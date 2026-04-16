## Why

目前 `srs-publish-notion` skill 依賴 `mcp__plugin_Notion_notion__notion-update-page` 的 `replace_content` 命令。該命令吃 Notion-flavored markdown 字串（含 `<columns>`、`<details>`、`<aside>` 等 HTML-like tag），由遠端 MCP 伺服器（`https://mcp.notion.com/mcp`）做 markdown → block 轉換。此設計有三個結構性問題：

1. **部署脆弱**：下游專案必須透過「Notion Workspace Plugin」連上 `mcp.notion.com/mcp`。若環境只有 `@notionhq/notion-mcp-server`（純低階 REST wrapper，即 `mcp__notionApi__*`），skill 完全無法運作。實務上本 change 的觸發情境就是後者。

2. **能力不可驗證**：遠端 converter 是黑盒。`<columns>` / `<br>` / `<details>` 等 HTML-like tag 的支援度、邊界行為、錯誤模式完全沒有官方文件；skill 寫入的語法即使合法也可能被靜默拋棄或誤譯。

3. **圖片無法跨 publish 存活**：v1 沙箱明文「圖片不自動上傳」，使用者必須每次 publish 後手動重新上傳。但 `replace_content` 是 destructive overwrite，手動上傳的圖片會在下次 publish 時被 archive，變成每次迭代都要重傳 11 張圖 + 對齊 caption。沙箱設計的「簡單優先」在 3-B 迭代階段已成為主要 friction。

REST API 直接路徑可解決三個問題：**所有 block 本地產生 JSON，不依賴遠端 markdown converter**；**圖片走 `/v1/file_uploads` 三步驟拿永久 `file_upload_id` 寫入 mapping.json，跨 publish 重用**；**columns 以 `column_list` / `column` 官方 block type 實作**。研究 `/Users/ericcai/Downloads/ew-notion-component-docs/scripts/convert.py`（931 行，已涵蓋 20+ block type）顯示 80% converter 工作已有可複用實作，scope 從原估 10–16 小時砍到 5–8 小時。

## What Changes

- **新增 `scripts/md-to-notion-blocks.py`**（基於 `ew-notion-component-docs/convert.py` 改寫）
  - 沿用 convert.py 已實作的 20+ block type：heading_1/2/3、paragraph、bulleted/numbered list（含巢狀）、to_do、toggle、quote、callout、code、divider、table、image（external）、embed、bookmark、equation、TOC、breadcrumb
  - 沿用 rich text annotations：bold / italic / strikethrough / underline / code / link / inline equation
  - **新增 `<columns>` / `<column>` HTML-like tag 解析** → `column_list` / `column` block JSON（附 `width_ratio`）
  - **新增 `file_upload` image 模式**：image block 可選產生 `{type: "file_upload", file_upload: {id}}` 而非 external URL，走 `--images-manifest <json>` 提供 path→id mapping
  - **新增 H4+ 降級**：H4 降為 H3、H5/H6 降為 paragraph 粗體
  - **新增 content > 2000 字自動拆**：同一 paragraph 的 rich text 超過 2000 字時，切成多個 rich_text item（不切 block）
  - CLI：`uv run scripts/md-to-notion-blocks.py <md_file> [--images-manifest <json>] [-o <out>] [--compact]`
  - 零依賴：純 Python 3 stdlib；檔案頂部加 PEP 723 inline script metadata（`requires-python = ">=3.8"`、`dependencies = []`）讓 `uv run` 自動管理 runtime
- **新增 `scripts/notion-api-client.js`**
  - 純 Node fetch wrapper（Node ≥ 18），零 npm 依賴
  - 自動帶入 `Authorization: Bearer <NOTION_TOKEN>` + `Notion-Version: 2022-06-28` header
  - Token bucket rate limiter：average 3 req/s、burst 5
  - 429 retry：讀 `Retry-After` header，指數退避、最多 5 次
  - 標準化 error shape：`{status, code, message, requestId}`
  - Export 函式：`postPage`、`retrievePage`、`getBlockChildren`、`appendBlockChildren`、`deleteBlock`、`createFileUpload`、`sendFileUpload`
- **新增 `scripts/notion-upload-image.js`**
  - CLI：`node scripts/notion-upload-image.js --batch <id> --file <relative_path>`
  - 讀 `.claude/notion-mapping.json.batches.{batch}.images[{relative}]` 做 md5 cache 比對
  - Cache miss → `POST /v1/file_uploads` (mode=single_part) → `POST /v1/file_uploads/{id}/send` (multipart/form-data) → 回填 mapping.json
  - Cache hit → 直接印既有 `file_upload_id`
  - 輸出 stdout JSON：`{file_upload_id, md5, cached}`
  - 不支援 multi_part（3-B 圖片全 < 20 MB，超過的情境不在本 change scope）
- **新增 `scripts/publish-to-notion.js`**（orchestrator）
  - 讀 `.claude/notion-mapping.json` 取得 `batches[{batch}].sandbox.child_page_id`
  - Step A：`GET /v1/blocks/{child_page_id}/children` 分頁列出既有 top-level blocks（含 child_page），逐個 `DELETE /v1/blocks/{id}` archive
  - Step B：預處理圖片 — 掃 output markdown 找 `![]()`，對每張圖呼叫 `notion-upload-image.js`，組成 `images-manifest.json`
  - Step C：呼叫 `md-to-notion-blocks.py --images-manifest` 產出最終 block JSON 陣列
  - Step D：block count safety check — `blocks.length > 1000` 中止、`> 900` 警告
  - Step E：分批 append（每 100 blocks 一批）到 `child_page_id`，遵守 Notion 「最多 2 層 nesting per request」規則；遇到 `column_list` 時先 append container（≤ 2 層）→ 取回 column block IDs → 第二輪 `patch-block-children` append image 到各 column
  - Step F：更新 mapping.json 的 `last_synced_at` / `last_synced_source_md5`
  - `--dry-run` 模式：執行 archive + image upload + convert + safety check，但跳過 append 與 state update。注意 dry-run 會實際清空 Notion 頁面並上傳圖片，僅最終寫入步驟被跳過
  - `--discover` 模式：從 `parent_page_id` 掃 toggle block 找出 child_page_id，寫回 mapping
- **修改 `skills/srs-publish-notion/SKILL.md`**
  - Step 2（Discovery）：改為呼叫 `node scripts/publish-to-notion.js --discover --batch {batch}`，不再依賴 `notion-fetch`
  - Step 4（轉換）：整段刪掉；skill 不再手動產 placeholder callout、不再做 heading depth check、長段落拆分、block 數估算（全部交給 script）
  - Step 5（Publish Gate）：preview 由 `node scripts/publish-to-notion.js --dry-run --batch {batch}` 產出
  - Step 6（執行發佈）：改為 `node scripts/publish-to-notion.js --batch {batch}`，skill 只讀 exit code 決定成敗
  - v1 沙箱限制表：移除「圖片不自動上傳」、「不自動建立 toggle block（仍保留，bootstrap 需求不變）」、修改「跨需求引用純文字」為 warn not limitation
  - 新增 prerequisite：`NOTION_TOKEN` 環境變數必須可用（script 從 `.mcp.json` 讀或 env 取）
- **修改 `templates/notion-mapping.json.tmpl`**
  - `batches.{batch}.images` 的 value schema 改為 `{md5, file_upload_id, uploaded_at}`（原為 `{md5, notion_url}`）
- **修改 `skills/notion-doc-writing/block-selection.md`**
  - 新增 **Image 章節**：獨立段落 `![alt](path)` pattern，alt 作為 Notion image block caption，禁止塞進 table cell（cross-reference 既有 gotcha）
  - 新增 **Columns 章節**：`<columns>` / `<column>` tag 語法，支援 optional `width_ratio` attribute，同一 `<columns>` 內 width_ratio 總和須為 1；欄內可放 paragraph / heading / image，不建議放 table
  - 補「image 為二等公民」的知識缺口（先前 Grep 發現只有負面規則，沒有正面用法指引）

## Non-Goals

- **不做 webhook integration**：目前流程為 batch publish，無增量同步需求
- **不做 block-level diff**：publish 仍是 archive-then-append 的 full overwrite。原 skill 的 `Block-level diff` limitation 依然成立
- **不引入 `@notionhq/client` npm 依賴**：保持 zero-dep 原則，純 Node fetch + Python stdlib
- **不做 file_upload multi_part mode**：3-B 圖片全部 < 20 MB，single_part 足夠；multi_part 留給未來圖片需求超過 20 MB 的情境
- **不動 Notion database / data source 寫入**：publish 只操作 block children
- **不做向後相容的 plugin-Notion MCP 路徑**：本 change 是一次性切換。若未來需要支援雙路徑，另開 change
- **不動 srs-check / srs-sync / merge-srs.js**：這三條 skill/script 與 publish 路徑無關
- **不把 Python converter 立 standalone spec**：歸屬於 `markdown-to-notion-blocks` capability spec 內部實作
- **不移除 bootstrap 流程**：首次 publish 前使用者仍須手動在 Notion 建立 toggle + child page（`API-post-page` 能以 block_id 為 parent 的能力未確認，且 toggle heading 的建立 API 複雜度高，留給未來）
- **不寫 Python 或 Node 的單元測試框架**：以 fixture 檔案 + CLI 端到端測試為 v1 驗收手段，參考既有 plugin 腳本的風格
- **不做 rate limit 的中央協調**：每次 publish 獨立計算 rate，不跨 process 共享 token bucket

## Capabilities

### New Capabilities

- `markdown-to-notion-blocks`：Python 實作的 markdown → Notion block JSON 轉換器。涵蓋 20+ block type、rich text annotations、HTML-like container tag（`<columns>` / `<column>` / `<toggle>` / `<aside>`）、image 的 external/file_upload 雙模式、H4+ 降級、超長 rich_text 自動拆。純 stdlib，CLI 產出 JSON 陣列到 stdout
- `notion-api-client`：Node 實作的 Notion REST API 客戶端模組。內建 `Authorization` header、`Notion-Version` 管理、3 req/s token bucket rate limiter、429 `Retry-After` 指數退避重試、標準化 error shape。零 npm 依賴，export 七個主要 endpoint 函式供其他 script 使用
- `notion-image-upload`：`/v1/file_uploads` 三步驟流程的 CLI 封裝。讀 mapping.json 做 md5 cache，cache miss 走 single_part 上傳並回填 `{md5, file_upload_id, uploaded_at}`，cache hit 直接回既有 ID。Idempotent、無副作用於未變動圖片

### Modified Capabilities

- `srs-publish-notion`：publish 流程從 plugin-Notion MCP `replace_content` 改為 Notion REST API 直接呼叫，由 `scripts/publish-to-notion.js` orchestrator 與三個新 capability 共同實作。v1 沙箱的「圖片不自動上傳」限制移除；columns 排版支援透過 `<columns>` source 語法實現；Step 2/4/5/6 的 markdown 預處理全部下沉到 script

## Impact

**Affected specs**：
- `openspec/specs/srs-publish-notion/spec.md` — MODIFIED
- `openspec/specs/markdown-to-notion-blocks/spec.md` — NEW
- `openspec/specs/notion-api-client/spec.md` — NEW
- `openspec/specs/notion-image-upload/spec.md` — NEW

**Affected code（新增）**：
- `scripts/md-to-notion-blocks.py`（基於 convert.py，~1100 行）
- `scripts/notion-api-client.js`（~250 行）
- `scripts/notion-upload-image.js`（~180 行）
- `scripts/publish-to-notion.js`（~400 行）

**Affected code（修改）**：
- `skills/srs-publish-notion/SKILL.md` — Step 2/4/5/6 重寫，v1 限制表更新
- `skills/notion-doc-writing/block-selection.md` — 新增 Image 與 Columns 章節
- `templates/notion-mapping.json.tmpl` — `images` value schema 變更

**Affected dependencies**：
- 新增 runtime 需求：`uv`（Astral 的 Python package manager / runner）必須在 PATH；`uv` 會自動處理 Python 3.8+ runtime，使用者不需另外裝 python3
- `uv` 安裝方式：`brew install uv` 或 `curl -LsSf https://astral.sh/uv/install.sh | sh`
- 新增 env 需求：`NOTION_TOKEN`（讀自 `.mcp.json` 或 env；skill 執行前檢查）
- 不新增 npm 依賴
- 不新增 pip 依賴（converter 純 stdlib）

**Affected downstream projects**：
- 下游專案的 `.claude/notion-mapping.json` 需 migrate `images` schema（舊 `{md5, notion_url}` → 新 `{md5, file_upload_id, uploaded_at}`）。由於當前所有下游專案的 `images` 皆為空 `{}`，實務上無資料遷移成本
- 下游專案的 `.mcp.json` 必須設定 `notionApi` server 與 `NOTION_TOKEN`（現狀符合）

**風險**：
- **Notion API rate limit 緊**：average 3 req/s。9 個需求 + 11 張圖 + columns 2-pass estimated 30–50 API calls，publish 一次需 10–20 秒純 API 時間。Mitigation：token bucket + 429 retry + verbose progress log
- **column_list children 位置**：Notion API 要求 `column_list` / `column` 的 children 放在 type-specific object（`column_list.children` / `column.children`）而非 top-level `children`。Spike 1.1 的 one-shot nesting（3 層）測試通過，但 converter 最初將 children 放在 top-level 導致 400 validation_error。已於 e2e 驗證階段修正（commit f63febe）
- **3-B 總 block 數接近 1000 上限**：估算 900 blocks，新增 2-3 份需求會突破。Mitigation：block count safety check（900 warn、1000 abort）與未來可選的「拆成多 child page」策略（本 change 不做）
- **file_upload expiry_time**：e2e 驗證（14.2）證實 file_upload_id 存在未文件化的 TTL — spike 階段（06:29）上傳的 R0050 在 1.5 小時後 attach 時已 expired（400 "invalid status of expired"）。單次 publish 內（< 1 分鐘）安全，但 **跨 session 的 mapping cache 可能過期**。Mitigation：遇到 expired 時清除 cache 重傳即可（已驗證），未來可考慮在 uploader 加入 TTL 過期偵測與自動重傳
- **NOTION_TOKEN 洩漏風險**：script 直接讀 `.mcp.json`（gitignored），不 log token、不寫入 workflow-state。Mitigation：文件化 token 讀取路徑，script 不接受 token 作為 CLI arg

**不受影響（刻意強調）**：
- `srs-check` / `srs-sync` / `merge-srs.js`：publish 路徑切換不影響合規檢核與 md 合併流程
- `srs-onboard`：健檢項目可在後續 change 中新增「NOTION_TOKEN 可讀性」檢查，本 change 不做
- 下游專案的 `src/*.md` 源檔：publish 路徑改變對 source markdown 的唯一新要求是 `<columns>` 標籤語法（選用），其他 pattern 不變
