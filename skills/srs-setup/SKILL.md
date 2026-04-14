---
name: srs-setup
description: >
  使用端專案首次接上 notion-automation-studio plugin 的初始化流程。
  當用戶說「初始化 SRS 專案」「我要在這個 repo 開始用 plugin」「第一次設定 SRS」
  「setup SRS」「srs setup」「plugin setup」「新 repo 初始化」「從零開始」時觸發。
  在使用端 repo 建立 `.claude/` 目錄、複製初始設定檔、互動式填寫
  notion-mapping.json 與 CLAUDE.md，並引導手動在 Notion 建立所需的 toggle 頁面。
  寫檔，但對既有真實資料完全冪等（存在即跳過）。
---

# srs-setup

在使用端 repo 執行**首次初始化**，讓這個 repo 可以使用 notion-automation-studio
plugin 的完整 skill 管線（`srs-check` → `srs-sync` → `srs-publish-notion`）。

## 定位

| 與其他 skill 的分工 |
|---|
| **srs-setup**（本 skill）：一次性初始化，建立骨架與設定檔 |
| **srs-new-batch**：建立新的 `{batch}-SRS/` 批次目錄 |
| **srs-onboard**：說明 plugin 功能，只讀不寫 |

本 skill 寫檔，但對既有真實資料完全冪等：各步驟若目標已存在則跳過，
不覆蓋使用者的真實資料。

## 適用範圍

- 使用端 repo（非 plugin 本身的 repo）
- 尚未有 `.claude/workflow-state.json` 或 `.claude/notion-mapping.json` 的全新接入
- CLAUDE.md 可能已存在（部分初始化）或完全不存在

---

## Workflow

### Step 1：建立 `.claude/` 目錄

```bash
mkdir -p .claude
```

**冪等**：目錄已存在時 `mkdir -p` 靜默跳過，無副作用。

---

### Step 2：複製 workflow-state.json

**若 `.claude/workflow-state.json` 不存在**，從 plugin 模板複製：

```bash
node ${CLAUDE_PLUGIN_ROOT}/scripts/workflow-state.js ensure \
  .claude/workflow-state.json \
  ${CLAUDE_PLUGIN_ROOT}/templates/workflow-state.json
```

腳本輸出：

- `OK: state file exists` → 已存在，跳過
- 建立成功 → 提示使用者之後記得 `git add .claude/workflow-state.json` 並 commit

**冪等**：目標已存在時腳本不覆蓋。

---

### Step 3：互動式填寫 notion-mapping.json

**冪等檢查（優先執行）**：

若 `.claude/notion-mapping.json` 已存在，且 JSON 不等於模板預設值（即
`parent_page_id` 不是 `"{PARENT_PAGE_UUID}"`），則表示檔案已有真實資料。
輸出提示後跳過整個 Step 3：

```
notion-mapping.json 已存在且含有真實設定，跳過互動式填寫。
如需修改，請直接編輯 .claude/notion-mapping.json。
```

**互動式對話**（僅首次執行時）：

#### 3-a：詢問 Notion 父頁面 URL

```
請貼上 Notion 父頁面的 URL（在這個頁面下方會建立需求分析 toggle）：
> https://www.notion.so/your-workspace/Project-Overview-abc123def456789012345678abcd1234
```

從 URL 尾端提取 32 字元 UUID（去除 `-` 後的最後一段 hex 字串）：

```
解析結果：
  parent_page_id: abc123def456789012345678abcd1234
  parent_page_url: https://www.notion.so/your-workspace/Project-Overview-abc123def456789012345678abcd1234

確認正確嗎？(y/n)
```

若使用者確認錯誤，重新詢問 URL。

#### 3-b：詢問第一個 batch ID

```
請輸入第一個批次 ID（例如 3-B、4-A、phase-1）：
> 3-B
```

#### 3-c：確認 toggle_label 與 child_page_title

```
Notion toggle 標籤（預設：《需求分析》，直接 Enter 採用預設）：
>

Child page 標題（預設：需求說明文件3-B，直接 Enter 採用預設）：
>
```

使用者可按 Enter 接受預設，或輸入自訂值。

#### 3-d：預覽並確認

顯示即將寫入的 JSON 預覽：

```json
{
  "batches": {
    "3-B": {
      "parent_page_id": "abc123def456789012345678abcd1234",
      "parent_page_url": "https://www.notion.so/your-workspace/Project-Overview-abc123def456789012345678abcd1234",
      "sandbox": {
        "toggle_label": "《需求分析》",
        "child_page_title": "需求說明文件3-B",
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

```
以上設定正確嗎？確認後寫入 .claude/notion-mapping.json (y/n)
```

確認後，以 Write tool 原子性寫入（先寫 `.claude/notion-mapping.json.tmp`，再 rename 覆蓋）。寫入完成後提示：

```
.claude/notion-mapping.json 已建立。
注意：此檔含有 Notion page URL，請依團隊政策決定是否 git commit：
  - 若要讓團隊成員共用同一 Notion 目標 → commit
  - 若各人有不同沙箱 → gitignore
```

---

### Step 4：檢查 Notion MCP 是否已安裝

檢查可用 MCP 工具清單中是否存在 `mcp__plugin_Notion_notion__*` 前綴的工具。

**若已安裝**：

```
Notion MCP 已安裝。
```

**若未安裝**：

```
未偵測到 Notion MCP。若要使用 srs-publish-notion skill，
請在終端機執行：

  /plugin install Notion

安裝後重新啟動 Claude Code 工作階段即可。
（本 skill 不會自動安裝 MCP，請手動執行上述指令。）
```

**本 skill 絕不自行安裝 MCP**，只告知使用者手動步驟。

---

### Step 5：互動式填寫 CLAUDE.md

#### 5-a：冪等檢查

**若 `CLAUDE.md` 不存在**：以 Read 讀取 `${CLAUDE_PLUGIN_ROOT}/templates/project-CLAUDE.md.tmpl`，再以 Write tool 寫至 `./CLAUDE.md`。

**若 `CLAUDE.md` 已存在**：
讀取現有內容，偵測下列三個章節是否存在：

| 必要章節 | 偵測關鍵字 |
|----------|------------|
| 子系統對照 | `## 子系統對照` |
| 需求清單 | `## 需求清單` |
| 術語對照表 | `## 術語對照表` |

對每個缺少的章節，詢問是否要附加骨架：

```
CLAUDE.md 已存在，偵測到以下章節缺失：
  - 術語對照表

是否要在 CLAUDE.md 末尾附加缺少章節的骨架？(y/n)
```

確認後，以 Edit tool 追加（不覆蓋現有內容）。

#### 5-b：互動式對話填寫內容

完成骨架建立後，進入互動式對話，逐步把佔位符填成真實資料。
**每個問題一次問一個**，不要批量列出所有問題：

**5-b-1：專案基本資訊**

```
這個 SRS 專案的名稱是什麼？（會出現在 CLAUDE.md 標題）
> {your-project}

這個專案服務的主要領域 / 業務背景是什麼？（一兩句話即可）
> 例如：員工宿舍管理、採購申請審核、客服工單系統
```

**5-b-2：子系統與角色**

```
這個專案有哪些子系統？請逐一說明，每個子系統的名稱與主要使用對象。
（完成後輸入「完成」）

> 例如：後台管理系統，使用對象：管理員
```

每說一個子系統，即時寫入 CLAUDE.md 的「子系統對照」表格一列。

**5-b-3：術語對照表（逐列建立）**

```
現在來建立術語對照表。這個表格讓 srs-check skill 自動統一文件中的術語。

請告訴我一組術語，格式：
  正式用詞 | 應禁止混用的別名（可多個，逗號分隔）

（完成後輸入「完成」）

> 例如：承辦人員 | 承辦、管理者
```

每確認一列，即時以 Edit tool 追加至術語對照表。確保使用者看到即時回饋：

```
已新增：承辦人員 | 禁止：承辦、管理者
繼續下一組，或輸入「完成」：
```

**5-b-4：需求清單（初步）**

```
接下來列出目前已知的需求編號與功能名稱（可先列粗略的）。

格式：R00XX | 功能名稱
（完成後輸入「完成」）

> 例如：R0001 | 登入功能
```

每確認一條，即時追加至需求清單表格，並確認回饋：

```
已新增：R0001 | 登入功能
繼續，或輸入「完成」：
```

---

### Step 6：引導手動在 Notion 建立 toggle / child page

Notion MCP 無法在 toggle block 內建立子頁面（API 限制），需手動操作：

```
目標結構：
  父頁面（{parent_page_url}）
  └── 《需求分析》（toggle block，標題須與 toggle_label 字字相符）
      └── 需求說明文件{batch-id}（child page，標題須與 child_page_title 字字相符）

步驟：
1. 開啟父頁面 URL
2. 輸入 /toggle 建立 toggle，標題設為：《需求分析》
3. 展開 toggle → 點「+」→「Page」→ 標題設為：需求說明文件{batch-id}
4. 開啟 child page，複製其 URL

準備好後，請貼上 child page URL（或輸入「之後再填」跳過）：
```

若使用者提供了 URL，解析其 UUID 後，以 Edit tool 更新 `.claude/notion-mapping.json`
的 `child_page_id` 與 `child_page_url` 欄位。

若使用者選擇跳過，提示：

```
了解。稍後可執行 srs-publish-notion skill 前再回填：
  .claude/notion-mapping.json → batches.{batch-id}.sandbox.child_page_url
  .claude/notion-mapping.json → batches.{batch-id}.sandbox.child_page_id
```

---

### Step 7：初始化完成摘要與下一步

輸出完成摘要：

```
## srs-setup 完成

建立或確認的項目：
  ✅ .claude/ 目錄
  ✅ .claude/workflow-state.json
  ✅ .claude/notion-mapping.json（batch: {batch-id}）
  ✅ CLAUDE.md（含子系統對照 / 需求清單 / 術語對照表）
  ⚠️ Notion MCP：{已安裝 / 未安裝，請執行 /plugin install Notion}
  ⚠️ Notion child page：{已設定 / 待手動建立}

下一步：
  執行以下指令建立第一個批次目錄：

    srs-new-batch {batch-id}
```

**本 skill 不自動呼叫 `srs-new-batch`**，由使用者手動觸發。

---

## 完成檢查

- [ ] `.claude/` 目錄存在
- [ ] `.claude/workflow-state.json` 存在（版本 1，空 batches）
- [ ] `.claude/notion-mapping.json` 含有真實的 parent_page_id 與 batch 設定
- [ ] CLAUDE.md 含有「子系統對照」「需求清單」「術語對照表」三個章節
- [ ] 使用者知道 Notion toggle / child page 須手動建立（若尚未建立）
- [ ] 使用者知道下一步要執行 `srs-new-batch {batch-id}`

---

## Integration

| 銜接 | 說明 |
|------|------|
| 前置（無） | 這是管線起點，無前置 skill |
| 後續（必要） | `srs-new-batch {batch-id}` — 建立第一個批次目錄骨架 |
| 後續（選用） | `srs-onboard` — 向新成員說明 plugin 使用方式 |
| 主管線 | `srs-check` → `srs-sync` → `srs-publish-notion`（待 batch 建立後啟動） |

---

## 冪等行為一覽

| 項目 | 已存在時的行為 |
|------|---------------|
| `.claude/` 目錄 | 靜默跳過（`mkdir -p`） |
| `workflow-state.json` | 腳本偵測後跳過，印 `OK: state file exists` |
| `notion-mapping.json`（含真實資料） | 整個 Step 3 跳過，不詢問不覆蓋 |
| `notion-mapping.json`（仍為模板佔位符） | 視同不存在，繼續互動式填寫 |
| `CLAUDE.md`（完整含三個必要章節） | Step 5 互動部分仍執行（填寫佔位符內容） |
| `CLAUDE.md`（缺少部分章節） | 只附加缺少的章節骨架，不碰既有內容 |

---

## 常見錯誤與處理

| 情境 | 處理方式 |
|------|----------|
| 使用者貼的 URL 無法解析出 32 字元 UUID | 說明正確 URL 格式，重新詢問 |
| 使用者在 plugin repo 本身執行 srs-setup | 回報「偵測到 plugin 維護者環境（`${CLAUDE_PLUGIN_ROOT}` 位於當前目錄）」，拒絕執行並提示切換至使用端 repo |
| Notion MCP 工具清單為空（沙箱 / 隔離環境） | 假設未安裝，輸出安裝指引 |
| Write 工具因權限問題失敗 | 回報 fs 錯誤路徑，提示使用者確認目錄寫入權限 |
| 使用者中途放棄（Ctrl-C） | 不寫任何 state 紀錄；下次重新執行時冪等規則自動跳過已完成的步驟 |
