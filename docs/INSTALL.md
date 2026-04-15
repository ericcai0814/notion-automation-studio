# INSTALL

`notion-automation-studio` plugin 的安裝與首次使用指引。

## 一、安裝 plugin

前提：已安裝 Claude Code。

```
/plugin install notion-automation-studio
```

安裝後 skills 與 agents 自動可用，不需要任何額外設定。

## 二、首次在新專案中使用

假設你要在一個新的 SRS 文件庫專案（例如 `acme-corp-srs/`）套用 studio。

### 1. 建立專案 repo 與目錄結構

```bash
mkdir acme-corp-srs
cd acme-corp-srs
git init
mkdir -p {batch}-SRS/{src,output,assets}
mkdir -p .claude
```

`{batch}` 用你的批次代號取代，例如 `3-B`、`4-A`、`phase-1`。

### 2. 初始化專案（推薦：對 Claude 說「初始化 SRS 專案」）

在新 repo 目錄下開 Claude Code，對 Claude 說：

> 初始化 SRS 專案

會觸發 `srs-setup` skill，互動式地：

- 建 `.claude/` 目錄與 `workflow-state.json`
- 詢問 Notion parent page URL、batch ID 後產生 `.claude/notion-mapping.json`
- 跟你討論專案名稱、子系統、術語、需求清單，建立 `CLAUDE.md` 骨架
- 偵測 Notion MCP 是否已裝，若沒裝會提示你下一步要跑什麼指令

迷路或想知道目前進度時，對 Claude 說「我現在該做什麼」「健檢一下」或
「狀態如何」會觸發 `srs-onboard` skill，它會**只讀不寫**地輸出健檢 /
狀態報告 + 下一步建議。

#### 手動替代方式（不想用 skill 時）

- 複製 `templates/project-CLAUDE.md.tmpl` → `acme-corp-srs/CLAUDE.md`，填入
  專案名稱、子系統、需求清單、術語對照表
- 複製 `templates/notion-mapping.json.tmpl` → `acme-corp-srs/.claude/notion-mapping.json`，
  填入 Notion parent page ID、toggle label、child page title
- 複製 `templates/workflow-state.json` → `acme-corp-srs/.claude/workflow-state.json`

這三個範本都在 plugin 的 `templates/` 目錄。

### 3. 設定 Notion 連線（兩個 MCP，角色不同）

`notion-automation-studio` 目前同時依賴**兩條** Notion MCP 路線，原因是
官方 `@notionhq/notion-mcp-server`（integration token 路線）的 OpenAPI
spec 只支援 `paragraph` + `bulleted_list_item` 兩種寫入 block type，無法
滿足 `srs-publish-notion` 需要 heading / code / table / callout / toggle
等的需求。完整背景見 `docs/srs-publish-notion-refactor.md`。

#### 3-a：notionApi（integration token，setup / check / sync 用）

由 `srs-setup` skill 互動式建立。對 Claude 說「初始化 SRS 專案」會自動
進入 Step 4 引導：

- 建立 Notion internal integration、複製 ntn_ 開頭 token
- 從模板複製 `./.mcp.json` 並 gitignore
- 提示你自己用編輯器把 token 填進 `./.mcp.json`（**不要貼進對話框**）
- 重啟 Claude Code 後 `notionApi ✓ Connected`

完成後可使用：`srs-check`、`srs-sync`、以及 `Notion@claude-plugins-official`
plugin 的 6 個 `/Notion:*` slash command。

#### 3-b：OAuth Notion plugin（publish 才需要）

```
/plugin install Notion
```

來源 `claude-plugins-official`，作者 Notion Labs。安裝後依指引完成 OAuth
登入授權。這一步**只**有在你要使用 `srs-publish-notion` 時才需要——它提供
高階 markdown-aware 的 `notion-fetch` / `notion-update-page` tools，也就是
publish 流程目前依賴的工具。

> **這是已知的暫時雙路線狀態**。長期目標是把 `srs-publish-notion` 改成
> 只用 notionApi 一條路，前置調研見 `docs/srs-publish-notion-refactor.md`。

### 4. 在 Notion 建立沙箱結構（一次性）

在 `notion-mapping.json` 指定的 `parent_page_id` 頁面下：

1. 建立一個 toggle，label 與 `toggle_label` 欄位**完全一致**
2. 在該 toggle 內建立一個 child page，標題與 `child_page_title` 完全一致
3. 在 Claude Code 中說「PUBLISH」，`srs-publish-notion` skill 會進入
   Discovery 模式並自動把 `child_page_id` 回填到 `notion-mapping.json`
4. commit 更新後的 `notion-mapping.json`

### 5. 開始寫需求文件

```bash
# 建立第一份需求
echo "# R0001_我的第一個需求" > {batch}-SRS/src/R0001_我的第一個需求.md
```

進入 Claude Code，說「SRS R0001」，`srs-check` skill 會依據專案 CLAUDE.md
的規範檢核並修正。

## 三、日常四步驟流程

```
1. 編輯   {batch}-SRS/src/R00XX_*.md     ← 日常入口（source of truth）
2. 檢核   「SRS R00XX」                  ← 觸發 srs-check
3. 同步   「SYNC R00XX」                 ← 觸發 srs-sync
4. 發佈   「PUBLISH」                     ← 觸發 srs-publish-notion
```

## 四、注意事項

- **禁止**直接編輯 `{batch}-SRS/output/requirements-{batch}.md`，永遠改
  `src/` 後執行 `SYNC`
- `PUBLISH` 後 `notion-mapping.json` 的 `last_synced_at` 等欄位會更新，
  此 diff 屬正常現象
- **禁止** commit `.claude/settings.local.json`（個人權限快取）
- **禁止** 在專案 repo 裡複製 studio 的 skills 檔案；skills 由 plugin
  提供，專案只需在自己的 `CLAUDE.md` 內放 instance-specific 資料（術語表、
  需求清單等），skill 執行時會同時讀取
- Commit message 使用 Traditional Chinese（zh-TW）Conventional Commits 格式
