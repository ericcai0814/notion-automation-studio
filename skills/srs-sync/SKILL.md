---
name: srs-sync
description: >
  SRS 需求文件同步流程（獨立 .md ↔ 整合版）。
  當用戶輸入「SYNC R00XX」「同步 R00XX」「SYNC ALL」
  或在修改 src/ 後需要將內容同步至 output/requirements-{batch}.md 時觸發。
  確保獨立需求檔與整合版需求文件兩處內容一致，並維護版本說明紀錄。
---

# SRS 需求同步 Skill

將 `{batch}-SRS/src/R00XX_*.md` 之最新內容同步至總整文件
`{batch}-SRS/output/requirements-{batch}.md`。

這是純 md → md 的同步流程，**不觸及 Notion**。Notion 發佈由
`srs-publish-notion` skill 負責。

## 設計分層

`srs-sync` 是**業務層**，呼叫一個確定性腳本完成主要的合併工作：

```
業務層：srs-sync skill（本檔）
  └─ 工具層：${CLAUDE_PLUGIN_ROOT}/scripts/merge-srs.js（純 node，no LLM）
```

**分工原則**：
- **腳本** 處理檔案合併、貳、需求大綱 自動產生、壹、版本說明 表格保留 — 確定性、可重複
- **LLM** 處理 壹、版本說明 新版本列的撰寫（需要描述「這次改了什麼」）、
  貳、需求大綱 的 sanity check（確認順序與內容合理）、檢核 output 結構

## Batch Resolution（多 batch 推斷）

本 skill 操作對象是「某個 SRS batch」，目錄結構為 `{batch}-SRS/`。執行任何
動作前，必須先決定 **batch ID**：

1. **若使用者輸入有明確 batch 指定**（例如「對 3-B 跑」、「in 4-A」、
   「batch phase-1」、「{batch} 的 R0001」），用該 batch
2. **否則**：用 Glob 列出 repo root 下所有 `*-SRS/` 目錄
   - **恰好 1 個** → 自動使用該 batch（單 batch 體驗，零摩擦）
   - **0 個** → 報錯「找不到任何 SRS batch」並停止
   - **2 個以上** → 報錯，列出可選 batch 與正確指令格式並停止：
     ```
     ⚠️ 偵測到多個 batch，無法判斷目標。請明確指定：

     可選 batch：
       - 3-B  (3-B-SRS/)
       - 4-A  (4-A-SRS/)

     重試指令範例：
       SYNC R0001 in 3-B
       同步 3-B 的所有需求
     ```
3. **不要猜**。寧可報錯讓使用者明確指定，也不要默默選一個。

從 batch ID 推導路徑（後續所有路徑都用這個 pattern）：
- batch dir：`{batch}-SRS/`
- src 目錄：`{batch}-SRS/src/`
- output 檔：`{batch}-SRS/output/requirements-{batch}.md`
- assets 目錄：`{batch}-SRS/assets/`
- Notion target：讀專案的 `.claude/notion-mapping.json` 的 `batches[{batch}]`

## Trigger

- `SYNC R0001`、`/srs-sync R0001`
- 「同步 R0001 到總整」「把 R0002 更新到總整文件」
- `SYNC ALL` / `/srs-sync-all` — 對所有需求依序執行

## 來源與目標

| 角色 | 路徑 |
|------|------|
| 來源（source of truth） | `{batch}-SRS/src/R00XX_*.md` |
| 目標（合併版） | `{batch}-SRS/output/requirements-{batch}.md` |

**方向鐵則：單向同步，來源 → 目標。禁止反向。**

## 總整文件結構

`output/requirements-{batch}.md` 由三個固定 H1 章節組成：

```markdown
# 壹、版本說明

| 修改日期 | 需求編號 | 修改項目 |
|---|---|---|
| YYYY-MM-DD | R0001 | 同步 {某變更描述} |
| ... | ... | ... |

# 貳、需求大綱

- 【R0001】{功能名稱 1}
- 【R0002】{功能名稱 2}
- ...

# 參、需求內容

## 【R0001】{功能名稱 1}
（R0001 全文，從 src/R0001_*.md 串入）

---

## 【R0002】{功能名稱 2}
（R0002 全文）
...
```

- **壹、版本說明**：版本變更紀錄表，由 LLM 維護（每次 sync 新增一列）
- **貳、需求大綱**：由 `merge-srs.js` 自動從 `src/R*.md` 標題抽出
- **參、需求內容**：由 `merge-srs.js` 自動串接 `src/R*.md` 全文

## Workflow

### Preflight: 確保 workflow state + pre-check

#### P.1 ensure state 檔存在

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js ensure \
  .claude/workflow-state.json \
  ${CLAUDE_PLUGIN_ROOT}/templates/workflow-state.json
```

行為同 `srs-check` 的 Preflight：檔案不存在則從 template 複製，**不中斷**。

#### P.2 pre-check（依 Mode 分支）

**Mode A（SYNC R00XX）**：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js pre-check-sync \
  .claude/workflow-state.json {batch} R00XX
```

**Mode B（SYNC ALL）**：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js pre-check-sync-all \
  .claude/workflow-state.json {batch} {batch}-SRS/src
```

Mode B 不因「只有部分 rid 沒 check」而靜默跳過 — 只要任一個 rid 從未被
srs-check 過，腳本就會 exit 1 並列出完整 missing 清單。使用者必須逐項
補齊、強制繼續、或取消。

#### P.3 pre-check 結果處理

- **Exit 0** → 進入對應 Mode 的步驟 1
- **Exit 1（BLOCKED）** → 停下來，把腳本 stdout/stderr 原樣呈現給使用者，
  並顯示三選一：
  ```
  Pre-check 未通過。請選擇：
  [1] 立即執行 srs-check（依 BLOCKED 訊息指出的 rid），完成後重新執行 sync
  [2] 我已確認內容正確，這次強制繼續（跳過 pre-check）
  [3] 取消本次 sync
  ```
  等到使用者輸入 `1` / `2` / `3` 或同義詞才繼續：
  - `1` → 啟動 srs-check 補齊缺漏的 rid，結束後由使用者自行重跑 sync
  - `2` → 跳過 pre-check 進入正常流程。**不寫 override 紀錄**（設計取捨：
    state 只記「實際跑過的事」，不記「使用者選過什麼」；參見
    `scripts/workflow-state.js` 開頭註解）
  - `3` → 停止流程，**不**做任何 sync 操作
- **Exit 2（ERROR）** → 腳本異常，回報 stderr 給使用者處理，不繼續

> 設計註：三選一的選項文字是目前的 default UX。若要改 ordering 或新增
> 選項，請同時調整 `srs-publish-notion` skill 的對應段落保持一致。

### Mode A: 單一需求同步（SYNC R00XX）

#### 1. 確認來源檔存在

```bash
ls {batch}-SRS/src/R00XX_*.md
```

若找不到，回報並停止。

#### 2. 執行 merge 腳本

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-srs.js {batch}-SRS
```

此腳本會：
- 讀取 `src/` 下所有 `R*.md`，按 R 編號排序
- 重新產生「貳、需求大綱」（從每份 R 檔的第一個 H1 標題抽出）
- 重新產生「參、需求內容」（串接所有 R 檔 H1→H2 後的全文）
- **保留**既有 `output/requirements-{batch}.md` 的「壹、版本說明」表格

> 注意：腳本是「全量重產」，不是 incremental update。即使你只改了
> R0001，merge 後其他 R 檔的對應段落也會被重新串入。這是預期行為。

#### 3. LLM：維護「壹、版本說明」

`merge-srs.js` 不動 壹（只保留），新版本列由 LLM 用 Edit 加入：

1. 用 Bash 取得當天日期：`date +%Y-%m-%d`
2. Read `{batch}-SRS/output/requirements-{batch}.md`，定位到 壹 表格的最後一列
3. 用 Edit 在表格最後一列下方插入新列：
   ```
   | YYYY-MM-DD | R00XX | <修改項目描述> |
   ```
   - **修改項目描述**由 LLM 根據實際改了什麼撰寫（不要寫死成「同步」）
   - 例如：「{某流程}新增異常項目處理」、「{某表單}新增三個欄位」
   - 若無法判斷具體變更，回退到「同步自 src/R00XX_*.md」

#### 4. LLM：sanity check「貳、需求大綱」

腳本自動產生 貳，但 LLM 應再 Read 一次 output，確認：
- 貳 列出的需求份數與 src 目錄中 R-files 數量一致
- 順序按 R 編號遞增
- 標題拼字、括號全形/半形與 src 一致
- 沒有編號跳號（例如專案 CLAUDE.md 需求清單有 R0055，但 src 沒有；
  應該確認是預期還是 src 漏檔）

若有異常，回報並建議使用者檢查 src/。

#### 5. 結構驗證（選用）

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/validate-structure.js {batch}-SRS
```

確認 src 結構仍然合規（應該已合規，因為使用者多半才剛 srs-check 過）。

#### 5.5. 寫入 workflow state

`merge-srs.js` 成功後、輸出報告之前，把本次 sync 記入 state：

```bash
# 記錄 per-rid sync 時間戳
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js record \
  .claude/workflow-state.json {batch} R00XX sync

# 更新 batch 層級的 last_sync_output_md5（publish pre-check 會比對這個值）
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js set-output-md5 \
  .claude/workflow-state.json {batch} {batch}-SRS/output/requirements-{batch}.md
```

若 P.3 階段使用者選 `[2] 強制繼續`，以上兩行仍要跑（state 要反映實際變更）。

#### 6. 輸出同步結果

```
## SYNC R00XX 完成

### 變更檔案
- {batch}-SRS/output/requirements-{batch}.md

### 維護紀錄
- 壹、版本說明：新增一列 → `YYYY-MM-DD | R00XX | {具體變更描述}`
- 貳、需求大綱：sanity check ✓（共 N 份需求，順序正確）
- 參、需求內容：merge-srs.js 自動重產

### 下一步建議
- 確認 output 內容無誤後可執行 `PUBLISH` 發佈到 Notion
```

### Mode B: 全量同步（SYNC ALL）

跟 Mode A 幾乎一樣，差別只在「壹、版本說明」的新版本列：

1. 確認 `src/` 下有 R-files
2. 跑 `node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-srs.js {batch}-SRS`
3. LLM Edit 壹 加入一列：
   ```
   | YYYY-MM-DD | (全量) | 全量同步 — N 份需求 |
   ```
4. Sanity check 貳
5. validate-structure（選用）
5.5. 寫入 workflow state（全量）：

   ```bash
   # 對 src/ 下每個 R00XX 寫 sync 紀錄
   for rid in $(ls {batch}-SRS/src/R*_*.md | sed -E 's|.*/(R[0-9]+)_.*|\1|'); do
     node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js record \
       .claude/workflow-state.json {batch} "$rid" sync
   done

   node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js set-output-md5 \
     .claude/workflow-state.json {batch} {batch}-SRS/output/requirements-{batch}.md
   ```

6. 輸出總體摘要

## 邊界情況

| 情況 | 處理 |
|------|------|
| 來源檔不存在 | 跳過該需求並警告（SYNC ALL 不中斷） |
| 內容未變動 | merge-srs.js 仍會跑（不檢查 diff），但壹的新列要由 LLM 判斷是否寫 |
| `output/` 不存在 | merge-srs.js 自動建立，並用 default 壹 表格 |
| `output/requirements-{batch}.md` 被手動破壞（壹 表格缺失） | merge-srs.js 會 fall back 到 default 壹；LLM 要警告使用者既有版本紀錄已遺失 |
| src 檔的 H1 格式不對（例如用 `## R00XX` 而非 `# R00XX`） | merge-srs.js 會 fall back 到檔名做 section title — 仍可運作但標題會缺括號內容；LLM 應提示使用者修正 src H1 |

## 完成檢查

- [ ] 來源檔存在
- [ ] `node ${CLAUDE_PLUGIN_ROOT}/scripts/merge-srs.js {batch}-SRS` 已執行成功
- [ ] 「壹、版本說明」已 append 一列（含日期、R 編號、修改項目）
- [ ] 「貳、需求大綱」已 sanity check（順序、編號、拼字）
- [ ] 結構 validation 通過（若有跑）
- [ ] workflow-state 已記錄對應的 `sync` 時間戳並更新 `last_sync_output_md5`
- [ ] 同步結果已輸出給使用者

## Integration

| 銜接 | 說明 |
|------|------|
| 前置 | `srs-check` skill — 先修正再 sync |
| 後續 | `srs-publish-notion` skill — sync 完後發佈到 Notion 沙箱 |
| 觸發來源 | 使用者手動執行或在 `srs-check` 完成後接續 |
| 腳本依賴 | `${CLAUDE_PLUGIN_ROOT}/scripts/merge-srs.js`（plugin 內建；plugin 未裝則 sync 無法執行） |

## 預期的完整流程序列

```
srs-check R00XX     → 審查並修正 src/R00XX_*.md
srs-sync R00XX      → 跑 merge-srs.js + 維護版本說明
srs-publish-notion  → 發佈到 Notion 沙箱 toggle（含 publish gate）
```

沙箱階段**不做自動 orchestration**，三個步驟手動執行以利 debug。
