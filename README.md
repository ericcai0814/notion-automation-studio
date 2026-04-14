# notion-automation-studio

SRS 需求文件自動化工作室，封裝為 Claude Code plugin。包含檢核、整合、
發佈到 Notion 的 skills、agents 與 helper scripts，讓任何以 zh-TW
Markdown 撰寫 SRS 的專案都能快速接上。

**這個 repo 只裝工具**。專案內容（需求文件、assets、notion-mapping）永遠
活在使用端的 repo 裡，studio 本體絕不持有任何 instance 資料。

## 內容物

```
.claude-plugin/plugin.json      # Plugin manifest
skills/
├── srs-check/                  # 10 項 SRS 需求文件合規檢核
├── srs-sync/                   # 獨立需求檔 ↔ 整合版同步
├── srs-publish-notion/         # 發佈到 Notion workspace sandbox
├── srs-new-batch/              # 新 batch scaffolding
└── notion-doc-writing/         # 通用 Notion markdown 撰寫規則
agents/
└── srs-reviewer.md             # 批次平行審查 agent
scripts/
├── merge-srs.js                # 獨立 md → 整合版 merge 工具
├── scaffold-batch.js           # 建立新 batch 目錄骨架
└── validate-structure.js       # 驗證目錄結構
templates/                      # 使用端專案初始化時可複製的範本
docs/
└── INSTALL.md                  # 安裝與使用指引
```

## 安裝

```
/plugin install notion-automation-studio
```

完整安裝與首次使用流程見 [docs/INSTALL.md](docs/INSTALL.md)。

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
