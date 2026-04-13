# Template: PRD (Product Requirement Doc)

Skeleton for a product / feature requirement doc. Delete sections you don't need. Adapt to workspace conventions if they exist.

---

## Properties（DB 欄位建議）

| Property | Type | 備註 |
|---|---|---|
| Name | title | PRD 標題 |
| Status | status | Draft / In Review / Approved / Shipped / Archived |
| Owner | people | PM 或 feature lead |
| Target Release | date | 預計發布日 |
| Priority | select | P0-P3 |
| Area | select | 功能域 |
| Related Docs | relation | 連到相關 ADR、Research |

## Content Structure

```markdown
<callout icon="🎯" color="blue_bg">
	**TL;DR**（1-2 句）：要解決什麼問題、給誰用、成功指標。
</callout>

## 背景與動機

（為什麼現在做？市場/用戶/技術的觸發點是什麼？）

## 目標（Goals）

- G1 —
- G2 —
- G3 —

## 非目標（Non-Goals）

（明確列出**不做**的事，避免 scope creep）

- N1 —
- N2 —

## 使用者場景

### 主要使用者

（persona 或 role）

### 關鍵流程

1. 使用者 __，為了 __，目前 __
2. 使用者 __，為了 __，期望 __

## 提案的解決方案

（概念描述 + 關鍵截圖/mockup/mermaid）

```mermaid
flowchart LR
    A["使用者"] --> B["核心流程"]
    B --> C["結果"]
```

## 成功指標

| 指標 | 當前 | 目標 | 量測方式 |
|---|---|---|---|
| | | | |

## Alternatives Considered

（至少 1-2 個評估過但未採用的方案 + 為什麼不選）

## Open Questions

- [ ] Q1 —
- [ ] Q2 —

## Acceptance Criteria

- [ ] 條件 1
- [ ] 條件 2
- [ ] 條件 3

## 相關文件

- <mention-page url="..."/>（ADR）
- <mention-page url="..."/>（Research）
```
