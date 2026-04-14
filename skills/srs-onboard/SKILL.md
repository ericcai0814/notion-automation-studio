---
name: srs-onboard
description: >
  SRS 專案狀態診斷與 mentor（唯讀）。
  當用戶輸入「我是新來的」「這個專案怎麼用」「怎麼開始」「第一次用」「SRS 是什麼」
  「SRS 怎麼運作」「orientation」觸發 Mode 1（新手導覽）；
  輸入「plugin 設定對嗎」「健檢」「check my setup」「看一下專案狀態」「驗證設定」
  觸發 Mode 2（健檢報告）；
  輸入「我卡住了」「我不知道該做什麼」「現在該做什麼」「下一步」「狀態如何」
  「srs status」「R0001 跑到哪了」觸發 Mode 3（進度診斷）。
  本 skill 絕對不修改任何檔案，只讀取、診斷、建議。
---

# srs-onboard — 專案狀態診斷與 mentor

## 定位（Read-Only Contract）

本 skill 是**純診斷用途**的 mentor。它讀取專案現況、判斷使用者處於工作流程
的哪個位置，並以中文給出下一步建議。

**鐵則**：
- **不** Write、Edit、mkdir、rm 任何檔案
- **不**自動觸發其他 skill（srs-check / srs-sync / srs-publish-notion 等）
- **不**假設專案內容——一律從實際檔案讀取
- **不**硬編碼任何特定專案或客戶名稱

若發現缺少的檔案或設定，輸出推薦的 skill 指令，讓使用者**手動決定**是否執行。

---

## 三種模式總覽

| 模式 | 觸發情境 | 診斷深度 |
|------|----------|----------|
| **Mode 1** 新手導覽 | 「我是新來的」「怎麼開始」「orientation」「第一次用」「SRS 是什麼」 | 淺：概念說明 + 指向文件 |
| **Mode 2** 健檢報告 | 「plugin 設定對嗎」「健檢」「check my setup」「看一下專案狀態」「驗證設定」 | 中：逐項核對必要檔案與設定 |
| **Mode 3** 進度診斷 | 「我卡住了」「下一步」「現在該做什麼」「狀態如何」「srs status」「R0001 跑到哪了」 | 深：讀取 workflow state，找最遠已完成點，給具體下一步 |

若觸發詞同時符合多個模式，依以下優先順序：Mode 3 > Mode 2 > Mode 1。

---

## Step 1: 環境快速偵測（所有模式都執行）

使用 Glob 與 Read 偵測下列項目，結果供後續模式使用：

```
A. repo root 是否有 CLAUDE.md？
   → Glob: CLAUDE.md
   → 若有：讀取並確認含「需求清單」「術語對照表」「子系統對照」章節

B. 是否有 *-SRS/ 批次目錄？
   → Glob: *-SRS/
   → 記錄所有 batch ID（例如 3-B、4-A）

C. 各 batch 的 src/ 下有哪些 R*.md？
   → Glob: {batch}-SRS/src/R*.md（對每個 batch 執行）

D. 是否有 .claude/notion-mapping.json？
   → 若有：讀取，記錄每個 batch 的 child_page_id 是否已填寫

E. 是否有 .claude/workflow-state.json？
   → 若有：讀取，記錄每個 batch / rid 的 check / sync 時間戳與 last_publish

F. Notion MCP 是否可用？
   → 啟發式判斷：若 mcp__plugin_Notion_notion__* 工具出現在當前環境，記為「可用」
```

---

## Step 2: 模式選擇邏輯

```
觸發詞 → 是否匹配 Mode 3 觸發？
  是 → 執行 Step 5（進度診斷）
  否 → 是否匹配 Mode 2 觸發？
    是 → 執行 Step 4（健檢報告）
    否 → 執行 Step 3（新手導覽）
```

所有模式在輸出前，先輸出 Step 1 偵測到的基本環境摘要（2–4 行），讓使用者
知道 skill 看到了什麼。

---

## Step 3: Mode 1 — 新手導覽

**目標**：讓新使用者在 60 秒內理解這個專案的用途與基本操作方式。

### 3.1 概念簡介（不超過 5 點）

1. 這個 plugin 把 SRS 需求文件的**檢核、整合、發佈**三件事各自封裝成一個 skill
2. 需求內容存放在使用端 repo 的 `{batch}-SRS/src/R*.md`，plugin 只提供工具
3. 日常操作透過自然語言觸發：「審查 R0001」→ 「SYNC R0001」→ 「PUBLISH」
4. `.claude/workflow-state.json` 記錄每份需求跑到哪一步，確保順序不被跳過
5. Notion MCP 讓你可以直接從 Claude Code 把文件推到 Notion workspace

### 3.2 環境偵測回饋

依 Step 1 結果給出針對性提示：

- **若缺 CLAUDE.md** → 說明需要在使用端 repo 建立 CLAUDE.md（含需求清單、術語表）
- **若無 *-SRS/ 目錄** → 推薦執行 `srs-setup` 初始化，再執行 `srs-new-batch {你的批次ID}`
- **若有批次但 Notion MCP 不可用** → 提示需要先安裝並授權 Notion MCP 才能 PUBLISH
- **若一切齊全** → 直接提示可以從「審查 R0001」開始

### 3.3 深度文件指引

完整安裝與首次設定流程請見：
- `docs/INSTALL.md`（Notion MCP 授權、bootstrap Notion toggle / child page）
- `README.md`（概念說明、pipeline 圖示）

---

## Step 4: Mode 2 — 健檢報告

**目標**：系統性確認每個必要檔案與設定，輸出 ✓/⚠/✗ 逐項報告。

### 健檢項目清單

| # | 檢查項目 | 通過條件 |
|---|----------|----------|
| H1 | `CLAUDE.md` 存在 | Glob 找到 |
| H2 | `CLAUDE.md` 含「需求清單」章節 | Read 後找到該標題 |
| H3 | `CLAUDE.md` 含「術語對照表」章節 | Read 後找到該標題 |
| H4 | `CLAUDE.md` 含「子系統對照」章節 | Read 後找到該標題 |
| H5 | 有至少一個 `*-SRS/` 批次目錄 | Glob `*-SRS/` 非空 |
| H6 | 各 batch 有 `src/` 目錄且含 R*.md | Glob 結果非空 |
| H7 | `.claude/notion-mapping.json` 存在 | Glob 找到 |
| H8 | `notion-mapping.json` 每個 batch 的 `parent_page_id` 已填寫 | 非 null / 非空字串 |
| H9 | `notion-mapping.json` 每個 batch 的 `child_page_id` 已填寫 | 非 null（null = 還沒首次發佈） |
| H10 | `.claude/workflow-state.json` 存在 | Glob 找到 |
| H11 | `workflow-state.json` 的 batch 清單與實際 `*-SRS/` 目錄一致 | 比對兩邊 key |
| H12 | Notion MCP 可用 | 環境中有 `mcp__plugin_Notion_notion__*` 工具 |

**注意**：H9 `child_page_id = null` 表示尚未做過首次發佈，輸出 ⚠（非 ✗）
並建議執行 `PUBLISH` 做 Discovery（首次建立 child page）。

---

## Step 5: Mode 3 — 進度診斷

**目標**：讀取 workflow state，報告每個 rid 的進度，找出最遠已完成點，給出
最具體的下一步建議。

### 5.1 讀取狀態

1. 讀取 `.claude/workflow-state.json`（若不存在，推薦先執行 `srs-setup` 或
   `srs-check` 讓 Preflight 自動建立）
2. 讀取 `.claude/notion-mapping.json`（若存在）
3. 用 Glob 列出各 batch 的 `src/R*.md`（以 src 為準，state 可能漏掉新加的 rid）

### 5.2 比對 src vs state

對每個 batch，比對：
- src 中存在的 rid（Glob 結果）
- state 中有記錄的 rid（`records` 物件的 key）

若 src 有但 state 沒有 → 此 rid「從未跑過任何 skill」。

### 5.3 各 rid 進度分類

| 狀態 | 判斷條件 |
|------|----------|
| 未開始 | state 無此 rid 的任何記錄 |
| 已 check | `records.{rid}.check.ts` 存在，但無 `sync.ts` |
| 已 sync | `records.{rid}.sync.ts` 存在 |
| 已發佈 | 同 batch 的 `last_publish.ts` 存在（批次級，非 rid 級） |
| output 已漂移 | `last_sync_output_md5` 與 `output/requirements-{batch}.md` 的實際 md5 不符 |

md5 比對方式（唯讀 Bash）：
```bash
md5 output/requirements-{batch}.md   # macOS
# 或
md5sum output/requirements-{batch}.md  # Linux
```
與 state 中的 `last_sync_output_md5` 比對，不符則標記 ⚠ 漂移。

### 5.4 輸出進度表

每個 batch 輸出一張表，再給「最高優先下一步」建議（見 Step 6）。

---

## 報告範本

### Mode 1 — 新手導覽範本

```
## 歡迎使用 SRS 自動化 Plugin

【環境偵測】
- CLAUDE.md：✓ 找到，含需求清單（N 項）、術語對照表、子系統對照
- Batch 目錄：✓ 找到 {batch}（共 N 份 R*.md）
- Notion MCP：✓ 可用

【Plugin 是什麼】
這個 plugin 把 SRS 需求文件的三件事各自封裝成 skill：
  1. 「審查 R0001」→ srs-check：10 項格式/術語合規檢核，直接修正
  2. 「SYNC R0001」→ srs-sync：合併 src/ 至 output/requirements-{batch}.md
  3. 「PUBLISH」→ srs-publish-notion：推送至 Notion workspace 沙箱頁面

【日常流程】
  編輯 src/R*.md → 審查 → SYNC → PUBLISH

【下一步建議】
你已具備基本設定。建議從第一份需求開始：
→ 說「審查 R0001」讓 srs-check 做合規檢核

完整安裝與 Notion 授權說明：docs/INSTALL.md
```

---

### Mode 2 — 健檢報告範本

```
## SRS Plugin 健檢報告

【環境偵測基礎】
- 偵測時間：2026-04-13T10:00:00Z
- 偵測路徑：/path/to/project

### 健檢結果

| # | 項目 | 狀態 | 說明 |
|---|------|------|------|
| H1 | CLAUDE.md 存在 | ✓ | |
| H2 | 需求清單章節 | ✓ | 共 N 項 |
| H3 | 術語對照表章節 | ✓ | |
| H4 | 子系統對照章節 | ⚠ | 缺少此章節，srs-check 的角色辨識會跳過 |
| H5 | *-SRS/ 目錄 | ✓ | 找到：{batch}（共 1 個） |
| H6 | src/ 含 R*.md | ✓ | {batch}-SRS/src/ 共 N 份 |
| H7 | notion-mapping.json | ✗ | 缺少 .claude/notion-mapping.json |
| H8 | parent_page_id | ✗ | 依賴 H7，跳過 |
| H9 | child_page_id | ✗ | 依賴 H7，跳過 |
| H10 | workflow-state.json | ✓ | |
| H11 | state ↔ 目錄一致性 | ✓ | |
| H12 | Notion MCP | ⚠ | 找不到 Notion MCP 工具，PUBLISH 無法執行 |

### 發現問題

1. ✗ **H7 缺少 notion-mapping.json**：請執行 `srs-setup` 或手動複製
   `templates/notion-mapping.json.tmpl` 至 `.claude/notion-mapping.json`
   並填入 `parent_page_id`（Notion 父頁面 URL 中的 UUID）

2. ⚠ **H12 Notion MCP 不可用**：請依 `docs/INSTALL.md` 授權 Notion MCP plugin

3. ⚠ **H4 缺少子系統對照**：在 CLAUDE.md 補上「子系統對照」章節，srs-check 才能辨識角色
```

---

### Mode 3 — 進度診斷範本

```
## SRS 進度診斷

【環境偵測基礎】
- Batch：{batch}（src/ 共 N 份需求）
- workflow-state.json：✓ 存在
- notion-mapping.json：✓ child_page_id 已填（曾發佈過）

### {batch} 進度表

| RID | Check | Sync | 發佈 | 狀態 |
|-----|-------|------|------|------|
| R0001 | 2026-04-10 | 2026-04-10 | ✓ | 已發佈 |
| R0002 | 2026-04-11 | — | — | 已 check，待 sync |
| R0003 | — | — | — | 未開始 |

⚠ output/requirements-{batch}.md md5 已漂移（與 state 記錄不符）
  → 懷疑 output 在最後一次 SYNC 後被手動編輯
  → 建議重跑 srs-sync 或確認改動是否要保留在 src/

### 最高優先下一步

1. **立即處理漂移**：
   → 若 output 的手動改動需要保留，請先把改動反移回對應的 src/R*.md
   → 接著執行：「SYNC {batch}」（全量重產 output）

2. **繼續推進 R0002**：
   → 執行：「SYNC R0002」

3. **R0003 尚未開始**：
   → 執行：「審查 R0003」
```

---

## 下一步建議矩陣

依偵測到的缺失狀態給出推薦 skill。本 skill 只輸出推薦，**不自動執行**。

| 偵測到的缺失 | 推薦行動 |
|--------------|----------|
| 無 `.claude/` 目錄或無 `workflow-state.json` | 執行 `srs-setup` |
| 無任何 `*-SRS/` batch 目錄 | 執行 `srs-new-batch {你的批次ID}` |
| 有 batch 目錄但無 `src/R*.md` | 建立 `{batch}-SRS/src/R0001_功能名稱.md` 後執行 `srs-check R0001` |
| rid 在 src 存在但無任何 state 記錄 | 執行 `srs-check {rid}` |
| rid 有 check.ts 但無 sync.ts | 執行 `SYNC {rid}` |
| rid 有 sync.ts 但 batch 無 last_publish.ts | 執行 `PUBLISH` |
| `child_page_id = null`（首次發佈前） | 執行 `PUBLISH`（Discovery 模式，自動建立 child page） |
| output md5 漂移 | 先確認 output 的手動改動，再執行 `SYNC {batch}` 重產 |
| `notion-mapping.json` 缺少 `parent_page_id` | 填入 Notion 父頁面 URL 中的 UUID |
| Notion MCP 不可用 | 依 `docs/INSTALL.md` 安裝並授權 Notion MCP plugin |
| CLAUDE.md 缺少需求清單章節 | 補充「需求清單」章節至專案 CLAUDE.md |
| CLAUDE.md 缺少術語對照表 | 補充「術語對照表」章節至專案 CLAUDE.md |
| state batch 清單與 `*-SRS/` 目錄不一致 | 確認是否有 batch 目錄被移除或新增，手動對齊或執行 `srs-new-batch` |

---

## 完成檢查

- [ ] 依觸發詞選定正確模式
- [ ] Step 1 環境偵測結果已在報告頂端顯示
- [ ] 報告以「下一步推薦」結尾，每項推薦包含具體 skill 指令
- [ ] 所有偵測都使用 Read / Glob / Bash（唯讀）完成
- [ ] **沒有修改任何檔案**（Write / Edit / mkdir / rm 皆未使用）
- [ ] 沒有自動觸發其他 skill
- [ ] 沒有硬編碼特定專案名稱或客戶名稱

---

## 不做什麼（Read-Only Boundary）

以下行為**絕對禁止**，即使使用者要求也不能做：

| 禁止行為 | 原因 |
|----------|------|
| Write / Edit 任何 `.md`、`.json` 或其他檔案 | 違反 read-only contract |
| 建立目錄（mkdir） | 交給 `srs-setup` / `srs-new-batch` |
| 自動觸發 `srs-check`、`srs-sync`、`srs-publish-notion` | 使用者必須明確觸發 |
| 從 Notion 拉取資料反寫 markdown | 違反單向同步原則 |
| 複製 template 檔案至 `.claude/` | 交給 `srs-setup` 的 Preflight |
| 根據過去記憶假設專案設定 | 必須每次從實際檔案讀取 |

若使用者請求的行為觸及上述禁止項目，解釋原因，並告知應執行哪個 skill 來完成。

---

## Integration

| 銜接 | 說明 |
|------|------|
| 前置 | 無——本 skill 可在任何時間點觸發 |
| 後續（Mode 1） | 若缺設定 → `srs-setup`；若準備好 → `srs-check {rid}` |
| 後續（Mode 2） | 依健檢缺失項目執行對應 skill |
| 後續（Mode 3） | 依進度表執行：`srs-check` → `srs-sync` → `PUBLISH` |
| 規範來源 | 本 skill 提供診斷邏輯；專案資料（需求清單、術語表）來自使用端 `CLAUDE.md` |
