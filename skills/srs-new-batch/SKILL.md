---
name: srs-new-batch
description: >
  建立新的 SRS 批次目錄與骨架。當用戶說「新增批次 4-A」「new batch 3-C」
  「scaffold batch」「開新批次」「建一個新的 SRS 批次」時觸發。
  自動建立 `{batch}-SRS/{src,output,assets}/` 目錄與初始模板檔，
  並提示使用者下一步要做什麼。
---

# srs-new-batch

建立新的 SRS 批次目錄（例如 `4-A-SRS/`、`3-C-SRS/`），於專案 repo root
與既有批次平行存在。

## When to use

使用者明確要新增一個全新的 SRS 批次目錄時。常見觸發詞：

- 「新增批次 4-A」
- 「new batch 3-C」
- 「scaffold batch」
- 「開新批次」
- 「建一個新的 SRS 批次」

## What it produces

```
{batch-name}-SRS/
├── src/
│   ├── R0001_範例需求.md   ← 含六大章節空白模板
│   └── .gitkeep
├── output/
│   └── .gitkeep
└── assets/
    └── .gitkeep
```

## Workflow

1. **確認批次名稱**：跟使用者確認新批次的名稱（例如 `4-A`）。
   如果不清楚，問清楚 — 不要自己猜。
2. **檢查不存在**：執行前確認 `{batch-name}-SRS/` 目錄**不存在**。
   腳本本身會 refuse 覆寫，但提早警示使用者體驗較好。
3. **呼叫腳本**：
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/scaffold-batch.js {batch-name}
   ```
4. **自動更新 notion-mapping.json**：
   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/append-batch-mapping.js \
     .claude/notion-mapping.json {batch-name}
   ```
   腳本會在 `.claude/notion-mapping.json` 的 `batches` 下自動新增對應的 entry。
   - 若所有既有 batch 共用相同的 `parent_page_id`，會自動繼承並印出說明。
   - 若 mapping 裡尚無其他 batch，或各 batch 的 `parent_page_id` 不一致，
     會將兩個欄位設為 `null` 並提示手動填入。
   - **BLOCKED（exit 1）**：
     - `notion-mapping.json 不存在` → 這是首次使用的專案，請先執行
       `srs-setup` 初始化（參見 `srs-setup` skill），建立好 mapping 檔再重試。
     - `batch 已存在` → 無需再新增，直接繼續後續步驟。
   - **exit 2（腳本錯誤）**：JSON 解析失敗或參數有誤，請回報 bug。
5. **回報結果**：把步驟 3–4 的腳本輸出原樣回給使用者，讓他確認。
6. **提醒下一步**：
   - 改寫 `{batch-name}-SRS/src/R0001_範例需求.md`（或刪除、改名為實際的 R-number）
   - 新增其他需求 .md 檔（每個一份，命名 `R{NNNN}_{中文功能名}.md`）
   - **在 Notion 端手動建立** 對應的 toggle（`《需求分析》`）與 child page
     （`需求說明文件{batch-name}`）— Notion MCP 無法將 child page 掛在
     toggle block 下，這步驟必須由使用者手動完成。
   - 建好 Notion 頁面後說 `PUBLISH`，srs-publish-notion 的 Discovery
     模式會自動偵測並回填 `child_page_id` 到 mapping。
   - 跑 `SYNC` 與 `PUBLISH` 驗證 pipeline（兩個 skill 都會自動透過 Batch
     Resolution 偵測新 batch）

## What this skill does NOT do

- 不寫任何**真實**需求內容（只放空白模板）
- 不在 Notion 建立 toggle 或 child page（Notion MCP 限制，需手動操作）
- 不執行 git operations（commit / branch / push）
- 不呼叫 Notion API
- 不修改任何現有 `*-SRS/` 批次目錄

> `notion-mapping.json` 的新增 entry **由 `append-batch-mapping.js` 自動處理**（步驟 4）。
> 若 mapping 尚不存在（首次使用專案），請先執行 `srs-setup` 初始化。

## 失敗情境

| 情境 | 處理 |
|---|---|
| `{batch-name}-SRS/` 已存在 | 腳本 exit 1 並回報訊息；要求使用者明示是否要刪除重來 |
| 沒提供 batch name | 腳本 exit 1 並列出 usage |
| 寫檔權限不足 | 腳本 exit 1 並回報 fs 錯誤；通常是路徑不對或 read-only mount |
