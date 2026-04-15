# `srs-publish-notion` Refactor 調研紀錄

> 最後更新：2026-04-15（Phase 3 runtime 實證後重大修訂）
> 狀態：**stage-1 仍 defer，但核心前提已被推翻，見第八節**。本份原為 stage-1 調研文件。2026-04-15 當天補做 runtime 實證（Phase 0/1/2/3），發現第二節「致命限制」的核心斷言**錯誤**——`@notionhq/notion-mcp-server` 是 thin REST proxy，`tools/call` 時完全不 enforce schema，12/12 SRS block type 全部可寫入。Refactor 路線重排見第八節第 8.8 節。

## 一、背景

`srs-publish-notion` skill 目前依賴 OAuth 路線的 `Notion@claude-plugins-official` plugin，呼叫的工具前綴為 `mcp__plugin_Notion_notion__notion-*`。包含：

- `notion-fetch`：讀 page，回傳 Notion-flavored markdown
- `notion-update-page` with `command: "replace_content"`：用 markdown 字串覆寫 page 內容
- `notion-update-page` with `command: "update_content"`：search-and-replace 增量更新

這些都是 OAuth Notion plugin 自家**高階 markdown-aware** command——OAuth plugin 在內部把 markdown 解析成 Notion blocks 後寫入。Notion REST API 本身**沒有**這種 command；它是 OAuth plugin 自家的抽象。

2026-04-15 srs-setup 改寫成 integration token 路線（`@notionhq/notion-mcp-server` 套件，server 名 `notionApi`）後，發現 publish 流程在 integration token 環境下完全跑不起來——即使把 tool name 從 `mcp__plugin_Notion_notion__*` 換成 `mcp__notionApi__API-*`，**語意層級也對不上**。

## 二、~~致命限制（schema-level）~~ ⚠️ 核心斷言已被推翻（見第八節）

> ⚠️ **2026-04-15 runtime 實證結果**：本節主張「OpenAPI proxy server 嚴格 enforce schema，多餘的 type 在 client/server 雙端都會被擋掉」——**不成立**。server 實際不驗證 tools/call 的 block type，12/12 SRS 需要的 block type 全部實測寫入成功。以下原始內容保留作為「錯誤推論」的紀錄，但請依第八節的修正理解現況。

`@notionhq/notion-mcp-server` 是個 OpenAPI proxy server——它從 `scripts/notion-openapi.json` 讀一份 OpenAPI 3 spec，把每個 endpoint 自動轉成 MCP tool。Tool schema 完全由 spec 決定，server 對輸入嚴格做 JSON Schema validation。

**檔案位置**：
```
~/.npm/_npx/2e5266eea15d0ccd/node_modules/@notionhq/notion-mcp-server/scripts/notion-openapi.json
```

（路徑中的 `_npx` hash 會因安裝時間不同，但結構一致）

**關鍵 schema 定義**（line 253-262）：

```json
"blockObjectRequest": {
  "anyOf": [
    {"$ref": "#/components/schemas/paragraphBlockRequest"},
    {"$ref": "#/components/schemas/bulletedListItemBlockRequest"}
  ]
}
```

整份 spec 內**完全沒有** `headingOneBlockRequest`、`headingTwoBlockRequest`、`headingThreeBlockRequest`、`calloutBlockRequest`、`codeBlockRequest`、`quoteBlockRequest`、`tableBlockRequest`、`tableRowBlockRequest`、`toggleBlockRequest`、`dividerBlockRequest`、`imageBlockRequest`、`bookmarkBlockRequest` 任何一個。

也就是說，透過 `notionApi` 寫入 Notion blocks 時，**只能寫 paragraph 與 bulleted_list_item**。

**這不是 schema 文件不完整**——OpenAPI proxy server 嚴格 enforce schema，多餘的 type 在 client/server 雙端都會被擋掉。Notion 自家 REST API 本身支援所有 block type，但這個官方 wrapper 是刻意挑的最小子集（推測理由是降低 LLM 寫錯 block JSON 的風險）。

**SRS publish 必須的 block type**（無一可繞過）：

| Block type | 用途 |
|---|---|
| `heading_1` | 「壹、版本說明」「貳、需求大綱」「參、需求內容」三大章節 |
| `heading_2` ~ `heading_4` | 各需求的六大子章節（一、需求說明 / 二、使用情境 / …） |
| `code` | 範例與 placeholder code block |
| `quote` | 引用原文（多行用 `<br>`） |
| `callout` | 頁首 warning + 圖片 placeholder |
| `table` / `table_row` | 術語對照、屬性對照 |
| `bulleted_list_item` ✓ | 條列項目（**這個有支援**） |
| `numbered_list_item` | 編號條列 |
| `divider` | 章節分隔 |

10 個 block type 中只有 1 個（bulleted_list_item）被 notionApi 支援。換句話說 **`notionApi` 寫不出 SRS publish 的 90% 內容**。

## 三、Refactor 路徑評估（2026-04-15）

> ⚠️ 本節的 5 個選項評估建立在第二節的錯誤前提之上。Phase 3 實證後多數選項都失去意義（因為「必須繞過 notionApi」這個驅動力本來就不成立）。修正後的路線排序見第八節第 8.8 節。以下內容保留作為當時的決策脈絡紀錄。

評估時考慮的 5 個選項：

### A：Rollback 到 OAuth 路線

把 srs-setup 改回 `/plugin install Notion` + OAuth 授權。`srs-publish-notion` 維持現狀。

| 評估維度 | 結論 |
|---|---|
| 工程量 | 0（reverts） |
| 跨平台 | OAuth 流程在 macOS / Linux / Windows 都一致（瀏覽器跳轉） |
| Token 管理 | OAuth refresh token 自動處理，使用者不需碰 token |
| 缺點 | 否定 integration token 路線的所有優點（project-scoped、明文可見、無瀏覽器依賴） |

### B-revised：Node script + `@notionhq/client` + `@tryfabric/martian`

繞過 MCP 完全不用。寫 `scripts/publish-to-notion.js`，引入：
- `@notionhq/client`（Notion 官方 SDK，直接打 REST API，不經 MCP wrapper 的 schema 限制）
- `@tryfabric/martian`（社群套件，markdown → Notion blocks converter）

| 評估維度 | 結論 |
|---|---|
| 工程量 | 中（4-6 hr，需先驗證 martian 對 SRS markdown 子集的覆蓋率） |
| Repo 結構影響 | **本 repo 從零 npm deps 變成有 deps**，需要 `package.json` + 在 srs-setup 加 `npm install` 步驟 |
| 跨平台 | OK（npm 三平台一致） |
| Skill 模式變化 | 從「LLM 帶 MCP」變成「LLM 呼叫 Bash 跑 Node script」，跟 `merge-srs.js` 同模式 |
| 風險 | martian 對 Notion-flavored 的覆蓋率未知（callout、toggle、`<br>`、`<details>`、自訂 attributes 可能不支援） |

### B-revised-2：Node script + 純 fetch + 手寫 markdown→blocks converter

同 B-revised 但不用 npm 套件。Node 18+ 內建 `fetch()` 直接打 `https://api.notion.com/v1/...`，markdown 解析自己寫。

| 評估維度 | 結論 |
|---|---|
| 工程量 | 大（8-12 hr，~400 行 converter + tests） |
| Repo 結構影響 | 維持「零 npm deps」原則 |
| 跨平台 | OK |
| 維護成本 | 高——需要長期維護一個自家 markdown parser，新的 SRS 寫法都要回來改 converter |

### C-revised：兩條路並存（接受現狀，加文件）

整合 token 給 setup/check/sync 用，OAuth 給 publish 用。在 srs-setup Step 4 末尾加說明，要 publish 的人額外裝 OAuth plugin。

| 評估維度 | 結論 |
|---|---|
| 工程量 | 小（補一段文件） |
| 使用者體驗 | 要設兩套 MCP，但 setup 流程引導 |
| 缺點 | 雙 MCP 並存的長期維護成本（schema drift、tool name 混淆） |

### D：Defer publish 重寫（**已選**）

保留今天的 srs-setup 改寫 + 模板，commit 並結束本次。本份文件記下發現與選項，未來重啟時直接從 stage 2 開始，不用重新調研。

| 評估維度 | 結論 |
|---|---|
| 工程量 | 小（補文件 + commit） |
| Scope 控制 | ✓ 與原始目標（user 配 token 引導）對齊 |
| 短期使用者體驗 | publish 流程**仍要**走 C-revised 的雙路線設計（在 INSTALL.md 已說明） |
| 風險 | 雙路線設計如果長期不解，schema drift 風險會增加 |

## 四、為什麼選 D（決策依據）

1. **scope 控制**：原本的目標是「使用者裝 plugin 後能引導配置 token」。srs-setup 改寫已經達成這個目標。publish refactor 是 schema-level 的外部約束，本來就不該夾在 srs-setup 改寫的同一個 commit
2. **避免綁定好變更與壞變更**：srs-setup 改寫是好變更（cross-platform、整合 token、明確流程）。如果跟 publish 重寫綁在一起，publish 卡住等於整個變更卡住
3. **使用者真實工作流不會立刻被擋**：`~/project/tsmc-dormitory-srs/` 真要 publish 時，可以暫時走 OAuth（裝 official plugin、授權一次），這是未來幾週的事
4. **B-revised 需要架構決策**：要不要引入 npm deps、要不要從 LLM-driven 改成 script-driven，這些是獨立的 architecture decision，不該在 srs-setup commit 內隱含決定

## 五、未來重啟此 refactor 前需要先回答的問題

1. **Notion 自家有沒有可能擴充 OpenAPI spec？** 可定期檢查 `@notionhq/notion-mcp-server` 新版的 `notion-openapi.json`，若 `blockObjectRequest` 擴充了 heading / table / code 等，整個 refactor 變簡單
2. **本 repo 願不願意接受 npm deps？** 若願意，B-revised 是最快路線（4-6 hr）。若不願意，B-revised-2 是高成本（8-12 hr）但純淨的選項
3. **`@tryfabric/martian` 對 SRS 子集的覆蓋率？** 在投入 B-revised 之前需先做 spike：寫個小 driver，把 `requirements-3-B.md` 灌進 martian、看輸出 blocks 跟預期的 H1-H4 / table / callout 是不是對的上
4. **publish 是不是長期需要 markdown→blocks？** 如果未來 SRS source 直接寫成 Notion block JSON（或 YAML 之類的中介格式），整個 markdown converter 問題不存在
5. **是否願意自己跑 MCP server？** Notion 官方 wrapper 的 schema 限制是固定的，但有人可以 fork 那個 repo、把 spec 補完、自己跑——這是最重的選項但徹底解決 schema 不足

## 六、今天保留下來的（stage 1 deliverables）

- `templates/mcp.json.tmpl`（新檔）：integration token 路線的 `.mcp.json` 模板，用於 srs-setup 自動建立
- `skills/srs-setup/SKILL.md`（修改）：Step 4 整段重寫成 integration token 路線，含 4-a 偵測、4-b token 建立引導、4-c 模板複製、4-d gitignore、4-e 重啟指引、4-f 進階替代、4-g publish 額外需求說明
- `docs/INSTALL.md`（修改）：把 Notion MCP 設定拆成 3-a（notionApi）與 3-b（OAuth），並引用本份文件
- `docs/srs-publish-notion-refactor.md`（本檔）：今天的發現與選項評估

**未動到**的（stage 2 範圍）：

- `skills/srs-publish-notion/SKILL.md`：仍 hardcode `mcp__plugin_Notion_notion__notion-*`
- `skills/notion-doc-writing/SKILL.md`：仍以 OAuth markdown command 為中心設計
- `README.md` / `skills/srs-onboard/SKILL.md`：未檢查是否有 OAuth 路線殘留引用

## 七、調研用到的指令／路徑（給未來自己）

```bash
# 找 notionApi MCP server 的本機安裝位置
find ~/.npm -name "notion-mcp-server" -type d

# 看 OpenAPI spec 的 blockObjectRequest 定義
sed -n '253,262p' ~/.npm/_npx/*/node_modules/@notionhq/notion-mcp-server/scripts/notion-openapi.json

# 統計 spec 內定義的 block type（如果是新版本，這個會更多）
grep -oE '"[a-z_]+BlockRequest"' ~/.npm/_npx/*/node_modules/@notionhq/notion-mcp-server/scripts/notion-openapi.json | sort -u

# 看 srs-publish-notion 對 OAuth tool 的所有引用點
grep -n "mcp__plugin_Notion_notion__\|notion-fetch\|notion-update-page\|replace_content\|update_content" \
  skills/srs-publish-notion/SKILL.md
```

---

## 八、2026-04-15 runtime 實證（Phase 0/1/2/3 findings）

> ⚠️ **本節推翻第二、三節的核心斷言**。原推論「OpenAPI proxy server 嚴格 enforce schema，多餘的 type 在 client/server 雙端都會被擋掉」——runtime 測試顯示**不成立**。server 實際是 thin REST proxy，`tools/call` 時完全不驗證 block type，12/12 SRS 需要的 block type 全部通過。

### 8.1 TL;DR

- `@notionhq/notion-mcp-server@2.2.1` 的 `tools/list` response 中，`$defs.blockObjectRequest` 確實只 `anyOf [paragraphBlockRequest, bulletedListItemBlockRequest]`——這點跟第二節一致
- **但 server 對 `tools/call` 的 arguments 完全不做 schema validation**。送任意 block type 都會被原樣 forward 給 Notion REST API
- 實測：用 notionApi 送 heading_1 / heading_2 / heading_3 / code / quote / callout / numbered_list_item / toggle / divider / table / paragraph 全部成功回 200
- 結論：notionApi 本身**有能力**滿足 SRS publish。refactor 路線從「繞過 wrapper」變成「教 LLM 無視 $defs schema 直接用 tool」

### 8.2 Phase 0：現況盤點

- `skills/srs-setup/SKILL.md` Step 4 已完整改寫成 integration token 路線（4-a 偵測、4-b token 引導、4-c 模板、4-d gitignore、4-e 重啟指引、4-g publish 補充）
- `templates/mcp.json.tmpl` 存在，只含 `notionApi` 一個 server
- 使用端 `~/project/tsmc-dormitory-srs/` **原本沒有 `.mcp.json`**——新版 srs-setup 此前從未在真實 consumer 跑過一次。Phase 0 期間手動執行 Step 4-c ~ 4-d 的 subset，建立 `.mcp.json` + gitignore。`git check-ignore -v .mcp.json` 回傳 `.gitignore:15:.mcp.json` 確認 gitignore 生效

### 8.3 Phase 1：OpenAPI spec 靜態重驗

版本 `@notionhq/notion-mcp-server@2.2.1`（本機 npx cache）。`blockObjectRequest` 定義位於 `scripts/notion-openapi.json` line 253-262，內容與第二節描述一致——只 `anyOf` `paragraphBlockRequest` + `bulletedListItemBlockRequest`。

整份 spec 搜尋 `BlockRequest`，只有 4 個匹配：2 個 definition + 2 個 ref。`headingOneBlockRequest`、`tableBlockRequest`、`codeBlockRequest`、`calloutBlockRequest` 等**確實不存在**於 spec。

**這部分結論與第二節一致——spec 靜態內容沒錯**。問題出在「從 spec 反推 runtime 行為」這一步（見 8.5）。

### 8.4 Phase 2：notionApi live server 的 tools/list

手寫最小 Node MCP client（`/tmp/claude/mcp-probe.mjs`），spawn `node <cached-cli.mjs>`，送 `initialize` + `notifications/initialized` + `tools/list`。發現：

- **`tools/list` 不驗證 token**——假 token（但格式符合 `ntn_*`）也能完成 handshake 並拿到完整 tool 清單。這代表未來 CI regression test 幾乎零成本
- Server identity：`{ "name": "Notion API", "version": "1.0.0" }`，protocol `2024-11-05`
- **22 tools**，全部 `API-*` 前綴。MCP client 側的 tool name 格式：`mcp__notionApi__API-<operationId>`
- 全 22 tool 的 `inputSchema.$defs` **都塞同一組限制**：`blockObjectRequest anyOf [paragraphBlockRequest, bulletedListItemBlockRequest]`。不是只有 `API-patch-block-children` 受限，連 `API-post-page`、`API-update-a-block` 等都帶同一份 $defs
- 全 22 tool 的 description 掃過，**沒有任何欄位**提到 "markdown"。notionApi 完全是 block-JSON 導向，沒有 OAuth plugin 的 `replace_content` 類 markdown string 介面
- 意外觀察：每個 tool description 都帶 `Error Responses: 400: Bad request` 尾巴——這是 OpenAPI operation description 被直接塞進 MCP tool description 的副作用，對 LLM 判讀無幫助但是 wrapper 自身的問題，非本調研範圍

**這部分仍是間接驗證——驗證了 schema 被 exposed 的樣子，沒驗證 runtime 實際 enforcement 行為**。這是 Phase 2 的盲點。

### 8.5 Phase 3：runtime tools/call 實測（核心發現）

用真 token + 拋棄用測試頁 `3413d161-2a9d-8025-aa23-d636f95f01aa`，probe script `/tmp/claude/phase3-probe.mjs`，五步驟測試：

| # | 測試 | 預期 | 實測 | 結論 |
|---|---|---|---|---|
| A | notionApi + paragraph | ✅ OK | ✅ OK, 1316ms | 預期內 |
| B | notionApi + heading_1 | ❌ schema rejected | ⚠️ **✅ OK, 8397ms** | **顛覆性** |
| C | REST direct + heading_1 | ✅ OK | ✅ OK, 650ms | 預期內 |
| D | REST direct + callout + table | ✅ OK | ✅ OK | 預期內 |
| E | cleanup 5 blocks via REST DELETE | 全 200 | 全 200 | 測試頁乾淨 |

**P3-B 是關鍵**：透過 notionApi `tools/call` 送 `children: [{ type: "heading_1", heading_1: { rich_text: [...] } }]`，server **照樣** forward 給 Notion API，Notion 回 200，block 成功建立。這行為跟第二節「server 嚴格 enforce schema，client/server 雙端擋掉」的假設**完全相反**。

P3-B 的 8397ms latency 異常（是 P3-A paragraph 1316ms 的 6 倍），當時以為是 server 對 schema-不符 payload 做了某種 fallback 處理。Phase 3-G 多次重跑後確認這是 **one-off 變異**（見 8.6）。

### 8.6 Phase 3-G：全 SRS block type 寬容度驗證

為排除 P3-B 是特例，probe script `/tmp/claude/p3g-probe.mjs` 對 SRS 需要的 12 個 block type 跑全掃，單一 MCP session 複用：

```
heading_1_run1       OK   842ms
heading_1_run2       OK   394ms
heading_1_run3       OK   942ms
heading_2            OK  1158ms
heading_3            OK   631ms
code                 OK   826ms
quote                OK   909ms
callout              OK  3905ms   ← 唯一 >2s 的 outlier
numbered_list_item   OK   924ms
toggle               OK   658ms
divider              OK   785ms
table                OK   929ms
```

- **12/12 全通過**
- **latency min/median/mean/max = 394 / 909 / 1075 / 3905 ms**
- **heading_1 重跑 3 次**：[842, 394, 942]，spread 548ms——**P3-B 的 8397ms 確認為 one-off outlier，不是系統性行為**。heading_1 正常在 400-1000ms 區間
- **callout 3905ms**：疑似 Notion 對 icon/emoji 的 server-side 處理較重。batch publish 若有大量 callout，latency 會線性放大——stage 2 實作時要記住
- 12 個 block cleanup 全 HTTP 200，測試頁恢復乾淨

### 8.7 schema semantics 修正（心智模型）

第二節的心智模型：

> server 從 OpenAPI spec 載入 schema → MCP client 收到 schema → 雙端 validation → 多餘 block type 被擋

**實際模型**：

> server 從 OpenAPI spec 載入 schema → 僅用於 `tools/list` response（給 LLM 當 guidance） → `tools/call` 時原樣 forward 到 Notion REST API → 真正的 enforcement 發生在 Notion side

關鍵區分：

- **tools/list 的 `$defs` schema** = 「給 LLM 看的建議」，不是 runtime constraint
- **tools/call 的 runtime validation** = **無**。`@notionhq/notion-mcp-server` 是 thin pass-through
- **真正的 enforcement layer** = Notion REST API 自己

推測 wrapper 的設計意圖：讓 LLM 依 spec 寫出「常用的 block type」，但 spec 不完整時，有經驗的 client 可以繞過 LLM 的 schema 束縛直接送 block。這是 **LLM-ergonomic 的妥協**，不是安全邊界。

### 8.8 Refactor 路線重排

| 選項 | 原評估 | Phase 3 後重評 |
|---|---|---|
| **E'': 教 LLM 無視 $defs schema，直接用 notionApi** | 原本不存在 | **🌟 新首選**。前置條件：Claude Code MCP client 不做 client-side schema validation（見 8.9） |
| A: Rollback OAuth | 0 hr | 徹底沒必要 |
| B-revised-3: Node script + @notionhq/client | 6 hr（stub→量測→修） | **降為備案**——E'' 被 client-side validation 擋下時走這條 |
| B-revised-2: 純 fetch + 自寫 converter | 8-12 hr | 徹底沒必要 |
| C-revised: 雙 MCP 並存 | 補文件 | 徹底沒必要 |
| E: 自建 MCP（fork / fresh / wrapper） | 8-25 hr | 徹底沒必要 |

**E'' 的實作規模（純文件改）**：

1. 改 `skills/srs-publish-notion/SKILL.md`：
   - 明確聲明「notionApi tools/list 暴露的 `$defs.blockObjectRequest` schema 不完整；server runtime **接受所有 Notion block type**，你可以直接送 heading / table / code / callout / toggle / divider / quote / numbered_list_item 等」
   - 把 hardcoded 的 OAuth tool name（`mcp__plugin_Notion_notion__notion-*`）換成 `mcp__notionApi__API-patch-block-children` 等
   - 重寫 publish 流程：「讀 markdown → LLM 自己 parse 成 block JSON → 逐次（或批次） `tools/call API-patch-block-children`」
2. 改 `skills/srs-setup/SKILL.md`：
   - 刪除 Step 4-g「publish 必須額外裝 OAuth Notion plugin」整段
   - 更新 Step 7 完成摘要
3. 改 `skills/notion-doc-writing/SKILL.md`：
   - 從 OAuth markdown-command 為中心改成 block JSON 為中心
   - 補一份「SRS markdown element → Notion block JSON」對照表

工程量估計：**2-4 hr**（純文件改，無新 script、無新 dep）。遠低於原本的 B-revised-3 6 hr。

### 8.9 剩餘未驗證的最後一環：Claude Code client-side validation

Phase 3 probe **繞過了兩層可能的 client-side 擋點**：

1. **LLM 自我審查**：Claude 看 tool schema 說 block type 只能 2 種，生成 tool call 時可能主動排除 heading_1。這是 prompt engineering 問題，skill 文件可以強制 override
2. **MCP client SDK 的 schema validation**：`@modelcontextprotocol/sdk` 的 client 端可能在 send 前依 `inputSchema` 驗證 arguments。這是硬限制，skill 無法 override

probe 是手寫 JSON-RPC 送到 child process stdin，**這兩層都被繞過**。真實 Claude Code session 會走過這兩層。

**驗證方法**（本 session 無法執行，要在 consumer repo 開新 Claude Code session）：

1. 在 `~/project/tsmc-dormitory-srs/` 確認 `.mcp.json` 含真 token、integration 已 share 給測試頁
2. 開新 Claude Code（new process，新 session 會載入 `.mcp.json`）
3. 執行 `claude mcp list`，確認 `notionApi: ... ✓ Connected`
4. 給 Claude 明確指令：「請使用 `mcp__notionApi__API-patch-block-children` 工具，寫一個 type=heading_1 的 block 到 block_id=`3413d161-2a9d-8025-aa23-d636f95f01aa`，heading_1.rich_text 內容設為 'client-side validation test'」
5. 觀察結果：
   - ✅ **寫成功** → E'' 完全可行。下一步是真的改 skill 文件
   - ❌ **Claude 拒絕但給出解釋**（「schema 不允許 heading_1」）→ 這是 LLM self-censoring。可以用 skill prompt 強制 override。試第二次：在指令中明確告知「schema 不完整，heading_1 實際可用」，看 Claude 能否被說服
   - ❌ **MCP call 發出後 client SDK 擋下** → SDK-level validation。此時 E'' 走不通，退回 B-revised-3
6. 無論結果如何，記得 `API-delete-a-block` 清掉測試 block

### 8.10 意外發現：srs-setup Step 4-e 的安全漏洞

**場景**：使用者依 Step 4-e 指示，在編輯器打開 `.mcp.json` 填 integration token、存檔。此時若 Claude Code session 還是 active 的，Claude Code 的檔案修改通知機制會透過 `<system-reminder>` 把**整份新內容 dump 到 assistant context**，包含第 7 行的明文 token。

**結果**：token 進入 session transcript，等同洩漏。整條路徑使用者完全照守則做了——**沒貼進對話框**。漏洞不在使用者，而在 Claude Code 的檔案修改通知機制繞過了「不在對話框輸入 token」這條防線。

**當天 incident response**：採 option B，先完成 Phase 3 驗證，結束後 rotate token。使用者在 `https://www.notion.so/profile/integrations` rotate secret。

**Step 4-e 需要補的守則**（stage 2 時納入 `skills/srs-setup/SKILL.md`）：

- 在 Step 4-e 的 safety 段補一條：「如果你在 Claude Code session 裡執行 srs-setup，**請在『打開 .mcp.json 前』先關閉 session**，改完 token 存檔後再開新 session。避免 file-modification `<system-reminder>` 把 token 回傳給 assistant」
- 或改守則：要求使用者先填 dummy token 存檔、關閉 session、手動編輯、再重開 session——這種方式 session 完全沒看過 token
- **長期解法**：Step 4-f 提到的 OS keychain / password manager 路線應該升為 default，而不是 advanced。在 keychain 路線下，`.mcp.json` 只存一個引用，不存明文，file-mod reminder 就洩漏不到實際 secret

**T1 狀態更新（2026-04-15 同日）**：上述前兩條守則已實作並 commit 到 `skills/srs-setup/SKILL.md`，包含：

- Step 4-e 從「印出 token 填寫與重啟指引」改名「填入 token 的安全流程」，明確列出兩條洩漏管道（對話框 + file-watcher），並把流程順序從「改檔 → 關閉並重啟」改成「**先關閉 → 改檔 → 開新**」。新增步驟 4 洩漏自檢（要 Claude 掃 session 歷史找 `ntn_` 字串但不印出）
- Step 4-f 的 keychain 段升級措辭，明確指出 keychain 路線能**從源頭消除 file-watcher 洩漏風險**，但仍保留為 advanced option（default 還是 gitignored 明文 + 嚴格 4-e 流程）
- 「常見錯誤與處理」表新增一列，對應「session active 時編輯 `.mcp.json`」的 incident response 流程
- 「完成檢查」表新增一項，確認使用者理解 4-e 的順序

T1 工程量實際 ~30 min，純文件改動。未包含 T3（terminal atomic-write script）與 T2（keychain 升級為 default）——這兩項仍為未來工作。

### 8.11 意外發現：page URL confusion 造成破壞性測試風險

Phase 3 執行時，使用者第一次提供的測試頁 URL 實際指向 **production SRS 頁面**（`3-B`，UUID `3413d1612a9d8128a604fec3a4d6aa5b`），之後才糾正為拋棄用測試頁（UUID `3413d1612a9d8025aa23d636f95f01aa`）。

兩個 UUID 前 13 個 hex 完全相同：`3413d1612a9d8`，差異在中後段。**純看 UUID 無法分辨**。

**教訓**：對 Notion 做任何破壞性操作（write / delete / update）前，必須用 `API-retrieve-a-page` 或 `pages.retrieve()` 讀 title，印出給使用者/LLM 自己做 sanity check，不能只依賴 UUID。

**Stage 2 實作 srs-publish-notion 時應內建的流程**：

1. 從 `notion-mapping.json` 讀取目標 `child_page_id`
2. 呼叫 `API-retrieve-a-page` 取得 page title
3. 把「即將寫入 page title：『需求說明文件 3-B』」印出來給使用者確認，確認後才執行 publish
4. 這個 confirmation gate 可以被設定檔關掉（CI 模式），但 default 開

### 8.12 Phase 3 probe scripts（便於將來重跑）

本次調研產出的 runtime probe scripts：

- `/tmp/claude/mcp-probe.mjs` — Phase 2 tools/list 探測 + $defs 分析 + markdown-in-string 掃描
- `/tmp/claude/phase3-probe.mjs` — Phase 3 A+B+C+D+E 五步驟測試（notionApi paragraph/heading + REST heading/table/callout + cleanup）
- `/tmp/claude/p3g-probe.mjs` — Phase 3-G 全 12 block type sweep（含 heading_1 x3 重跑做 latency 變異測試）

這些 scripts 是 throwaway，不入 plugin repo。若未來要促成 CI regression test（驗證 Notion 有沒有更新 OpenAPI spec 或 wrapper 行為），建議遷移到 `scripts/mcp-regression/` 下並加 `package.json` 的 test script。

**重跑指令**（假設 `.mcp.json` 有真 token、integration 已 share 給 test page）：

```bash
# Phase 2
node /tmp/claude/mcp-probe.mjs /path/to/.mcp.json

# Phase 3 核心
node /tmp/claude/phase3-probe.mjs /path/to/.mcp.json <page_id>

# Phase 3-G 全 block type sweep
node /tmp/claude/p3g-probe.mjs /path/to/.mcp.json <page_id>
```

### 8.13 Sandbox 注意事項

Claude Code Bash tool sandbox 的 network allowlist **只有 `registry.npmjs.org`，不含 `api.notion.com`**。Phase 3 / 3-G 所有對 Notion 寫入都必須 `dangerouslyDisableSandbox: true`。這對執行路徑的含意：

- **Phase 驗證/開發時**：從 Claude Code 執行 probe 必須 disable sandbox，使用者會看到 sandbox 提示
- **Runtime publish 時**：skill 執行路徑走 MCP protocol（LLM → MCP client → spawned MCP server），不經 Bash tool，**不受 sandbox 限制**。這是 MCP 的優勢之一

### 8.14 今日實證的剩餘 artifacts

- 使用端 `~/project/tsmc-dormitory-srs/.mcp.json`：含**已 rotated** 的 token（rotate 時機見 8.10）。gitignored
- 使用端 `.gitignore`：新增第 15 行 `.mcp.json`
- 拋棄用測試頁：`3413d161-2a9d-8025-aa23-d636f95f01aa`（title: `notion-mcp-testing`），connection 已 share 給 integration，可重複使用做 regression test
- **舊 token**（洩漏到本 session transcript 的那個）：已由使用者 rotate，失效

---

## 九、（建議）stage 2 行動順序

Phase 3 結論讓 stage 2 的工程量從 6-25 hr 降到 2-4 hr。建議執行順序：

1. **先做 8.9 的真實 client 驗證**（~15 min，需在 consumer repo 開新 session 手動跑）。這一步決定後面走 E'' 還是 B-revised-3
2. **如走 E''**：改 `srs-publish-notion/SKILL.md` + `srs-setup/SKILL.md`（刪 4-g）+ `notion-doc-writing/SKILL.md`（block JSON 對照表）。2-4 hr
3. **如走 B-revised-3**：寫 `templates/publish-to-notion.js.tmpl` + `templates/package.json.tmpl` + srs-setup 新增 Step 5 `npm install` 引導。6 hr
4. **stage 2 完成後**：把 8.10 的 Step 4-e 安全守則補進 srs-setup。包括：session 關閉指引、keychain 路線升為 default 的評估
5. **stage 2 完成後**：srs-publish-notion 內建 8.11 的 page title confirmation gate

