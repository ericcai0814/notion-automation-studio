---
name: srs-publish-notion
description: >
  將 SRS 需求文件發佈到 Notion workspace 沙箱 toggle。
  當用戶輸入「publish 到 notion」「PUBLISH」「發佈 SRS」「同步到 Notion」
  「把 {batch} 推到 Notion」「更新 Notion 沙箱」
  或在 srs-sync 完成後需要將 output/requirements-{batch}.md 發佈到
  Notion 時觸發。
  透過 publish-to-notion.js orchestrator 直接呼叫 Notion REST API 完成發佈。
  v1 沙箱階段：全量覆寫（archive-then-append）、圖片自動上傳（file_upload API）、
  publish gate 使用者確認、跨需求引用純文字（warn）。
---

# SRS 發佈至 Notion Sandbox Skill

把 `{batch}-SRS/output/requirements-{batch}.md` 發佈到 Notion workspace 的
沙箱 toggle 內的 child page。實際的 parent / toggle label / child page
title 由專案 `.claude/notion-mapping.json` 指定。

## 設計分層

這個 skill 是**業務層**，組合下列元件：

```
業務層：srs-publish-notion（本 skill）
  ├─ 內容層：notion-doc-writing skill（格式守則、block 選用、size limits、陷阱清單）
  └─ 工具層：scripts/publish-to-notion.js orchestrator
       ├─ scripts/md-to-notion-blocks.py  (markdown → block JSON converter)
       ├─ scripts/notion-api-client.js    (Notion REST API client + rate limiter)
       └─ scripts/notion-upload-image.js  (file_upload API + md5 cache)
```

**執行前必做**：先載入 `notion-doc-writing` skill 的 Pre-Write Checklist 與
Anti-Patterns。本 skill 不重抄內容格式規則，只負責 SRS 業務邏輯。

## v1 沙箱階段的限制（明確列出不處理的）

| 限制 | 原因 | 之後怎麼升級 |
|------|------|--------------|
| 全量覆寫 child page（archive-then-append，不做 block-level diff） | 沙箱無評論保留需求，求簡單 | 正式化時改 block diff |
| 跨需求引用為純文字（warn） | Notion 無 markdown anchor，block mention 需先建後拿 ID | 未來可升級 page mention |
| 不自動建立 toggle block | Notion API 無法將 page parent 到 block_id | 使用者手動建 toggle |
| 不做雙向同步 | 增加衝突處理複雜度 | 永遠不做 |

## Notion 結構契約（重要）

目標 child page 在每次 publish 後**必須**處於下列狀態。任何違反此契約的
人工編輯都會在下次 publish 時被覆寫：

1. **Flat 結構** — 頁面**不應有任何 child page**。所有需求內容皆 inline
   於本頁。若 publish 前偵測到既有 child page，會在 Step 6 自動 archive
   後再寫入。
2. **頂部 warning callout** — 第一個 block 必為 callout，內文：
   > ⚠️ 此頁面由 `srs-publish-notion` skill 自動產生，請勿手動編輯。
   > 下次 publish 會覆蓋所有內容（包含本頁的所有 block 與 child page）。
3. **三大章節順序固定** — 壹、版本說明 → 貳、需求大綱 → 參、需求內容
4. **單向流向** — markdown 是 source of truth；Notion 是輸出鏡像；禁止反向

> **預期攤平行為備註**：之前 Notion 端可能因為手動操作累積過 child page
> （例如每個 R00XX 各自一個子頁）。本 skill 的設計**刻意拒絕**這種巢狀結構，
> 因為跟 source markdown 的 flat 模型對不上。如果未來想要 Notion 端有巢狀
> 子頁，請另外設計，不要動本 skill 的契約。

## Batch Resolution（多 batch 推斷）

本 skill 操作對象是「某個 SRS batch」。執行前先決定 **batch ID**：

1. **若使用者明確指定** batch（例如「PUBLISH 3-B」、「把 3-B 推到 Notion」），用該 batch
2. **否則**：用 Glob 列出 repo root 下所有 `*-SRS/` 目錄
   - **恰好 1 個** → 自動使用
   - **0 個** → 報錯「找不到任何 SRS batch」
   - **2 個以上** → 報錯，列出可選 batch 並要求明確指定
3. **不要猜** — publish 是不可逆操作，誤觸發代價高

從 batch ID 推導：
- 源檔：`{batch}-SRS/output/requirements-{batch}.md`
- assets：`{batch}-SRS/assets/`
- Notion target：讀專案的 `.claude/notion-mapping.json` 的 `batches[{batch}]`，
  其中包含 `parent_page_id`、`sandbox.child_page_id`、`sandbox.toggle_label`、
  `sandbox.child_page_title` 等

若 `batches[{batch}]` 不存在 → 報錯「該 batch 在 notion-mapping.json 沒有
對應設定，請先補上或執行 srs-new-batch 時記得加入」。

## 前置條件

### Bootstrap（第一次執行前由使用者手動完成）

1. 在父頁面（專案 `.claude/notion-mapping.json` 中的 `parent_page_id`）手動
   建立一個 toggle heading，標題為 `sandbox.toggle_label` 指定的字串
   （例如 `《需求分析》`）
2. 在該 toggle 內建立一個 child page，標題為 `sandbox.child_page_title`
   指定的字串（例如 `需求說明文件3-B`）
3. 複製該 child page 的 URL
4. 本 skill 首次執行時會把 URL 寫入 `.claude/notion-mapping.json`

**為什麼需要手動 bootstrap？**
Notion API 的 `POST /v1/pages` 只能把 page parent 到 `page_id` /
`database_id`，不能 parent 到 block_id（例如 toggle block）。
所以 child page 的初始容器必須人工建立。之後 skill 只管理該 child page 的內容。

### 環境需求

| 需求 | 用途 | 安裝 |
|------|------|------|
| `NOTION_TOKEN` 可讀 | Notion REST API 認證 | 設在 `process.env.NOTION_TOKEN` 或 `.mcp.json` 的 `mcpServers.notionApi.env.NOTION_TOKEN` |
| `uv` 在 PATH | 執行 Python converter（md-to-notion-blocks.py） | `brew install uv` |
| `node` >= 18 | 執行 orchestrator 與 API client（使用原生 `fetch`） | `brew install node` |

### `notion-mapping.json` 必備欄位（multi-batch schema）

```json
{
  "batches": {
    "{BATCH_ID}": {
      "parent_page_id": "<parent_page_uuid>",
      "parent_page_url": "https://www.notion.so/<workspace>/<parent_slug>",
      "sandbox": {
        "toggle_label": "《需求分析》",
        "child_page_title": "需求說明文件{BATCH_ID}",
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

每個 batch 在 `batches` 物件下有自己的 entry。Skill 透過 Batch Resolution
決定 batch ID 後，從 `batches[{batch}]` 讀取對應設定。完整 template 見
plugin 的 `templates/notion-mapping.json.tmpl`。

若 `batches[{batch}].sandbox.child_page_id` 為 null，進入 **Discovery
模式**（見下方）。

## Workflow

### Preflight: 確保 workflow state + pre-check

#### P.1 ensure state 檔存在

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js ensure \
  .claude/workflow-state.json \
  ${CLAUDE_PLUGIN_ROOT}/templates/workflow-state.json
```

#### P.2 pre-check-publish

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js pre-check-publish \
  .claude/workflow-state.json {batch} {batch}-SRS/output/requirements-{batch}.md
```

**Pre-check 檢核項目**：

1. Output 檔存在
2. `state.batches.{batch}.last_sync_output_md5` 已設定
3. Output 檔的當前 md5 與 state 紀錄相符（偵測 sync 後的手動編輯）

**已知限制（v1，不修）**：若使用者在最後一次 sync 之後新增了
`src/R00XX_*.md` 但沒重跑 sync，output 檔沒被動過 → md5 仍符合 state →
pre-check 會放行，但 publish 會漏掉新需求。腳本刻意不跨目錄掃 src/ 以
維持 pre-check 廉價與局部。使用者應該養成「改 src 一定先 sync」的流程
規避此案。

#### P.3 結果處理

- **Exit 0** → 進入 Step 1
- **Exit 1（BLOCKED）** → 停下來，把腳本訊息呈現給使用者，並顯示三選一：
  ```
  Pre-check 未通過。請選擇：
  [1] 立即執行 srs-sync（依 BLOCKED 訊息判斷用 SYNC R00XX 或 SYNC ALL），完成後重新 publish
  [2] 我已確認內容正確，這次強制繼續（跳過 pre-check）
  [3] 取消本次 publish
  ```
  等使用者輸入後處理：
  - `1` → 啟動 srs-sync，結束後由使用者自行重跑 publish
  - `2` → 跳過 pre-check 進入 Step 1。**不寫 override 紀錄**
  - `3` → 停止流程，**不**做任何 Notion 操作
- **Exit 2（ERROR）** → 回報 stderr，不繼續

> 三選一選項與 `srs-sync` 保持一致 — 要改一起改。

### Step 1: 讀取 mapping 與源檔

1. Read `.claude/notion-mapping.json`（專案端）
2. Read `{batch}-SRS/output/requirements-{batch}.md`
3. 若任一檔案不存在，回報錯誤並停止

### Step 2: Discovery 模式（若 child_page_id 為 null）

首次執行時需要找到 bootstrap 建好的 child page：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/publish-to-notion.js --discover --batch {batch}
```

Orchestrator 會：
1. 讀 mapping 的 `parent_page_id`，透過 Notion REST API 分頁掃描 parent page 的 children
2. 找到 `is_toggleable` heading 或 toggle block，text 匹配 `sandbox.toggle_label`
3. 鑽入 toggle children，找到 `child_page` title 匹配 `sandbox.child_page_title`
4. 自動寫回 mapping 的 `sandbox.child_page_id` / `sandbox.child_page_url`
5. 若找不到：stderr 輸出 bootstrap 步驟提示並 exit 1

### Step 3: 載入 Notion 內容層規則

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/SKILL.md`，必要時
進一步 Read 下列支援檔案：
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/markdown-gotchas.md` — 完整陷阱清單
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/block-selection.md` — block type 選用
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/property-conventions.md` — 屬性命名

確認以下規則內化：

- Title 不在 content 第一行（源檔若有 `# {child_page_title}` H1 須剝除）
- Heading 最深 H4（H4 → heading_4；H5/H6 由 converter 自動降級為 bold paragraph）
- 多行 quote 用 `<br>` 連接
- Tab 縮排
- Single rich text < 2000 字元（converter 自動拆分，但源檔仍應避免超長段落）
- Code block 不轉義
- Callout/table cell 用 markdown 不用 HTML
- Image 必須為獨立 top-level block，alt text 作為 caption，不放 table cell 內
- Columns 用 `<columns>` / `<column>` tag 包裹，最多 4 欄，可選 `width_ratio` attribute

### Step 4: Publish Gate（使用者確認）

**任何 destructive Notion 操作之前，必須停下並等待使用者確認**。

#### 4.1: 執行 dry-run 取得 preview

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/publish-to-notion.js --dry-run --batch {batch}
```

Dry-run 會執行 archive + image upload + convert + safety check，但跳過實際
append 與 state update。stdout 輸出 JSON preview，包含：

- `archived_blocks`：將被 archive 的 block 數
- `top_level_blocks`：將 append 的 top-level block 數
- `total_blocks`：含巢狀的總 block 數
- `column_list_count`：column_list 數量
- `estimated_append_batches`：預估 API append 批次數

**注意**：dry-run 會**真的執行 archive（清空頁面）與上傳圖片**（以產出 manifest），
僅跳過 append（寫入新內容）與 state update。這代表 dry-run 後頁面會暫時為空，
直到接續的正式 publish 寫入新內容。

#### 4.2: 顯示 Preview 給使用者

將 dry-run JSON 格式化為可讀報告，呈現給使用者確認。

#### 4.3: 等待使用者輸入

- **不要自動執行**下一步 — 必須等使用者下一輪輸入
- 接受常見同意詞（寬鬆語意 confirm）：
  - `confirm` / `yes` / `y` / `OK` / `ok` / `go`
  - `推` / `OK 推` / `好` / `確認` / `沒問題`
- 任何其他輸入視為取消，停止流程，**不做任何 Notion API 呼叫**
- 取消時回報：「已取消發佈，未做任何 Notion 操作」

### Step 5: 執行發佈（gate 通過後）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/publish-to-notion.js --batch {batch}
```

Orchestrator 依序執行：

1. **Step A — Archive**：分頁掃描 child page 的 top-level blocks，逐個 DELETE
2. **Step B — Image Upload**：掃描 markdown 的 `![](...)` 圖片，透過
   `notion-upload-image.js` 上傳（md5 cache 避免重複上傳）
3. **Step C — Convert**：透過 `uv run md-to-notion-blocks.py` 轉為 block JSON
4. **Step D — Safety Check**：block 數 > 1000 中止、> 900 警告
5. **Step E — Append**：分批 ≤ 100 blocks append 到 child page（column_list
   one-shot，422 時 fallback two-pass）
6. **Step F — State Update**：寫入 `last_synced_at` / `last_synced_source_md5`

Skill 只需讀 exit code 與 stdout JSON 報告。

### Step 6: 輸出報告

Orchestrator 的 stdout 是 JSON 報告，包含：

- `batch`、`mode`（publish）
- `archived_blocks`：已 archive 的 block 數
- `appended_blocks`：已 append 的 top-level block 數
- `total_blocks`：含巢狀的總 block 數
- `column_list_count`：column_list 數量
- `child_page_id`、`child_page_url`
- `synced_at`、`source_md5`

Skill 將此 JSON 格式化為可讀報告，附上下一步建議：

1. 打開 Notion 檢視 `child_page_url`
2. 確認所有圖片顯示正常、caption 正確
3. 確認 columns 排版正確（R0044 等有並排需求的 requirements）
4. 若結構看起來 OK，下次修改源檔後重新執行本 skill

### Step 7: 寫入 workflow state

Publish 完整成功後（orchestrator exit 0），記錄 batch 級的 publish 時間戳：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js record-publish \
  .claude/workflow-state.json {batch}
```

**只在完整成功時**寫入。任何一個前置步驟失敗都不呼叫此命令，讓
`state.batches.{batch}.last_publish.ts` 忠實反映最後一次成功發佈時間。

## 完成檢查

- [ ] mapping 檔案已讀取或 Discovery 模式完成（`--discover` exit 0）
- [ ] notion-doc-writing 規則已載入（含 Image / Columns 條目）
- [ ] **Publish gate 已等到使用者明確 confirm 才繼續**（dry-run preview 呈現）
- [ ] orchestrator exit 0（archive + upload + convert + append + state update 全通過）
- [ ] mapping 的 `last_synced_at` 與 `last_synced_source_md5` 已由 orchestrator 更新
- [ ] 發佈報告已呈現給使用者
- [ ] workflow-state 的 `batches.{batch}.last_publish.ts` 已記錄

## Integration

| 銜接 | 說明 |
|------|------|
| 前置（建議） | `srs-check` → `srs-sync` → 本 skill |
| 組合 | `notion-doc-writing` skill（內容層）+ orchestrator scripts（工具層） |
| 依賴 capability | `markdown-to-notion-blocks`（converter）/ `notion-api-client`（REST client）/ `notion-image-upload`（file_upload） |
| 首次執行 | 須先由使用者手動完成 Bootstrap（建 toggle + child page）+ `--discover` |
| 失敗降級 | Step A archive 失敗 → 中止（log 斷點）；Step B/C 失敗 → 頁面暫空，下次 publish 重填 |
| 使用者取消 | Publish gate 階段 → 回報「已取消」，不做任何 Notion 操作 |

## 常見錯誤與處理

| 錯誤 | 原因 | 處理 |
|------|------|------|
| `NOTION_TOKEN not found` | 環境變數與 `.mcp.json` 都無 token | 設定 `NOTION_TOKEN` 或在 `.mcp.json` 加入 `mcpServers.notionApi.env.NOTION_TOKEN` |
| `找不到 uv 指令` | uv 未安裝 | `brew install uv` |
| `child_page_id` 為 null | Bootstrap 沒做或 `--discover` 沒跑 | 先完成 Bootstrap + `--discover` |
| `top-level block 數超過 1000` | SRS 內容太多 | 考慮拆分為多個頁面 |
| Step A archive 中途失敗 | 權限不足或 API 錯誤 | orchestrator log 顯示斷點位置，檢查 Notion 端權限 |
| Step B 圖片上傳失敗 | 檔案不存在或 > 20 MB | 單張失敗會 warn 繼續，其他圖片不受影響 |
| Step E 422 on column_list | Notion API nesting 限制 | orchestrator 自動 fallback two-pass |
| Step E `file_upload expired` | mapping 中 cached 的 `file_upload_id` 已超過 Notion 未文件化的 TTL（實測 >1hr 會過期） | 刪除 mapping 中該圖的 cache entry（清空為 `{}`），重跑 publish 讓 uploader 重新上傳 |
| 使用者於 publish gate 取消 | 預期行為 | 不做 Notion 頁面寫入，回報「已取消」 |
