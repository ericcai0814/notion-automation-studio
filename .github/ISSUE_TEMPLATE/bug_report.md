---
name: 回報 Bug
about: 回報 plugin 實作錯誤或執行失敗
title: "[bug] "
labels: [bug]
assignees: []
---

<!--
感謝你花時間回報 bug。請盡量把下列五個段落填完整，越詳細越能幫助 maintainer 重現問題。
如果某個段落真的不適用，寫「N/A」即可，但請不要整段刪掉。
-->

## 觸發 prompt

<!-- 你在 Claude Code 裡輸入了什麼話，導致問題發生？請原封不動貼上原始 prompt。 -->

例如：`審查 R0001` 或 `SYNC 3-B` 等。

## 期待行為

<!-- 你原本以為會發生什麼？describe the desired outcome。 -->

## 實際行為

<!-- 實際上發生了什麼？錯誤訊息、錯誤訊息的完整 stack、skill 停在哪一步、或是 skill 根本沒觸發——都請如實描述。 -->

## 環境

- **Plugin 版本**：<!-- 例如：0.1.0（在 `.claude-plugin/plugin.json` 的 `version` 欄位） -->
- **Claude Code 版本**：<!-- `claude --version` 的輸出 -->
- **作業系統**：<!-- macOS 14.5 / Ubuntu 22.04 / Windows 11 WSL2 等 -->

## Workflow-state 摘錄（optional）

<!--
若問題與 srs-check / srs-sync / srs-publish-notion 的順序或狀態有關，
貼一段 `.claude/workflow-state.json` 的相關內容會很有幫助。

⚠ 貼上前請先 redact（移除或以 `<REDACTED>` 取代）下列敏感資料：
  - `parent_page_id`
  - `child_page_id`
  - 任何看起來像 token 的字串（例如 `secret_xxxxx`、`ntn_xxxxx`、`ghp_xxxxx`）
  - 你覺得不該公開的 batch 名稱或客戶代號

沒有 workflow-state 相關問題就留空。
-->

```json
(在這裡貼入 redact 過的片段)
```
