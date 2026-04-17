# notion-automation-studio

SRS 需求文件自動化工作室，封裝為 Claude Code plugin。包含檢核、整合、
發佈到 Notion 的 skills、agents 與 helper scripts，讓任何以 zh-TW
Markdown 撰寫 SRS 的專案都能快速接上。

**這個 repo 只裝工具**。專案內容（需求文件、assets、notion-mapping）永遠
活在使用端的 repo 裡，studio 本體絕不持有任何 instance 資料。

## 它解決什麼問題

手寫 SRS 需求文件時，同時要顧四件事：

1. **格式與用語合規** — 六大章節齊備、術語一致、文字階層正確、Notion 相容
2. **多份需求合併成總整文件** — 客戶要看的是一份打包過的 `requirements-{batch}.md`
3. **推到 Notion 讓客戶審閱** — 客戶不用下載 markdown，直接在 Notion workspace 裡看
4. **圖片與排版同步** — 需求文件裡的圖片（表單範例、流程圖）和並排排版（columns）要在 Notion 上正確呈現，不能每次 publish 都手動重傳

若全手動，任一環節漏掉就會讓客戶看到半成品、讓術語不一致、讓 Notion
上的內容過期、或讓圖片 caption 對不上。這個 plugin 把這些事封裝成
skills，Claude Code 讀到你的口語指令（「審查 R0001」「SYNC R0001」
「PUBLISH」）時會自動觸發對應 skill 並依規則執行。

典型情境：

> 要在兩週內交付 N 份需求文件給客戶。你天天在 `{batch}-SRS/src/R*.md`
> 底下增補內容，每改完一份就對 Claude 講「SRS R0001」做合規檢核，
> 再講「SYNC R0001」併入總整文件，最後 `PUBLISH` 把總整文件推到
> Notion。圖片自動上傳、排版自動轉換、格式自動檢核——整個流程不碰
> git 以外的指令列，也不用記格式規則。

## 日常操作流程

一次典型的「改一份需求 → 送到 Notion」大致會是這樣的對話：

```
你 > 審查 R0001
Claude > [srs-check 觸發]
         載入專案 CLAUDE.md 的術語表與需求清單
         十項合規檢核（六大章節、術語、文字階層、Notion 相容 ...）
           ✓ 六大章節齊備
           ⚠ 術語「{禁用詞}」已改為「{統一用詞}」（2 處）
         ✓ 檢核完成，workflow-state 已記錄

你 > SYNC R0001
Claude > [srs-sync 觸發]
         確認 R0001 已 check 過 ... OK
         合併 src/ 下所有需求檔 → output/requirements-{batch}.md
         ✓ 總整文件已更新

你 > PUBLISH
Claude > [srs-publish-notion 觸發]
         確認 output 與上次 sync 一致 ... OK
         掃描圖片：11 張（8 已 cache、3 新上傳）
         轉換 569 個 blocks、2 組 columns

         === Publish Preview ===
         block 數：569（上限 1000）
         圖片：11 張
         columns：2 組
         [等你打 confirm]

你 > confirm
Claude > 清空 Notion 舊內容
         寫入 569 blocks ... [1/6] [2/6] ... [6/6]
         ✓ 發佈完成
         Notion 頁面：https://www.notion.so/xxxxxxxx
```

若中間跳步（例如沒 check 直接 SYNC），pre-check 會 block 並顯示三選一，
你可以補跑前置 skill、強制繼續、或取消。任何 skill 中途出錯或使用者取消，
workflow-state 都**不會**被更新——狀態檔忠實反映「實際完成的事」。

### PUBLISH 時你會看到什麼

| 階段 | 你看到的 | 意思 |
|------|----------|------|
| 掃描圖片 | 「11 張（3 新上傳、8 已 cache）」 | 圖片自動上傳到 Notion，沒改過的圖不重傳 |
| 轉換 | 「569 個 blocks、2 組 columns」 | Markdown 已轉為 Notion 格式，含並排排版 |
| Preview | block 數、圖片數、columns 數 | **檢查點**——確認數字合理再打 confirm |
| 寫入進度 | `[1/6] [2/6] ...` | 分批寫入 Notion，每批 100 blocks |
| 完成 | Notion 頁面 URL | 點開確認圖片和排版正確 |

**重要**：打 `confirm` 之前 Notion 頁面不會被動到。取消就完全不影響。

## 安裝

```
/plugin install notion-automation-studio
```

安裝後第一次使用需要：
1. 設定 `NOTION_TOKEN`（Notion integration token）
2. 在 Notion 手動建立 toggle heading + child page（一次性 bootstrap）
3. 執行 `srs-setup` 初始化專案設定

完整步驟見 [docs/INSTALL.md](docs/INSTALL.md)。

## 遇到問題?

Plugin 沒有 telemetry、沒有 crash reporter、不自動上傳任何資料。遇到問題時
請依下列**四層管道**擇一回報，每一層的摩擦由低到高：

### 1. 在 Claude Code 對話中直接講（最省力）

在對話裡說「壞了」「卡住」「踩坑」「回報問題」「something is wrong」等類似
語句，Claude 會自動觸發 `report-issue` skill。Skill 會：

1. 先問你是要回報 bug 還是只是想問問題（選錯了立刻退出，沒有副作用）
2. 互動式蒐集你剛剛的觸發 prompt、期待行為、實際行為、環境版本
3. 讀取 `.claude/workflow-state.json` 的關鍵時間戳（**不**包含 page ID 或 token）
4. 組出完整 issue body 印在對話中讓你 **review**
5. 你明確確認後，產生一個 **pre-filled GitHub issue URL** 印出來
6. 你自己複製 URL 到瀏覽器、在 GitHub 網頁做最後一次 review、按 Submit

**隱私承諾**：整個過程 skill **絕不**發任何網路請求（沒有 `curl`、沒有
`wget`、沒有 `open`、沒有 HTTP MCP tool）。最後一步永遠是「印 URL」，送不送
出完全由你掌控。

### 2. 直接在 GitHub 開 issue（不想開 Claude Code 時）

到 GitHub repo 的 [Issues 頁面](https://github.com/ericcai0814/notion-automation-studio/issues/new/choose)
選 issue template：

- **「回報 Bug」** — plugin 實作錯誤、skill crash、輸出不正確
- **「使用疑惑 / 文件不準」** — skill 技術上沒壞但跟你預期不同、description
  讓你產生錯誤的心智模型

兩個 template 都會主動要求你填觸發 prompt、期待 vs 實際、環境版本等欄位。
Blank issue 已刻意關閉，請走結構化管道以便 maintainer 快速重現問題。

### 3. 先翻 `docs/KNOWN_ISSUES.md`（已知踩坑目錄）

[docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md) 是所有已記錄踩坑的 single source
of truth。開 issue 前先瞥一眼——若你遇到的症狀已經在列表裡，通常那一頁直接就
有 Resolution 或 workaround。

`srs-onboard` skill 的 Mode 2 健檢也會在 H1-H12 出現失敗時自動 cross-reference
這份目錄，主動提示「可能是已知問題 KI-NNNN」。你不需要自己手動翻。

### 4. Maintainer 的 `distill-known-issue` skill（不是給你用的）

這層是 plugin maintainer 的工具：把收到的 GitHub issue 半自動歸納成
`docs/KNOWN_ISSUES.md` 的一條條目。流程：

1. Maintainer 本機的 `gh` CLI 抓取 issue 原文（`gh issue view` 唯讀子命令）
2. Skill 問 maintainer 五個抽象化問題（症狀 pattern / 影響 skill / 根本原因 /
   解法類型 / 對應的健檢項）
3. Skill 組出草稿、自動分配 `KI-NNNN` ID、印出完整草稿
4. **Maintainer 明確確認後**才 append 到 `docs/KNOWN_ISSUES.md` 尾端

**隱私承諾**：skill **不**直接發 HTTP 請求，只 spawn 本機 `gh` CLI；**不**
執行任何 mutating gh 子命令（`gh issue create/edit/close/comment`、`gh pr *`
等全部禁止）；寫 `docs/KNOWN_ISSUES.md` 前強制人類確認 gate，沉默、超時、
模糊回答一律視為「未確認」。

> 這個 skill 只對 maintainer 有意義，對一般使用者是透明的——你在 `/` 斜線
> 命令列表裡看不到它，但它的觸發詞（「distill issue」「歸納成 KI」等）也刻意
> 精準到不會被一般使用者誤觸。

---

**總結承諾**：

- Plugin 不做自動 telemetry、不做 crash reporter、不做遠端 usage analytics
- `report-issue` 只產生 URL，絕不發 HTTP 請求
- `distill-known-issue` 只透過本機 gh CLI 唯讀抓 issue，寫檔前強制人類確認
- 所有 skill 對 `docs/KNOWN_ISSUES.md` 的寫入都必須通過 human-in-the-loop gate
- 禁止 webhook / cron / git hook / PostToolUse hook 等任何繞過人類確認的
  自動寫入管道

## 授權

MIT

---

> 維護者技術文件見 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
