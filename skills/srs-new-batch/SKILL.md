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
4. **回報結果**：把腳本輸出原樣回給使用者，讓他確認檔案路徑都對。
5. **提醒下一步**：
   - 改寫 `{batch-name}-SRS/src/R0001_範例需求.md`（或刪除、改名為實際的 R-number）
   - 新增其他需求 .md 檔（每個一份，命名 `R{NNNN}_{中文功能名}.md`）
   - 在 Notion 端為這個新批次建立對應的 toggle + child page（如果要 publish）
   - **在專案 `.claude/notion-mapping.json` 的 `batches` 物件下新增 entry**
     （參考 plugin 的 `templates/notion-mapping.json.tmpl`）：
     ```json
     {
       "batches": {
         "<既有批次>": { "...": "..." },
         "{batch-name}": {
           "parent_page_id": "<parent_page_uuid>",
           "parent_page_url": "https://www.notion.so/<workspace>/<slug>",
           "sandbox": {
             "toggle_label": "《需求分析》",
             "child_page_title": "需求說明文件{batch-name}",
             "child_page_id": null,
             "child_page_url": null,
             "last_synced_at": null,
             "last_synced_source_md5": null
           },
           "images": {}
         }
       }
     }
     ```
     沒加這條的話 `srs-publish-notion` skill 會報錯「該 batch 沒有 Notion
     設定」並停止。
   - 跑 `SYNC` 與 `PUBLISH` 驗證 pipeline（兩個 skill 都會自動透過 Batch
     Resolution 偵測新 batch）

## What this skill does NOT do

- 不寫任何**真實**需求內容（只放空白模板）
- 不修改 `notion-mapping.json`（新批次的 Notion target 由使用者另外設定）
- 不執行 git operations（commit / branch / push）
- 不呼叫 Notion API
- 不修改任何現有 `*-SRS/` 批次目錄

## 失敗情境

| 情境 | 處理 |
|---|---|
| `{batch-name}-SRS/` 已存在 | 腳本 exit 1 並回報訊息；要求使用者明示是否要刪除重來 |
| 沒提供 batch name | 腳本 exit 1 並列出 usage |
| 寫檔權限不足 | 腳本 exit 1 並回報 fs 錯誤；通常是路徑不對或 read-only mount |
