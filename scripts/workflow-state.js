#!/usr/bin/env node
/**
 * Workflow state tracker for SRS pipeline (srs-check → srs-sync → srs-publish-notion).
 *
 * State schema (version 1):
 *   {
 *     "version": 1,
 *     "batches": {
 *       "<batch>": {
 *         "last_sync_output_md5": "<hex>",
 *         "last_publish": { "ts": "<iso>" },
 *         "records": {
 *           "R00XX": {
 *             "check": { "ts": "<iso>" },
 *             "sync":  { "ts": "<iso>" }
 *           }
 *         }
 *       }
 *     }
 *   }
 *
 * Exit codes:
 *   0 — OK (pre-check passed or write succeeded)
 *   1 — BLOCKED (pre-check failed; user can resolve via the skill's 3-choice UX)
 *   2 — ERROR (missing file, bad args, malformed state; indicates bug or misuse)
 *
 * Per-invocation override: skills may skip pre-check when the user explicitly picks
 * "[2] 強制繼續" in their 3-choice UX. This script intentionally has NO audit trail
 * for overrides — the design decision is that runtime state should reflect reality
 * (what actually got run), not user intent. If auditing is needed later, add it as
 * a separate "history" field without breaking the current schema shape.
 *
 * Usage:
 *   node workflow-state.js <subcommand> [args...]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

function die(code, msg) {
  process.stderr.write(msg.replace(/\n?$/, '\n'));
  process.exit(code);
}

function ok(msg) {
  process.stdout.write(msg.replace(/\n?$/, '\n'));
}

function readState(statePath) {
  if (!fs.existsSync(statePath)) {
    die(2,
      `ERROR: state file not found: ${statePath}\n` +
      `HINT: 先執行 "ensure <state-path> <template-path>" 建立檔案`);
  }
  let raw;
  try {
    raw = fs.readFileSync(statePath, 'utf8');
  } catch (e) {
    die(2, `ERROR: cannot read state file: ${e.message}`);
  }
  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    die(2, `ERROR: state file is not valid JSON: ${e.message}`);
  }
  if (state == null || typeof state !== 'object') {
    die(2, `ERROR: state root must be an object`);
  }
  if (state.version !== SCHEMA_VERSION) {
    die(2,
      `ERROR: state schema version mismatch ` +
      `(expected ${SCHEMA_VERSION}, got ${state.version})`);
  }
  if (!state.batches || typeof state.batches !== 'object') {
    state.batches = {};
  }
  return state;
}

function writeState(statePath, state) {
  const tmpPath = statePath + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(tmpPath, statePath);
}

function ensureBatchEntry(state, batch) {
  if (!state.batches[batch]) {
    state.batches[batch] = {
      last_sync_output_md5: null,
      last_publish: { ts: null },
      records: {},
    };
  }
  const b = state.batches[batch];
  if (!b.records || typeof b.records !== 'object') b.records = {};
  if (!b.last_publish || typeof b.last_publish !== 'object') {
    b.last_publish = { ts: null };
  }
  if (!('last_sync_output_md5' in b)) b.last_sync_output_md5 = null;
  return b;
}

function md5File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(buf).digest('hex');
}

function nowIso() {
  return new Date().toISOString();
}

function requireArgs(name, provided, expected) {
  if (provided.length < expected.length) {
    die(2, `Usage: ${name} ${expected.map(s => `<${s}>`).join(' ')}`);
  }
}

// --- subcommands ---

function cmdEnsure(args) {
  requireArgs('ensure', args, ['state-path', 'template-path']);
  const [statePath, templatePath] = args;
  if (fs.existsSync(statePath)) {
    ok(`OK: state file exists: ${statePath}`);
    return;
  }
  if (!fs.existsSync(templatePath)) {
    die(2, `ERROR: template not found: ${templatePath}`);
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.copyFileSync(templatePath, statePath);
  ok(
    `CREATED: ${statePath}\n` +
    `→ copied from ${templatePath}\n` +
    `→ 請記得 \`git add ${statePath}\` 並 commit，把 workflow state 納入版控`
  );
}

function cmdRecord(args) {
  requireArgs('record', args, ['state-path', 'batch', 'rid', 'stage']);
  const [statePath, batch, rid, stage] = args;
  if (stage !== 'check' && stage !== 'sync') {
    die(2, `ERROR: stage must be 'check' or 'sync', got '${stage}' ` +
           `(for publish use "record-publish")`);
  }
  if (!/^R\d{4}$/.test(rid)) {
    die(2, `ERROR: rid must match R\\d{4}, got '${rid}'`);
  }
  const state = readState(statePath);
  const b = ensureBatchEntry(state, batch);
  if (!b.records[rid]) b.records[rid] = {};
  b.records[rid][stage] = { ts: nowIso() };
  writeState(statePath, state);
  ok(`OK: recorded ${batch}/${rid}/${stage} at ${b.records[rid][stage].ts}`);
}

function cmdRecordPublish(args) {
  requireArgs('record-publish', args, ['state-path', 'batch']);
  const [statePath, batch] = args;
  const state = readState(statePath);
  const b = ensureBatchEntry(state, batch);
  b.last_publish = { ts: nowIso() };
  writeState(statePath, state);
  ok(`OK: recorded publish for ${batch} at ${b.last_publish.ts}`);
}

function cmdSetOutputMd5(args) {
  requireArgs('set-output-md5', args, ['state-path', 'batch', 'output-path']);
  const [statePath, batch, outputPath] = args;
  if (!fs.existsSync(outputPath)) {
    die(2, `ERROR: output file not found: ${outputPath}`);
  }
  const state = readState(statePath);
  const b = ensureBatchEntry(state, batch);
  b.last_sync_output_md5 = md5File(outputPath);
  writeState(statePath, state);
  ok(`OK: set last_sync_output_md5 for ${batch} = ${b.last_sync_output_md5}`);
}

function cmdPreCheckSync(args) {
  requireArgs('pre-check-sync', args, ['state-path', 'batch', 'rid']);
  const [statePath, batch, rid] = args;
  const state = readState(statePath);
  const b = state.batches[batch];
  const checkTs = b && b.records && b.records[rid] && b.records[rid].check && b.records[rid].check.ts;
  if (!checkTs) {
    die(1,
      `BLOCKED: ${rid} 尚未執行 srs-check\n` +
      `REASON: state 找不到 batches.${batch}.records.${rid}.check.ts\n` +
      `HINT: 先跑 srs-check ${rid}，或選擇 [2] 強制繼續 / [3] 取消`
    );
  }
  ok(`OK: ${rid} 已於 ${checkTs} check 過`);
}

function cmdPreCheckSyncAll(args) {
  requireArgs('pre-check-sync-all', args, ['state-path', 'batch', 'src-dir']);
  const [statePath, batch, srcDir] = args;
  if (!fs.existsSync(srcDir)) {
    die(2, `ERROR: src dir not found: ${srcDir}`);
  }
  const ridRe = /^(R\d{4})_.+\.md$/;
  const ridsInSrc = fs.readdirSync(srcDir)
    .map(f => {
      const m = f.match(ridRe);
      return m ? m[1] : null;
    })
    .filter(Boolean)
    .sort();
  if (ridsInSrc.length === 0) {
    die(2, `ERROR: no R*.md files in ${srcDir}`);
  }
  const state = readState(statePath);
  const b = state.batches[batch];
  const missing = [];
  for (const rid of ridsInSrc) {
    const ts = b && b.records && b.records[rid] && b.records[rid].check && b.records[rid].check.ts;
    if (!ts) missing.push(rid);
  }
  if (missing.length > 0) {
    die(1,
      `BLOCKED: SYNC ALL 偵測到 ${missing.length}/${ridsInSrc.length} 份需求尚未 srs-check\n` +
      `MISSING: ${missing.join(', ')}\n` +
      `HINT: 先跑 srs-check 補齊，或選擇 [2] 強制繼續 / [3] 取消`
    );
  }
  ok(`OK: ${ridsInSrc.length} 份需求皆已 check 過`);
}

function cmdPreCheckPublish(args) {
  requireArgs('pre-check-publish', args, ['state-path', 'batch', 'output-path']);
  const [statePath, batch, outputPath] = args;
  if (!fs.existsSync(outputPath)) {
    die(1,
      `BLOCKED: output 檔不存在: ${outputPath}\n` +
      `REASON: 從未執行 srs-sync 或路徑錯誤\n` +
      `HINT: 先跑 srs-sync，或選擇 [3] 取消`
    );
  }
  const state = readState(statePath);
  const b = state.batches[batch];
  const storedMd5 = b && b.last_sync_output_md5;
  if (!storedMd5) {
    die(1,
      `BLOCKED: ${batch} 的 last_sync_output_md5 尚未設定\n` +
      `REASON: srs-sync 似乎沒跑完，或 state 與 output 脫節\n` +
      `HINT: 先跑 srs-sync 讓 state 同步，或選擇 [2] 強制繼續 / [3] 取消`
    );
  }
  const currentMd5 = md5File(outputPath);
  if (currentMd5 !== storedMd5) {
    die(1,
      `BLOCKED: output 檔 md5 與 state 紀錄不符\n` +
      `STORED:  ${storedMd5}\n` +
      `CURRENT: ${currentMd5}\n` +
      `REASON: output 似乎在最後一次 srs-sync 之後被手動編輯過\n` +
      `HINT: 重跑 srs-sync 重新同步 state，或選擇 [2] 強制繼續 / [3] 取消`
    );
  }
  ok(`OK: output md5 與 state 紀錄相符，可發佈`);
}

// --- dispatch ---

const handlers = {
  'ensure': cmdEnsure,
  'record': cmdRecord,
  'record-publish': cmdRecordPublish,
  'set-output-md5': cmdSetOutputMd5,
  'pre-check-sync': cmdPreCheckSync,
  'pre-check-sync-all': cmdPreCheckSyncAll,
  'pre-check-publish': cmdPreCheckPublish,
};

const subcommand = process.argv[2];
const args = process.argv.slice(3);

if (!subcommand || !handlers[subcommand]) {
  die(2,
    `Usage: node workflow-state.js <subcommand> [args...]\n\n` +
    `Subcommands:\n` +
    `  ensure <state-path> <template-path>\n` +
    `      Copy template → state-path if state file missing.\n\n` +
    `  record <state-path> <batch> <rid> <stage>\n` +
    `      stage = 'check' | 'sync'. Writes timestamp for the given rid.\n\n` +
    `  record-publish <state-path> <batch>\n` +
    `      Writes batch-level publish timestamp.\n\n` +
    `  set-output-md5 <state-path> <batch> <output-path>\n` +
    `      Computes md5 of output file and stores as batches.<batch>.last_sync_output_md5.\n\n` +
    `  pre-check-sync <state-path> <batch> <rid>\n` +
    `      Blocks (exit 1) if <rid> has never been checked.\n\n` +
    `  pre-check-sync-all <state-path> <batch> <src-dir>\n` +
    `      Scans src-dir for R*.md files, blocks (exit 1) on any that have\n` +
    `      never been checked. Reports the full missing list.\n\n` +
    `  pre-check-publish <state-path> <batch> <output-path>\n` +
    `      Blocks (exit 1) if output missing, md5 unset, or md5 drifted.\n\n` +
    `Exit codes: 0 ok / 1 blocked / 2 error`
  );
}

handlers[subcommand](args);
