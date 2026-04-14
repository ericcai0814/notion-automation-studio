---
name: srs-publish-notion
description: >
  將 SRS 需求文件發佈到 Notion workspace 沙箱 toggle。
  當用戶輸入「publish 到 notion」「PUBLISH」「發佈 SRS」「同步到 Notion」
  「把 {batch} 推到 Notion」「更新 Notion 沙箱」
  或在 srs-sync 完成後需要將 output/requirements-{batch}.md 發佈到
  Notion 時觸發。
  組合 notion-doc-writing skill 與官方 Notion MCP tools 完成發佈，
  v1 沙箱階段：全量覆寫、刪除既有 child page、頁首注入 warning callout、
  publish gate 等使用者確認、圖片手動處理、跨需求引用純文字。
---

# SRS 發佈至 Notion Sandbox Skill

把 `{batch}-SRS/output/requirements-{batch}.md` 發佈到 Notion workspace 的
沙箱 toggle 內的 child page。實際的 parent / toggle label / child page
title 由專案 `.claude/notion-mapping.json` 指定。

## 設計分層

這個 skill 是**業務層**，組合下列兩個既有元件：

```
業務層：srs-publish-notion（本 skill）
  ├─ 內容層：notion-doc-writing skill（格式守則、block 選用、size limits、陷阱清單）
  └─ 工具層：mcp__plugin_Notion_notion__* tools（官方 Notion plugin 提供的 API call）
```

**執行前必做**：先載入 `notion-doc-writing` skill 的 Pre-Write Checklist 與
Anti-Patterns。本 skill 不重抄內容格式規則，只負責 SRS 業務邏輯。

## v1 沙箱階段的限制（明確列出不處理的）

| 限制 | 原因 | 之後怎麼升級 |
|------|------|--------------|
| 全量覆寫 child page（不做 block-level diff） | 沙箱無評論保留需求，求簡單 | 正式化時改 block diff |
| 圖片**不**自動上傳 | Notion MCP 無本地檔案上傳 API | 加 CDN / 圖片 host 步驟 |
| 跨需求引用為純文字 | Notion 無 markdown anchor，block mention 需先建後拿 ID | 第二輪 publish 填 mention |
| 不自動建立 toggle block | MCP 無法將 page parent 到 block_id | 使用者手動建 toggle |
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
Notion MCP `notion-create-pages` 只能把 page parent 到 `page_id` /
`database_id` / `data_source_id`，不能 parent 到 block_id（例如 toggle block）。
所以 child page 的初始容器必須人工建立。之後 skill 只管理該 child page 的內容。

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

1. 用 `mcp__plugin_Notion_notion__notion-fetch` 取 `parent_page_id` 的內容
2. fetch 結果會是 Notion-flavored markdown，toggle 與 child page 大致長這樣：
   ```
   <details>
   <summary>{toggle_label}</summary>
   <page url="https://www.notion.so/<workspace>/xxx">{child_page_title}</page>
   </details>
   ```
3. 找到 `<summary>` 含 `toggle_label` 字串的 `<details>` 區塊，在其中抓出
   `<page url="...">{child_page_title}</page>` tag，提取 URL 與 page ID
4. 若找不到：回報「請先依 Bootstrap 步驟手動建立 toggle + child page」並停止
5. 找到：Edit `notion-mapping.json` 寫入 `child_page_id`、`child_page_url`

### Step 3: 載入 Notion 內容層規則

**Read** `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/SKILL.md`，必要時
進一步 Read 下列支援檔案：
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/markdown-gotchas.md` — 完整陷阱清單
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/block-selection.md` — block type 選用
- `${CLAUDE_PLUGIN_ROOT}/skills/notion-doc-writing/property-conventions.md` — 屬性命名

確認以下規則內化：

- Title 不在 content 第一行（源檔若有 `# {child_page_title}` H1 須剝除）
- Heading 最深 H4（六大章節 + 子層若超過要降級或折 toggle）
- 多行 quote 用 `<br>` 連接
- Tab 縮排
- Single rich text < 2000 字元，過長要拆
- Code block 不轉義
- Callout/table cell 用 markdown 不用 HTML

### Step 4: 將源檔轉為 Notion-flavored markdown

輸入：`{batch}-SRS/output/requirements-{batch}.md` 的完整內容
輸出：Notion-ready 的 markdown 字串

轉換規則：

1. **剝除最外層 H1**
   若源檔第一行是 `# {child_page_title}` → 移除（title 由 properties 管）
   保留 `# 壹、版本說明`、`# 貳、需求大綱`、`# 參、需求內容` 等 H1
   （注意：`merge-srs.js` 產出的章節是 H1，不是 H2）

2. **Heading 深度檢查**
   - 掃描所有 heading，若有 H5 / H6 → 降級為 H4 或改用 `<details>` toggle
   - 建議策略：第四層以下改 toggle

3. **長段落拆分**
   - 偵測連續文字段落 > 1800 字元（保守閾值），在語意邊界拆分

4. **圖片路徑處理（v1 限制）**
   - 掃描所有 `![...](../assets/R00XX/xxx.png)` 格式
   - 替換為 placeholder callout：
     ```
     <callout icon="🖼️">
     **[待上傳圖片] R00XX/xxx.png** — 原說明文字
     </callout>
     ```
   - 收集所有圖片清單用於 Step 7 的輸出

5. **跨需求引用處理（v1 限制）**
   - `詳見【R00XX】功能名稱` 保留為純文字（Notion 使用者可 Ctrl+F 搜尋）

6. **Block 數量估算**
   - 粗估：每個 heading/paragraph/list item/table row 算 1 block
   - 若預估 > 900，進入 **分批模式**（見 Step 6 的 fallback）

7. **頂部插入 warning callout**（**契約強制**）
   在剝除過 H1 之後、所有正文章節之前，插入：
   ```
   <callout icon="⚠️">
   **此頁面由 `srs-publish-notion` skill 自動產生**，請勿手動編輯。
   下次 publish 會覆蓋所有內容（包含本頁的所有 block 與 child page）。
   </callout>
   ```
   這是 Notion 結構契約第 2 條，**不可省略**。

### Step 5: Publish Gate（使用者確認）

**任何 destructive Notion 操作之前，必須停下並等待使用者確認**。本 step
的目的是讓使用者親眼看到「將要做什麼」、評估風險後才執行。

#### 5.1: 顯示 Preview

輸出下列格式給使用者：

```
## Publish Preview — 等待確認

### 源檔
- 路徑: {batch}-SRS/output/requirements-{batch}.md
- 大小: N 行 / N 字
- md5: <hash>

### 偵測到的需求
- 從 src/ 讀到的 R-IDs（例如 R0001, R0002, …）
（共 N 份；若與專案 CLAUDE.md 需求清單對不上會在此提示）

### 將執行的 Notion 操作
- ⚠️ 刪除既有 child page: N 個
  · {child_page_title}/R00XX_{功能名稱}
  · ...（列出所有將被 archive 的 child page）
- 注入 warning callout 於頁首
- 全量覆寫 child page 內容
- 更新 mapping 的 last_synced_at 與 last_synced_source_md5

### Notion API 呼叫估計
- 1 × notion-fetch（重新確認 child pages）
- N × notion-update-page（archive 每個既有 child page）
- 1 × notion-update-page（replace_content 寫入新 markdown）

### 風險
- ⚠️ 既有 N 個 child page 將被永久 archive（Notion 沒有版本控制）
- ⚠️ 任何 Notion 端的人工編輯都會被覆寫

請說 `confirm` 確認執行，或說 `cancel` 取消。
```

#### 5.2: 等待使用者輸入

- **不要自動執行**下一步 — 必須等使用者下一輪輸入
- 接受常見同意詞（寬鬆語意 confirm）：
  - `confirm` / `yes` / `y` / `OK` / `ok` / `go`
  - `推` / `OK 推` / `好` / `確認` / `沒問題`
- 任何其他輸入視為取消，停止流程，**不做任何 Notion API 呼叫**
- 取消時回報：「已取消發佈，未做任何 Notion 操作」

### Step 6: 執行發佈（gate 通過後）

#### 6.1: 偵測並 archive 既有 child page

1. 用 `mcp__plugin_Notion_notion__notion-fetch` 重新讀取 `child_page_id` 的內容
2. 解析回傳裡的 `<page url="...">XXX</page>` tags，這些是該頁的既有 child page
3. 對每個既有 child page 呼叫 `mcp__plugin_Notion_notion__notion-update-page`
   進行 archive：
   ```json
   {
     "page_id": "<child_id>",
     "command": "archive"
   }
   ```
   （或 plugin 實際支援的對應指令；archive 是 Notion 的 soft-delete，可恢復）
4. 任何刪除失敗，停止並回報哪一頁失敗、原因為何

#### 6.2: 寫入新內容

呼叫 `mcp__plugin_Notion_notion__notion-update-page`：

```json
{
  "page_id": "<sandbox.child_page_id>",
  "command": "replace_content",
  "new_str": "<Step 4 產出的 Notion-ready markdown，含頂部 warning callout>",
  "properties": {},
  "content_updates": []
}
```

由於 6.1 已清空 child page，replace_content 不會再觸發「will delete child
pages」錯誤。若仍報錯，停止並回報異常。

#### 6.3: Fallback（block > 900）

若 Step 4 預估 block 數超過 900：
1. 先用 `command: "replace_content", new_str: "<只有 callout + 第一段>"` 建立基礎
2. 將剩餘新內容切成多段（每段 < 900 blocks）
3. 依序用 `command: "update_content"` 以 search-and-replace 方式 append

實務上一個批次的 SRS 應該在 900 block 以內，fallback 罕用。

### Step 7: 更新 mapping 並輸出報告

1. Edit `notion-mapping.json`，更新：
   - `sandbox.last_synced_at`：當前 ISO timestamp
   - `sandbox.last_synced_source_md5`：源檔 md5（用 Step 5 preview 算過的值）
2. 輸出發佈報告：

```
## Publish to Notion Sandbox — 完成

### 目標
- Page: {child_page_title}
- URL: <child_page_url>
- 更新時間: <timestamp>

### 統計
- 預估 block 數: N
- 發佈方式: replace_content（單次） / 分批 append
- H5/H6 降級數: N
- 長段落拆分數: N
- Archive 既有 child page 數: N
- 注入 warning callout: ✓

### 待手動處理（v1 限制）
#### 圖片（需手動上傳並回填 notion-mapping.json）
- R00XX/<圖片檔名>.png — 原說明「…」
（共 N 張）

#### 跨需求引用（Notion 端為純文字，不可點擊）
- 詳見【R00XX】{功能名稱}
（共 N 處）

### 下一步建議
1. 打開 Notion 檢視 <child_page_url>
2. 確認頂部 warning callout 顯示正常
3. 確認壹/貳/參 三大章節完整、所有需求都有出現
4. 依圖片清單手動上傳到對應位置
5. 若結構看起來 OK，下次修改源檔後重新執行本 skill
```

### Step 8: 寫入 workflow state

Publish 完整成功後（含 6.1 archive、6.2 replace_content、Step 7 mapping
更新皆通過），記錄 batch 級的 publish 時間戳：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js record-publish \
  .claude/workflow-state.json {batch}
```

**只在完整成功時**寫入。任何一個前置步驟失敗都不呼叫此命令，讓
`state.batches.{batch}.last_publish.ts` 忠實反映最後一次成功發佈時間。

## 完成檢查

- [ ] mapping 檔案已讀取或 Discovery 模式完成
- [ ] notion-doc-writing 規則已載入
- [ ] H1 已剝除、H5/H6 已處理、長段落已拆
- [ ] 圖片已替換為 placeholder 並列入待處理清單
- [ ] **頂部 warning callout 已注入**（契約第 2 條，強制）
- [ ] **Publish gate 已等到使用者明確 confirm 才繼續**
- [ ] **既有 child page 已全部 archive（若有）**
- [ ] Notion page 已更新且無 replace_content 誤刪錯誤
- [ ] mapping 的 last_synced_at 與 last_synced_source_md5 已更新
- [ ] 發佈報告完整列出待手動處理項目
- [ ] workflow-state 的 `batches.{batch}.last_publish.ts` 已記錄

## Integration

| 銜接 | 說明 |
|------|------|
| 前置（建議） | `srs-check` → `srs-sync` → 本 skill |
| 組合 | `notion-doc-writing` skill（內容層）+ 官方 Notion plugin（工具層） |
| 首次執行 | 須先由使用者手動完成 Bootstrap（建 toggle + child page） |
| 失敗降級 | 6.1 archive 失敗 → 停止並列出剩餘 child page；不繼續 6.2 |
| 使用者取消 | Publish gate 階段 → 回報「已取消」，不做任何 Notion 操作 |

## 常見錯誤與處理

| 錯誤 | 原因 | 處理 |
|------|------|------|
| `replace_content` 報「will delete child pages」 | 6.1 沒成功 archive 全部 child page | 停止，回報剩餘的 child page 名稱讓使用者手動處理 |
| `child_page_id` 找不到 | Bootstrap 沒做或 toggle 名稱不對 | 提示使用者檢查 Bootstrap 步驟 |
| 單段 rich text > 2000 字 | 源檔有超長段落 | srs-check 應該要擋到，若漏則當場拆 |
| Block 數 > 900 | SRS 內容太多 | 進入 fallback 分批路徑 |
| 使用者於 publish gate 取消 | 預期行為 | 不做 Notion API 呼叫，回報「已取消」 |
| Child page archive 失敗 | 權限不足或 page 已被別處鎖定 | 停止並回報具體失敗原因，要求人工介入 |
