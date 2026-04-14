# Template: Post-mortem (Incident)

Skeleton for blameless incident post-mortems. 重點：**blameless**（對事不對人）、**根本原因**（不止於表面症狀）、**可行 action items**（有 owner 有 due date）。

---

## Properties（DB 欄位建議）

| Property | Type | 備註 |
|---|---|---|
| Name | title | `INC-042: 登入 API 全線異常 45 min` |
| Number | unique_id | PREFIX `INC` |
| Severity | select | SEV1 / SEV2 / SEV3 / SEV4 |
| Status | select | Active / Investigating / Mitigating / Post-mortem / Resolved |
| Date | date | 事件開始日期 |
| Duration | number | 影響時長（分鐘） |
| Impact | rich_text | 影響範圍簡述 |
| Owner | people | Incident Commander |
| Root Cause Category | select | Bug / Config / Infra / Dependency / Human / Unknown |
| Related Services | multi_select | 受影響服務 |

## Content Structure

```markdown
<callout icon="🚨" color="red_bg">
	**SEV1** · **2026-04-13 14:23 – 15:08**（45 min）· **Incident Commander**: @Owner
</callout>

## 事件摘要（TL;DR）

（2-3 句：發生什麼、影響多少使用者、怎麼緩解、根本原因類別。給沒時間讀全文的人。）

## 影響

| 項目 | 數值 |
|---|---|
| 受影響使用者 | |
| 影響時長 | |
| 受影響服務 | |
| 業務影響 | |
| 資料遺失 | 無 / 有（詳情） |

## 時間軸（Timeline, UTC+8）

| 時間 | 事件 |
|---|---|
| 14:23 | 第一個警報觸發：`api-login p99 > 5s` |
| 14:25 | Oncall @A 接手，開始調查 |
| 14:31 | 確認影響範圍為所有登入請求 |
| 14:35 | 宣告 SEV1，召集 incident channel |
| 14:42 | 初步判斷為 DB 連線池耗盡 |
| 14:55 | Rollback 到前一個版本 |
| 15:08 | 監控恢復正常，事件結束 |

## 根本原因（5 Whys）

1. **為什麼登入 API 全掛？** 
2. **為什麼 DB 連線池耗盡？** 
3. **為什麼 leak 沒被測試抓到？** 
4. **為什麼 canary 沒發現？** 
5. **為什麼... ？** 

**真正的根本原因：** 

## 怎麼被偵測到？

（自動監控抓到 / 使用者回報 / 內部同事發現？detection time 有多久？是否可改善？）

## 怎麼被緩解？

（採取什麼行動讓事件停止？rollback? feature flag? infra scale?）

## What Went Well

- 
- 
- 

## What Went Wrong

- 
- 
- 

## Where We Got Lucky

（哪些地方是運氣好才沒更糟？下次不一定這麼好運）

- 

## Action Items

> 每一項都必須有 **Owner + Due Date + Priority**，並建成實際 task 追蹤。

| # | Action | Owner | Priority | Due | Status |
|---|---|---|---|---|---|
| 1 | | @ | P0 | | |
| 2 | | @ | P1 | | |
| 3 | | @ | P1 | | |

## 相關資料

- Incident channel log: <mention-page url="..."/>
- Monitoring dashboard 快照：<mention-page url="..."/>
- 相關 ADR / PR: <mention-page url="..."/>
```
