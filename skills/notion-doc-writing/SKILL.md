---
name: notion-doc-writing
description: >
  寫入 Notion 頁面與資料庫的結構、風格、block 選用規則與陷阱避坑指南。
  當用戶說「寫成 Notion 頁面」「整理到 Notion」「寫一份 Notion PRD/ADR/
  會議記錄/事故覆盤/Runbook」「Notion 排版」「Notion 屬性怎麼設」時觸發。
  也適用於呼叫 notion-create-pages、notion-update-page、notion-create-database、
  notion-update-data-source、notion-create-comment 等 MCP tool 之前，
  需要確認 Notion-flavored markdown 格式、property 寫法、size limits 的場景。
  補官方 notion-workspace-plugin 的空白——官方負責工具層，這份負責內容層。
metadata:
  source_urls:
    - notion://docs/enhanced-markdown-spec
    - notion://docs/view-dsl-spec
    - https://developers.notion.com/reference/request-limits
    - https://developers.notion.com/guides/data-apis/working-with-page-content
  fetched_date: 2026-04-13
---

# Notion Doc Writing

寫入 Notion 時的**內容層**守則：結構、block 選用、屬性命名、size limits、陷阱避坑。

官方 `notion-workspace-plugin` 已涵蓋**工具層**（MCP server + 14 個 tool + 9 個 `/Notion:*` slash commands）。這份 skill 補官方沒做的：頁面實際長什麼樣、怎麼排版、怎麼不踩 Notion-flavored markdown 的陷阱。

## When to Activate

- 呼叫任一 Notion 寫入 MCP tool 前：`notion-create-pages` / `notion-update-page` / `notion-create-database` / `notion-update-data-source` / `notion-create-comment`
- 用戶明確說「寫成 Notion 頁面」「整理到 Notion」「Notion 排版」「Notion 屬性怎麼設」
- 要做 PRD / ADR / 會議記錄 / 事故覆盤 / Runbook 並打算放到 Notion
- 懷疑 markdown 格式或 property 寫法要踩雷時（多行 quote、callout 內格式、多源 DB、date 屬性等）

## Core Rules

### 1. 寫入前 3 件事（每次都做）

1. **有目標 DB → 先 fetch 拿 schema**：呼叫 `notion-fetch` 拿 `<data-source url="collection://...">` 內的 `data_source_id` 與 property 真實名稱。**不要憑記憶猜 property name**。
2. **對 markdown 語法有任何不確定 → 讀 MCP resource**：`notion://docs/enhanced-markdown-spec` 是一手權威規格。這份 skill **不重現** spec，只補陷阱清單。
3. **估 size**：payload 上限 500KB、block children 上限 1000 元素、批次建頁上限 100 個（同 parent）。超過要分批。

### 2. Title 與 Properties 硬規則

- Title **只**放在 `properties.title`，**絕不**寫在 content 第一行（會重複又難看）
- 每張 DB 恰好一個 title 欄位，名稱可能不是 `"title"`——看 schema
- Property 名稱是 `id` 或 `url`（不分大小寫）→ 必須前綴 `userDefined:`，例：`userDefined:URL`、`userDefined:id`
- Date property 要**拆三個 key**：`date:{name}:start` / `date:{name}:end`（可選）/ `date:{name}:is_datetime`（0 或 1）
- Checkbox 用**字串** `"__YES__"` / `"__NO__"`，**不是** true/false
- 多源 DB 的 parent 必須 `data_source_id`，**不能** `database_id`（單源可，多源會報錯）
- Wiki DB 的 parent 必須用 `page_id`（DB 的 page URL），不能用 `data_source_id`

### 3. 內容排版原則

- **Tab 縮排**（不是空格）
- **不用** `<empty-block/>`：Notion 自動處理段落間距，除非真的要刻意空一行且沒其他 block
- Heading **最深到 H4**（H5/H6 自動降級為 H4）
- List 項目**必須**包含 inline rich text——空項目在 UI 裡會是奇怪的空圓點
- 多行 quote **必須**用 `<br>` 連接，不能用 newline（每個 newline 會切成獨立 quote block）
- Callout 與 table cell 內部**用 markdown**（`**bold**`），**不用** HTML（`<strong>`）
- Code block 裡的特殊字元**不要**轉義，照原樣寫
- Inline math：`$` 前需空白、結尾 `$` 後需空白；`$` **右側**不能有空白，結尾 `$` **左側**不能有空白

### 4. Block 選用快速指引（詳見 `block-selection.md`）

| 情境 | 用什麼 |
|---|---|
| 隱藏大段可摺疊細節 | `<details>` toggle 或 `# X {toggle="true"}` |
| 強調重點、且要包多個子 block | `<callout icon="💡">` |
| 程式碼或 >1 行的指令 | ` ```lang ` code block |
| 引用他人說法 / 出處 | `> quote` |
| 強烈分段（大部分 H1-H3 就夠） | `---` divider |
| 結構化對照資料 | `<table>`（cells 只能放 rich text） |
| 補充閱讀 / 外部連結 | citation `[^url]` 或 link |
| 視覺化流程或關係 | ` ```mermaid ` |

### 5. Mention vs `<page>` tag（這個很容易踩雷）

- 想**引用**已存在的頁/DB、不搬動 → `<mention-page url="...">` / `<mention-database url="...">`
- 想把既有頁**搬動**為當前頁的子頁 → `<page url="...">Title</page>` ⚠️
- `<page>` tag 從 content 中**刪除**等於**刪除那個子頁**（除非 `allow_deleting_content: true` 且你明確同意）
- 更新頁面內容（`replace_content`）時若會影響到子頁，API 會先擋下來

### 6. 不要重現 spec

寫 markdown 有任何疑問：**讀 `notion://docs/enhanced-markdown-spec`**，不要用一般 markdown / CommonMark 的知識硬猜。Notion-flavored 有多處不同：mention XML tag、`{color="..."}` 屬性、toggle 的 `<details>`、callout、multi-line quote 處理、table 結構等。

## Size Limits 速查

| 項目 | 上限 |
|---|---|
| Rich text `text.content`（單段） | 2000 字元 |
| URL | 2000 字元 |
| Equation expression | 1000 字元 |
| Email | 200 字元 |
| Phone number | 200 字元 |
| Rich text array per block | 100 元素 |
| Multi-select options | 100 |
| Relation related pages | 100 |
| People property users | 100 |
| Block children per request | 1000 |
| Overall payload | 500KB |
| `notion-create-pages` 批次上限 | 100（同 parent） |

超限處理：
- Rich text 過長 → 切多個 paragraph 或用 toggle/callout 收攏
- URL 過長 → 改放在 rich text description 或用短網址
- 大量 block → 分多次 append，搭配 `notion-update-page` 的 `update_content`
- 批次建頁 → 分批呼叫 `notion-create-pages`

## Pre-Write Checklist

寫入前自檢（每一項中一個就要回去改）：

- [ ] **Parent 類型正確**：DB 寫入用 `data_source_id`，普通頁用 `page_id`
- [ ] **Schema 已 fetch**：property 名稱與實際 schema 對得上
- [ ] **Property 值特殊格式到位**：date 三拆、checkbox `__YES__`、`userDefined:` 前綴
- [ ] **Title 在 properties 裡**，不在 content 第一行
- [ ] **沒有使用 H5 或 H6**
- [ ] **多行 quote 用 `<br>`**，不是 newlines
- [ ] **Code block 內沒有轉義**
- [ ] **Callout / table cell 用 markdown 格式**，不用 HTML
- [ ] **`<page>` 與 `<mention-page>` 選對**
- [ ] **Size 估算過**：單段 rich text < 2000 字、total 預期 < 500KB
- [ ] **多源 DB 不用 `database_id`**

## Anti-Patterns

完整陷阱清單在 `markdown-gotchas.md`。以下是 7 個最常踩：

### 1. 把 title 寫在 content 第一行
頁面本身已經有大標題，content 再放一個會變雙標題。

**錯**：
```markdown
# 2026 Q2 產品規劃
## 背景
...
```
**對**：`properties.title = "2026 Q2 產品規劃"`，content 從 `## 背景` 開始。

### 2. 多行 quote 用 newlines
**錯**：
```
> 這是引用第一行
> 這是引用第二行
> 這是引用第三行
```
↑ 會渲染成 **三個獨立** quote blocks。

**對**：
```
> 這是引用第一行<br>這是引用第二行<br>這是引用第三行
```

### 3. Code block 內硬轉義
**錯**：
~~~
```js
const arr = \[1, 2, 3\]
```
~~~
程式碼裡的 `\` 會變字面值。

**對**：
~~~
```js
const arr = [1, 2, 3]
```
~~~

### 4. 想引用既有頁面卻用 `<page>` tag
**錯**：`參考這份：<page url="https://...">既有頁面</page>`
↑ 這會把那頁**搬進來**並從原位置刪除。

**對**：`參考這份：<mention-page url="https://..."/>`

### 5. 多源 DB 用 `database_id`
**錯**：
```json
{"parent": {"type": "database_id", "database_id": "..."}}
```
多源 DB 會拒絕。必須先 fetch 拿 `collection://` URI，改用 `data_source_id`。

### 6. Inline math 空白錯位
**錯**：`$ x + y $` 或 `這是$x+y$的計算`
**對**：`這是 $x + y$ 的計算`（`$` 外需空白、`$` 內不能有空白）

### 7. Callout 內用 HTML
**錯**：`<callout>重點是<strong>這個</strong></callout>`
**對**：`<callout>重點是**這個**</callout>`

Callout 與 table cell 內部一律用 markdown，不用 HTML。

## Further Reading

以下檔案按需載入，不要一次全讀：

| 情境 | 檔案 |
|---|---|
| 不確定用哪個 block type | `block-selection.md` |
| Markdown 有什麼坑（詳版） | `markdown-gotchas.md` |
| DB 屬性命名、status lifecycle 預設 | `property-conventions.md` |
| 寫 PRD | `template-prd.md` |
| 寫 ADR | `template-adr.md` |
| 寫會議記錄 | `template-meeting-notes.md` |
| 寫事故覆盤 | `template-postmortem.md` |
| 寫 Runbook | `template-runbook.md` |

模板是 skeleton，依實際脈絡刪減/改寫。如果 workspace 已有既定慣例，**跟著既有的走**，不要套模板覆寫。

## 配合官方 plugin

遇到寫入動作優先用官方 slash commands：
- `/Notion:create-page` — 建頁
- `/Notion:create-database-row` — 建 DB row
- `/Notion:create-task` — 建 task
- `/Notion:database-query` — 查 DB

這些 command 內部叫 MCP tools，本 skill 的規則在它們執行時同樣適用——觸發時會一併載入，遵守上面的 Core Rules 與 Pre-Write Checklist。
