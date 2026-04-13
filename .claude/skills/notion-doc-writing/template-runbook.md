# Template: Runbook

Skeleton for operational runbooks. 目標：**凌晨 3 點被叫起來的人**能照著做、不用問問題、不用讀程式碼。

**原則**：
- 每個步驟**可執行、可驗證**（不要只寫「檢查 xxx」，要寫「跑 `foo status` 看到 `OK`」）
- 先 **diagnose** 再 **act**——不要讓 oncall 盲目操作
- 標示**不可逆**操作（⚠️）
- 留 **rollback** 步驟

---

## Properties（DB 欄位建議）

| Property | Type | 備註 |
|---|---|---|
| Name | title | `Runbook: X 服務啟動失敗` |
| Service | relation | 對應服務 |
| Severity Trigger | select | SEV1 / SEV2 / SEV3 |
| Alert | rich_text | 觸發此 runbook 的警報名稱 |
| Last Verified | date | 最近一次走過確認有效 |
| Owner | people | 維護者 |
| Related Incidents | relation | 用過這份 runbook 的事件 |

## Content Structure

```markdown
<callout icon="📘" color="blue_bg">
	**何時用**：警報 `xxx` 觸發 OR 使用者回報 xxx 症狀
	**預期時長**：10-20 min
	**Last Verified**: 2026-04-13 by @Owner
</callout>

## 症狀（Symptoms）

- [ ] 症狀 A：...
- [ ] 症狀 B：...
- [ ] 症狀 C：...

（以上都中才執行此 runbook；只中一個可能是別的問題——跳到「相關 runbook」）

## 前置條件

- 有 `xxx` 權限
- 能 SSH 到 `yyy`
- 準備好 rollback credential

## 診斷（Diagnose First）

### Step 1: 確認服務狀態

```bash
foo status
```
**預期**：`OK`
**異常**：出現 `ERROR` → 進 Step 2

### Step 2: 檢查 log

```bash
foo logs --tail 100 | grep -i error
```
**常見模式**：
| log 內容 | 原因 | 跳到 |
|---|---|---|
| `connection refused` | 後端服務掛 | Action A |
| `out of memory` | 記憶體不足 | Action B |
| `timeout` | 網路問題 | Action C |

### Step 3: 檢查 dashboard

<mention-page url="..."/>（監控儀表板連結）

確認：
- [ ] CPU < 80%
- [ ] Memory < 80%
- [ ] Error rate < 1%

## 行動（Action）

### Action A: 重啟後端依賴

```bash
sudo systemctl restart backend
foo health
```
**驗證**：`foo health` 回 `healthy`
**若失敗**：跳 Action D

### Action B: 重啟並擴容

<callout icon="⚠️" color="yellow_bg">
	重啟會造成 30 秒的 downtime。先在 incident channel 廣播。
</callout>

```bash
kubectl scale deployment/foo --replicas=6
kubectl rollout restart deployment/foo
```

### Action C: 切流量

<callout icon="⚠️" color="red_bg">
	**不可逆**：切完流量要手動切回
</callout>

```bash
foo-cli traffic --shift secondary 100
```
**驗證**：
```bash
foo-cli traffic --status
```

### Action D: 升級到下一級（Escalate）

如果 Action A-C 都無效：
1. 聯絡 @service-owner
2. 建 incident: <mention-page url="..."/>
3. 在 #incidents channel 廣播

## Rollback

如果上面動作造成更糟的狀況：

```bash
foo-cli traffic --shift primary 100  # 切回主流量
kubectl rollout undo deployment/foo  # 復原部署
```

## 驗證恢復

- [ ] `foo status` 回 `OK`
- [ ] Dashboard error rate < 0.1% 持續 5 分鐘
- [ ] 手動測試：`curl https://... | grep OK`

## 結束

- [ ] 在 incident channel 報告恢復時間
- [ ] 建事故 post-mortem（若 SEV1/2）：使用 `template-postmortem.md`
- [ ] 更新此 runbook 的 `Last Verified`

## 相關 Runbook

- <mention-page url="..."/>（上游依賴 runbook）
- <mention-page url="..."/>（類似症狀 runbook）
```
