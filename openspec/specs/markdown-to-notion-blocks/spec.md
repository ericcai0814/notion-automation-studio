# markdown-to-notion-blocks Specification

## Purpose

Deterministic Python CLI converter that transforms a markdown file into Notion
REST API block JSON. Consumed by the publish orchestrator as a subprocess — reads
a file path, writes a JSON array to stdout. Zero external dependencies (Python 3
stdlib only), invoked via `uv run`.

## Requirements

### Requirement: Converter CLI contract

The plugin SHALL provide a deterministic markdown-to-block converter
at `scripts/md-to-notion-blocks.py`. The script MUST be executable
via `uv run` under Python 3.8+ using only the standard library
(`sys`, `json`, `re`, `argparse`, `pathlib`, `os`, `hashlib`). The
plugin SHALL NOT introduce a `pyproject.toml`, `requirements.txt`, or
`site-packages` dependency tree for this capability. The script file
SHALL contain a PEP 723 inline script metadata block declaring
`requires-python = ">=3.8"` and `dependencies = []`, plus a shebang
line `#!/usr/bin/env -S uv run --script` so that direct execution
(`./scripts/md-to-notion-blocks.py`) works identically to explicit
`uv run` invocation.

#### Scenario: Happy-path invocation

- **WHEN** the script runs as
  `uv run scripts/md-to-notion-blocks.py <md_file>`
- **THEN** stdout contains a single JSON document: an array of
  Notion block JSON objects in the order they appear in the source
- **AND** exit code is 0

#### Scenario: Direct shebang invocation

- **WHEN** the script runs as `./scripts/md-to-notion-blocks.py <md_file>`
  (executable bit set)
- **THEN** the shebang `#!/usr/bin/env -S uv run --script` dispatches
  to `uv run` transparently and the behavior is identical to
  explicit `uv run`

#### Scenario: File not found

- **WHEN** the `<md_file>` argument points to a non-existent path
- **THEN** stderr contains an error message naming the missing path
- **AND** exit code is 1

#### Scenario: Output file option

- **WHEN** the `-o <out_file>` flag is provided
- **THEN** the JSON document is written to `<out_file>` instead of
  stdout, and a one-line summary (block count and output path) is
  printed to stderr

#### Scenario: Compact mode

- **WHEN** the `--compact` flag is provided
- **THEN** JSON output has no indentation or trailing whitespace
- **AND** it remains valid JSON that round-trips through `json.loads`

---
### Requirement: Block type coverage

The converter SHALL produce valid Notion block JSON for the following
block types, each matching the Notion REST API schema exactly:

`heading_1`, `heading_2`, `heading_3`, `heading_4`, `paragraph`,
`bulleted_list_item` (nested), `numbered_list_item` (nested), `to_do`,
`toggle`, `quote`, `callout`, `code`, `divider`, `table`, `table_row`,
`bookmark`, `image` (external and file_upload modes), `embed`,
`equation` (block), `table_of_contents`, `breadcrumb`, `column_list`,
`column`.

#### Scenario: Heading with color annotation

- **WHEN** the source contains
  `# 大標題 <!-- blue_background -->`
- **THEN** the emitted heading_1 block has
  `heading_1.color == "blue_background"` and `rich_text` free of the
  comment

#### Scenario: Bulleted list with nesting

- **WHEN** the source contains a two-space indented bullet under a
  top-level bullet
- **THEN** the top-level bulleted_list_item includes `children`
  containing the nested bulleted_list_item

#### Scenario: Table with header row

- **WHEN** the source contains a pipe table with a `|---|---|`
  separator row after the first row
- **THEN** the emitted table block has `has_column_header: true` and
  `children` equal to the list of non-separator `table_row` blocks

#### Scenario: Code fence language mapping

- **WHEN** the source contains ` ```ts ` opening fence
- **THEN** the emitted code block has `code.language == "typescript"`

---
### Requirement: Rich text annotations

The converter SHALL parse inline markdown annotations into Notion
rich_text annotations: `bold`, `italic`, `strikethrough`, `code`,
`underline`, `link`, and inline `equation`. Combined annotations
(e.g., bold+italic) SHALL merge correctly into a single rich_text
item's `annotations` object.

#### Scenario: Combined bold italic

- **WHEN** the source contains `***重點***`
- **THEN** the emitted rich_text item has
  `annotations.bold == true` and `annotations.italic == true`

#### Scenario: Link inside paragraph

- **WHEN** the source contains `點擊[這裡](https://example.com)`
- **THEN** the emitted rich_text array contains two items: a plain
  item "點擊" and a link item "這裡" with
  `text.link.url == "https://example.com"`

#### Scenario: Inline equation

- **WHEN** the source contains `$e=mc^2$`
- **THEN** the emitted rich_text item has `type == "equation"` and
  `equation.expression == "e=mc^2"`

---
### Requirement: Columns block parsing

The converter SHALL recognize `<columns>` and `<column>` HTML-like
tags as container markers for `column_list` and `column` Notion
blocks respectively. The `<column>` tag SHALL accept an optional
`width_ratio` attribute as a decimal number. Children SHALL be placed
inside the type-specific object (`column_list.children` /
`column.children`), not at the block top level.

#### Scenario: Two-column layout with equal widths

- **WHEN** the source contains:
  ```
  <columns>
  <column>
  **Left**
  ![Left](../assets/x/left.png)
  </column>
  <column>
  **Right**
  ![Right](../assets/x/right.png)
  </column>
  </columns>
  ```
- **THEN** the output contains one `column_list` block with
  `column_list.children` containing two `column` blocks, each with
  `column.children` containing a paragraph and an image block

#### Scenario: Explicit width ratios

- **WHEN** the source contains `<column width_ratio="0.3">` and
  `<column width_ratio="0.7">` within the same `<columns>` block
- **THEN** the emitted column blocks carry `column.width_ratio` of
  0.3 and 0.7 respectively

#### Scenario: Width ratio sum mismatch

- **WHEN** the `width_ratio` values within a single `<columns>` do
  not sum to 1 (within 0.01 tolerance)
- **THEN** the converter SHALL print a warning to stderr naming the
  column_list line number and the observed sum
- **AND** the converter SHALL still emit valid column blocks (not
  abort)

#### Scenario: Unsupported nesting

- **WHEN** a `<columns>` tag appears inside a `<toggle>` or
  `<aside>` block
- **THEN** the converter SHALL exit with a non-zero code and stderr
  stating "<columns> nested inside toggle/callout is not supported in
  v1"

---
### Requirement: Image file_upload mode

The converter SHALL accept an optional `--images-manifest <path>`
flag naming a JSON file mapping relative image paths to
`{file_upload_id: string}` entries. When provided, the converter
SHALL emit image blocks with
`{image: {type: "file_upload", file_upload: {id: <id>}}}` for all
matched images and fall back to the external URL form for unmatched
images.

#### Scenario: Manifest hit

- **WHEN** the manifest contains
  `{"R0001/diagram.png": {"file_upload_id": "uuid-1"}}` and the
  source contains `![流程圖](../assets/R0001/diagram.png)`
- **THEN** the emitted image block has
  `image.type == "file_upload"` and
  `image.file_upload.id == "uuid-1"`, with caption rich_text "流程圖"

#### Scenario: Manifest miss

- **WHEN** an image path is not found in the manifest
- **THEN** the converter SHALL emit an external URL image block
  (unchanged from no-manifest behavior) and print a warning to stderr
  listing the missed path
- **AND** the converter SHALL NOT abort

#### Scenario: Relative path normalization

- **WHEN** the source markdown file sits at
  `3-B-SRS/output/requirements-3-B.md` and contains
  `![](../assets/R0001/x.png)`
- **THEN** the converter SHALL normalize the path to
  `R0001/x.png` (relative to the batch root) before looking up in
  the manifest

---
### Requirement: H4+ heading downgrade

The converter SHALL handle headings of level 4 and deeper per the
following policy (updated after spike 1.6 confirmed `heading_4`
exists in Notion API version 2022-06-28):

- `####` (H4) maps directly to `heading_4` (no downgrade)
- `#####` (H5) and `######` (H6) downgrade to `paragraph` with a
  bold rich_text item containing the heading content

#### Scenario: H4 in source

- **WHEN** the source contains `#### 小節`
- **THEN** the emitted block is `heading_4` with rich_text "小節"

#### Scenario: H5 in source

- **WHEN** the source contains `##### 更小的小節`
- **THEN** the emitted block is a paragraph whose first rich_text
  item has `annotations.bold == true` and content "更小的小節"
- **AND** stderr contains a warning about the downgrade

---
### Requirement: Long rich text content splitting

The converter SHALL split rich_text content exceeding 2000 characters
into multiple rich_text items within the same block, preserving
annotations. Splits SHALL prefer newline boundaries, then whitespace,
then hard cut at 2000 chars.

#### Scenario: Paragraph over 2000 characters

- **WHEN** a single paragraph contains 3500 characters of plain text
- **THEN** the emitted paragraph block contains two rich_text items,
  neither exceeding 2000 characters
- **AND** the concatenation of their `text.content` fields equals
  the original content

#### Scenario: Long bold segment

- **WHEN** a single `**...**` region contains 2500 characters
- **THEN** the emitted rich_text items each carry
  `annotations.bold == true`

---
### Requirement: HTML-like tag containers

The converter SHALL recognize `<toggle title="...">`, `<aside>`, and
`<columns>` HTML-like tags as container markers that wrap child
markdown blocks. Closing tags SHALL be `</toggle>`, `</aside>`, and
`</columns>` respectively (case-insensitive).

#### Scenario: Callout container

- **WHEN** the source contains `<aside>` followed by a paragraph and
  `</aside>`
- **THEN** the emitted callout block has the paragraph content as
  `rich_text`

#### Scenario: Toggle container

- **WHEN** the source contains
  `<toggle title="詳細說明">` followed by two paragraphs and
  `</toggle>`
- **THEN** the emitted toggle block has rich_text "詳細說明" and
  two paragraph children
