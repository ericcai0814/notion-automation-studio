---
name: srs-onboard
description: >
  台積電宿舍管理 SRS 專案的人類讀者導覽。
  當新成員加入專案、或有人問「這個專案怎麼用」「自動化流程是什麼」
  「我是新來的」「怎麼開始」「SRS 怎麼編輯」「publish 到 Notion 怎麼做」
  「這個 skill 怎麼運作」「流程壞掉怎麼辦」時觸發。
  這不是給 Claude 的指令集，是給人類的快速上手文件。
---

# SRS 專案快速上手指南

歡迎加入台積電宿舍管理系統 SRS 文件專案。這份文件是**給人類讀的**，
讀完大概需要 5 分鐘，之後你就能開始日常編輯與 publish 循環。

---

## 30 秒 TL;DR

1. 這是一個 **純文件專案**，沒有程式碼
2. 你在 `{batch}-SRS/src/` 編輯 markdown 需求文件
3. Claude Code 會自動幫你做三件事：**檢核格式** → **同步到總整** → **發佈到 Notion**
4. 你不需要記住流程細節 — 跟 Claude 說「審查 R0044」「同步」「發佈到 Notion」即可
5. Notion 最終會出現在 `《需求分析》` toggle 內的「需求說明文件3-B」

---

## 這個專案在做什麼

台積電宿舍管理系統有 4 個子系統（後台、清潔派工、管家、預約），
我們負責撰寫**軟體需求規格書（SRS）** 供客戶審閱與開發團隊實作。

scope 是第三批第 B 組（簡稱「3-B」），共 9 個需求：

| 編號 | 功能 |
|------|------|
| R0044 | 點檢作業 |
| R0050 | 報修作業 |
| R0051 | 扣款參數維護 |
| R0052 | 扣款項目計算 |
| R0053 | 備品參數維護 |
| R0054 | 備品管理 |
| R0056 | 寢具送洗管理 |
| R0058 | 單身有眷申請 |
| R0060 | 管家系統登入 QRcode |

## 三個基本概念先建立

### 概念 1：三份檔案代表同一份需求

同一個需求 R0044 有三個存在形式，不要搞混：

```
{batch}-SRS/
├── src/R0044_點檢作業功能.md   ← 你編輯這個（source of truth）
├── output/requirements-{batch}.md           ← 自動產出（合併版，給客戶看的 md）
└── [Notion page「需求說明文件3-B」]    ← 自動發佈（給客戶在 Notion 看的）
```

**鐵則：只編輯 src/，其他兩個讓 Claude 幫你同步。**

反向編輯（改 output 或 Notion）會造成衝突，目前沒有雙向同步機制。

### 概念 2：六大章節是強制的

每份需求文件一定有六章：

1. 一、需求說明
2. 二、使用情境
3. 三、功能需求
4. 四、非功能需求
5. 五、驗收條件
6. 六、待釐清項目

你不用背 — Claude 檢核時會自動補缺漏。

### 概念 3：主詞速記（全專案最重要的一條規則）

```
主詞是「人」    → 二、使用情境
主詞是「系統」  → 三、功能需求
```

例如：
- 「清潔人員完成點檢後按送出」→ 人，放使用情境
- 「系統須支援離線點檢」→ 系統，放功能需求

混寫是最常見的錯誤，Claude 會自動拆開。

---

## 首次設定（Bootstrap，只做一次）

### Step 1：Notion 準備

1. 打開父頁面
   `https://www.notion.so/ewill-software/20cd6e303b5c80c4a9f5c041bfdca150`
2. 手動建立一個 toggle heading，標題 **`《需求分析》`**
3. 在該 toggle 內建立一個 child page，標題 **`需求說明文件3-B`**
4. **什麼內容都不用填**，Claude 會覆蓋進去

> **為什麼要手動建？** Notion API 不支援把 page 直接 parent 到 toggle block，所以這一步必須人工。未來 publish skill 只管理這個 child page 的內容，不碰 toggle 本身。

### Step 2：告訴 Claude 做首次 publish

在專案目錄下開啟 Claude Code，說：

```
PUBLISH
```

Claude 會進入 **Discovery 模式**：
1. Fetch 父頁面的內容
2. 找到你剛建好的 toggle 與 child page
3. 自動把 page ID 寫入 `.claude/notion-mapping.json`
4. 把 `output/requirements-{batch}.md` 的內容發佈到 Notion

之後 publish 就不會再 Discovery，直接打 API。

---

## 日常工作流

### 場景 A：修改某個需求的某段文字

```
使用者：把 R0050 報修流程改成「須先拍照」
Claude：[直接改 src/R0050_報修作業功能.md]
使用者：審查 R0050
Claude：[執行 srs-check skill，10 項檢核 + 自動修正]
使用者：SYNC R0050
Claude：[執行 srs-sync skill，同步到 output/]
使用者：PUBLISH
Claude：[執行 srs-publish-notion skill，發佈到 Notion]
```

四步就搞定。可以全部一次說完：「修改 R0050 加上『須先拍照』，然後審查、同步、發佈」。

### 場景 B：批次審查所有需求（客戶交付前）

```
使用者：批次審查所有 9 份需求
Claude：[spawn srs-reviewer agent，平行審查]
         → 每份文件一份檢核摘要
         → 一份跨文件一致性報告（術語漂移、dangling 引用、孤兒 AC）
使用者：SYNC ALL
Claude：[同步全部 9 份到 output/]
使用者：PUBLISH
Claude：[全量覆寫 Notion 沙箱頁面]
```

### 場景 C：只是想看看現在文件長怎樣

```
使用者：R0044 現在寫到哪了？
Claude：[讀檔，摘要現況]
```

不需要觸發任何 skill。

---

## 常見問題排解

### Q1：Claude 說「R0044 檔案不存在」

**原因**：你還沒建立過該需求的 md 檔案。
**解法**：直接跟 Claude 說「幫我新建 R0044 的空白骨架」，它會依據六大章節建一份空殼。

### Q2：PUBLISH 時 Claude 說「找不到 child page，請先 Bootstrap」

**原因**：Notion 上還沒建 toggle 或 child page，或者 `.claude/notion-mapping.json` 被誤刪。
**解法**：回到「首次設定」Step 1，確認 toggle 名稱是 **`《需求分析》`**（含書名號、中間空格、半形減號）一字不差，child page 名稱是 **`需求說明文件3-B`**。

### Q3：Notion 上看到一堆 `[待上傳圖片]` 字樣

**正常現象**，這是 v1 沙箱階段的限制。Notion MCP 目前不支援從本地檔案自動上傳圖片，publish skill 把每張圖片替換成 placeholder，並在發佈報告中列出待手動上傳清單。

**你要做的**：
1. 依清單找到 `{batch}-SRS/assets/R00XX/xxx.png`
2. 手動拖進 Notion 對應位置
3. （可選）在 `.claude/notion-mapping.json` 的 `images` 物件填入對應關係

圖片自動上傳會在 v2 實作，在那之前這個步驟會重複發生。

### Q4：跨需求引用在 Notion 上不能點擊

**正常現象**，也是 v1 限制。`詳見【R0050】報修作業功能` 在 Notion 上會是純文字，不是超連結。要導航請用 Ctrl+F 搜尋關鍵字。

**技術原因**：Notion 沒有 markdown anchor（`#heading-name`）機制，要做可點擊的跨段引用需要先建 block → 拿到 block ID → 再用 `<mention-block>` tag，這是 v2 要做的事。

### Q5：審查完成後發現 Claude 改了我不想改的地方

**不要慌**：
1. 所有修改都在 git working tree 裡，`git diff` 看得到
2. 不認同的修改：`git checkout src/R00XX_*.md` 還原
3. 找 Claude 重新審查，告訴它「這次請不要動 X」

### Q6：我想跳過某個檢核項

`srs-check` skill 的 10 項檢核目前是硬編碼的。若你有合理理由要跳過某項，
兩個選項：

- **一次性**：告訴 Claude「審查 R0044，但跳過檢核 7」
- **持久化**：修改 `.claude/skills/srs-check/SKILL.md` 把該項改為 optional，並在 CLAUDE.md 記錄這個決定

---

## 檔案導覽圖

當你想找某件事該改哪裡時：

| 我想改… | 去哪裡 |
|---------|--------|
| 需求內容 | `{batch}-SRS/src/R00XX_*.md` |
| 專案慣例（術語表、章節結構） | `CLAUDE.md`（專案根目錄） |
| 檢核流程（加一項、改規則） | `.claude/skills/srs-check/SKILL.md` |
| 同步流程（改版本紀錄格式） | `.claude/skills/srs-sync/SKILL.md` |
| Notion 發佈邏輯 | `.claude/skills/srs-publish-notion/SKILL.md` |
| 平行審查 agent 行為 | `.claude/agents/srs-reviewer.md` |
| Notion 目標頁面 ID | `.claude/notion-mapping.json` |
| Notion 格式規則（誰負責哪種 block） | `.claude/skills/notion-doc-writing/` |
| 這份導覽 | `.claude/skills/srs-onboard/SKILL.md`（你正在讀的） |

---

## 進階：什麼時候應該繞過 skill

Skill 是「規則化的流程」，不是萬能。以下情境應該**直接手動操作**：

- **想大幅改動結構**（例如把六大章節改成五大）：直接改 CLAUDE.md，不要嘗試透過 skill
- **臨時的探索性修改**：先用 `git stash` 保護現狀，手動改完驗證，確認再進 skill 流程
- **跨需求的大規模重構**（例如統一所有 AC 格式）：用 `srs-reviewer` agent 批次處理比單獨跑 skill 更有效率
- **需要和客戶討論的草稿**：可以在 Notion 上另開一個 child page 作為討論區，不要污染 publish 目標頁

---

## 你會常問的五個指令

```
審查 R0044          # 單檔審查
批次審查所有需求    # 9 份平行跑
SYNC R0044          # 單檔同步到總整
SYNC ALL            # 全量同步
PUBLISH             # 發佈到 Notion 沙箱
```

以上指令都是**自然語言**，不是嚴格語法。「幫我審一下 R0050」「把 R0044 推到
Notion」「全部同步一次」都能觸發相同的 skill。

---

## 還有問題？

- **技術問題**（skill 壞掉、MCP 連不上）：直接問 Claude，它會從 skill 定義與錯誤訊息推理
- **業務問題**（需求要寫什麼內容）：Claude 不知道，問 PM 或承辦人員
- **這份導覽有錯或不清楚**：直接改 `.claude/skills/srs-onboard/SKILL.md`，下次載入時生效

歡迎加入這個專案。🎉
