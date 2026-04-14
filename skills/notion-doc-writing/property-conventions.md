# Property Conventions (Defaults)

**這不是鐵律，是 greenfield 情境下的預設值。** 如果 workspace 已有既定慣例，**跟著既有走**，不要套這份覆寫。在新建 DB 或沒有歷史包袱時才參考。

## 命名原則

### Title 欄
- 名稱用 `Name` 或領域詞（`Task`、`Page`、`Decision`），**不要**叫 `Title`（多餘）
- 值要足以在 search 中一眼辨識：「登入頁 loading bug」優於「bug」

### 屬性命名
- 英文 Title Case 或全中文，**不要**混（`建立時間 Created` 這種超醜）
- 多字詞用空格，不用底線或 camelCase（Notion UI 會醜）
- 縮寫盡量展開：`Priority` 優於 `Pri`
- **避免**用 `id`、`url` 當欄名（需要 `userDefined:` 前綴，寫入時容易錯）。用 `Link`、`External ID`、`Reference` 代替

## 常用 Status lifecycle 預設

### 一般 task / work item
```
📥 Inbox → 🔨 In Progress → 👀 Review → ✅ Done → 🗄️ Archived
```
（`📥` 是「未分類進來的」；`🗄️` 用於明確保留但已停止的）

### 事故 / incident
```
🚨 Active → 🔍 Investigating → 🛠 Mitigating → 📝 Post-mortem → ✅ Resolved
```

### ADR / decision
```
📝 Proposed → 💬 In Review → ✅ Accepted → 🚫 Rejected → 📦 Superseded
```

### 文件 / content
```
✏️ Draft → 👀 Review → 🚀 Published → 🔄 Needs Update → 🗄️ Archived
```

> 遇到既有 workspace 有不同 lifecycle 的，優先採用既有。不要為了用這份的預設去改既有 DB。

## Priority 預設

### Select `Priority`（P0-P3）
- `P0 🔴` — 必須立即處理，阻塞其他工作
- `P1 🟠` — 本 sprint 內必須解決
- `P2 🟡` — 有時間窗，不緊急但重要
- `P3 🟢` — 有空才處理，可能直接 drop

**不建議**用 `High / Medium / Low`——過於主觀、無法體現 blocking 語意。

## 常見欄位標準格式

| 用途 | 型別 | 名稱 | 備註 |
|---|---|---|---|
| 負責人 | `people` | `Owner` 或 `Assignee` | **絕對**不要用 `rich_text` 存人名 |
| 建立時間 | `created_time` | `Created` | 自動，不用手動填 |
| 更新時間 | `last_edited_time` | `Updated` | 自動 |
| 建立者 | `created_by` | `Created By` | 自動 |
| 截止日 | `date` | `Due` | 不要叫 `Due Date`（Due 已足夠） |
| 完成日 | `date` | `Completed` | |
| 開始日 | `date` | `Start` | |
| 結束日 | `date` | `End` | |
| 分類（封閉集合） | `select` | `Category` 或 `Type` | 選項數 ≤ 10 |
| 標籤（開放集合） | `multi_select` | `Tags` | 選項可自由增加 |
| 狀態 | `status` 或 `select` | `Status` | 用 `status` type 有內建 group 功能 |
| 外部連結 | `url` | `Link` | 不叫 `URL`（會需要 userDefined 前綴） |
| 關聯 | `relation` | 領域詞（`Related Docs`, `Blocked By`） | 避免只叫 `Relation` |
| 工時估算 | `number` FORMAT `number` | `Estimate (h)` | |
| 金額 | `number` FORMAT `dollar`/`euro` | `Cost` | |

## 欄位順序原則

Notion DB 的 property 順序影響 table view 預設顯示。建議：
1. **Title**（永遠第一）
2. **Status** / 關鍵狀態
3. **Owner** / **Assignee**
4. **Due** / **Created**
5. **Priority**
6. **Category** / **Tags**
7. 其他次要欄位
8. **Relations** / **Rollups**
9. **自動欄位**（Created By / Updated / Unique ID）

## Unique ID 前綴預設

用 `UNIQUE_ID PREFIX 'XXX'` 時，3 字母縮寫最實用：
- `TSK` — Tasks
- `BUG` — Bugs
- `ADR` — Decisions
- `DOC` — Documents
- `INC` — Incidents
- `RFC` — RFCs
- `PRJ` — Projects
- `OKR` — Objectives

## Relation 設計原則

- **Dual relation**（雙向）預設用在真的兩邊都需要導航的場景（task ↔ project）
- **Single relation**（單向）用在引用不需反向查的場景（task → created-from-template）
- 雙向 relation 命名：從 A 看 B 的欄名要從 **A 的語境**取，從 B 看 A 的要從 **B 的語境**取。例如 Tasks 裡叫 `Project`、Projects 裡叫 `Tasks`
- 自我 relation（parent/child 樹）：先建 DB、再 `notion-update-data-source` 加 relation，因為需要自己的 data_source_id

## Rollup 設計原則

- Rollup 用 `count` / `sum` / `average` / `min` / `max` / `latest_date` 等
- 避免 rollup 上堆 rollup（計算成本大、UI 慢）
- Rollup 名稱帶動作詞：`Task Count`、`Total Cost`、`Latest Updated`

## 絕對避免

- **Rich text 存結構化資料**：人名、日期、狀態、分類——都應該用對應的 property type
- **Select 選項超過 20 個**：該改 multi_select 或拆兩個 select
- **Multi_select 超過 100 個**：Notion 硬上限；之前該考慮 relation 到另一個 DB
- **DB 欄位數 > 25**：大部分 view 顯示不下，考慮拆 DB 或用 relation 分離

## 若已有 workspace 慣例

**覆寫順序**：workspace 既有 > team 慣例 > 這份預設。

實務做法：
1. 建 DB 前先 `notion-search` 找相似 DB 是否存在
2. Fetch 一兩個既有 DB 看 schema pattern
3. 跟著既有命名風格、status 命名、icon 風格
4. 不確定時**問使用者**，不要套這份預設當作權威
