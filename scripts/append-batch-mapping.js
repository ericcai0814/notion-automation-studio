#!/usr/bin/env node
/**
 * Append a new batch entry to an existing notion-mapping.json file.
 *
 * Parent page inheritance logic:
 *   - If ALL existing batches share the same parent_page_id, inherit it
 *     (and parent_page_url) for the new entry.
 *   - If there are no existing batches, or existing batches disagree on
 *     parent_page_id, write null for both fields and prompt manual fill.
 *
 * Atomic write: writes to <mapping-path>.tmp, then renames to <mapping-path>.
 *
 * Usage:
 *   node append-batch-mapping.js <mapping-path> <batch-id>
 *
 * Exit codes:
 *   0 — OK (entry added successfully)
 *   1 — BLOCKED (user-resolvable: file missing, batch already exists)
 *   2 — ERROR (bad args, JSON parse failure)
 */

'use strict';

const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function die(code, msg) {
  process.stderr.write(msg.replace(/\n?$/, '\n'));
  process.exit(code);
}

function ok(msg) {
  process.stdout.write(msg.replace(/\n?$/, '\n'));
}

function writeMapping(mappingPath, data) {
  const tmpPath = mappingPath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmpPath, mappingPath);
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

const mappingPath = process.argv[2];
const batchId     = process.argv[3];

if (!mappingPath || !batchId) {
  die(2, 'Usage: node append-batch-mapping.js <mapping-path> <batch-id>');
}

// ---------------------------------------------------------------------------
// Read & parse existing mapping
// ---------------------------------------------------------------------------

if (!fs.existsSync(mappingPath)) {
  die(
    1,
    `BLOCKED: notion-mapping.json 不存在: ${mappingPath}. ` +
    `請先執行 srs-setup 初始化專案。`
  );
}

let raw;
try {
  raw = fs.readFileSync(mappingPath, 'utf8');
} catch (e) {
  die(2, `ERROR: 無法讀取 ${mappingPath}: ${e.message}`);
}

let mapping;
try {
  mapping = JSON.parse(raw);
} catch (e) {
  die(2, `ERROR: JSON 解析失敗 (${mappingPath}): ${e.message}`);
}

if (mapping == null || typeof mapping !== 'object') {
  die(2, `ERROR: mapping root 必須是物件: ${mappingPath}`);
}

if (!mapping.batches || typeof mapping.batches !== 'object') {
  mapping.batches = {};
}

// ---------------------------------------------------------------------------
// Guard: batch already exists
// ---------------------------------------------------------------------------

if (Object.prototype.hasOwnProperty.call(mapping.batches, batchId)) {
  die(
    1,
    `BLOCKED: batch "${batchId}" 已存在於 mapping，沒有新增的必要。`
  );
}

// ---------------------------------------------------------------------------
// Parent page inheritance logic
// ---------------------------------------------------------------------------

const existingEntries = Object.values(mapping.batches);

let parentPageId  = null;
let parentPageUrl = null;

if (existingEntries.length > 0) {
  const ids = existingEntries.map(e => e.parent_page_id);
  const allSame = ids.every(id => id === ids[0]);

  if (allSame && ids[0] !== null && ids[0] !== undefined) {
    parentPageId  = ids[0];
    parentPageUrl = existingEntries[0].parent_page_url || null;
    ok(
      `INFO: parent_page_id 繼承自既有 batch ` +
      `(${parentPageId})。如有需要請手動修改。`
    );
  } else {
    ok(
      `INFO: 既有 batches 的 parent_page_id 不一致或為 null，` +
      `已設為 null — 請手動填入正確的 parent_page_id 與 parent_page_url。`
    );
  }
} else {
  ok(
    `INFO: mapping 中尚無其他 batch，parent_page_id 設為 null — ` +
    `請手動填入 parent_page_id 與 parent_page_url。`
  );
}

// ---------------------------------------------------------------------------
// Build new entry
// ---------------------------------------------------------------------------

const newEntry = {
  parent_page_id:  parentPageId,
  parent_page_url: parentPageUrl,
  sandbox: {
    toggle_label:              '《需求分析》',
    child_page_title:          `需求說明文件${batchId}`,
    child_page_id:             null,
    child_page_url:            null,
    last_synced_at:            null,
    last_synced_source_md5:    null,
  },
  images: {},
};

mapping.batches[batchId] = newEntry;

// ---------------------------------------------------------------------------
// Atomic write
// ---------------------------------------------------------------------------

writeMapping(mappingPath, mapping);

// ---------------------------------------------------------------------------
// Success report
// ---------------------------------------------------------------------------

const needsManual = [];
if (parentPageId === null)  needsManual.push('parent_page_id', 'parent_page_url');
needsManual.push('sandbox.child_page_id（首次 PUBLISH 後由 srs-publish-notion 自動回填）');

ok(`OK: 已新增 batch "${batchId}" 到 ${mappingPath}`);
if (needsManual.length > 0) {
  ok(`     請手動填入: ${needsManual.join('、')}`);
}
