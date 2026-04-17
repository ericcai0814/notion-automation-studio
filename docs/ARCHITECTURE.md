# Architecture

notion-automation-studio 的內部架構文件。面向 plugin 維護者，非使用端使用者。

## Plugin 定位與分層原則

### 工具與內容分離（兩個 repo）

| Repo | 放什麼 | 由誰改 |
|------|--------|--------|
| `notion-automation-studio`（本 repo） | Skills、agents、scripts、templates | Plugin 維護者 |
| `{your-project}-srs`（使用端） | `{batch}-SRS/src/R*.md`、`CLAUDE.md`、`.claude/notion-mapping.json`、`.claude/workflow-state.json` | 撰寫需求的人 |

兩個 repo 永遠不會混在一起。Plugin 升級不會動到使用端的需求內容；新增需求
也不會動到 plugin。維護者 `CLAUDE.md` 明文禁止在本 repo 放任何 `*-SRS/`
目錄、`notion-mapping.json` 或特定客戶名稱。

### Plugin 提供規則，專案提供資料

| 放在 skill 裡 | 放在使用端 CLAUDE.md |
|---------------|---------------------|
| 六大章節結構（一、需求說明 / 二、使用情境 / …） | 實際的需求清單（R00XX 列表） |
| 寫作風格原則、文字階層規則 | 專案術語對照表 |
| Notion 相容性規則 | Notion parent/child page ID（在 notion-mapping.json） |
| 各檢核項目的判定邏輯 | 子系統對照、角色定義 |

Skill 內若要示範格式，用明顯 generic 的佔位符（`R0001` / `{術語A}`），
附一句「實際資料由使用端專案 CLAUDE.md 提供」。

### Skill 是什麼

Claude Code 的 skill 是一份「長文件 + 觸發詞清單」。安裝 plugin 後
Claude 每次開工都會看一眼 skill 清單，當使用者說的話對上某個 skill 的觸發
詞（例如「審查 R0001」對上 `srs-check`），Claude 自動切換到那個模式，
依 SKILL.md 裡寫好的步驟執行。

所以「使用 plugin」不是「呼叫 API」，是**用自然語言觸發模式切換**。

## Workflow State 機制

### 順序保障

三個主要 skill 之間有隱性規則：**check → sync → publish，不能跳**。

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

### Pre-check 邏輯

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
的 `.claude/`，並提示 `git add` 後 commit。

Skill 只記「實際跑過的事」，不記「使用者的選擇意圖」——選「[2] 強制繼續」
不會留下 override audit trail，這是刻意設計，避免汙染 causal chain。

## Skill 一覽

### 主要管線

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
  「PUBLISH」（發佈）      →    srs-publish-notion →  Notion 沙箱頁面（含圖片與 columns）
```

三個 skill 刻意**不自動連鎖**：沙箱階段需要 debug 能見度，每個階段都要
使用者親自觸發。每個 skill 的輸出會留在檔案系統（不是記憶體），可以獨立
檢視與回退。

### 完整 Skill 列表

| Skill | 觸發詞（摘要） | 用途 |
|-------|----------------|------|
| `srs-check` | 「審查 R00XX」「檢查 SRS」 | 10 項合規檢核 + 直接修正 |
| `srs-sync` | 「SYNC R00XX」「SYNC ALL」 | 合併 src/*.md → output/ |
| `srs-publish-notion` | 「PUBLISH」「發佈 SRS」 | REST API 直接發佈到 Notion（含圖片自動上傳） |
| `srs-setup` | 「初始化 SRS 專案」 | 首次 repo 初始化（互動式） |
| `srs-new-batch` | 「新增批次 4-A」 | 建立新 batch 目錄骨架 + append mapping |
| `srs-onboard` | 「我是新來的」「健檢」 | 專案狀態診斷 mentor（唯讀） |
| `notion-doc-writing` | 「Notion 排版」 | 通用 Notion markdown 撰寫規則（被 publish 組合使用） |
| `report-issue` | 「壞了」「有 bug」 | 互動式 bug 回報（產生 GitHub issue URL） |
| `distill-known-issue` | 「歸納成 KI」 | 從 GitHub issue 歸納 Known Issue 條目（maintainer 專用） |

### Agent

| Agent | Model | 用途 |
|-------|-------|------|
| `srs-reviewer` | opus | 批次平行審查多份需求（10 項逐檔 + 4 項跨文件一致性檢查） |

## Script 與工具層

### Publish Pipeline Scripts

| Script | 語言 | 用途 |
|--------|------|------|
| `publish-to-notion.js` | Node | Publish orchestrator（Steps A-F，`--dry-run`/`--discover`） |
| `md-to-notion-blocks.py` | Python | Markdown → Notion block JSON converter（20+ block types） |
| `notion-api-client.js` | Node | Notion REST API client（token bucket + 429 retry） |
| `notion-upload-image.js` | Node | 圖片上傳 CLI（file_upload API + md5 cache） |

### Workflow Scripts

| Script | 語言 | 用途 |
|--------|------|------|
| `merge-srs.js` | Node | 合併 src/*.md → output/（排序、需求大綱生成） |
| `scaffold-batch.js` | Node | 建立新 batch 目錄骨架 |
| `append-batch-mapping.js` | Node | 新 batch entry append 到 notion-mapping.json |
| `validate-structure.js` | Node | 批次目錄結構驗證（六大章節 marker、檔名 pattern） |
| `workflow-state.js` | Node | 工作流狀態讀寫與 pre-check |

### 零外部依賴原則

- **Node scripts**：Node 18+ stdlib（`fetch`、`FormData`、`fs`、`crypto`），零 npm 依賴
- **Python converter**：Python 3 stdlib（`sys`、`json`、`re`、`argparse`），零 pip 依賴，透過 `uv run` 執行
- 使用端只需安裝 `node >= 18` 和 `uv`（`brew install uv`）

## Publish Pipeline 詳解

`srs-publish-notion` skill 呼叫 `publish-to-notion.js` orchestrator，
orchestrator 依序執行六個步驟：

```
publish-to-notion.js --batch {batch}
  ├─ Step A: Archive — 逐 block DELETE 清空目標頁面
  ├─ Step B: Image Upload — 掃描 MD 圖片引用，透過 notion-upload-image.js 上傳
  │   └─ md5 cache：未改過的圖跳過上傳
  ├─ Step C: Convert — uv run md-to-notion-blocks.py 轉為 block JSON
  │   └─ --images-manifest 傳入 file_upload_id mapping
  ├─ Step D: Safety Check — block 數 > 1000 中止、> 900 警告
  ├─ Step E: Append — 分批 ≤100 blocks append 到 child page
  │   └─ column_list: one-shot 預設，422 時 fallback two-pass
  └─ Step F: State Update — 寫入 last_synced_at / last_synced_source_md5
```

### 三種執行模式

| 模式 | 指令 | 行為 |
|------|------|------|
| `--discover` | `--discover --batch {batch}` | 從 parent page 掃描 toggle → child page，寫入 mapping |
| `--dry-run` | `--dry-run --batch {batch}` | 執行 Steps A-D（含 archive 和圖片上傳），跳過 append 和 state update，輸出 preview JSON |
| 正式 publish | `--batch {batch}` | 執行 Steps A-F 全流程 |

**注意**：`--dry-run` 會真的 archive 頁面內容和上傳圖片，不是 pure preview。
設計意圖是讓 dry-run 之後直接跑正式 publish 時，archive 為空、圖片全部 cache hit。

### Column 處理

Markdown 中的 `<columns>` / `<column>` tag 會被 converter 轉為
`column_list` / `column` Notion blocks。Children 放在 type-specific
object（`column_list.children` / `column.children`），不在 top-level。

Orchestrator 預設 one-shot append（含 inline children），若 Notion API
回 422 則 fallback two-pass：先 append 空 columns、GET column IDs、再
分別 append children 到各 column。

### Image Cache 機制

`notion-upload-image.js` 用本地檔案 md5 做 cache key：

```
notion-mapping.json
  batches.{batch}.images.{relative_path}
    ├─ md5: "<hex>"
    ├─ file_upload_id: "<uuid>"
    └─ uploaded_at: "<iso>"
```

- **Cache hit**（md5 相同）：跳過上傳，直接回傳 file_upload_id
- **Cache miss**（md5 不同或無 entry）：重新上傳，覆寫 mapping entry

**file_upload TTL**：Notion 的 file_upload_id 有未文件化的 TTL。單次
publish 內安全（< 1 分鐘），但跨 session 的 cached ID 可能過期（實測 >1.5hr
會 expired）。遇到 expired 錯誤時清除該圖的 cache entry 重跑即可。

## 設計原則

1. **工具與內容分離** — studio 只放 tooling；需求文件、Notion page ID、
   assets 都屬於使用端 repo
2. **Plugin 提供規則，專案提供資料** — skills 內建六大章節結構、寫作風格
   等規則；專案在自己的 `CLAUDE.md` 內定義術語表、需求清單等 instance 資料
3. **Notion 相容性優先** — 所有 markdown 產出物都考慮到最終會變成 Notion
   blocks；避免 HTML、深層巢狀、hidden frontmatter metadata
4. **單向同步** — markdown 是 source of truth，Notion 是單向鏡像，禁止反向
5. **零外部依賴** — Node 18+ stdlib + Python 3 stdlib via `uv`，不引入
   npm 或 pip 依賴
6. **Archive-then-rewrite** — publish 採全量覆寫（archive 舊 blocks → append
   新 blocks），不做 block-level diff，保證正確性
7. **Publish gate** — 任何 destructive Notion 操作前必須使用者明確 confirm，
   取消 = 零副作用

## 內容物

```
.claude-plugin/plugin.json       # Plugin manifest
skills/
├── srs-setup/                   # 首次 repo 初始化（互動式）
├── srs-new-batch/               # 新 batch scaffolding + 自動 append mapping
├── srs-check/                   # 10 項 SRS 需求文件合規檢核
├── srs-sync/                    # 獨立需求檔 → 整合版同步
├── srs-publish-notion/          # 發佈到 Notion workspace sandbox（REST API）
├── srs-onboard/                 # 專案狀態診斷 mentor（read-only）
├── notion-doc-writing/          # 通用 Notion markdown 撰寫規則
├── report-issue/                # 互動式 bug 回報
└── distill-known-issue/         # Known Issue 歸納（maintainer 專用）
agents/
└── srs-reviewer.md              # 批次平行審查 agent
scripts/
├── publish-to-notion.js         # Publish orchestrator（Steps A-F）
├── md-to-notion-blocks.py       # Markdown → Notion block JSON converter
├── notion-api-client.js         # Notion REST API client + rate limiter
├── notion-upload-image.js       # Image uploader CLI（file_upload + md5 cache）
├── merge-srs.js                 # 獨立 md → 整合版 merge 工具
├── scaffold-batch.js            # 建立新 batch 目錄骨架
├── append-batch-mapping.js      # 自動 append 新 batch 到 notion-mapping.json
├── validate-structure.js        # 驗證目錄結構
└── workflow-state.js            # workflow state 讀寫與 pre-check
templates/
├── project-CLAUDE.md.tmpl       # 專案 CLAUDE.md 骨架
├── notion-mapping.json.tmpl     # Notion mapping 骨架
├── mcp.json.tmpl                # .mcp.json 骨架
└── workflow-state.json          # workflow state 骨架（version: 1，空 batches）
docs/
├── INSTALL.md                   # 安裝與使用指引
├── KNOWN_ISSUES.md              # 已知踩坑目錄
├── ARCHITECTURE.md              # 本檔
└── srs-publish-notion-refactor.md  # publish 重構研究紀錄（歷史文件）
```
