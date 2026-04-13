# CLAUDE.md

台積電宿舍管理系統 SRS 文件庫協作指引。本專案為純文件專案，以 zh-TW
Markdown 撰寫，最終透過 Notion MCP 發佈到 Notion workspace 供客戶審閱。

## 子系統對照

| 子系統 | 使用對象 |
|--------|----------|
| 宿舍管理後台 | 管理員、承辦人員 |
| 清潔派工系統 | 櫃檯人員、駐廠人員、清潔人員 |
| 宿舍管家系統 | 台積電員工（住戶） |
| 宿舍預約系統 | 台積電員工、排房人員 |

## 目錄結構

```
{batch}-SRS/                  # 例如目前的 3-B-SRS/、未來可能的 4-A-SRS/
├── output/                  # 整合版需求文件 requirements-{batch}.md（merge-srs.js 產出）
├── src/                     # 各需求獨立 .md（日常編輯入口，source of truth）
└── assets/{R00XX}/          # 圖片附件，依需求編號分群
```

**鐵則**：
- 日常編輯**只**改 `src/`，再透過 `srs-sync` 同步到 `output/`
- **禁止**直接編輯 `output/requirements-{batch}.md`
- **禁止**在總整文件上做反向同步

## 需求清單

| 編號 | 功能名稱 |
|------|----------|
| R0044 | 點檢作業功能 |
| R0050 | 報修作業功能 |
| R0051 | 扣款參數維護 |
| R0052 | 扣款項目計算 |
| R0053 | 備品參數維護 |
| R0054 | 備品管理功能 |
| R0056 | 寢具送洗管理功能 |
| R0058 | 單身有眷申請 |
| R0060 | 宿舍管家系統登入 QRcode 製作需求 |

## 章節結構（六大章節，固定順序）

每份需求文件依下列順序撰寫：

1. 一、需求說明 — 功能目的與業務背景
2. 二、使用情境 — 角色操作場景
3. 三、功能需求 — 系統須實作之具體功能
4. 四、非功能需求 — 效能、安全、相容性
5. 五、驗收條件 — 可量化判定標準（`AC-01`、`AC-02` 編號）
6. 六、待釐清項目 — 無則填「（無）」

## 內容歸屬速記（最高頻檢核點）

**主詞是「人」→ 二、使用情境；主詞是「系統」→ 三、功能需求。**

| 內容性質 | 歸屬章節 |
|----------|----------|
| 功能目的、業務脈絡（為什麼需要） | 一、需求說明 |
| 角色＋動作＋順序 | 二、使用情境 |
| 系統行為與規格 | 三、功能需求 |

不可在同一條目混寫使用流程與系統規格。

## 文字階層

| 層級 | 格式 | 用途 |
|------|------|------|
| 第一層 | 一、二、 | 大區塊 |
| 第二層 | 1. 2. | 條列功能 |
| 第三層 | i. ii. | 補充條件 |
| 第四層 | - | 細節 |

- 同層不混用格式；建議最多三層
- Notion 端：超過 H4 會被降級，第四層以下請改用 toggle

## 術語對照表（強制一致）

| 統一用詞 | 禁止混用 |
|----------|----------|
| 台積電員工（住戶） | 使用者、房客、租戶 |
| 櫃檯人員 | 櫃台人員、前台人員 |
| 駐廠人員 | 現場人員 |
| 承辦人員 | 承辦、管理者 |
| 排房人員 | 配房人員 |
| 清潔人員 | 打掃人員、清潔工 |
| 報修 | 維修申請、修繕申請 |
| 點檢 | 檢查、巡檢 |
| 派工 | 指派、發包 |
| 排房 | 配房、分房 |
| 備品 | 耗材、物資 |

## 寫作風格

1. **主詞明確**：每條需求清楚標示動作主體（「系統須…」「員工可…」）
2. **條件與例外逐條列出**，禁止用「等」「其他情況類推」
3. **雙向可追溯**：每條功能需求對應至「五、驗收條件」中至少一項
4. **避免實作細節**：描述「做什麼」而非「如何做」
5. **語氣**：專業、客觀、精確的書面語

## 跨需求引用

- 格式：`詳見【R00XX】功能名稱`
- 共用流程須指定主要定義處，其餘以引用方式帶出
- **注意**：Notion 沒有 markdown anchor 機制，publish 後為純文字，非可點擊連結

## 圖片與驗收條件

- 圖片路徑：`../assets/{R00XX}/{描述}.png`，須附說明文字
- 檔名格式：`{需求編號}_{描述}.png`
- 驗收條件：`AC-01` 編號，包含「前置條件 → 操作步驟 → 預期結果」

---

## 自動化工作流

### 常用指令對照

| 動作 | 觸發方式 | Skill / Agent |
|------|----------|---------------|
| **新成員導覽** | 「我是新來的」「這個專案怎麼用」「怎麼開始」 | `srs-onboard` skill |
| 審查單一需求並修正 | `SRS R00XX`、`審查 R00XX`、`/srs-check` | `srs-check` skill |
| 同步到總整 | `SYNC R00XX`、`/srs-sync` | `srs-sync` skill |
| 全量同步 | `SYNC ALL`、`/srs-sync-all` | `srs-sync` skill（ALL mode） |
| 平行批次審查 | 「審查所有需求」「batch review」 | `srs-reviewer` agent |
| 發佈至 Notion 沙箱 | `PUBLISH`、`發佈到 Notion` | `srs-publish-notion` skill |

### 預期的完整流程序列

```
編輯 src/R00XX_*.md
    ↓
srs-check R00XX            ← 10 項檢核並直接修正
    ↓
srs-sync R00XX             ← 同步至 output/
    ↓
srs-publish-notion         ← 發佈至 Notion 沙箱 toggle
```

**沙箱階段不做自動 orchestration**，三個步驟手動執行以利 debug 與驗證。
每個 skill 的詳細流程定義於 `.claude/skills/<name>/SKILL.md`。

### Notion 發佈 pipeline 重點

1. **目標**：父頁面 → 《需求分析》toggle → 需求說明文件3-B child page
2. **v1 限制**：圖片不自動上傳、跨需求引用為純文字、全量覆寫（無評論保留需求）
3. **Mapping 檔**：`.claude/notion-mapping.json` 已 commit 於 repo，
   含共用沙箱的 parent / child page ID 與圖片對應關係，成員 clone 後即就緒
4. **規則層組合**：`srs-publish-notion` skill 會載入 `notion-doc-writing`
   skill 的格式規則（title 位置、heading 深度、多行 quote、size limits 等）

詳細流程見 `.claude/skills/srs-publish-notion/SKILL.md`。

---

## 版本管理

- 總整文件「壹、版本說明」章節由 `srs-sync` skill 自動維護
- 各獨立需求文件修改後須透過 `srs-sync` 同步至總整文件

---

## 設計原則：新增 Skill / Agent 時須遵守

Notion 是 SRS 需求文件最終發佈目的地，markdown 只是中介格式。撰寫或修改
任何 SRS 相關 skill / agent / workflow 時，下列原則優先於一般 md 考量：

1. **Notion 相容性優先**：避免 HTML 標籤、巢狀表格、深層巢狀清單
   （H4 以下改 toggle）、避免把關鍵 metadata 藏在 frontmatter。
   設計時須想像內容最終會變成 Notion blocks。
2. **單向同步原則**：markdown 是 source of truth，Notion 是單向鏡像。
   禁止從 Notion 反向同步回 markdown。
3. **圖片與跨需求引用的 v1 限制**：
   - 圖片 publish 不自動上傳，須手動上傳後回填 `notion-mapping.json`
   - 跨需求引用 `詳見【R00XX】功能名稱` 在 Notion 為純文字，非 page mention
4. **組合既有 skill 不要重抄**：Notion block 格式細節已由 `notion-doc-writing`
   skill 處理，新 skill 應以組合方式重用規則。
