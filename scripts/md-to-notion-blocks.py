#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = []
# ///
"""
notion-automation-studio — Markdown → Notion Block JSON 轉換器

將 SRS 需求文件的 Markdown 轉為 Notion API append-block-children 所需的
Block JSON 陣列。供 scripts/publish-to-notion.js orchestrator 呼叫。

支援 Block 類型：
- heading_1 / heading_2 / heading_3 / heading_4（含 is_toggleable、color）
- paragraph（含 color）
- bulleted_list_item / numbered_list_item（含巢狀 children）
- to_do（含 checked）
- toggle（含 children）
- quote（含多行合併、color）
- callout（含 icon emoji、color）
- code（含 language、caption）
- divider
- table / table_row（含 has_column_header）
- bookmark
- image（external URL / file_upload via --images-manifest）
- embed
- equation（block-level $$...$$）
- table_of_contents
- breadcrumb

Rich Text annotations 支援：
bold / italic / strikethrough / code / underline / link / inline equation

特殊處理：
- <!-- blue background --> 註解：H1 自動加上 color: blue_background
- <aside> ... </aside>：轉為 callout block
- 巢狀列表（2/4 空格縮排）

用法：
    uv run scripts/md-to-notion-blocks.py input.md              # stdout
    uv run scripts/md-to-notion-blocks.py input.md -o out.json  # 寫檔
    uv run scripts/md-to-notion-blocks.py input.md --compact    # 壓縮
"""

import sys
import json
import re
import os
import argparse
from pathlib import Path


# ============================================================
# Rich Text Parser
# ============================================================

def split_rich_text_content(content, max_len=2000):
    """
    將超過 max_len 的文字切成多段。
    切分優先順序：換行 > 空白 > 硬切。
    """
    if len(content) <= max_len:
        return [content]

    chunks = []
    remaining = content
    while remaining:
        if len(remaining) <= max_len:
            chunks.append(remaining)
            break

        # 優先在換行處切
        cut = remaining.rfind('\n', 0, max_len)
        if cut > 0:
            chunks.append(remaining[:cut])
            remaining = remaining[cut + 1:]
            continue

        # 次優先在空白處切
        cut = remaining.rfind(' ', 0, max_len)
        if cut > 0:
            chunks.append(remaining[:cut])
            remaining = remaining[cut + 1:]
            continue

        # 硬切
        chunks.append(remaining[:max_len])
        remaining = remaining[max_len:]

    return chunks


def parse_rich_text(text):
    """
    解析 Markdown 行內格式為 Notion rich_text 陣列。

    支援的格式（依優先順序）：
    1. inline code: `text`
    2. link: [text](url)
    3. image ref in text: ![alt](url) → 只取 alt text
    4. inline equation: $expr$
    5. bold + italic: ***text*** 或 ___text___
    6. bold: **text** 或 __text__
    7. italic: *text* 或 _text_
    8. strikethrough: ~~text~~
    9. underline: <u>text</u>
    10. plain text
    """
    if not text:
        return []

    parts = []

    # 統一的 regex pattern（順序很重要）
    pattern = re.compile(
        r'(`[^`]+`)'                              # 1. inline code
        r'|(\!\[([^\]]*)\]\(([^)]+)\))'           # 2. inline image ![alt](url)
        r'|(\[([^\]]+)\]\(([^)]+)\))'             # 3. link [text](url)
        r'|(\$([^$]+)\$)'                          # 4. inline equation $...$
        r'|(\*\*\*(.+?)\*\*\*)'                    # 5. bold+italic ***text***
        r'|(\_\_\_(.+?)\_\_\_)'                     # 6. bold+italic ___text___
        r'|(\*\*(.+?)\*\*)'                        # 7. bold **text**
        r'|(\_\_(.+?)\_\_)'                         # 8. bold __text__
        r'|(\*(.+?)\*)'                             # 9. italic *text*
        r'|(\_(.+?)\_)'                             # 10. italic _text_
        r'|(\~\~(.+?)\~\~)'                        # 11. strikethrough ~~text~~
        r'|(<u>(.+?)</u>)'                          # 12. underline <u>text</u>
    )

    last_end = 0
    for m in pattern.finditer(text):
        # 先加入 match 之前的純文字
        if m.start() > last_end:
            plain = text[last_end:m.start()]
            if plain:
                parts.extend(_text_obj_list(plain))

        if m.group(1):
            # inline code
            code_content = m.group(1)[1:-1]
            parts.extend(_text_obj_list(code_content, code=True))
        elif m.group(2):
            # inline image → 只取 alt text，圖片本身會在 block 層級處理
            alt_text = m.group(3) or "image"
            parts.extend(_text_obj_list(alt_text))
        elif m.group(5):
            # link [text](url)
            link_text = m.group(6)
            link_url = m.group(7)
            parts.extend(_text_obj_list(link_text, link=link_url))
        elif m.group(8):
            # inline equation
            expr = m.group(9)
            parts.append({
                "type": "equation",
                "equation": {"expression": expr}
            })
        elif m.group(10):
            # bold+italic ***
            parts.extend(_text_obj_list(m.group(11), bold=True, italic=True))
        elif m.group(12):
            # bold+italic ___
            parts.extend(_text_obj_list(m.group(13), bold=True, italic=True))
        elif m.group(14):
            # bold **
            parts.extend(_text_obj_list(m.group(15), bold=True))
        elif m.group(16):
            # bold __
            parts.extend(_text_obj_list(m.group(17), bold=True))
        elif m.group(18):
            # italic *
            parts.extend(_text_obj_list(m.group(19), italic=True))
        elif m.group(20):
            # italic _
            parts.extend(_text_obj_list(m.group(21), italic=True))
        elif m.group(22):
            # strikethrough ~~
            parts.extend(_text_obj_list(m.group(23), strikethrough=True))
        elif m.group(24):
            # underline <u>
            parts.extend(_text_obj_list(m.group(25), underline=True))

        last_end = m.end()

    # 剩餘文字
    if last_end < len(text):
        remaining = text[last_end:]
        if remaining:
            parts.extend(_text_obj_list(remaining))

    return parts if parts else _text_obj_list(text)


def _text_obj(content, bold=False, italic=False, strikethrough=False,
              underline=False, code=False, color="default", link=None):
    """建立一個 Notion rich_text text object"""
    obj = {
        "type": "text",
        "text": {
            "content": content,
            "link": {"url": link} if link else None
        }
    }

    annotations = {}
    if bold:
        annotations["bold"] = True
    if italic:
        annotations["italic"] = True
    if strikethrough:
        annotations["strikethrough"] = True
    if underline:
        annotations["underline"] = True
    if code:
        annotations["code"] = True
    if color != "default":
        annotations["color"] = color

    if annotations:
        obj["annotations"] = annotations

    return obj


def _text_obj_list(content, bold=False, italic=False, strikethrough=False,
                   underline=False, code=False, color="default", link=None):
    """建立 Notion rich_text text object 列表。content > 2000 字時自動拆分，共用 annotations。"""
    chunks = split_rich_text_content(content)
    return [
        _text_obj(chunk, bold=bold, italic=italic, strikethrough=strikethrough,
                  underline=underline, code=code, color=color, link=link)
        for chunk in chunks
    ]


# ============================================================
# Block Builders（依照 Notion API Block Reference）
# ============================================================

def block_heading(level, rich_text, color="default", is_toggleable=False):
    """heading_1 / heading_2 / heading_3 / heading_4"""
    key = f"heading_{level}"
    block = {
        "object": "block",
        "type": key,
        key: {
            "rich_text": rich_text,
            "color": color,
            "is_toggleable": is_toggleable
        }
    }
    return block


def block_paragraph(rich_text, color="default"):
    """paragraph"""
    return {
        "object": "block",
        "type": "paragraph",
        "paragraph": {
            "rich_text": rich_text,
            "color": color
        }
    }


def block_bulleted_list_item(rich_text, children=None, color="default"):
    """bulleted_list_item"""
    obj = {
        "object": "block",
        "type": "bulleted_list_item",
        "bulleted_list_item": {
            "rich_text": rich_text,
            "color": color
        }
    }
    if children:
        obj["bulleted_list_item"]["children"] = children
    return obj


def block_numbered_list_item(rich_text, children=None, color="default"):
    """numbered_list_item"""
    obj = {
        "object": "block",
        "type": "numbered_list_item",
        "numbered_list_item": {
            "rich_text": rich_text,
            "color": color
        }
    }
    if children:
        obj["numbered_list_item"]["children"] = children
    return obj


def block_to_do(rich_text, checked=False, color="default"):
    """to_do"""
    return {
        "object": "block",
        "type": "to_do",
        "to_do": {
            "rich_text": rich_text,
            "checked": checked,
            "color": color
        }
    }


def block_toggle(rich_text, children=None, color="default"):
    """toggle"""
    obj = {
        "object": "block",
        "type": "toggle",
        "toggle": {
            "rich_text": rich_text,
            "color": color
        }
    }
    if children:
        obj["toggle"]["children"] = children
    return obj


def block_quote(rich_text, color="default"):
    """quote"""
    return {
        "object": "block",
        "type": "quote",
        "quote": {
            "rich_text": rich_text,
            "color": color
        }
    }


def block_callout(rich_text, icon_emoji="💡", color="default"):
    """callout"""
    return {
        "object": "block",
        "type": "callout",
        "callout": {
            "rich_text": rich_text,
            "icon": {"emoji": icon_emoji},
            "color": color
        }
    }


def block_code(rich_text, language="plain text", caption=None):
    """code"""
    obj = {
        "object": "block",
        "type": "code",
        "code": {
            "rich_text": rich_text,
            "language": language
        }
    }
    if caption:
        obj["code"]["caption"] = caption
    else:
        obj["code"]["caption"] = []
    return obj


def block_divider():
    """divider"""
    return {
        "object": "block",
        "type": "divider",
        "divider": {}
    }


def block_table(table_width, rows, has_column_header=False, has_row_header=False):
    """table（含 table_row children）"""
    return {
        "object": "block",
        "type": "table",
        "table": {
            "table_width": table_width,
            "has_column_header": has_column_header,
            "has_row_header": has_row_header,
            "children": rows
        }
    }


def block_table_row(cells):
    """table_row"""
    return {
        "type": "table_row",
        "table_row": {
            "cells": cells
        }
    }


def block_bookmark(url, caption=None):
    """bookmark"""
    obj = {
        "object": "block",
        "type": "bookmark",
        "bookmark": {
            "url": url
        }
    }
    if caption:
        obj["bookmark"]["caption"] = caption
    else:
        obj["bookmark"]["caption"] = []
    return obj


def _resolve_image_manifest(url, images_map, md_dir):
    """
    嘗試在 images_map 中查找 url 對應的 file_upload entry。
    匹配策略：
    1. 直接 key match（url 原值）
    2. 正規化路徑 match（os.path.normpath(os.path.join(md_dir, url))）
    3. 後綴 match（normalized path 以 manifest key 結尾）
    回傳 manifest entry dict 或 None。
    """
    if url in images_map:
        return images_map[url]

    if md_dir:
        normalized = os.path.normpath(os.path.join(md_dir, url))
        if normalized in images_map:
            return images_map[normalized]
        for key, value in images_map.items():
            norm_key = os.path.normpath(key)
            if normalized.endswith(os.sep + norm_key) or normalized == norm_key:
                return value

    return None


def block_image(url, caption=None, images_map=None, md_dir=None):
    """image（external 或 file_upload）"""
    if images_map is not None:
        entry = _resolve_image_manifest(url, images_map, md_dir)
        if entry:
            obj = {
                "object": "block",
                "type": "image",
                "image": {
                    "type": "file_upload",
                    "file_upload": {
                        "id": entry["file_upload_id"]
                    }
                }
            }
            if caption:
                obj["image"]["caption"] = caption
            return obj
        print(
            f"image {url} not in manifest, fallback to external",
            file=sys.stderr,
        )

    obj = {
        "object": "block",
        "type": "image",
        "image": {
            "type": "external",
            "external": {
                "url": url
            }
        }
    }
    if caption:
        obj["image"]["caption"] = caption
    return obj


def block_embed(url):
    """embed"""
    return {
        "object": "block",
        "type": "embed",
        "embed": {
            "url": url
        }
    }


def block_equation(expression):
    """equation (block-level)"""
    return {
        "object": "block",
        "type": "equation",
        "equation": {
            "expression": expression
        }
    }


def block_table_of_contents(color="default"):
    """table_of_contents"""
    return {
        "object": "block",
        "type": "table_of_contents",
        "table_of_contents": {
            "color": color
        }
    }


def block_column_list(columns):
    """column_list block（columns 為 column block 陣列）"""
    return {
        "object": "block",
        "type": "column_list",
        "column_list": {},
        "children": columns
    }


def block_column(children, width_ratio=None):
    """column block（children 為 sub-block 陣列）"""
    col = {
        "object": "block",
        "type": "column",
        "column": {},
        "children": children
    }
    if width_ratio is not None:
        col["column"]["width_ratio"] = width_ratio
    return col


def block_breadcrumb():
    """breadcrumb"""
    return {
        "object": "block",
        "type": "breadcrumb",
        "breadcrumb": {}
    }


# ============================================================
# Markdown Line Parser
# ============================================================

def get_indent_level(line):
    """計算縮排層級（每 2 或 4 個空格為一層）"""
    stripped = line.lstrip(' ')
    spaces = len(line) - len(stripped)
    # 支援 2 空格或 4 空格縮排
    if spaces >= 4:
        return spaces // 4
    elif spaces >= 2:
        return spaces // 2
    return 0


def classify_line(line):
    """
    分類一行 Markdown 的類型。
    回傳 (type, content, metadata)
    """
    stripped = line.strip()

    # 空行
    if stripped == '':
        return 'empty', '', {}

    # HTML 註解行（獨立行，不含在 heading 裡的）
    if stripped.startswith('<!--') and stripped.endswith('-->'):
        return 'html_comment', stripped, {}

    # Divider（--- 或 *** 或 ___，至少 3 個）
    if re.match(r'^(-{3,}|\*{3,}|_{3,})$', stripped):
        return 'divider', '', {}

    # Heading
    heading_match = re.match(r'^(#{1,6})\s+(.+)$', stripped)
    if heading_match:
        level = len(heading_match.group(1))
        content = heading_match.group(2)
        return f'heading_{level}', content, {}

    # Code fence start
    code_match = re.match(r'^```(\w*)$', stripped)
    if code_match:
        lang = code_match.group(1) or 'plain text'
        return 'code_fence', '', {'language': lang}

    # Table row
    if stripped.startswith('|') and stripped.endswith('|'):
        return 'table_row', stripped, {}

    # Columns HTML-like tags (guarded by '<' prefix to skip regex on non-tag lines)
    if stripped.startswith('<') or stripped.startswith('</'):
        if re.match(r'^<columns\s*>$', stripped, re.IGNORECASE):
            return 'columns_start', '', {}
        if re.match(r'^</columns\s*>$', stripped, re.IGNORECASE):
            return 'columns_end', '', {}
        col_match = re.match(r'^<column(?:\s+width_ratio=["\']?([\d.]+)["\']?)?\s*>$', stripped, re.IGNORECASE)
        if col_match:
            ratio = float(col_match.group(1)) if col_match.group(1) else None
            return 'column_start', '', {'width_ratio': ratio}
        if re.match(r'^</column\s*>$', stripped, re.IGNORECASE):
            return 'column_end', '', {}

    # Callout HTML
    if stripped.lower().startswith('<aside'):
        return 'callout_start', stripped, {}
    if stripped.lower().startswith('</aside>'):
        return 'callout_end', stripped, {}

    # Toggle HTML
    toggle_match = re.match(r'^<toggle(?:\s+title=["\']([^"\']*)["\'])?\s*>$', stripped, re.IGNORECASE)
    if toggle_match:
        title = toggle_match.group(1) or ''
        return 'toggle_start', title, {}
    if stripped.lower() == '</toggle>':
        return 'toggle_end', '', {}

    # Embed @[embed](url)
    embed_match = re.match(r'^@\[embed\]\(([^)]+)\)$', stripped)
    if embed_match:
        url = embed_match.group(1)
        return 'embed', url, {}

    # Bookmark @[bookmark](url)
    bookmark_match = re.match(r'^@\[bookmark\]\(([^)]+)\)$', stripped)
    if bookmark_match:
        url = bookmark_match.group(1)
        return 'bookmark', url, {}

    # Block equation $$...$$
    if stripped.startswith('$$') and stripped.endswith('$$') and len(stripped) > 4:
        expr = stripped[2:-2].strip()
        return 'equation', expr, {}
    if stripped == '$$':
        return 'equation_fence', '', {}

    # Image ![alt](url)
    img_match = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)$', stripped)
    if img_match:
        alt = img_match.group(1)
        url = img_match.group(2)
        return 'image', url, {'alt': alt}

    # Quote（支援多行）
    if stripped.startswith('> '):
        return 'quote', stripped[2:], {}
    if stripped == '>':
        return 'quote', '', {}

    # [TOC] 或 [[toc]] → table_of_contents
    if stripped.lower() in ('[toc]', '[[toc]]'):
        return 'toc', '', {}

    # 計算縮排
    indent = get_indent_level(line)
    content_stripped = line.lstrip()

    # To-do list
    todo_match = re.match(r'^- \[([ xX])\]\s+(.+)$', content_stripped)
    if todo_match:
        checked = todo_match.group(1).lower() == 'x'
        text = todo_match.group(2)
        return 'to_do', text, {'checked': checked, 'indent': indent}

    # Bulleted list（- 或 * 或 +）
    bullet_match = re.match(r'^[-*+]\s+(.+)$', content_stripped)
    if bullet_match:
        text = bullet_match.group(1)
        return 'bulleted_list', text, {'indent': indent}

    # Numbered list
    num_match = re.match(r'^\d+\.\s+(.+)$', content_stripped)
    if num_match:
        text = num_match.group(1)
        return 'numbered_list', text, {'indent': indent}

    # 段落（fallback）
    return 'paragraph', stripped, {}


# ============================================================
# Main Converter
# ============================================================

def _parse_columns(lines, i, line_num, images_map=None, md_dir=None):
    """
    從 <columns> 後開始收集 column blocks 直到 </columns>。
    回傳 (columns_list, next_i)。
    """
    columns = []
    ratios = []

    while i < len(lines):
        lt, lc, lm = classify_line(lines[i])

        if lt == 'columns_end':
            i += 1
            break

        if lt == 'column_start':
            ratio = lm.get('width_ratio')
            if ratio is not None:
                ratios.append(ratio)
            children, i = _parse_column_children(lines, i + 1, line_num, images_map=images_map, md_dir=md_dir)
            columns.append(block_column(children, width_ratio=ratio))
            continue

        if lt == 'empty':
            i += 1
            continue

        print(
            f"警告：<columns>（行 {line_num}）內發現非預期內容（行 {i + 1}），已忽略",
            file=sys.stderr,
        )
        i += 1

    if ratios and len(ratios) == len(columns):
        ratio_sum = sum(ratios)
        if abs(ratio_sum - 1.0) > 0.01:
            print(
                f"警告：<columns>（行 {line_num}）的 width_ratio 總和為 {ratio_sum}，預期 1.0",
                file=sys.stderr,
            )

    return columns, i


def _parse_column_children(lines, i, columns_line_num, images_map=None, md_dir=None):
    """
    從 <column> 後開始收集 sub-blocks 直到 </column>。
    回傳 (children, next_i)。
    """
    children = []

    while i < len(lines):
        lt, lc, lm = classify_line(lines[i])

        if lt == 'column_end':
            i += 1
            break

        if lt == 'columns_start':
            raise ValueError(
                f"行 {i + 1}：<columns> 不可巢狀在 <column> 內（v1 限制）"
            )

        if lt == 'empty':
            i += 1
            continue

        # 將 column 內的行轉成 sub-blocks
        if lt.startswith('heading_'):
            level = int(lt[-1])
            if level <= 4:
                children.append(block_heading(level, parse_rich_text(lc)))
            else:
                children.append(block_paragraph(_text_obj_list(lc, bold=True)))
                print(f"H{level} downgraded to bold paragraph, consider restructuring source", file=sys.stderr)
            i += 1
        elif lt == 'image':
            alt = lm.get('alt', '')
            caption = parse_rich_text(alt) if alt else None
            children.append(block_image(lc, caption=caption, images_map=images_map, md_dir=md_dir))
            i += 1
        elif lt == 'paragraph':
            children.append(block_paragraph(parse_rich_text(lc)))
            i += 1
        elif lt == 'bulleted_list':
            block, i = _parse_list_with_children(lines, i, 'bulleted')
            children.append(block)
        elif lt == 'numbered_list':
            block, i = _parse_list_with_children(lines, i, 'numbered')
            children.append(block)
        else:
            # 其他行類型作為 paragraph fallback
            children.append(block_paragraph(parse_rich_text(lc)))
            i += 1

    return children, i


def convert_markdown_to_blocks(text, images_map=None, md_dir=None):
    """
    將 Markdown 文字轉換為 Notion Block 陣列。
    images_map: 圖片 manifest dict（key → {file_upload_id}），None 表示 external URL 模式。
    md_dir: markdown 檔案所在目錄的絕對路徑，用於 image path normalization。
    """
    lines = text.split('\n')
    blocks = []
    i = 0

    while i < len(lines):
        line = lines[i]
        line_type, content, meta = classify_line(line)

        # ---- Empty ----
        if line_type == 'empty':
            i += 1
            continue

        # ---- HTML Comment (standalone) ----
        if line_type == 'html_comment':
            i += 1
            continue

        # ---- Divider ----
        if line_type == 'divider':
            blocks.append(block_divider())
            i += 1
            continue

        # ---- Headings ----
        if line_type.startswith('heading_'):
            level = int(line_type[-1])
            color = "default"

            # 處理 <!-- blue background --> 註解
            if '<!-- blue background -->' in content:
                content = content.replace('<!-- blue background -->', '').strip()
                color = "blue_background"

            # 處理其他顏色註解 <!-- COLOR -->
            color_match = re.search(r'<!--\s*(\w+(?:_\w+)?)\s*-->', content)
            if color_match:
                potential_color = color_match.group(1)
                valid_colors = [
                    "blue", "blue_background", "brown", "brown_background",
                    "default", "gray", "gray_background", "green", "green_background",
                    "orange", "orange_background", "pink", "pink_background",
                    "purple", "purple_background", "red", "red_background",
                    "yellow", "yellow_background"
                ]
                if potential_color in valid_colors:
                    color = potential_color
                    content = re.sub(r'<!--\s*\w+(?:_\w+)?\s*-->', '', content).strip()

            if level <= 4:
                rich_text = parse_rich_text(content)
                blocks.append(block_heading(level, rich_text, color=color))
            else:
                # H5/H6 → paragraph with bold rich_text
                rich_text = _text_obj_list(content, bold=True)
                blocks.append(block_paragraph(rich_text, color=color))
                print(
                    f"H{level} downgraded to bold paragraph, consider restructuring source",
                    file=sys.stderr,
                )
            i += 1
            continue

        # ---- Code Fence ----
        if line_type == 'code_fence':
            language = meta.get('language', 'plain text')
            # 對應 Notion 支援的語言名稱
            lang_map = {
                'js': 'javascript', 'ts': 'typescript', 'py': 'python',
                'rb': 'ruby', 'rs': 'rust', 'sh': 'shell', 'bash': 'bash',
                'yml': 'yaml', 'md': 'markdown', 'txt': 'plain text',
                'objc': 'objective-c', 'cpp': 'c++', 'csharp': 'c#',
                'cs': 'c#', 'vb': 'visual basic', 'vue': 'javascript',
                'jsx': 'javascript', 'tsx': 'typescript', 'scss': 'scss',
                'less': 'less', 'graphql': 'graphql', 'proto': 'protobuf',
                'tf': 'haskell', 'hs': 'haskell', 'ex': 'elixir',
                'dockerfile': 'docker', 'makefile': 'makefile',
            }
            language = lang_map.get(language.lower(), language.lower())

            # 收集 code block 內容
            code_lines = []
            i += 1
            while i < len(lines):
                if lines[i].strip() == '```':
                    i += 1
                    break
                code_lines.append(lines[i])
                i += 1

            code_content = '\n'.join(code_lines)
            rich_text = _text_obj_list(code_content)
            blocks.append(block_code(rich_text, language=language))
            continue

        # ---- Table ----
        if line_type == 'table_row':
            table_rows = []
            table_width = 0
            has_header = False

            while i < len(lines):
                lt, lc, lm = classify_line(lines[i])
                if lt != 'table_row':
                    break

                cells = [c.strip() for c in lc.split('|')[1:-1]]

                # 偵測分隔行 |---|---|
                if all(re.match(r'^[-:]+$', c) for c in cells):
                    has_header = True
                    i += 1
                    continue

                if not table_width:
                    table_width = len(cells)

                row = block_table_row([parse_rich_text(cell) for cell in cells])
                table_rows.append(row)
                i += 1

            blocks.append(block_table(table_width, table_rows, has_column_header=has_header))
            continue

        # ---- Callout (HTML <aside>) ----
        if line_type == 'callout_start':
            callout_lines = []
            icon = "💡"  # 預設 icon
            i += 1

            while i < len(lines):
                lt, lc, lm = classify_line(lines[i])
                if lt == 'callout_end':
                    i += 1
                    break
                if lt == 'columns_start':
                    raise ValueError(
                        f"行 {i + 1}：<columns> 不可巢狀在 <aside>（callout）內（v1 限制）"
                    )
                stripped = lines[i].strip()
                # 偵測 emoji 行作為 icon
                if len(stripped) <= 2 and stripped:
                    # 可能是 emoji icon（如 📍、⭐、💡）
                    try:
                        # 簡單判斷：如果只有 1-2 個字元且不是一般文字
                        if not stripped.isascii():
                            icon = stripped
                            i += 1
                            continue
                    except Exception:
                        pass
                callout_lines.append(stripped)
                i += 1

            text_content = '\n'.join(callout_lines).strip()
            rich_text = parse_rich_text(text_content)
            blocks.append(block_callout(rich_text, icon_emoji=icon))
            continue

        # ---- Quote ----
        if line_type == 'quote':
            quote_parts = [content]
            i += 1
            while i < len(lines):
                lt, lc, lm = classify_line(lines[i])
                if lt == 'quote':
                    quote_parts.append(lc)
                    i += 1
                else:
                    break

            combined = '\n'.join(quote_parts)
            rich_text = parse_rich_text(combined)
            blocks.append(block_quote(rich_text))
            continue

        # ---- Block Equation ----
        if line_type == 'equation':
            blocks.append(block_equation(content))
            i += 1
            continue

        if line_type == 'equation_fence':
            # 收集 $$ ... $$ 之間的內容
            expr_lines = []
            i += 1
            while i < len(lines):
                if lines[i].strip() == '$$':
                    i += 1
                    break
                expr_lines.append(lines[i])
                i += 1
            expression = '\n'.join(expr_lines)
            blocks.append(block_equation(expression))
            continue

        # ---- Embed ----
        if line_type == 'embed':
            blocks.append(block_embed(content))
            i += 1
            continue

        # ---- Bookmark ----
        if line_type == 'bookmark':
            blocks.append(block_bookmark(content))
            i += 1
            continue

        # ---- Columns (<columns>...<column>...</column>...</columns>) ----
        if line_type == 'columns_start':
            columns, i = _parse_columns(lines, i + 1, line_num=i + 1, images_map=images_map, md_dir=md_dir)
            blocks.append(block_column_list(columns))
            continue

        # ---- Toggle (<toggle>...</toggle>) ----
        if line_type == 'toggle_start':
            toggle_title = content or 'Toggle'
            toggle_children = []
            i += 1

            while i < len(lines):
                lt, lc, lm = classify_line(lines[i])
                if lt == 'toggle_end':
                    i += 1
                    break
                if lt == 'columns_start':
                    raise ValueError(
                        f"行 {i + 1}：<columns> 不可巢狀在 <toggle> 內（v1 限制）"
                    )
                # 遞迴收集 toggle 內的 blocks
                # 為簡化處理，將 toggle 內的內容作為段落
                if lt == 'empty':
                    i += 1
                    continue
                if lt == 'paragraph':
                    toggle_children.append(block_paragraph(parse_rich_text(lc)))
                elif lt == 'image':
                    alt = lm.get('alt', '')
                    caption = parse_rich_text(alt) if alt else None
                    toggle_children.append(block_image(lc, caption=caption, images_map=images_map, md_dir=md_dir))
                elif lt == 'embed':
                    toggle_children.append(block_embed(lc))
                elif lt.startswith('heading_'):
                    hlevel = int(lt[-1])
                    if hlevel <= 4:
                        toggle_children.append(block_heading(hlevel, parse_rich_text(lc)))
                    else:
                        toggle_children.append(block_paragraph(_text_obj_list(lc, bold=True)))
                        print(f"H{hlevel} downgraded to bold paragraph, consider restructuring source", file=sys.stderr)
                else:
                    toggle_children.append(block_paragraph(parse_rich_text(lc)))
                i += 1

            rich_text = parse_rich_text(toggle_title)
            blocks.append(block_toggle(rich_text, children=toggle_children if toggle_children else None))
            continue

        # ---- Image ----
        if line_type == 'image':
            alt = meta.get('alt', '')
            caption = parse_rich_text(alt) if alt else None
            blocks.append(block_image(content, caption=caption, images_map=images_map, md_dir=md_dir))
            i += 1
            continue

        # ---- TOC ----
        if line_type == 'toc':
            blocks.append(block_table_of_contents())
            i += 1
            continue

        # ---- To-Do List ----
        if line_type == 'to_do':
            checked = meta.get('checked', False)
            rich_text = parse_rich_text(content)
            blocks.append(block_to_do(rich_text, checked=checked))
            i += 1
            continue

        # ---- Bulleted List ----
        if line_type == 'bulleted_list':
            block, i = _parse_list_with_children(lines, i, 'bulleted')
            blocks.append(block)
            continue

        # ---- Numbered List ----
        if line_type == 'numbered_list':
            block, i = _parse_list_with_children(lines, i, 'numbered')
            blocks.append(block)
            continue

        # ---- Paragraph ----
        if line_type == 'paragraph':
            rich_text = parse_rich_text(content)
            blocks.append(block_paragraph(rich_text))
            i += 1
            continue

        # 預設：跳過
        i += 1

    return blocks


def _parse_list_with_children(lines, start_idx, list_type):
    """
    解析列表項目，支援巢狀 children。
    回傳 (block, next_index)
    """
    i = start_idx
    line_type, content, meta = classify_line(lines[i])
    current_indent = meta.get('indent', 0)
    rich_text = parse_rich_text(content)

    i += 1

    # 收集子項目
    children = []
    while i < len(lines):
        lt, lc, lm = classify_line(lines[i])

        if lt in ('bulleted_list', 'numbered_list', 'to_do'):
            child_indent = lm.get('indent', 0)
            if child_indent > current_indent:
                child_block, i = _parse_list_with_children(lines, i, lt.replace('_list', '').replace('bulleted', 'bulleted').replace('numbered', 'numbered'))
                children.append(child_block)
            else:
                break
        elif lt == 'empty':
            # 空行可能是列表間的分隔
            # 看下一行是否還是同層或更深的列表
            if i + 1 < len(lines):
                next_lt, _, next_lm = classify_line(lines[i + 1])
                if next_lt in ('bulleted_list', 'numbered_list', 'to_do'):
                    next_indent = next_lm.get('indent', 0)
                    if next_indent > current_indent:
                        i += 1
                        continue
            break
        else:
            break

    if list_type == 'bulleted' or list_type == 'bulleted_list':
        block = block_bulleted_list_item(rich_text, children=children if children else None)
    elif list_type == 'numbered' or list_type == 'numbered_list':
        block = block_numbered_list_item(rich_text, children=children if children else None)
    elif list_type == 'to_do':
        checked = meta.get('checked', False)
        block = block_to_do(rich_text, checked=checked)
    else:
        block = block_bulleted_list_item(rich_text, children=children if children else None)

    return block, i


# ============================================================
# CLI Entry Point
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description='notion-automation-studio — Markdown → Notion Block JSON 轉換器'
    )
    parser.add_argument('input', help='輸入的 Markdown 檔案路徑')
    parser.add_argument('-o', '--output', help='輸出的 JSON 檔案路徑（預設 stdout）')
    parser.add_argument('--pretty', action='store_true', default=True,
                        help='格式化 JSON 輸出（預設開啟）')
    parser.add_argument('--compact', action='store_true',
                        help='壓縮 JSON 輸出（關閉格式化）')
    parser.add_argument('--images-manifest',
                        help='圖片 manifest JSON 路徑；提供時 image block 改為 file_upload 模式')

    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"錯誤：找不到檔案 {args.input}", file=sys.stderr)
        sys.exit(1)

    with open(input_path, 'r', encoding='utf-8') as f:
        md_content = f.read()

    images_map = None
    md_dir = None
    if args.images_manifest:
        manifest_path = Path(args.images_manifest)
        if not manifest_path.exists():
            print(f"錯誤：找不到 manifest 檔案 {args.images_manifest}", file=sys.stderr)
            sys.exit(1)
        with open(manifest_path, 'r', encoding='utf-8') as f:
            images_map = json.load(f)
        md_dir = str(input_path.resolve().parent)

    blocks = convert_markdown_to_blocks(md_content, images_map=images_map, md_dir=md_dir)

    indent = None if args.compact else 2
    json_output = json.dumps(blocks, indent=indent, ensure_ascii=False)

    if args.output:
        output_path = Path(args.output)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(json_output)
        print(f"已輸出 {len(blocks)} 個 blocks 到 {args.output}", file=sys.stderr)
    else:
        print(json_output)


if __name__ == "__main__":
    main()
