# CLAUDE.md

`notion-automation-studio` plugin 的**維護者**指引。本檔僅適用於修改這個
plugin 本身的內容（新增 skill、調整檢核規則、改 agent 等），**不是**使用端
專案的指引。使用端專案請見各自 repo 的 CLAUDE.md。

## 定位

這個 repo 是一個 Claude Code plugin，封裝 SRS 需求文件自動化工具組。
Repo 裡**只**裝 tooling：

```
.claude-plugin/plugin.json       # manifest
skills/                          # 自動啟用的 agent skills
agents/                          # 主動呼叫的 subagents
scripts/                         # helper scripts
templates/                       # 使用端初始化時可複製的範本
docs/                            # 人類讀的文件
```

**絕對不要**在本 repo 新增：
- 任何 `*-SRS/` 批次目錄（那屬於使用端專案）
- `.claude/notion-mapping.json`（instance-specific，永遠 gitignored）
- 任何特定客戶或專案名稱的硬編碼（「台積電」「某某公司」等）

## 工具與資料的分層原則

`srs-check`、`srs-sync` 等 skill 需要依據「術語對照表」「需求清單」等資料
做檢核。這些資料**不**存放在 plugin 本身，而是由使用端專案的 `CLAUDE.md`
提供。Claude Code 在執行時會同時載入 plugin skills 與專案 CLAUDE.md，
skill 取得規則、專案提供資料。

修改 skill 時的分工：

| 放在 skill 裡 | 放在使用端 CLAUDE.md |
|---------------|---------------------|
| 六大章節結構（一、需求說明 / 二、使用情境 / …） | 實際的需求清單（R00XX 列表） |
| 寫作風格原則、文字階層規則 | 專案術語對照表 |
| Notion 相容性規則 | Notion parent/child page ID（在 notion-mapping.json） |
| 各檢核項目的判定邏輯 | 子系統對照、角色定義 |

skill 內若要示範格式，請用明顯 generic 的佔位符（`R0001` / `{術語A}`），
並附一句「實際資料由使用端專案 CLAUDE.md 提供」。**不要**塞入任何
specific 專案的真實資料。

## 設計原則

1. **Notion 相容性優先**：避免 HTML 標籤、巢狀表格、深層巢狀清單
   （H4 以下改 toggle）、避免把關鍵 metadata 藏在 frontmatter。設計時須
   想像內容最終會變成 Notion blocks
2. **單向同步**：markdown 是 source of truth，Notion 是單向鏡像。**禁止**
   從 Notion 反向同步回 markdown
3. **圖片與跨需求引用的 v1 限制**：圖片 publish 不自動上傳（須手動上傳後
   回填 notion-mapping.json）；跨需求引用 `詳見【R00XX】功能名稱` 在
   Notion 為純文字，非 page mention
4. **組合既有 skill 不要重抄**：Notion block 格式細節由 `notion-doc-writing`
   skill 處理，新 skill 應以組合方式重用規則

## Git 慣例

Commit message 使用 Traditional Chinese（zh-TW）Conventional Commits 格式。
Feature branch → commit → push → PR → merge → worktree remove。
