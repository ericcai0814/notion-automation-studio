# Block Selection Decision Guide

寫進 Notion 頁面時，「這段內容要放哪種 block」的決策依據。規格本身讀 `notion://docs/enhanced-markdown-spec`，這份是**選用判斷**。

## 決策樹

```
這段內容是...
├── 純文字說明 → paragraph
├── 章節標題 → heading (H1-H4, 上限 4 層)
├── 清單
│   ├── 順序重要 → numbered list
│   ├── 順序不重要 → bulleted list
│   └── 可勾選任務 → to-do
├── 要強調
│   ├── 只是一兩句話 → callout（加 icon）
│   ├── 引用他人 → quote
│   └── 關鍵警告/注意事項 → callout（color="red_bg"）
├── 程式碼 / 指令 → code block（設 language）
├── 可摺疊細節 → toggle 或 toggle heading
├── 圖表資料
│   ├── 對照表 → table（cells 只能放 rich text）
│   ├── 流程 / 架構 / 序列 → mermaid code block
│   └── 關係複雜 → 拆出子頁嵌入
├── 媒體
│   ├── 圖 → ![caption](url)
│   ├── 影片 / 音檔 → <video> / <audio>
│   └── PDF / 檔案 → <pdf> / <file>
├── 分段視覺強調 → divider（慎用，headings 通常夠）
└── 要連結到其他 Notion 實體
    ├── 純引用、不搬動 → <mention-page> / <mention-database>
    ├── 真的要變成子頁 → <page>
    └── 嵌入 DB 當 inline view → <database data-source-url=... inline="true">
```

## Block 選用對照表

| Block | 適合 | 不適合 | 常見誤用 |
|---|---|---|---|
| **paragraph** | 連續散文、說明 | 任何帶結構的內容 | 把多段不同性質的內容塞進同一段 |
| **heading 1** | 頁面大區塊標題（約 3-5 個） | 每段小標都用 | 當強調（用 callout） |
| **heading 2-3** | 次級與三級標題 | — | 超過 H4 |
| **bulleted list** | 並列項目、摘要 | 有順序依賴的步驟 | 空項目（Notion 會顯示奇怪的空圓點） |
| **numbered list** | 步驟、有順序 | 並列且順序無關 | 步驟內嵌太深（>3 層難讀） |
| **to-do** | 可勾選任務、checklist | 不是真的任務的條列 | 當普通 bullet 用 |
| **toggle** | 隱藏非核心細節（FAQ、舊紀錄、長 log） | 核心內容（使用者不會展開） | 關鍵資訊藏在 toggle 裡 |
| **callout** | 警告、重點、提醒、TL;DR | 長段落說明（超過 3-4 行要拆） | 當 paragraph 替代品濫用 |
| **quote** | 引用他人話語、citation | 強調重點 | 當 callout 替代品 |
| **code** | 程式碼、命令列、config | 一行以內的片段（用 inline `` ` ``） | 轉義特殊字元 |
| **divider** | 強烈分段、頁面大區隔 | 每小段都分 | 代替 heading |
| **table** | 結構化對照、schema 說明 | cells 需要 heading/list/image（不支援） | 跑出 100+ 列（考慮改用 DB） |
| **mermaid** | 流程圖、序列圖、架構圖 | 純視覺設計圖 | 節點文字沒雙引號包含 `()` |
| **columns** | 並排顯示、左右對照 | 手機閱讀為主（columns 在窄螢幕會擠） | 超過 3 欄 |
| **table_of_contents** | 長頁面目錄 | 短頁面 | 每頁都放 |

## Toggle 用法要點

- children **必須縮排**（tab）才會被包在 toggle 裡；沒縮排的會變成 toggle 之外的同層 block
- Toggle heading (`# X {toggle="true"}`) 適合章節可摺疊的場景
- 不要把核心結論藏在 toggle，只藏細節（理由、原始資料、長 log）

## Callout 用法要點

- 可以包**多個 child block**（不只 inline rich text）
- 內部格式用 markdown：`**bold**` 不是 `<strong>`
- `icon` 用 emoji 或 `:name:` 自訂 emoji
- `color` 用 bg 色最有視覺重量（`blue_bg`、`red_bg`、`yellow_bg`）
- 一頁不要超過 3-4 個 callout，否則稀釋效果

## Table 用法要點

- Cells **只能**放 rich text——要放 heading/list/image 就改用兩個小 table 或拆段落
- 欄位多時開 `fit-page-width="true"`
- 首列當標題開 `header-row="true"`
- 色彩優先順序：cell > row > column（衝突時 cell 贏）

## Mermaid 用法要點

- 語言設 `mermaid`
- 節點文字含 `()` 或特殊字元 → 用雙引號包：`A["Service (prod)"]`
- 節點內換行用 `<br>`，**不是** `\n`
- 不要用 `\(` `\)`，直接雙引號整段包起來

## Columns 用法要點

- 適合左右對照（優缺點、before/after、spec vs impl）
- 手機/窄螢幕會被迫堆疊，重要資訊不要只靠 column 排版
- 2 欄是常用，3 欄已經擁擠，4 欄幾乎不可讀

## 決策優先順序

當兩種 block 都可以時：
1. **結構勝於裝飾**：table/list 比一長串 paragraph 好
2. **可折疊勝於一次暴露**：toggle 能讓頁面掃讀更快
3. **內建強調勝於排版技巧**：callout 比「第一段粗體 + 縮排」好
4. **可搜尋勝於隱藏**：核心內容不放 toggle，確保 Notion 搜尋能命中
