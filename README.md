# notion-automation-studio

SRS 需求文件自動化工作室，封裝為 Claude Code plugin。包含檢核、整合、
發佈到 Notion 的 skills、agents 與 helper scripts，讓任何以 zh-TW
Markdown 撰寫 SRS 的專案都能快速接上。

**這個 repo 只裝工具**。專案內容（需求文件、assets、notion-mapping）永遠
活在使用端的 repo 裡，studio 本體絕不持有任何 instance 資料。

## 它解決什麼問題

手寫 SRS 需求文件時，同時要顧三件事：

1. **格式與用語合規** — 六大章節齊備、術語一致、文字階層正確、Notion 相容
2. **多份需求合併成總整文件** — 客戶要看的是一份打包過的 `requirements-{batch}.md`
3. **推到 Notion 讓客戶審閱** — 客戶不用下載 markdown，直接在 Notion workspace 裡看

若全手動，三件事任一環節漏掉就會讓客戶看到半成品、讓術語不一致、讓 Notion
上的內容過期。這個 plugin 把三件事各自封裝成一個 skill，Claude Code 讀到
你的口語指令（「審查 R0001」「SYNC R0001」「PUBLISH」）時會自動觸發
對應 skill 並依規則執行。

典型情境：

> 要在兩週內交付 N 份需求文件給客戶。你天天在 `{batch}-SRS/src/R*.md`
> 底下增補內容，每改完一份就對 Claude 講「SRS R0001」做合規檢核，
> 再講「SYNC R0001」併入總整文件，最後 `PUBLISH` 把總整文件推到
> Notion。整個流程不碰 git 以外的指令列，也不用記格式規則。

## 基本原理

### 1. Plugin vs. 使用端專案（兩個 repo）

| Repo | 放什麼 | 由誰改 |
|------|--------|--------|
| `notion-automation-studio`（本 repo） | Skills、agents、scripts、templates | Plugin 維護者 |
| `{your-project}-srs`（使用端） | `{batch}-SRS/src/R*.md`、`CLAUDE.md`、`.claude/notion-mapping.json`、`.claude/workflow-state.json` | 撰寫需求的人 |

兩個 repo 永遠不會混在一起。Plugin 升級不會動到你的需求內容；新增需求
也不會動到 plugin。這是設計鐵則，維護者 `CLAUDE.md` 明文禁止在本 repo
放任何 `*-SRS/` 目錄、notion-mapping 或特定客戶名稱。

### 2. Skill 是什麼

Claude Code 的 skill 是一份「長文件 + 觸發詞清單」。安裝 plugin 後
Claude 每次開工都會看一眼 skill 清單，當你說的話對上某個 skill 的觸發
詞（例如「審查 R0001」對上 `srs-check`），Claude 自動**切換到那個模式**，
依 SKILL.md 裡寫好的步驟執行。

所以「使用 plugin」不是「呼叫 API」，是**用自然語言觸發模式切換**。
這也是為什麼 install 完不需要額外設定——skills 會自己被對上。

### 3. 主要 skill 管線

```
  使用者動作                    Skill                 主要產出
  ─────────────────────         ──────────────────    ────────────────────────────
  編輯 R*.md                         -
      │
      ▼
  「SRS R0001」（審查）    →    srs-check         →   修正後的 src/R0001_*.md
      │
      ▼
  「SYNC R0001」（同步）   →    srs-sync          →   output/requirements-{batch}.md
      │
      ▼
  「PUBLISH」（發佈）      →    srs-publish-notion →  Notion 沙箱頁面
```

三個 skill 刻意**不自動連鎖**：沙箱階段需要 debug 能見度，每個階段都要
使用者親自觸發。每個 skill 的輸出會留在檔案系統（不是記憶體），可以獨立
檢視與回退。

支援角色（lifecycle 與輔助）：

- `srs-setup` — 使用端 repo 首次初始化（建 `.claude/`、互動填
  `notion-mapping.json`、互動建 `CLAUDE.md` 骨架）
- `srs-new-batch` — 建新 batch 的目錄骨架（`3-B-SRS/` 這類），並自動 append
  新 batch entry 到 `notion-mapping.json`
- `srs-onboard` — 專案狀態診斷與 mentor（**只讀不寫**；迷失時問它「我現在
  該做什麼」「健檢一下」「狀態如何」）
- `notion-doc-writing` — 通用 Notion markdown 規則，被 `srs-publish-notion`
  組合使用（不給使用者直接呼叫）
- `srs-reviewer` agent — 平行審查多份需求的 subagent

### 4. Workflow state：順序保障

三個 skill 之間有一個隱性規則：**check → sync → publish，不能跳**。

- 沒 check 就 sync 會把不合規內容推進總整文件
- 沒 sync 就 publish 會把舊資料推到 Notion
- Sync 後手動改 output 再 publish 會讓修改不反映在 src，下次 sync 被蓋掉

`.claude/workflow-state.json` 把這規則落成一個版控過的 JSON 檔：

```json
{
  "version": 1,
  "batches": {
    "{batch}": {
      "last_sync_output_md5": "<hex>",
      "last_publish": { "ts": "<iso>" },
      "records": {
        "R0001": {
          "check": { "ts": "<iso>" },
          "sync":  { "ts": "<iso>" }
        }
      }
    }
  }
}
```

每個 skill 結尾寫時間戳，下一個 skill 開頭讀這檔做 pre-check。順序不對
就 block，並顯示三選一：

```
Pre-check 未通過。請選擇：
[1] 立即執行前置 skill，完成後重來
[2] 我已確認內容正確，這次強制繼續
[3] 取消
```

此檔**不 gitignore**——它是版控過的工作狀態，讓跨人協作時也看得到
「哪份需求什麼時候被 check 過」。第一次在新專案使用時，skill 的 Preflight
會自動從 plugin 的 `templates/workflow-state.json` 複製一份到使用端 repo
的 `.claude/`，並提示你 `git add` 後 commit。

Skill 只記「實際跑過的事」，不記「使用者的選擇意圖」——選「[2] 強制繼續」
不會留下 override audit trail，這是刻意設計，避免汙染 causal chain。

## 內容物

```
.claude-plugin/plugin.json      # Plugin manifest
skills/
├── srs-setup/                  # 首次 repo 初始化（互動式）
├── srs-new-batch/              # 新 batch scaffolding + 自動 append mapping
├── srs-check/                  # 10 項 SRS 需求文件合規檢核
├── srs-sync/                   # 獨立需求檔 ↔ 整合版同步
├── srs-publish-notion/         # 發佈到 Notion workspace sandbox
├── srs-onboard/                # 專案狀態診斷 mentor（read-only）
└── notion-doc-writing/         # 通用 Notion markdown 撰寫規則
agents/
└── srs-reviewer.md             # 批次平行審查 agent
scripts/
├── scaffold-batch.js           # 建立新 batch 目錄骨架
├── append-batch-mapping.js     # 自動 append 新 batch 到 notion-mapping.json
├── merge-srs.js                # 獨立 md → 整合版 merge 工具
├── validate-structure.js       # 驗證目錄結構
└── workflow-state.js           # workflow state 讀寫與 pre-check
templates/                      # 使用端專案初始化時可複製的範本
├── project-CLAUDE.md.tmpl      # 專案 CLAUDE.md 骨架
├── notion-mapping.json.tmpl    # Notion mapping 骨架
└── workflow-state.json         # workflow state 骨架（version: 1，空 batches）
docs/
└── INSTALL.md                  # 安裝與使用指引
```

## 日常操作流程（概念版）

一次典型的「改一份需求 → 送到 Notion」大致會是這樣的對話：

```
你 > 審查 R0001
Claude > [srs-check 觸發]
         Preflight: ensure workflow-state.json ... CREATED（第一次會看到）
         Step 0: 載入 CLAUDE.md 規範 ...
         Step 1.5: 結構檢核 ...
         Step 2: 十項檢核
           ✓ 六大章節
           ⚠ 術語「{禁用詞}」已改為「{統一用詞}」（2 處）
           ⚠ H5 降級為 toggle（1 處）
           ...
         Step 5: workflow-state 記錄 check/R0001/ts

你 > SYNC R0001
Claude > [srs-sync 觸發]
         Preflight: pre-check-sync R0001 ... OK（已於 ... check 過）
         merge-srs.js 全量重產 output/
         在「壹、版本說明」加一列
         Step 5.5: workflow-state 記錄 sync/R0001 + last_sync_output_md5
         ✓ output/requirements-{batch}.md 已更新

你 > PUBLISH
Claude > [srs-publish-notion 觸發]
         Preflight: pre-check-publish ... OK（md5 符合 state 紀錄）
         轉成 Notion-ready markdown
         顯示 Publish Preview
         [等你打 confirm]

你 > confirm
Claude > archive 既有 child page → replace_content
         更新 notion-mapping.json last_synced_at
         Step 8: workflow-state 記錄 last_publish.ts
         ✓ Notion 頁面已更新
```

若中間跳步（例如沒 check 直接 SYNC），pre-check 會 block 並顯示三選一，
你可以補跑前置 skill、強制繼續、或取消。任何 skill 中途出錯或使用者取消，
workflow-state 都**不會**被更新——狀態檔忠實反映「實際完成的事」。

## 安裝

```
/plugin install notion-automation-studio
```

完整安裝、Notion MCP 授權、首次 bootstrap Notion toggle / child page 的
步驟見 [docs/INSTALL.md](docs/INSTALL.md)。

## 設計原則

1. **工具與內容分離** — studio 只放 tooling；需求文件、Notion page ID、
   assets 都屬於使用端 repo
2. **Plugin 提供規則，專案提供資料** — skills 內建六大章節結構、寫作風格
   等規則；專案在自己的 `CLAUDE.md` 內定義術語表、需求清單等 instance 資料
3. **Notion 相容性優先** — 所有 markdown 產出物都考慮到最終會變成 Notion
   blocks；避免 HTML、深層巢狀、hidden frontmatter metadata
4. **單向同步** — markdown 是 source of truth，Notion 是單向鏡像

## 授權

MIT
