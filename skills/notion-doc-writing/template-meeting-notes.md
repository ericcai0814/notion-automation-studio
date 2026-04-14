# Template: Meeting Notes

Skeleton for meeting records. **優先考慮** Notion 的 `<meeting-notes>` 進階 block type，內建 AI summary + transcript。這份 template 是「傳統手打會議記錄」版本，適用於沒錄音或不想用 meeting-notes block 的情境。

如果要用內建 block：
```
<meeting-notes>
	會議標題
	<notes>
		（你的筆記）
	</notes>
</meeting-notes>
```
（建立時 **省略** `<summary>` 和 `<transcript>`）

---

## Properties（DB 欄位建議）

| Property | Type | 備註 |
|---|---|---|
| Name | title | `2026-04-13 · Q2 規劃會議` |
| Date | date | 會議日期（is_datetime=1 帶時間） |
| Attendees | people | 實際出席者 |
| Type | select | 1:1 / Team / Cross-team / Client / All-hands |
| Project | relation | 關聯專案 |
| Follow-ups | relation | 衍生 tasks |

## Content Structure

```markdown
<callout icon="📅" color="gray_bg">
	**時間**：2026-04-13 14:00-15:00 · **地點**：Meet · **主持**：@Owner
</callout>

## 目標

（這場會議要達成什麼？不只是「同步」——具體的決策或交付。）

## 議程

1. 議題 A — 10 min
2. 議題 B — 20 min
3. 議題 C — 15 min
4. Action item review — 5 min

## 討論要點

### 議題 A: ...

- 要點 1
- 要點 2
- @人員 提出 ...
- **決議**：...

### 議題 B: ...

- 要點 1
- **決議**：...

## 決議摘要

| # | 決議 | 負責人 | 期限 |
|---|---|---|---|
| 1 | | @ | |
| 2 | | @ | |

## Action Items

- [ ] @Owner — 動作 1 —— Due 2026-04-20
- [ ] @Owner — 動作 2 —— Due 2026-04-25
- [ ] @Owner — 動作 3 —— Due 2026-04-30

## 未決議（Parking Lot）

（討論到但沒結論的，放這裡下次繼續）

- Q1 —
- Q2 —

## 下次會議

（時間 / 議題預告）
```
