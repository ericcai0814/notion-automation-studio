---
name: report-issue
user-invocable: false
description: >-
  在 Claude Code 對話中互動式蒐集 bug / 使用疑惑情境，產生一個 pre-filled
  GitHub issue URL 印出來給使用者手動點開瀏覽器送出。全程**不做任何網路呼叫**，
  也**不會**自動提交——最終一步永遠是「印 URL，讓使用者自己按」。
  當用戶在對話中表達挫折或明確回報意圖時觸發，包含下列觸發詞：
  「壞了」、「卡住」、「不對」、「不工作」、「沒反應」、「踩坑」、「有 bug」、
  「回報問題」、「找 maintainer」、「這個怎麼沒用」、「為什麼跑不起來」、
  「report issue」、「file a bug」、「something is wrong」、「this is broken」。
  觸發詞清單刻意廣，寧可誤觸發也不要漏觸發——誤觸發時使用者會在 Step 1 的
  intent 三選一說「不是要回報、想問」立刻退出；漏觸發使用者默默放棄的代價
  高得多。
---

# report-issue — 在 Claude Code 對話中產生 pre-filled GitHub issue URL

## 定位

這個 skill 把「使用者遇到 plugin 問題想回報」這件事的摩擦降到最低：

- 使用者不必離開 Claude Code 對話、不必複製觸發 prompt、不必記 `/plugin` 指令
- Skill 互動式蒐集期待 vs 實際、讀取當前 `.claude/workflow-state.json` 摘要
- 最後產生一個 pre-filled GitHub issue URL 印在對話中，使用者點開瀏覽器即可送出
- **絕不**自動執行任何網路呼叫。不 `curl`、不 `wget`、不 `open`、不呼叫任何 HTTP MCP tool

隱私邊界是這個 skill 的設計象徵，不是技術限制——使用者完整 review 過 body 才按送出，
絕不會「哎呀我以為只是草稿結果送出去了」。

## 鐵則（Hard Constraints）

以下四條即使使用者明確要求也**不能**違反：

1. **絕不發網路請求**：skill 整個生命週期不得執行 `curl`、`wget`、`fetch`、`open`、
   `xdg-open`、`start`、以及任何 HTTP-capable MCP tool（例如 `WebFetch`、
   `mcp__*__fetch` 之類）。最後一步一定是**印 URL**，不是開瀏覽器
2. **絕不 hardcode repo URL**：repo URL 從 `.claude-plugin/plugin.json` 的
   `repository.url` 欄位讀取。若欄位缺失，立刻 fail fast，**不**fallback 到任何
   內建字串
3. **絕不跳過 user review gate**：最終 URL 印出前，必須先把**未編碼**的 body 印在
   對話中，明確詢問「ready to generate URL?」，收到明確肯定回應才繼續。沉默、
   超時、模糊回答一律視為未確認
4. **絕不截斷關鍵欄位**：skill id、plugin 版本、Claude Code 版本、原始觸發 prompt
   這四欄無論 body 多長都**必須**保留完整

---

## Step 1：intent 三選一（防止誤觸發）

Skill 被觸發後，**第一件事**是確認使用者的意圖，不急著蒐集資訊：

```
我看起來你可能遇到了 plugin 的問題。你想做哪一件事？

  [1] file a bug — 回報 plugin 實作錯誤（skill 執行失敗、輸出錯誤、crash）
  [2] ask a how-to question — 只是想問怎麼用某個 skill，沒有「壞掉」
  [3] cancel — 我剛剛只是說個氣話，沒事

請回覆 [1] / [2] / [3]。
```

根據回覆分流：

- **[1]** → 繼續 Step 2
- **[2]** → 回覆「好的，我來試著回答你的問題。請告訴我你想做什麼。」**立刻退出**
  skill，讓一般對話接手。**不**產生任何 URL
- **[3]** → 回覆「沒問題，隨時再叫我。」**立刻退出**

這一步的存在目的是**捕捉誤觸發**。觸發詞清單刻意寬（「壞了」「卡住」都算），誤觸
的使用者在這一步會自己澄清「我只是想問」，skill 立刻退出沒有副作用。

---

## Step 2：從 `plugin.json` 讀取 repo URL

使用 Read tool 讀 `.claude-plugin/plugin.json`，解析 `repository.url` 欄位：

```bash
REPO_URL=$(jq -r '.repository.url // empty' .claude-plugin/plugin.json)
```

**Fail fast 條件**：

- 檔案不存在 → 印錯誤「找不到 .claude-plugin/plugin.json，無法確認 repo URL」→ 退出
- `repository` 欄位缺失 → 印錯誤「plugin.json 缺少 `repository` 欄位，請先請
  maintainer 加上」→ 退出
- `repository.url` 為空字串 → 同上 → 退出

**絕不**fallback 到任何 hardcoded URL。這個 skill 寧可失敗也不要指向錯 repo——
特別是在 fork 場景下，hardcode 會讓所有使用者把 issue 送到原作者而非 fork 者。

驗證 URL 以 `https://github.com/` 開頭後，把它組成 issue 端點：

```
ISSUE_URL_BASE="${REPO_URL%/}/issues/new"
```

---

## Step 3：蒐集 body 欄位

互動式向使用者蒐集下列欄位。每個欄位都要明確問，不要「合併問題」：

### 3.1 你剛剛輸入的觸發 prompt

```
你剛剛在對話中說的那句話是什麼？請原封不動貼上。
（例如：「審查 R0001」「SYNC 3-B」「PUBLISH」）
```

保留完整字串，不做任何修改。這欄是 body 裡最重要的部分——maintainer 靠它重現。

### 3.2 期待行為 vs 實際行為

```
你原本以為會發生什麼？（expected）

請分兩段描述：
  1. 期待：你以為 plugin 會做什麼？
  2. 實際：實際上發生了什麼？錯誤訊息的原文也請貼上。
```

保留使用者原文，不要「幫忙潤飾」。潤飾會讓 maintainer 難以分辨哪些字是使用者的
心智模型、哪些是 Claude 的轉譯。

### 3.3 涉及哪個 skill

```
你記得或看到這問題是哪個 skill 觸發的嗎？
（例如：srs-check / srs-sync / srs-publish-notion / srs-onboard）
不記得的話回覆「不確定」即可。
```

### 3.4 Plugin 與 Claude Code 版本

**Plugin 版本**：從剛才讀到的 `plugin.json` 取 `version` 欄位：

```bash
PLUGIN_VER=$(jq -r '.version // "unknown"' .claude-plugin/plugin.json)
```

**Claude Code 版本**：透過 `claude --version` 子命令讀取，取第一個 whitespace
token，失敗就 fallback 為 `unknown`：

```bash
CC_VER=$(claude --version 2>/dev/null | awk '{print $1}' || echo "unknown")
# 若 CC_VER 為空字串（command 存在但輸出空），也視為 unknown
[ -z "$CC_VER" ] && CC_VER="unknown"
```

設計理由：
- 取第一個 token 是為了去掉輸出後綴（例如 `2.1.108 (Claude Code)` 的
  `(Claude Code)`），避免污染 issue body 的 markdown 渲染
- `unknown` fallback 確保即使未來 CLI 改名、移除 `--version` 子命令、輸出格式
  變動，skill 仍能完成 issue body 組合不會 crash
- **不**重試、**不**警告、**不**嘗試其他偵測方法——版本字串只是 metadata，
  不該成為 skill 失敗點

### 3.5 `workflow-state.json` 摘要（optional）

使用 Read tool 嘗試讀取 `.claude/workflow-state.json`。若檔案存在，摘要出下列欄位：

- 當前 batch ID（若只有一個）或 batch 清單
- 最近一次 `check.ts`、`sync.ts`、`last_publish.ts` 的時間戳

摘要格式範例：

```
workflow-state summary:
- batches: 3-B
- 3-B.records.R0001.check.ts: 2026-04-10T08:15:00Z
- 3-B.records.R0001.sync.ts:  2026-04-10T08:20:00Z
- 3-B.last_publish.ts:        2026-04-11T14:00:00Z
- 3-B.last_sync_output_md5:   <hex>
```

**禁止**把整個 `workflow-state.json` 原樣 dump 進 body——Notion page ID 類敏感
欄位（如果未來被加進 state schema）可能外洩。只摘關鍵時間戳與 md5。

若檔案不存在，這欄寫 `workflow-state.json not found`。

---

## Step 4：組裝 body 與截斷策略

### 4.1 組完整 body

```markdown
## 觸發 prompt

<使用者原文，來自 Step 3.1>

## 期待行為

<Step 3.2 期待段>

## 實際行為

<Step 3.2 實際段>

## 環境

- **Skill**: <Step 3.3 的 skill 名稱，例如 `srs-check`，不確定填 `unknown`>
- **Plugin 版本**: <PLUGIN_VER>
- **Claude Code 版本**: <CC_VER>
- **OS**: <`uname -sr` 輸出，macOS / Linux；Windows WSL 寫 `WSL`>

## Workflow-state 摘要

<Step 3.5 摘要，或 `workflow-state.json not found`>
```

### 4.2 Byte 計算與截斷

目標上限：**6144 bytes**（6KB）。GitHub pre-filled issue URL 走 query string 傳
遞，瀏覽器實務上限約 8KB，保守設 6KB 為 skill 內部閾值。

先組完整 body 後用 `wc -c` 計算 byte 數：

```bash
RAW_BYTES=$(printf '%s' "$BODY" | wc -c | tr -d ' ')
```

若 `RAW_BYTES > 6144`，**依序**套下列截斷策略直到 body ≤ 6144：

**截斷優先順序（由大到小砍）**：

1. **先砍 workflow-state 摘要**：把整段改成 `workflow-state summary: (truncated — please add in issue)`
2. **再砍期待/實際描述**：保留前 400 chars + `... (truncated — please add details in the issue) ...` + 後 200 chars。期待段與實際段各自獨立套用這個規則
3. **保留**（**絕不**截斷）：
   - 觸發 prompt（Step 3.1）
   - Skill 名稱（Step 3.3）
   - Plugin 版本（PLUGIN_VER）
   - Claude Code 版本（CC_VER）

這四欄即使整個 body 已縮到只剩它們，也**不准**再砍。若 body 縮到只剩這四欄
仍超過 6144 bytes，這是 edge case（使用者觸發 prompt 超長），此時印警告
「body 仍超過上限，請手動精簡觸發 prompt 或在瀏覽器裡補內容」但仍繼續組 URL。

**不要**邊組邊截。先組完整 body、再判斷是否超限、再依序套截斷——這讓截斷優先
順序清晰可維護。

### 4.3 截斷標記

每一次截斷都必須在該段落尾端加一個**視覺明顯**的標記：

```
... (truncated — please add details in the issue)
```

這讓 maintainer 看到 issue 時一眼知道使用者原文被 skill 截過，需要在 comment 追問。

---

## Step 5：User Review Gate（硬約束）

組完最終 body 後，**必須**把完整**未編碼**的 body 印在對話中給使用者 review：

```
以下是即將放進 GitHub issue URL 的完整 body（未編碼）。
請確認沒有任何你不想公開的資訊（token、page ID、檔案絕對路徑、客戶名稱等）：

```markdown
<完整 body>
```

Ready to generate URL? [yes / no / edit]
```

根據回覆分流：

- **yes / y / 是 / ok / 好** → 繼續 Step 6
- **no / n / 否 / cancel / 取消** → 印「已取消。沒有產生任何 URL。」退出
- **edit / 編輯 / 修改** → 問「你想改哪一段？」蒐集修改 → 回到 Step 4.1 重組 body →
  再印一次 review → 再問一次 confirm
- **沉默 / 超時 / 模糊回答（「嗯」「好像可以」）** → 視為未確認。再問一次
  「Please answer yes / no / edit」。連續兩次未確認就取消退出

**絕不**在沒看到明確 "yes" 前 URL encode 或印出 URL。

---

## Step 6：URL encode 與最終輸出

通過 review gate 後，用 `jq -rR @uri` 把 body 轉成 URL-encoded 字串：

```bash
BODY_ENCODED=$(printf '%s' "$BODY" | jq -sRr @uri)
TITLE_ENCODED=$(printf '%s' "[report-issue] $TITLE_SUMMARY" | jq -sRr @uri)
LABELS_ENCODED=$(printf '%s' "bug" | jq -sRr @uri)

FINAL_URL="${ISSUE_URL_BASE}?title=${TITLE_ENCODED}&body=${BODY_ENCODED}&labels=${LABELS_ENCODED}"
```

設計理由（為何用 `jq -rR @uri`）：

- `jq` 是 Claude Code 常見依賴，幾乎所有開發環境都有
- `@uri` filter 做**純本地** URL encoding，不發任何網路請求
- Python `urllib.parse.quote` 需要 python3，Claude Code 環境不保證有
- `curl --data-urlencode --get` 會觸發網路請求，**違反鐵則 1**

印出最終 URL，並提示使用者：

```
✓ Pre-filled GitHub issue URL 已產生。點擊或複製下列 URL 到瀏覽器即可送出草稿：

<FINAL_URL>

**重要提醒**：
- 這個 URL 只是草稿，你點開瀏覽器後仍需要手動按「Submit new issue」才會真正送出
- Skill 全程沒有發任何網路請求，plugin 不會記錄這個 URL
- 送出前你可以在 GitHub 的網頁介面再次 review 或編輯 body
```

**絕不**在輸出 URL 後自動跑 `open "$FINAL_URL"`。最後一步永遠是**印**。

---

## 禁止清單（快速 audit 用）

這份 skill 不得包含下列任何指令或行為——未來 maintainer 改動時對照此清單：

| 禁止項 | 原因 |
|--------|------|
| `curl`、`wget`、`fetch` | 違反「絕不發網路請求」鐵則 |
| `open`、`xdg-open`、`start`、`explorer` | 自動開瀏覽器等於半自動送出 |
| 任何 HTTP-capable MCP tool（`WebFetch`、`mcp__*__fetch`...） | 同上 |
| Hardcoded `https://github.com/...` 字串作為 fallback | 違反「絕不 hardcode repo URL」鐵則 |
| 跳過 Step 5 user review gate 直接印 URL | 違反「絕不跳過 user review」鐵則 |
| 截斷 skill id / plugin 版本 / Claude Code 版本 / 觸發 prompt | 違反「絕不截斷關鍵欄位」鐵則 |
| 把整個 `workflow-state.json` 原樣 dump 進 body | Notion page ID 類敏感欄位可能外洩 |

---

## Integration

| 銜接 | 說明 |
|------|------|
| 前置 | 無——可在任何對話點觸發 |
| 後續 | 使用者自行在瀏覽器點開 URL → 在 GitHub 網頁送出 → maintainer 收到 issue |
| 相關 skill | `distill-known-issue`（maintainer 把收到的 issue 半自動歸納成 KI） |
| 相關檔案 | `.claude-plugin/plugin.json`（repo URL 來源）、`.claude/workflow-state.json`（摘要來源） |
| 相關文件 | `.github/ISSUE_TEMPLATE/bug_report.md`（使用者也可從 GitHub 網頁直接用這個 template，不經 skill） |

---

## 完成檢查

- [ ] 第一步問過 intent 三選一，使用者選 [1] 才繼續
- [ ] `repo URL` 來自 `.claude-plugin/plugin.json`，沒 hardcode
- [ ] `CC_VER` 透過 `claude --version | awk '{print $1}'` 讀取，失敗 fallback `unknown`
- [ ] Body 組完後用 `wc -c` 驗證 ≤ 6144 bytes，超過就套截斷優先順序
- [ ] 關鍵四欄（skill id / plugin 版本 / CC 版本 / 觸發 prompt）保留完整
- [ ] User review gate 印出完整未編碼 body 並收到明確 "yes"
- [ ] URL encoding 用 `jq -rR @uri`，沒碰 `curl --data-urlencode`
- [ ] 最後一步是**印** URL，沒有 `open` / `xdg-open` / `curl` / `wget`
