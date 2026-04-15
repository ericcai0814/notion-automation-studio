# Known Issues（已知問題目錄）

這份文件是 `notion-automation-studio` plugin 所有**已知踩坑**的 single source
of truth。使用者遇到 plugin 行為怪異時先翻一下這裡；`srs-onboard` skill 的
Mode 2 健檢（H13）會在健檢失敗時自動對照這份清單，主動提示可能的已知問題。

## 誰維護這份文件

- **使用者**：遇到問題不會改這份檔案，改用 `report-issue` skill 產生 GitHub
  issue 送出，maintainer 收到後判斷是否寫入此處
- **Maintainer**：透過 `distill-known-issue` skill 半自動把已解決或已確認的
  GitHub issue 歸納成一條 KI 條目。skill 會自動分配 `KI-NNNN` ID、帶出草稿、
  請 maintainer 明確確認後才 append 到檔案尾端
- **絕不**由 webhook、cron、git hook、PostToolUse hook 等機制無人 review
  自動寫入——每條 KI 都必須經過人類最後拍板

---

## Schema（每條 KI 條目的七欄位）

每條已知問題使用**二級標題 + 七欄位**格式：

```markdown
## KI-NNNN: <症狀一句話摘要>

- **Symptom**: <這個問題在使用者視角長什麼樣子；可重現的觸發條件>
- **Affected skill**: <受影響的一個或多個 skill 名稱，以逗號分隔>
- **Cause**: <根本原因的技術解釋>
- **Resolution**: <解法或 workaround；若是永久修復請註明 plugin 版本>
- **Related issue**: <GitHub issue URL 或 #N；若來自多個 issue 則列出全部>
- **Added date**: <YYYY-MM-DD，首次加入本文件的日期>
- **Health check trigger**: <`H1`-`H12` 單一識別子、逗號分隔多項、或字面值 `none`>
```

### 欄位規則

| 欄位 | 必填 | 規則 |
|------|------|------|
| `Symptom` | 是 | 使用者視角的症狀描述。禁止塞技術細節（那是 `Cause`） |
| `Affected skill` | 是 | 至少一個 skill 名稱。若影響整個 plugin 可寫 `plugin-wide` |
| `Cause` | 是 | 技術上的根因。若未知寫 `unknown`（將來補回） |
| `Resolution` | 是 | 使用者能直接 follow 的步驟；若只有 workaround 請明示「目前僅 workaround，永久修復追蹤 #N」 |
| `Related issue` | 是 | 至少一個 issue link 或 `#N`；若是內部發現無對應 issue 寫 `internal` |
| `Added date` | 是 | ISO date（`YYYY-MM-DD`） |
| `Health check trigger` | 是 | 合法值僅三種：`H1`-`H12` 單項、逗號分隔多項（如 `H5, H7`）、字面值 `none` |

### `Health check trigger` 欄位語意

這個欄位是 `srs-onboard` skill Mode 2 的 H13 cross-reference lookup 的**硬錨
點**。它告訴 H13：「當某個 H1-H12 健檢項失敗時，這條 KI 是潛在 suspect」。

- `H5` — 這條 KI 只在 H5（`*-SRS/` 目錄偵測）失敗時浮現
- `H5, H7` — 這條 KI 可能在 H5 或 H7（`notion-mapping.json` 偵測）失敗時都相關
- `none` — 這條 KI 不綁任何健檢項（例如只在使用者手動觸發特定操作時才踩到）

**非法值**（例如 `H99`、`bug`、空字串）由 H13 以 "skip that entry" 處理，**不會**
crash Mode 2 報告。但這是 best-effort fallback——maintainer 加新 KI 時 distill
skill 會在 interactive 五問的 Q5 強制驗證答案合法。

### ID 分配規則

- **格式**：`KI-` + 四位零填零整數，例如 `KI-0001`、`KI-0042`、`KI-1234`
- **單調遞增**：新條目 ID = 現有最大 ID + 1，`grep -oE '^## KI-[0-9]{4}'` 取最大值
- **不回收已刪除 ID**：即便 `KI-0002` 被刪，新條目仍分配 `KI-0004` 而非 `KI-0002`。
  這讓外部（issue tracker、commit message、討論串）引用的歷史 ID 永遠不會被二次使用
- **空檔案**：若檔案不含任何符合 `^## KI-[0-9]{4}` 的條目，新條目從 `KI-0001` 開始
- **自動分配**：實際分配由 `distill-known-issue` skill 執行，maintainer 不需手動算
- **v1 已知限制**：單 maintainer 場景。多 maintainer 同時 distill 可能撞 ID，v1 不處理

---

## ⚠ 為何此段沒有「真實」範例

本文件**刻意**不放任何符合 `^## KI-[0-9]{4}` 的範例條目。這是因為
`distill-known-issue` skill 的 ID 分配透過 grep 該 pattern 找最大值，若範例使用
`## KI-0001` 會讓未來第一條真實條目被錯配成 `KI-0002`。

若你是第一個 maintainer 要加入 KI，當前檔案無真實條目，skill 會分配 `KI-0001`。

下面提供一個**非數字識別子**範例供格式參考（不會被 ID 分配 grep 誤抓）：

<!--
======================================================================
格式範例（HTML comment 內，不渲染、不會被 grep 抓到）：

## KI-EXAMPLE: 批次目錄名稱含空格時 srs-onboard 無法 glob

- **Symptom**: 執行 srs-onboard Mode 2 健檢時，H5 項目回報找不到任何
  `*-SRS/` 目錄，但 `ls` 明明能看到 `3-B SRS/`
- **Affected skill**: srs-onboard, srs-check, srs-sync
- **Cause**: Node 的 Glob library 對含空白字元的 directory name 匹配行為
  不穩定，不同版本結果不一致
- **Resolution**: 將批次目錄重新命名為連字號格式，例如把 `3-B SRS/` 改為
  `3-B-SRS/`；plugin v0.2.0 起 `srs-new-batch` 預設產生連字號格式
- **Related issue**: #12
- **Added date**: 2026-04-15
- **Health check trigger**: H5
======================================================================
-->

## KI-EXAMPLE: 格式範例（非真實條目，ID 非數字故不影響 grep 分配）

- **Symptom**: 這是格式示範，說明一條 KI 條目實際長什麼樣子
- **Affected skill**: `plugin-wide`
- **Cause**: N/A — 範例條目
- **Resolution**: N/A — 範例條目；實際 KI 條目的 Resolution 欄應給出具體步驟
- **Related issue**: internal
- **Added date**: 2026-04-15
- **Health check trigger**: none

---

## 已知問題列表

<!--
以下空白區域是實際 KI 條目 append 進來的位置。
distill-known-issue skill 會把新條目寫到這個區域的最尾端（保留既有條目 byte-for-byte）。

第一條真實條目會從 KI-0001 開始。
-->

（尚無已知問題。若你遇到問題，請使用 `report-issue` skill 回報給 maintainer。）
