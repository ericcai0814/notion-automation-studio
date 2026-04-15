---
name: distill-known-issue
user-invocable: false
description: >-
  Plugin maintainer 專用：把 GitHub issue 半自動歸納成 `docs/KNOWN_ISSUES.md`
  的一條 KI 條目。透過本機 `gh` CLI 唯讀抓取 issue 內容，互動式向 maintainer
  問五個抽象化問題（症狀普遍形式 / 影響 skill / 根本原因 / 解法類型 / 對應的
  srs-onboard 健檢項），產出符合 schema 的草稿，自動分配 `KI-NNNN` ID，
  maintainer 明確確認後才 append 到 `docs/KNOWN_ISSUES.md` 尾端。
  當 maintainer 說下列觸發詞時啟動：
  「歸納成 KI」、「整理成 known issue」、「distill issue」、「distill known issue」、
  「幫我把 issue N 寫成 KI」、「把 issue 寫成 known issue」、
  「把 issue N 整理成已知問題」、「把這個 issue 歸檔成 KI」。
  skill 本身嚴禁 curl/wget/open 與任何 HTTP MCP tool，也禁止任何 mutating
  gh 子命令（`gh issue create/edit/close/comment`、`gh pr *`、`gh repo edit`
  等皆不可用）。
---

# distill-known-issue — 把 GitHub issue 半自動歸納成 KI 條目

## 定位與哲學

這個 skill 是 plugin maintainer 的工具，目的是讓「把踩坑經驗沉澱成
`KNOWN_ISSUES.md`」這件事**低摩擦但不失 human review**。設計劃分：

| 層 | 由誰做 |
|----|--------|
| 抓 issue 原文、自動分配 ID、組草稿、運算 grep | Skill（AI） |
| 抽象化症狀 pattern、判斷影響 skill、認定根本原因、分類解法、綁健檢項 | Maintainer（人類） |
| 最終寫入 `docs/KNOWN_ISSUES.md` | Maintainer 明確確認後 skill 執行 Edit |

skill 絕不**全自動**產生 KI 條目——抽象化（從具體情境提煉普遍 pattern）是語意
題，必須由 maintainer 最後拍板。這跟 `srs-check` 「腳本管結構、LLM 管語意」
的分層原則一致。

## 鐵則（Hard Constraints）

以下七條即使 maintainer 明確要求也**不能**違反：

1. **絕不發 HTTP 請求**：skill 不得執行 `curl`、`wget`、`fetch`、`open`、
   `xdg-open`、或任何 HTTP-capable MCP tool。網路存取**一律**透過本機 `gh`
   CLI 的唯讀子命令完成
2. **絕不執行 mutating gh 子命令**：白名單只有 `gh issue view`、`gh auth status`、
   `command -v gh`。任何 `gh issue create / edit / close / comment / delete`、
   `gh pr *`、`gh repo edit / fork / clone`、`gh api POST / PATCH / DELETE`
   等 mutating 指令**全部禁止**
3. **絕不 hardcode repo**：`owner/name` 從 `.claude-plugin/plugin.json` 的
   `repository.url` 欄位解析，每次 gh 呼叫都明確帶 `--repo <owner>/<name>`。
   不依賴 maintainer 的 cwd
4. **絕不跳過五個抽象化問題**：即使 issue body 明確寫了答案，skill **必須**
   逐題問 maintainer。可以把 issue 裡的候選答案當 suggestion 呈現，但
   maintainer 的回答才 authoritative
5. **絕不在確認前寫檔**：寫 `docs/KNOWN_ISSUES.md` 必須通過 human confirmation
   gate——印完整草稿 → 明確詢問 → 收到明確 yes 才 Edit append。沉默、超時、
   模糊回答一律視為未確認
6. **絕不覆寫既有條目**：寫入永遠是 append 到檔案尾端。絕不修改既有 KI 條目
   byte-for-byte 的內容
7. **絕不回收已刪除的 KI ID**：ID 分配依「現有最大 ID + 1」策略，即便某個
   `KI-NNNN` 被手動從檔案刪除，新條目**不**重用該 ID

---

## Step 1：前置檢查（gh CLI 可用且已 auth）

skill 被觸發後，**第一件事**是驗證本機 gh 可用。

### 1.1 `command -v gh`

```bash
if ! command -v gh >/dev/null 2>&1; then
  echo "錯誤：本機找不到 gh CLI。"
  echo "distill-known-issue 需要透過本機 gh CLI 唯讀抓取 GitHub issue，"
  echo "skill 本身不做任何網路呼叫。"
  echo ""
  echo "請先安裝 GitHub CLI："
  echo "  brew install gh    # macOS"
  echo "  或參考 https://cli.github.com/"
  echo "安裝後執行 'gh auth login' 授權，再重新觸發此 skill。"
  exit 1
fi
```

### 1.2 `gh auth status`

```bash
if ! gh auth status >/dev/null 2>&1; then
  echo "錯誤：gh CLI 尚未 auth 或 token 已過期。"
  echo "請執行："
  echo "  gh auth login"
  echo "完成授權後再重新觸發此 skill。"
  exit 1
fi
```

任一檢查失敗就**立刻 fail fast**，印出上面的提示並退出。**絕不**嘗試 fallback
到 curl / HTTP MCP tool / 直接解析 issue URL。

---

## Step 2：從 `plugin.json` 解析 `owner/name`

```bash
REPO_URL=$(jq -r '.repository.url // empty' .claude-plugin/plugin.json)
if [ -z "$REPO_URL" ]; then
  echo "錯誤：.claude-plugin/plugin.json 缺少 repository.url 欄位。"
  exit 1
fi

# 從 URL 解析 owner/name，例如 https://github.com/ericcai0814/notion-automation-studio
OWNER_REPO=$(echo "$REPO_URL" | sed -E 's#^https?://github\.com/##' | sed -E 's#\.git$##' | sed -E 's#/$##')
# 驗證格式：owner/name（允許 owner 含連字號，name 含連字號底線點）
if ! echo "$OWNER_REPO" | grep -qE '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$'; then
  echo "錯誤：repository.url 格式不符 GitHub HTTPS URL 慣例：$REPO_URL"
  exit 1
fi
```

記住這個 `$OWNER_REPO`，後續每個 gh 呼叫都要帶 `--repo "$OWNER_REPO"`。

---

## Step 3：向 maintainer 問 issue 編號

```
請提供要歸納的 GitHub issue 編號（只需數字，例如 42）：
```

驗證輸入為正整數。接受 `42`、`#42`、`issue 42` 等格式（skill 解析時 strip
前綴，只取數字）。

```bash
ISSUE_NUM="$1"  # 從 maintainer 回應取得
ISSUE_NUM=$(echo "$ISSUE_NUM" | grep -oE '[0-9]+' | head -1)
if [ -z "$ISSUE_NUM" ]; then
  echo "錯誤：無法解析 issue 編號。"
  exit 1
fi
```

---

## Step 4：`gh issue view` 抓取 issue 內容

```bash
ISSUE_JSON=$(gh issue view "$ISSUE_NUM" \
  --repo "$OWNER_REPO" \
  --json title,body,labels,comments,url)

if [ $? -ne 0 ]; then
  echo "錯誤：gh issue view 失敗。可能原因："
  echo "  - issue #${ISSUE_NUM} 不存在於 ${OWNER_REPO}"
  echo "  - 你的 gh auth 缺少對此 repo 的讀取權限"
  echo "  - 網路暫時不通（gh 的網路層問題）"
  exit 1
fi
```

**白名單**子命令（整個 skill 生命週期允許的 gh 呼叫）：

| 命令 | 用途 | 唯讀？ |
|------|------|--------|
| `command -v gh` | 偵測 gh 是否安裝 | 是（shell 內建） |
| `gh auth status` | 檢查是否已 auth | 是 |
| `gh issue view <N> --repo <owner/name> --json ...` | 取 issue 內容 | 是 |

**絕不**執行下列任何命令（即使 maintainer 明確要求）：

- `gh issue create / edit / close / reopen / comment / delete / lock / unlock / pin / unpin / transfer`
- `gh pr create / edit / merge / close / review / comment / ready`
- `gh repo create / edit / fork / delete / sync / archive / unarchive`
- `gh api POST / PATCH / DELETE / PUT`（即便是 read-only GET 也**不准**——已有 `gh issue view` 覆蓋需求）
- `gh release create / edit / delete / upload`
- `gh workflow run / enable / disable`

若未來需要 mutating 操作（例如關閉已歸納的 issue、加 `known-issue` label），
skill 應以「印出命令字串給 maintainer 貼到 terminal 執行」的形式存在，
**絕不**自己 spawn。

---

## Step 5：解析 issue 摘要供 maintainer 參考

把 `ISSUE_JSON` 解析出下列欄位並顯示給 maintainer，作為後續五問的 context：

```bash
TITLE=$(echo "$ISSUE_JSON" | jq -r '.title')
URL=$(echo "$ISSUE_JSON" | jq -r '.url')
LABELS=$(echo "$ISSUE_JSON" | jq -r '[.labels[].name] | join(", ")')
BODY_SNIPPET=$(echo "$ISSUE_JSON" | jq -r '.body' | head -30)
COMMENT_COUNT=$(echo "$ISSUE_JSON" | jq -r '.comments | length')
```

顯示：

```
已抓取 issue：

  #${ISSUE_NUM}: ${TITLE}
  URL: ${URL}
  Labels: ${LABELS}
  Comments: ${COMMENT_COUNT} 則

Body 前 30 行：
----
${BODY_SNIPPET}
----

接下來我會逐題問五個抽象化問題，請根據 issue 內容與你對 plugin code
的理解回答。我可能會把 issue 裡的候選答案當 suggestion 呈現，但你的
回答才是 authoritative。
```

---

## Step 6：互動式五問（**絕不**跳題）

以下五題必須**逐題**向 maintainer 發問並等待回答。即使 issue body 看起來
明確回答了某題，skill 也**必須**仍然問——AI 從 body 推論的答案未必是
maintainer 對 pattern 的真實理解。

### Q1：症狀的普遍形式

```
Q1. 症狀的普遍形式是什麼？

這個 issue 的 body 描述了一個具體情境，但 KI 條目要寫的是 pattern。
例如 issue 說「`3-B SRS/R0001_xxx.md` 找不到」，對應的 pattern 是
「批次目錄名稱含空白時 srs-onboard 找不到 batch」。

（如 skill 從 issue body 偵測到候選答案，在此呈現：
   Suggestion: <從 body 歸納的候選，標明來源行數>）

你的答案：
```

### Q2：影響哪些 skill

```
Q2. 這個問題會影響哪些 skill？

issue 可能只提到 `srs-onboard`，但你從 code 可能知道 `srs-check` / `srs-sync`
也會踩到。請列出所有受影響的 skill，以逗號分隔。若影響整個 plugin，可寫
`plugin-wide`。

（Suggestion: <從 body / labels 偵測到的候選>）

你的答案：
```

### Q3：根本原因

```
Q3. 根本原因是什麼？

請用一到兩句話說明技術上為什麼會發生這個問題。若尚未確認，回答 `unknown`，
之後可以補回。

（Suggestion: <從 body 偵測到的候選>）

你的答案：
```

### Q4：解法是 workaround 還是永久修復？

```
Q4. 目前的解法是 workaround 還是永久修復？

  [1] Workaround — 只是暫時繞過，根本修復待後續 release
  [2] Permanent fix — 已在某個 plugin 版本修好（請註明版本）
  [3] Documentation — 沒有 code 變動，只是文件/說明澄清
  [4] Unknown — 尚未有明確解法

你的答案（選 1/2/3/4）：若選 2，請附 plugin 版本；
若選 1，請附 workaround 的具體步驟。
```

### Q5：對應哪個 srs-onboard 健檢項

```
Q5. 這個問題對應 srs-onboard Mode 2 的哪個健檢項？

合法答案：
  - 單一識別子：H1、H2、H3、H4、H5、H6、H7、H8、H9、H10、H11、H12
  - 逗號分隔多項：例如 H5, H7
  - 字面值：none（不綁任何健檢項）

這個答案會寫進 KI 條目的 `Health check trigger` 欄位，未來使用者跑
srs-onboard Mode 2 時，若對應的健檢項失敗，H13 就會主動把這條 KI
提示出來。請慎重填寫。

（Suggestion: 如 skill 偵測到可能對應，在此列出）

你的答案：
```

#### Q5 答案驗證（硬約束）

接收 maintainer 的回答後，skill **必須**驗證答案屬於下列三種形式之一：

1. **單項**：正則 `^H([1-9]|1[0-2])$`（即 H1 到 H12）
2. **多項**：以逗號 + optional whitespace 分隔的 tokens，每個 token 都符合上面
   的單項正則。例如 `H5, H7` 合法、`H5,H7` 合法、`H5, H13` 不合法（H13 超出
   H1-H12）
3. **字面值**：`none`

若答案不符任何形式（例如 `H0`、`H13`、`H99`、`bug`、空字串、`all`），
**re-prompt** maintainer：

```
你的答案「<原答案>」不合法。合法值只能是：
  - H1 到 H12 的單一識別子
  - 以逗號分隔的多個 H1-H12 識別子
  - 字面值 `none`

請重新回答 Q5：
```

連續三次非法就印「Q5 answer invalid after 3 retries. Aborting.」並退出，
**不**用任意值 fallback。

---

## Step 7：自動分配 `KI-NNNN` ID

讀 `docs/KNOWN_ISSUES.md` 找出現有最大 ID，+1：

```bash
# 找所有符合 ^## KI-[0-9]{4} pattern 的條目
# 注意：必須是 ^## KI-[0-9]{4}，不含非數字尾綴（避免 KI-EXAMPLE 誤抓）
MAX_ID=$(grep -oE '^## KI-[0-9]{4}' docs/KNOWN_ISSUES.md 2>/dev/null \
  | grep -oE '[0-9]{4}' \
  | sort -n \
  | tail -1)

if [ -z "$MAX_ID" ]; then
  # 檔案為空、不存在、或無符合 pattern 的條目
  NEW_ID="KI-0001"
else
  NEXT=$(( 10#$MAX_ID + 1 ))
  NEW_ID=$(printf "KI-%04d" "$NEXT")
fi
```

**關鍵細節**：

- `grep -oE '^## KI-[0-9]{4}'` **只**匹配 `## KI-0000` 到 `## KI-9999` 這種格式。
  `## KI-EXAMPLE` 不是四位數字，grep 不會抓到——這是 `docs/KNOWN_ISSUES.md`
  範例使用 `KI-EXAMPLE` 而非 `KI-0001` 的原因
- `10#$MAX_ID` 確保 bash 用十進位解析（否則 `0042` 會被當成 octal）
- **已刪除的 ID 絕不回收**：若檔案有 `KI-0001`、`KI-0003`（`KI-0002` 被刪），
  `MAX_ID=0003`，`NEW_ID=KI-0004`，**不是** `KI-0002`
- `printf "KI-%04d"` 做 zero-pad 到四位
- 檔案不存在時視為 empty（從 `KI-0001` 開始）；**不**因此 fail

---

## Step 8：組 draft（七欄位 schema）

用 Step 6 的五個答案組出符合 `docs/KNOWN_ISSUES.md` schema 的草稿：

```markdown
## ${NEW_ID}: ${Q1_的症狀 pattern 簡述}

- **Symptom**: ${Q1 答案全文}
- **Affected skill**: ${Q2 答案}
- **Cause**: ${Q3 答案}
- **Resolution**: ${Q4 答案；若選 [1] workaround，附步驟；若 [2] permanent，附版本；若 [3] documentation，寫 "文件澄清"；若 [4] unknown，寫 "unknown"}
- **Related issue**: ${URL}（或 `#${ISSUE_NUM}`）
- **Added date**: $(date +%Y-%m-%d)
- **Health check trigger**: ${Q5 答案}
```

**絕不**跳過任何欄位。**絕不**省略「**Added date**」或「**Health check trigger**」。

---

## Step 9：Draft Review + 確認 gate（硬約束）

把完整草稿印在對話中給 maintainer review：

```
以下是即將 append 到 docs/KNOWN_ISSUES.md 尾端的草稿：

```markdown
${FULL_DRAFT}
```

確認後我才會寫入。append this entry to KNOWN_ISSUES.md? [yes / no / edit]
```

根據回覆分流：

- **yes / y / 是 / 寫入 / confirm / append** → 繼續 Step 10
- **no / n / 否 / cancel / 取消 / abort** → 印「已取消。docs/KNOWN_ISSUES.md
  未做任何修改。」退出
- **edit / 編輯 / 修改** → 問「你想改哪個欄位？（Symptom / Affected skill /
  Cause / Resolution / Related issue / Health check trigger）」→ 蒐集修改 →
  重組 draft → 印一次 review → 再問一次 confirm
- **沉默、超時** → 視為未確認。再問一次「Please answer yes / no / edit」
- **模糊回答**（「嗯」「好像可以」「差不多」「應該吧」）→ 視為未確認。
  再問一次「Please answer yes / no / edit」

連續兩次未確認就印「Confirmation not received. Aborting write.」退出，
**不**寫檔。

---

## Step 10：Append 到 `docs/KNOWN_ISSUES.md` 尾端

通過 confirmation gate 後，用 Edit tool append draft 到檔案尾端：

1. Read `docs/KNOWN_ISSUES.md` 取得完整現有內容
2. 在**檔案尾端**（最後一行之後）加上兩個換行 + `FULL_DRAFT`
3. 用 Edit tool 做 append（把 old_string 設為檔案最後幾行、new_string
   設為最後幾行 + draft）

**絕不**：

- 修改任何既有 KI 條目的 byte
- 在檔案中間插入 draft（永遠 append 到尾端）
- 重排現有條目順序
- 刪除 HTML comment 或 schema 說明段落

寫入後印：

```
✓ ${NEW_ID} 已寫入 docs/KNOWN_ISSUES.md

下一步建議：
  - 若 issue 已解決，可以手動在 GitHub 對 issue 加 `known-issue` label
    並 close，或在 comment 裡貼 KI-NNNN 連結（skill 不會自動做這個——
    外部變動由人類執行）
  - 在下次 release 的 changelog 提及這條新 KI
```

---

## 禁止清單（快速 audit 用）

| 禁止項 | 原因 |
|--------|------|
| `curl`、`wget`、`fetch`、`open`、`xdg-open`、`start` | 違反「絕不發 HTTP 請求」鐵則 |
| 任何 HTTP-capable MCP tool | 同上 |
| `gh issue create / edit / close / comment / delete / lock / transfer` | 違反「只允許 read-only gh」鐵則 |
| `gh pr *`（任何子命令） | 同上 |
| `gh repo edit / fork / delete / sync` | 同上 |
| `gh api POST/PATCH/DELETE/PUT` | 同上 |
| Hardcoded `owner/name` fallback | 違反「絕不 hardcode repo」鐵則 |
| 跳過五問任一題 | 違反「絕不跳題」鐵則 |
| 跳過 confirmation gate 直接寫檔 | 違反「絕不在確認前寫檔」鐵則 |
| 覆寫既有 KI 條目 | 違反「絕不覆寫既有條目」鐵則 |
| 回收已刪除的 KI ID | 違反「絕不回收 ID」鐵則 |
| description 加 `[maintainer-only]` 前綴 | 已移除；skill 不在 `/` 列表，前綴多餘且污染 agent 匹配 |

---

## Integration

| 銜接 | 說明 |
|------|------|
| 前置 | 使用者透過 `report-issue` skill 或 GitHub issue template 產生 issue；maintainer 處理後決定哪些值得歸納成 KI |
| 後續 | 寫入 `docs/KNOWN_ISSUES.md`；`srs-onboard` Mode 2 的 H13 下次執行時會自動感知新條目 |
| 相關 skill | `report-issue`（使用者回報端）、`srs-onboard`（H13 cross-reference 消費端） |
| 相關檔案 | `.claude-plugin/plugin.json`（repo URL）、`docs/KNOWN_ISSUES.md`（寫入目標） |
| 外部依賴 | 本機 `gh` CLI（GitHub Official CLI）——僅此 skill 依賴 |

---

## 完成檢查

- [ ] `command -v gh` 與 `gh auth status` 都通過才繼續
- [ ] `owner/name` 從 `plugin.json` 解析，沒 hardcode
- [ ] 每個 `gh` 呼叫都帶 `--repo <owner/name>`
- [ ] 五問全部問過，沒因 issue body 看起來有答案就跳題
- [ ] Q5 答案經過合法性驗證（H1-H12 / comma-list / none）
- [ ] `KI-NNNN` ID 透過 `grep -oE '^## KI-[0-9]{4}'` + max + 1 分配
- [ ] Draft review 印出完整草稿並收到明確 "yes"
- [ ] 寫入永遠是 append 到尾端，沒覆寫既有條目
- [ ] skill 原始碼沒包含任何 `curl`/`wget`/`open` 或 mutating gh 子命令
