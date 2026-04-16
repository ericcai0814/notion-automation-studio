## 1. Spike：驗證 Notion API 邊界行為（implementation 前必做）

- [x] 1.1 Spike `column_list` nesting 限制：實測「一次 append 含 `column_list → column → paragraph` 的 3 層 payload」是否回 422；若成立則驗證「第一次 append `column_list + 空 column`、取回 column.id、第二次 append paragraph」可行，記錄 column.id 的回傳位置（response `results[]` 中）
  > **Result (2026-04-15)**: 假設被推翻。3 層 payload = 200 OK。Two-pass 可行但非必須。Column ID 不在 PATCH response 中，需 GET /children。Decision 6 修訂為 one-shot default + 422 fallback。詳見 `spikes/01-column-list-nesting.result.json`
- [x] 1.2 Spike 一次 append 多個 `column_list`：驗證「同 request 中兩個 column_list 互為 sibling」是否合法；作為 Decision 6 two-pass 策略的併發優化依據
  > **Result (2026-04-16)**: 確認可行。2 個 column_list（2-col + 3-col）在同一 PATCH = 200 OK，各含完整 inline children。Orchestrator 可合併 batch
- [x] 1.3 Spike `file_upload` 生命週期：single_part 上傳一張 PNG、取得 `file_upload_id`、分別於 30s / 1min / 5min / 10min 後 attach 到 image block，記錄哪些 attach 成功，決定 orchestrator 的上傳時窗設計
  > **Result (2026-04-16)**: create(pending) → send(uploaded) → attach×3 全 200 OK。0s/30s/90s 都成功；同一 id 可多次 attach。Blob MIME 必須與 create 的 content_type 一致。5min/10min 未測（orchestrator < 1min 已在安全窗口）
- [x] 1.4 Spike rate limit burst 容量：用 notionApi MCP 連續發 10 個 `retrieve-a-block` 請求，記錄觸發 429 的時序；用結果調整 `notion-api-client.js` token bucket 的 burst 參數
  > **Result (2026-04-16)**: 10 個順序 GET 全 200 OK，0 個 429（wall 2.6s，avg 251ms）。Burst >= 10。Decision 7 burst=5 保守可行
- [x] 1.5 Spike `archive` child_page：建一個含 subtree 的 child_page、呼叫 `DELETE /v1/blocks/{page_id}`、重新 fetch 驗證 subtree 是否一併 archive；確認 Step A 的 archive 策略能正確清空頁面
  > **Result (2026-04-16)**: DELETE child_page → page.archived=true，subtree 不再可存取。Step A archive 策略確認
- [x] 1.6 Spike `heading_4` block type：嘗試 append `{type: "heading_4", heading_4: {rich_text: [...]}}` 到測試 page，成功則記錄用法；失敗則確認 Decision 1 的 H4 降級邏輯為正解
  > **Result (2026-04-16)**: heading_4 **存在且可用**（200 OK，type returned = heading_4）。Task 5.4 確認：H4 → heading_4 直接映射，不降 H3

## 2. 新增 `scripts/md-to-notion-blocks.py`（converter base）

- [x] 2.0 確認 `scripts/vendor/ew-notion-component-docs/convert.py` 存在且 sha256 為 `0c585786f3cde5cd669858eda12afbffb557a8c9036637de8b9ac47554d932ab`（對應 design.md Appendix A）；若 hash 不符則停工，不可盲目覆寫
- [x] 2.1 從 `scripts/vendor/ew-notion-component-docs/convert.py`（本 repo vendored snapshot，provenance 見 design.md Appendix A）複製全檔到 `scripts/md-to-notion-blocks.py`，保留所有既有 block builder 與 rich text parser
- [x] 2.2 重新命名檔案頂部 docstring 與 `argparse` 描述為 `notion-automation-studio publish` 用途；刪除 ew-notion-component-docs 專用的 Vuetify 組件 docs 流程註解
- [x] 2.3 沿用 convert.py 既有的 Python 3 stdlib 依賴：`sys`, `json`, `re`, `argparse`, `pathlib`；確認不新增任何 pip 依賴
- [x] 2.4 CLI 介面對外統一為 `uv run scripts/md-to-notion-blocks.py <md_file> [-o <out>] [--compact]`，確認 stdout / stderr / exit code 行為與 convert.py 一致
- [x] 2.5 在檔案頂部加入 PEP 723 inline script metadata（shebang `#!/usr/bin/env -S uv run --script` 與 `# /// script` block，`requires-python = ">=3.8"`、`dependencies = []`），並 `chmod +x` 讓 `./scripts/md-to-notion-blocks.py` 直接可執行

## 3. Converter Delta 改動 #1：`<columns>` / `<column>` tag 解析

- [x] 3.1 在 `classify_line` 新增 `columns_start` / `columns_end` / `column_start` / `column_end` 四個 line type，regex 大小寫不敏感；`<column>` 支援可選 `width_ratio="0.5"` attribute
- [x] 3.2 新增 `block_column_list(columns)` builder，回傳 `{type: "column_list", column_list: {}, children: columns}`；新增 `block_column(children, width_ratio=None)` builder，當 width_ratio 存在時寫入 `column.width_ratio`
- [x] 3.3 在 `convert_markdown_to_blocks` main loop 中新增 `columns_start` 分支，遞迴收集直到 `columns_end`；內部的 `column_start` / `column_end` 遞迴收集該 column 的 children（sub-blocks）
- [x] 3.4 限制 columns 內容：v1 不支援 `<columns>` 嵌在 `<toggle>` / `<aside>` 內、不支援 `<column>` 內巢狀 `<columns>`；遇到違規 raise ValueError，stderr 指出行號
- [x] 3.5 驗證同一 `<columns>` 內所有 `<column>` 的 `width_ratio` 總和為 1（若全部省略則 skip 驗證）；不符時 stderr 警告但不中止

## 4. Converter Delta 改動 #2：`--images-manifest` file_upload 模式

- [x] 4.1 `argparse` 新增 `--images-manifest <json_path>` 選項；未提供時 converter 行為與 convert.py 原本一致（external URL）
- [x] 4.2 Main 函式載入 manifest JSON，建立 `images_map: dict[str, dict]`，key 為相對路徑（相對 md 檔所在目錄）
- [x] 4.3 修改 `block_image(url, caption, images_map=None)` 函式簽名：若 `images_map` 且 `url` 能以相對路徑 match 則產生 `{type: "image", image: {type: "file_upload", file_upload: {id}, caption}}`，否則 fallback 為既有 external URL 產出
- [x] 4.4 Main loop 在呼叫 `block_image` 時傳入 `images_map`；relative path 的 normalization 統一用 `os.path.normpath(os.path.join(md_dir, url))`
- [x] 4.5 Manifest 未涵蓋某張圖時 stderr 警告「image X not in manifest, fallback to external」；external 在 file_upload 模式通常不是預期，維運人員應檢查 uploader 是否跑齊

## 5. Converter Delta 改動 #3：H4+ heading 降級

- [x] 5.1 修改 `classify_line` 的 heading regex 從 `^(#{1,3})\s+` 改為 `^(#{1,6})\s+`，支援偵測 H4–H6
- [x] 5.2 Main loop 的 heading 分支：若 level == 4 降為 heading_3、若 level ∈ {5, 6} 降為 paragraph 且內容包在 bold rich_text item 中
- [x] 5.3 降級時 stderr 警告「H{level} downgraded, consider restructuring source」，幫助源檔重構
- [x] 5.4 Spike task 1.6 若證實 `heading_4` block type 存在，將 H4 直接映射為 `heading_4` 而非降 H3；H5/H6 仍降 paragraph

## 6. Converter Delta 改動 #4：rich_text content > 2000 字自動拆

- [x] 6.1 新增工具函式 `split_rich_text_content(content: str, max_len: int = 2000) -> list[str]`，按換行、空白、硬切三層優先切段
- [x] 6.2 修改 `_text_obj` 為 `_text_obj_list`（回傳 list）：content 超過 2000 字時先切、每段產生獨立 rich_text item，共用相同 annotations
- [x] 6.3 修改所有 block builder：原先 append 單個 `_text_obj` 的地方改為 extend `_text_obj_list` 的回傳陣列
- [x] 6.4 驗證 `parse_rich_text` 在 inline annotation 邊界不會被拆壞：`**非常長的粗體**` 超過 2000 字時，應產生 N 個 bold rich_text item，annotation 一致

## 7. Converter Fixture 驗證

- [x] 7.1 建立 `openspec/changes/add-publish-via-api/fixtures/sample-columns.md` 與對應期望 `.blocks.json`；涵蓋 2 組 `<columns>`、1 個孤立 image、1 個獨立段落 image、1 個 table、1 個 code block
- [x] 7.2 手動對 `3-B-SRS/output/requirements-3-B.md` 跑一次 converter（external mode，無 manifest），驗證整份 output 能產出合法 block JSON 且 block 數 < 1000
  > **Result**: 569 blocks（< 1000），全部結構合法。Type 分佈：paragraph 216、numbered_list 209、bulleted_list 56、heading_3 54、heading_2 9、divider 8、image 7（top-level）+4（column children）=11、column_list 2、table 1、code 1
- [x] 7.3 用 `--images-manifest` 模式跑同一份 output，manifest 預先準備假的 file_upload_id；驗證所有 `![]()` 都轉為 file_upload 模式
  > **Result**: 全部 11 張圖片轉為 file_upload，0 張 external fallback，0 個 stderr 警告

## 8. 新增 `scripts/notion-api-client.js`（REST client）

- [x] 8.1 檔案結構：頂部 module docstring 與 usage 範例；export 物件 `{ postPage, retrievePage, getBlockChildren, appendBlockChildren, deleteBlock, createFileUpload, sendFileUpload }`
- [x] 8.2 Token 讀取：優先 `process.env.NOTION_TOKEN`、fallback 讀 `./.mcp.json` 的 `mcpServers.notionApi.env.NOTION_TOKEN`、再 fallback `~/.mcp.json`；三處都無則 throw
- [x] 8.3 通用 `request(method, path, body, extraHeaders)` 函式：自動帶入 `Authorization: Bearer <token>` 與 `Notion-Version: 2022-06-28`，body 為 JSON.stringify
- [x] 8.4 實作 token bucket rate limiter：capacity 5、refill 3 tokens/sec；每次 `request` 開頭 `await acquireToken()`
- [x] 8.5 實作 429 retry：`Retry-After` header（秒）決定等待時間，最多 5 次重試，指數退避 backoff factor 2
- [x] 8.6 標準化 error shape：非 2xx response 拋 `{status, code, message, requestId}`，`code` / `message` 從 Notion error body 取
- [x] 8.7 `sendFileUpload` 需特殊處理 multipart/form-data：用 Node 18+ 原生 `FormData` + `Blob(buffer)` 構造 body、不帶 `Content-Type` header 讓 fetch 自動處理 boundary
- [x] 8.8 手動測試：用 test integration token 對測試 page 跑 retrievePage / getBlockChildren，確認 rate limit 與 auth 正確
  > **Result**: retrievePage 取得 "notion mcp testing" page OK；getBlockChildren 回傳 5 children (3 paragraph, 1 toggle, 1 child_page)。Token 從 .mcp.json 正確解析，rate limiter 正常

## 9. 新增 `scripts/notion-upload-image.js`（file_upload CLI）

- [x] 9.1 CLI 介面 `node scripts/notion-upload-image.js --batch <id> --file <relative_path> [--mapping <path>]`；預設 mapping 為 `./.claude/notion-mapping.json`
- [x] 9.2 讀 mapping 取得 `batches[{batch}].images[{relative}]`，計算檔案 md5（`crypto.createHash('md5')`）
- [x] 9.3 Cache hit（md5 match）：直接 stdout 印 `{file_upload_id, md5, cached: true}`、exit 0
- [x] 9.4 Cache miss：呼叫 `createFileUpload({mode: "single_part", filename, content_type: "image/png"})` → 拿 `file_upload.id` → 呼叫 `sendFileUpload({id, buffer, filename})` → 確認 response status == "uploaded"
- [x] 9.5 成功後回填 mapping：`batches[{batch}].images[{relative}] = {md5, file_upload_id, uploaded_at: new Date().toISOString()}`，`fs.writeFileSync` 寫回
- [x] 9.6 錯誤處理：檔案不存在、檔案 > 20 MB、API error 都 stderr 明確訊息、exit 1
- [x] 9.7 Idempotent 保證：同一檔案連跑兩次，第二次應 100% cache hit，mapping 不變
  > **Result**: R0050_報修登記表.png — 第一次 cached:false (file_upload_id=3443d161...)，第二次 cached:true 瞬間完成，mapping 回填正確

## 10. 新增 `scripts/publish-to-notion.js`（orchestrator）

- [x] 10.1 CLI 介面：`node scripts/publish-to-notion.js --batch <id> [--dry-run] [--discover] [--mapping <path>]`
- [x] 10.2 `--discover` 模式：從 mapping 讀 `parent_page_id`、`GET /v1/blocks/{parent}/children` 分頁掃、找 toggle heading 內含 `sandbox.child_page_title` 的 child_page、寫回 mapping 的 `sandbox.child_page_id` / `sandbox.child_page_url`；失敗時 stderr 指示 bootstrap 步驟
- [x] 10.3 正常模式 Step A（archive）：`GET /v1/blocks/{child_page_id}/children` 分頁撈所有 top-level block id、逐個 `DELETE /v1/blocks/{id}`（包含 child_page 類型）、全部成功才進 Step B
  > **Implementation note**: archive 中途失敗會 log 斷點位置（已成功 archive N 個），然後 throw 中止
- [x] 10.4 正常模式 Step B（image upload）：regex 掃 output markdown 的 `![alt](path)`、對每個 path 呼叫 `notion-upload-image.js` 子程序（`execFileSync`）、收集 `{path: file_upload_id}` manifest、寫到 temp file
- [x] 10.5 正常模式 Step C（convert）：`execFileSync('uv', ['run', 'scripts/md-to-notion-blocks.py', outputMd, '--images-manifest', manifestPath])`、parse stdout JSON 取得 block 陣列；若 `uv` 不在 PATH 則 fail fast 並指示 `brew install uv`
- [x] 10.6 正常模式 Step D（safety check）：`blocks.length > 1000` → stderr 中止；`> 900` → warn 繼續；同時計算 nested block 深度、超過 2 層的 block 標記為「需 two-pass」
- [x] 10.7 正常模式 Step E（append）：分批（每批 ≤ 100 blocks）`appendBlockChildren`；column_list 預設 one-shot（依 Decision 6 修訂），422 時 fallback two-pass
  > **Implementation note**: 依 spike 1.1 結果，column_list 預設 one-shot append（含 inline children）。僅在 422 錯誤時 fallback 為 two-pass：strip column children → append container → GET column IDs → append children。Two-pass 加入 column count mismatch 警告
- [x] 10.8 正常模式 Step F（state update）：計算 output md 的 md5、寫回 `notion-mapping.json` 的 `batches[{batch}].sandbox.last_synced_at` / `last_synced_source_md5`
  > **Implementation note**: Step F 前重新從 disk 載入 mapping，避免覆寫 Step B 子程序寫入的 image cache entries（code review 發現的 stale-read 競爭修正）
- [x] 10.9 `--dry-run` 模式：Step A–C 照跑（upload 會真的上傳以產出 manifest）、Step D 的 safety check 照跑、Step E/F 跳過；印 preview: block 數、column_list 數、預估 API calls 數
- [x] 10.10 Progress logging：每批 append 後印 `[N/M] appended K blocks`；token bucket wait 時印 `rate-limited, waiting Xms`
- [x] 10.11 錯誤處理：Step A 失敗立即中止（頁面狀態 OK）；Step B / C 失敗在 archive 完成後、不 rollback（頁面暫時空白，下次 publish 重新填充）；Step E 中途失敗留下半填充狀態，log 明確指出斷點

## 11. 修改 `skills/srs-publish-notion/SKILL.md`

- [x] 11.1 Step 2（Discovery）：改為呼叫 `node scripts/publish-to-notion.js --discover --batch {batch}`，原有的 `mcp__plugin_Notion_notion__notion-fetch` 邏輯整段刪除
- [x] 11.2 Step 3（載入 notion-doc-writing 規則）：保留，但在內化清單中新增 Image / Columns 條目（對應 task 12 的新增章節）
- [x] 11.3 Step 4（轉換為 Notion-ready markdown）：整段刪除；skill 不再手動做 H5 降級、長段落拆分、圖片 placeholder、warning callout 注入
- [x] 11.4 Step 5（Publish Gate）：preview 來源改為 `node scripts/publish-to-notion.js --dry-run --batch {batch}` 的 stdout
- [x] 11.5 Step 6（執行發佈）：改為單一命令 `node scripts/publish-to-notion.js --batch {batch}`；skill 只讀 exit code 與 stdout 報告
- [x] 11.6 Step 7（報告）：改為轉述 orchestrator 的 stdout 報告，skill 不再自行組報告
- [x] 11.7 v1 沙箱限制表：移除「圖片不自動上傳」整列；保留「全量覆寫 child page」、「不自動建立 toggle block」、「不做雙向同步」；「跨需求引用為純文字」改為「warn（未來可升級 mention）」
- [x] 11.8 Prerequisite 段落新增：`NOTION_TOKEN` 必須可讀（env 或 `.mcp.json`）、`uv` 必須在 PATH（`brew install uv`）、`node` ≥ 18 必須在 PATH
- [x] 11.9 Integration 段落更新：列出本 change 新增的三個 capability（markdown-to-notion-blocks / notion-api-client / notion-image-upload）為依賴

## 12. 修改 `skills/notion-doc-writing/block-selection.md`

- [x] 12.1 新增 **Image 用法要點** 章節，位置緊接在 Table 之後
- [x] 12.2 更新「Block 選用對照表」補上 image 一列
- [x] 12.3 新增 **Columns 用法要點** 章節，擴充既有的簡短條目（含語法範例、內容規則、限制）
- [x] 12.4 更新「Block 選用對照表」的 columns 一列，cross-ref 新章節

## 13. 修改 `templates/notion-mapping.json.tmpl`

- [x] 13.1 `batches.{BATCH_ID}.images` 的 schema 註解更新為 `{md5, file_upload_id, uploaded_at}`（原為 `{md5, notion_url}`）
- [x] 13.2 Template `_comment` 段落補一句：「images 由 notion-upload-image.js 自動管理，手動編輯會被 script 覆寫」
- [x] 13.3 檢查既有 `srs-setup` skill / `scaffold-batch` 腳本是否有 hardcode 舊 schema，若有一併更新
  > **Result**: `append-batch-mapping.js:149` 有 `images: {}`（空物件初始化），schema 相容，不需修改。`scaffold-batch.js` 無 images 相關內容

## 14. 端到端驗證（對 3-B 實際 publish）

- [x] 14.1 對 `3-B-SRS/output/requirements-3-B.md` 跑 `node scripts/publish-to-notion.js --dry-run --batch 3-B`、驗證 preview 正確、block 數 < 1000、列出所有 column_list
  > **Result (2026-04-16)**: 569 top-level / 584 total blocks, 最大深度 2, 2 column_list, 11 張圖片（10 上傳 + 1 cache hit）。首次執行發現 converter 的 `block_column_list` / `block_column` 將 children 放在 top-level 而非 `column_list.children` / `column.children`，Notion API 回 400 validation_error。修正 converter 與 orchestrator two-pass fallback 後 dry-run 通過
- [x] 14.2 對同一 output 跑 `node scripts/publish-to-notion.js --batch 3-B`、驗證 publish 成功、mapping.json 的 images 全部填入 file_upload_id
  > **Result (2026-04-16)**: 首次嘗試在 Step E batch 2 失敗 — R0050 的 file_upload_id（spike 階段 06:29 上傳）已 expired（>1.5hr TTL）。清除 R0050 cache 後重跑成功：569 blocks append in 6 batches, 11/11 images 有 file_upload_id, last_synced_source_md5 = f537271df5fdcda022164baa9cae5c9c
- [x] 14.3 打開 Notion 目標頁面、視覺驗證所有 11 張圖存在、caption 正確、R0044 的 2 組 columns 正確併排、R0051 的三張獨立 figure 順序正確
  > **Result (2026-04-16)**: API 結構驗證通過 — 11 張圖全部存在（4 in columns + 7 top-level）、全部有 caption、2 column_list 各含 2 columns（paragraph + image）、R0051 三圖順序正確（天然氣→電費→台電）、所有 image type 為 file（file_upload 已 resolve）。瀏覽器視覺驗證需 Notion 登入，由使用者手動確認
- [x] 14.4 對同一 output 重跑一次 publish（無修改）、驗證 image upload 100% cache hit、archive 正確清空舊內容、新內容完全一致
  > **Result (2026-04-16)**: 0 上傳 / 11 cache hit, archive 569 blocks → append 569 blocks, source_md5 不變 = f537271df5fdcda022164baa9cae5c9c。Idempotent publish 確認
- [x] 14.5 修改 source 其中一張圖（替換檔案）、重跑 publish、驗證對應 image 重新上傳（cache miss）、其他圖仍 cache hit
  > **Result (2026-04-16)**: 替換 R0052_DormitoryFee（md5 1178...→e637...），結果 1 上傳 + 10 cache hit。首次嘗試遇 502 transient error 在 archive 167/569 中斷，重跑從剩餘 402 blocks 繼續 archive 後成功完成。已還原測試圖片

## 15. 文件與 Change 收尾

- [ ] 15.1 更新 `openspec/changes/add-publish-via-api/proposal.md` 的 Non-Goals / Impact 如果實作過程發現 scope 需調整
- [ ] 15.2 更新 `skills/srs-publish-notion/SKILL.md` 的「完成檢查」清單比照新流程
- [ ] 15.3 執行 `openspec` CLI 或等效手動檢查：`openspec validate add-publish-via-api`、確認 four specs 的 delta 描述符合 openspec schema
- [ ] 15.4 Archive 既有的 `.git/spectra-app/changes/add-publish-structure-validation` 或標記為「superseded by add-publish-via-api」，避免未來混淆；本 change 的 orchestrator 已包含基本的結構安全檢查（block count cap），park spec 的 fatal rules 可由 converter 隱性承擔

## 16. Traceability Matrix（requirement & decision 覆蓋對照）

> 本章節為 `spectra analyze` 所需的覆蓋度追蹤表。每條 trace item 對應一則
> spec requirement 或 design decision，並指出由哪些實作 task 承擔。完成實作
> 與人工複核後勾選，作為 change archive 前的最終 sign-off checklist。

### 16.1 Spec requirement traceability

- [ ] 16.1.1 Trace requirement `Converter CLI contract` → tasks 2.1 / 2.4 / 2.5 / 7.2
- [ ] 16.1.2 Trace requirement `Block type coverage` → tasks 2.1 / 3.x / 5.x / 7.1
- [ ] 16.1.3 Trace requirement `Rich text annotations` → tasks 2.1 / 6.1 / 6.4
- [ ] 16.1.4 Trace requirement `Columns block parsing` → tasks 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 7.1
- [ ] 16.1.5 Trace requirement `Image file_upload mode` → tasks 4.1 / 4.2 / 4.3 / 4.4 / 4.5 / 7.3
- [ ] 16.1.6 Trace requirement `H4+ heading downgrade` → tasks 5.1 / 5.2 / 5.3 / 5.4
- [ ] 16.1.7 Trace requirement `Long rich text content splitting` → tasks 6.1 / 6.2 / 6.3 / 6.4
- [ ] 16.1.8 Trace requirement `HTML-like tag containers` → tasks 3.1 / 3.4 / 12.3
- [ ] 16.1.9 Trace requirement `Client module surface` → tasks 8.1
- [ ] 16.1.10 Trace requirement `Token discovery` → tasks 8.2 / 11.8
- [ ] 16.1.11 Trace requirement `Standard headers` → tasks 8.3
- [ ] 16.1.12 Trace requirement `Rate limit enforcement` → tasks 8.4 / 10.10
- [ ] 16.1.13 Trace requirement `429 retry with Retry-After` → tasks 8.5
- [ ] 16.1.14 Trace requirement `Standardized error shape` → tasks 8.6
- [ ] 16.1.15 Trace requirement `Pagination helpers` → tasks 8.1 / 10.2 / 10.3
- [ ] 16.1.16 Trace requirement `Uploader CLI contract` → tasks 9.1
- [ ] 16.1.17 Trace requirement `md5 cache semantics` → tasks 9.2 / 9.3 / 9.4 / 9.7
- [ ] 16.1.18 Trace requirement `Idempotence` → tasks 9.7 / 14.4
- [ ] 16.1.19 Trace requirement `Secure mapping rewrite` → tasks 9.5 / 13.2
- [ ] 16.1.20 Trace requirement `Error propagation` → tasks 9.6
- [ ] 16.1.21 Trace requirement `Orchestrator integration` → tasks 10.4
- [ ] 16.1.22 Trace requirement `Publish transport layer` → tasks 10.1 / 10.5 / 11.1 / 11.5
- [ ] 16.1.23 Trace requirement `V1 sandbox limitations` → tasks 11.7
- [ ] 16.1.24 Trace requirement `Prerequisites` → tasks 11.8
- [ ] 16.1.25 Trace requirement `Error reporting contract with orchestrator` → tasks 10.11 / 11.6
- [ ] 16.1.26 Trace requirement `Migration from MCP path` → tasks 11.1 / 11.9

### 16.2 Design decision traceability

- [ ] 16.2.1 Trace decision 1：reuse `ew-notion-component-docs/convert.py` as converter base → tasks 2.1 / 2.2 / 2.3
- [ ] 16.2.2 Trace decision 2：language mix — python converter + node orchestrator / client / uploader → tasks 2.x / 8.x / 9.x / 10.x
- [ ] 16.2.3 Trace decision 3：column source syntax — `<columns>` / `<column>` html-like tag → tasks 3.1 / 3.2 / 3.3 / 3.4 / 3.5
- [ ] 16.2.4 Trace decision 4：image 雙模式 — external url or file_upload → tasks 4.1 / 4.2 / 4.3 / 4.4 / 4.5
- [ ] 16.2.5 Trace decision 5：publish flow — archive-then-append, no block diff → tasks 10.3 / 10.7
- [ ] 16.2.6 Trace decision 6：column nesting — two-pass append → tasks 1.1 / 10.7
- [ ] 16.2.7 Trace decision 7：rate limit — token bucket with burst 5 → tasks 1.4 / 8.4
- [ ] 16.2.8 Trace decision 8：python invocation via `uv` → tasks 2.5 / 10.5 / 11.8
- [ ] 16.2.9 Trace decision 9：notion_token source — read from `.mcp.json` → tasks 8.2 / 11.8
