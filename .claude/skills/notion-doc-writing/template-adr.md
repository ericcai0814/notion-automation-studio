# Template: ADR (Architecture Decision Record)

Skeleton for a single architecture decision. One decision per page. Immutable once accepted—新決策另開新 ADR 並用 `Status = Superseded` 標記舊的。

---

## Properties（DB 欄位建議）

| Property | Type | 備註 |
|---|---|---|
| Name | title | `ADR-0042: 改用 X 取代 Y` |
| Number | unique_id | PREFIX `ADR` |
| Status | select | Proposed / In Review / Accepted / Rejected / Superseded |
| Deciders | people | 決策者 |
| Date | date | 決策日期 |
| Supersedes | relation | 被這份取代的舊 ADR |
| Superseded By | relation | 取代這份的新 ADR |
| Tags | multi_select | 技術域 |

## Content Structure

```markdown
<callout icon="📝" color="gray_bg">
	**Status**: Accepted · **Date**: 2026-04-13 · **Deciders**: @A, @B
</callout>

## 脈絡（Context）

（我們目前遇到什麼情境？有什麼限制、需求、外部壓力？這裡要能讓**半年後的人**理解當時為什麼要做這個決策。）

## 決策（Decision）

**我們決定：** （一句話講結論）

**理由：**
- R1 —
- R2 —
- R3 —

## 考慮過的替代方案（Alternatives）

### Alternative A: XXX
- **優點**：
- **缺點**：
- **不選的原因**：

### Alternative B: YYY
- **優點**：
- **缺點**：
- **不選的原因**：

## 後果（Consequences）

**好的方面：**
- +
- +

**壞的方面 / trade-offs：**
- −
- −

**中性影響：**
- ~

## Action Items

- [ ] 建 migration plan
- [ ] 更新相關文件：<mention-page url="..."/>
- [ ] 通知 stakeholders

## 相關 ADRs

- Supersedes: <mention-page url="..."/>
- Related: <mention-page url="..."/>
```
