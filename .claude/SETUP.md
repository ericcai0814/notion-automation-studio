# SETUP

台積電宿舍管理系統 SRS 文件庫 — 團隊成員環境建置指引。

本專案為**純文件專案**，workflow 由 Claude Code 搭配 `.claude/` 內的
skill / agent 驅動。Clone 下來之後，三步驟即可開始編輯並發佈到 Notion。

---

## 一、環境建置（3 步驟）

### 1. 安裝 Claude Code

依官方文件安裝，確認 `claude` 指令可用。

### 2. 安裝 Notion MCP plugin 並 authenticate

在 Claude Code 中執行：

```
/plugin install Notion
```

依指引登入團隊共用的 Notion workspace（`ewill-software`）。這一步是
發佈 SRS 到 Notion 的必要依賴。

### 3. Clone repo 並進入目錄

```bash
git clone <repo-url> notion-mcp-studio
cd notion-mcp-studio
claude
```

**完成**。Notion 沙箱目標、parent / child page ID、toggle 等配置都已
寫在 `.claude/notion-mapping.json` 並隨 repo 過來，**不需要編輯任何
JSON，也不需要在 Notion 手動建結構**。

---

## 二、日常使用 — 四步驟流程

```
1. 編輯   3-B-SRS/src/R00XX_*.md   ← 日常入口（source of truth）
2. 檢核   在 Claude Code 中說「SRS R00XX」    ← 觸發 srs-check
3. 同步   在 Claude Code 中說「SYNC R00XX」   ← 觸發 srs-sync
4. 發佈   在 Claude Code 中說「PUBLISH」       ← 觸發 srs-publish-notion
```

**新成員可直接說「我是新來的」**，`srs-onboard` skill 會帶你逛一遍專案。
所有觸發詞、術語規範與寫作風格詳見 `.claude/CLAUDE.md`。

---

## 三、注意事項

- **禁止**直接編輯 `3-B-SRS/output/requirements-3-B.md`，永遠改
  `src/` 後執行 `SYNC`。
- `PUBLISH` 後 `.claude/notion-mapping.json` 的 `last_synced_at` 等欄位
  會更新，此 diff 屬正常現象，照常 commit。
- **禁止** commit `.claude/settings.local.json`（個人權限快取，已在 `.gitignore`）。
- Commit message 使用 Traditional Chinese（zh-TW）Conventional Commits 格式。

---

## 附錄：初次 Bootstrap（一次性，僅維護者需要）

若 `.claude/notion-mapping.json` 的 `sandbox.child_page_id` 仍為 `null`，
代表 Notion 端的沙箱結構尚未建立。此情況**僅在專案歷史上發生一次**，
由維護者執行：

1. 在 Notion 父頁面下建立 toggle，label `《需求分析》`（名稱須完全一致，含書名號《》）
2. 在該 toggle 內新增 child page，標題 `需求說明文件3-B`
3. 執行 `PUBLISH`，`srs-publish-notion` skill 會自動進入 Discovery 模式並
   回填 `child_page_id` 到 `.claude/notion-mapping.json`
4. Commit 更新後的 `.claude/notion-mapping.json`

完成後所有成員 clone 都是開箱即用狀態，永遠不需要再跑這段。
