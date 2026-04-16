#!/usr/bin/env node
/**
 * publish-to-notion.js — SRS Markdown → Notion 發佈 orchestrator
 *
 * Pipeline: archive → upload images → convert → safety check → append → state update
 *
 * 依賴：
 *   - scripts/notion-api-client.js  (Notion REST API client)
 *   - scripts/notion-upload-image.js (file_upload CLI)
 *   - scripts/md-to-notion-blocks.py (markdown → block JSON converter, via uv)
 *
 * Exit codes:
 *   0 — 發佈成功（或 --dry-run / --discover 成功）
 *   1 — 錯誤（參數錯誤、API 錯誤、safety check 中止）
 *
 * Usage:
 *   node scripts/publish-to-notion.js --batch <id> [--dry-run] [--discover] [--mapping <path>]
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const os = require('os');

const api = require('./notion-api-client');

// ============================================================
// Constants
// ============================================================

const MAX_BLOCKS = 1000;
const WARN_BLOCKS = 900;
const BATCH_SIZE = 100;
const SCRIPT_DIR = __dirname;

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {
    mapping: './.claude/notion-mapping.json',
    dryRun: false,
    discover: false,
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      parsed.batch = args[++i];
    } else if (args[i] === '--mapping' && args[i + 1]) {
      parsed.mapping = args[++i];
    } else if (args[i] === '--dry-run') {
      parsed.dryRun = true;
    } else if (args[i] === '--discover') {
      parsed.discover = true;
    }
  }

  if (!parsed.batch) {
    die(
      'Usage: node scripts/publish-to-notion.js --batch <id> ' +
      '[--dry-run] [--discover] [--mapping <path>]'
    );
  }

  return parsed;
}

// ============================================================
// Helpers
// ============================================================

function log(msg) {
  process.stderr.write(`[publish] ${msg}\n`);
}

function die(msg) {
  process.stderr.write(`${msg}\n`);
  process.exit(1);
}

function loadMapping(mappingPath) {
  const abs = path.resolve(mappingPath);
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch (e) {
    die(`錯誤：無法讀取 mapping 檔案 ${abs}: ${e.message}`);
  }
}

function saveMapping(mapping, mappingPath) {
  const abs = path.resolve(mappingPath);
  fs.writeFileSync(abs, JSON.stringify(mapping, null, 2) + '\n', 'utf-8');
}

function resolveOutputMd(batch) {
  const outputMd = path.join(
    process.cwd(),
    `${batch}-SRS`,
    'output',
    `requirements-${batch}.md`
  );
  if (!fs.existsSync(outputMd)) {
    die(`錯誤：找不到 output markdown ${outputMd}`);
  }
  return outputMd;
}

function md5File(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('md5').update(content).digest('hex');
}

function extractPlainText(richTextArray) {
  return (richTextArray || []).map((rt) => rt.plain_text || '').join('');
}

function notionPageUrl(pageId) {
  return `https://www.notion.so/${pageId.replace(/-/g, '')}`;
}

// ============================================================
// Pagination Helper
// ============================================================

async function getAllBlockChildren(blockId) {
  const allResults = [];
  let cursor;
  do {
    const res = await api.getBlockChildren(blockId, cursor);
    allResults.push(...res.results);
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);
  return allResults;
}

// ============================================================
// Discover Mode (10.2)
// ============================================================

async function discover(mapping, batch, mappingPath) {
  const batchData = mapping.batches[batch];
  if (!batchData) {
    die(`錯誤：mapping 中找不到 batch "${batch}"`);
  }

  const parentId = batchData.parent_page_id;
  if (!parentId) {
    die(`錯誤：batch "${batch}" 缺少 parent_page_id`);
  }

  const { sandbox } = batchData;
  if (!sandbox) {
    die(`錯誤：batch "${batch}" 缺少 sandbox 設定`);
  }

  const toggleLabel = sandbox.toggle_label;
  const childPageTitle = sandbox.child_page_title;

  log(`discover: 在 parent ${parentId} 中搜尋 toggle "${toggleLabel}" → child_page "${childPageTitle}"`);

  const parentChildren = await getAllBlockChildren(parentId);

  // Find toggle heading matching toggle_label
  let targetToggleId = null;
  for (const block of parentChildren) {
    const blockType = block.type;
    if (blockType && blockType.startsWith('heading_')) {
      const headingData = block[blockType];
      if (headingData && headingData.is_toggleable) {
        const text = extractPlainText(headingData.rich_text);
        if (text.trim() === toggleLabel.trim()) {
          targetToggleId = block.id;
          break;
        }
      }
    }
    if (blockType === 'toggle') {
      const text = extractPlainText(block.toggle.rich_text);
      if (text.trim() === toggleLabel.trim()) {
        targetToggleId = block.id;
        break;
      }
    }
  }

  if (!targetToggleId) {
    die(
      `錯誤：在 parent page 中找不到 toggle "${toggleLabel}"\n` +
      `Bootstrap 步驟：請在 Notion 的 parent page 中手動建立一個 toggle heading，` +
      `標題為「${toggleLabel}」，並在其中建立 child page「${childPageTitle}」`
    );
  }

  // Find child_page inside toggle
  const toggleChildren = await getAllBlockChildren(targetToggleId);
  let foundChildPage = null;
  for (const block of toggleChildren) {
    if (block.type === 'child_page') {
      const title = block.child_page && block.child_page.title;
      if (title && title.trim() === childPageTitle.trim()) {
        foundChildPage = block;
        break;
      }
    }
  }

  if (!foundChildPage) {
    die(
      `錯誤：在 toggle "${toggleLabel}" 中找不到 child_page "${childPageTitle}"\n` +
      `Bootstrap 步驟：請在 Notion 的 toggle block 內手動建立 child page「${childPageTitle}」`
    );
  }

  sandbox.child_page_id = foundChildPage.id;
  sandbox.child_page_url = notionPageUrl(foundChildPage.id);
  saveMapping(mapping, mappingPath);

  log(`discover: 找到 child_page_id = ${foundChildPage.id}`);
  log(`discover: child_page_url = ${sandbox.child_page_url}`);
  console.log(JSON.stringify({
    child_page_id: foundChildPage.id,
    child_page_url: sandbox.child_page_url,
  }));
}

// ============================================================
// Step A: Archive Existing Content (10.3)
// ============================================================

async function archiveExistingContent(childPageId) {
  log('Step A: 清除目標頁面既有內容...');

  const children = await getAllBlockChildren(childPageId);
  if (children.length === 0) {
    log('Step A: 頁面已為空，跳過 archive');
    return 0;
  }

  log(`Step A: 找到 ${children.length} 個 top-level blocks，開始 archive...`);
  let lastArchived = -1;
  try {
    for (let i = 0; i < children.length; i++) {
      await api.deleteBlock(children[i].id);
      lastArchived = i;
      if ((i + 1) % 20 === 0 || i === children.length - 1) {
        log(`Step A: [${i + 1}/${children.length}] archived`);
      }
    }
  } catch (err) {
    log(
      `Step A: 在第 ${lastArchived + 2}/${children.length} 個 block 失敗` +
      `（已成功 archive ${lastArchived + 1} 個）`
    );
    throw err;
  }

  log(`Step A: 完成，已 archive ${children.length} 個 blocks`);
  return children.length;
}

// ============================================================
// Step B: Image Upload (10.4)
// ============================================================

function uploadImages(batch, outputMd, mappingPath) {
  log('Step B: 掃描並上傳圖片...');

  const mdContent = fs.readFileSync(outputMd, 'utf-8');
  const mdDir = path.dirname(outputMd);
  const assetsDir = path.join(process.cwd(), `${batch}-SRS`, 'assets');

  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const manifest = {};
  let match;
  let uploadCount = 0;
  let cacheHitCount = 0;

  while ((match = imageRegex.exec(mdContent)) !== null) {
    const imgUrl = match[2];

    if (/^https?:\/\//.test(imgUrl)) continue;

    const absPath = path.resolve(mdDir, imgUrl);
    const relToAssets = path.relative(assetsDir, absPath);

    if (relToAssets.startsWith('..')) {
      log(`Step B: 警告 — 圖片 ${imgUrl} 不在 assets 目錄內，跳過上傳`);
      continue;
    }

    if (manifest[relToAssets]) continue;

    try {
      const result = execFileSync('node', [
        path.join(SCRIPT_DIR, 'notion-upload-image.js'),
        '--batch', batch,
        '--file', relToAssets,
        '--mapping', mappingPath,
      ], { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'inherit'] });

      const parsed = JSON.parse(result.trim());
      manifest[relToAssets] = { file_upload_id: parsed.file_upload_id };

      if (parsed.cached) {
        cacheHitCount++;
      } else {
        uploadCount++;
      }
    } catch (e) {
      log(`Step B: 警告 — 上傳 ${relToAssets} 失敗: ${e.message}`);
    }
  }

  const totalImages = Object.keys(manifest).length;
  log(
    `Step B: 完成 — ${totalImages} 張圖片` +
    `（${uploadCount} 上傳, ${cacheHitCount} cache hit）`
  );

  if (totalImages === 0) return null;

  const manifestPath = path.join(
    os.tmpdir(),
    `publish-manifest-${batch}-${Date.now()}.json`
  );
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  log(`Step B: manifest 寫入 ${manifestPath}`);

  return manifestPath;
}

// ============================================================
// Step C: Convert Markdown → Block JSON (10.5)
// ============================================================

function convertMarkdown(outputMd, manifestPath) {
  log('Step C: 轉換 markdown → Notion block JSON...');

  const uvArgs = ['run', path.join(SCRIPT_DIR, 'md-to-notion-blocks.py'), outputMd];
  if (manifestPath) {
    uvArgs.push('--images-manifest', manifestPath);
  }

  let stdout;
  try {
    stdout = execFileSync('uv', uvArgs, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'inherit'],
    });
  } catch (e) {
    if (e.code === 'ENOENT') {
      die(
        '錯誤：找不到 uv 指令。請先安裝：brew install uv\n' +
        '  uv 用於執行 Python converter（md-to-notion-blocks.py）'
      );
    }
    die(`錯誤：converter 執行失敗 — ${e.message}`);
  }

  let blocks;
  try {
    blocks = JSON.parse(stdout);
  } catch (e) {
    die(`錯誤：converter 輸出不是合法 JSON — ${e.message}`);
  }

  if (!Array.isArray(blocks)) {
    die('錯誤：converter 輸出不是 JSON 陣列');
  }

  log(`Step C: 完成 — ${blocks.length} 個 top-level blocks`);
  return blocks;
}

// ============================================================
// Step D: Safety Check (10.6)
// ============================================================

function countBlocks(blocks, depth) {
  let count = 0;
  let maxDepth = depth;
  for (const block of blocks) {
    count++;
    const children = block.children ||
      (block[block.type] && block[block.type].children);
    if (children && Array.isArray(children)) {
      const sub = countBlocks(children, depth + 1);
      count += sub.count;
      if (sub.maxDepth > maxDepth) maxDepth = sub.maxDepth;
    }
  }
  return { count, maxDepth };
}

function safetyCheck(blocks) {
  log('Step D: Safety check...');

  const { count: totalCount, maxDepth } = countBlocks(blocks, 0);
  const columnListCount = blocks.filter((b) => b.type === 'column_list').length;

  log(`Step D: ${blocks.length} top-level, ${totalCount} total (含巢狀), 最大深度 ${maxDepth}, ${columnListCount} column_list`);

  if (blocks.length > MAX_BLOCKS) {
    die(
      `錯誤：top-level block 數 ${blocks.length} 超過 ${MAX_BLOCKS} 上限。` +
      '請考慮拆分為多個頁面'
    );
  }

  if (blocks.length > WARN_BLOCKS) {
    log(`Step D: 警告 — top-level block 數 ${blocks.length} 接近 ${MAX_BLOCKS} 上限`);
  }

  const appendBatches = Math.ceil(blocks.length / BATCH_SIZE);
  const estimatedCalls = appendBatches;

  return { totalCount, maxDepth, columnListCount, appendBatches, estimatedCalls };
}

// ============================================================
// Step E: Append Blocks to Notion (10.7)
// ============================================================

/**
 * Two-pass append for a single column_list block (422 fallback).
 *
 * Pass 1: append column_list with empty columns
 * Pass 2: GET column IDs, then append saved children to each column
 */
async function appendColumnListTwoPass(parentId, block) {
  const originalColumns = block.children || [];
  const savedColumnChildren = originalColumns.map((col) => col.children || []);

  const strippedColumns = originalColumns.map((col) => {
    const { children: _children, ...rest } = col;
    return rest;
  });

  const strippedBlock = {
    type: 'column_list',
    column_list: block.column_list || {},
    children: strippedColumns,
  };

  const appendRes = await api.appendBlockChildren(parentId, [strippedBlock]);
  const columnListId = appendRes.results && appendRes.results[0] && appendRes.results[0].id;

  if (!columnListId) {
    throw new Error('two-pass: append column_list 回傳缺少 block id');
  }

  // GET column IDs (not in PATCH response)
  const columnsRes = await api.getBlockChildren(columnListId);
  const columnIds = columnsRes.results.map((c) => c.id);

  if (columnIds.length !== originalColumns.length) {
    log(
      `two-pass 警告：預期 ${originalColumns.length} 個 columns，` +
      `實際取得 ${columnIds.length} 個 — 可能有 children 遺失`
    );
  }

  for (let i = 0; i < columnIds.length && i < savedColumnChildren.length; i++) {
    const children = savedColumnChildren[i];
    if (children.length > 0) {
      await api.appendBlockChildren(columnIds[i], children);
    }
  }
}

/**
 * Append a batch of blocks. On 422 with column_list present,
 * falls back to per-block append with two-pass for column_lists.
 */
async function appendBatch(parentId, blocks, batchLabel) {
  try {
    await api.appendBlockChildren(parentId, blocks);
    return;
  } catch (err) {
    const hasColumnList = blocks.some((b) => b.type === 'column_list');
    if (err.status !== 422 || !hasColumnList) {
      throw err;
    }
    log(`${batchLabel} 422 detected — falling back to column_list two-pass`);
  }

  for (const block of blocks) {
    if (block.type === 'column_list') {
      await appendColumnListTwoPass(parentId, block);
    } else {
      await api.appendBlockChildren(parentId, [block]);
    }
  }
}

async function appendBlocks(childPageId, blocks) {
  log('Step E: 開始 append blocks...');

  const totalBlocks = blocks.length;
  let appended = 0;

  for (let i = 0; i < totalBlocks; i += BATCH_SIZE) {
    const batch = blocks.slice(i, Math.min(i + BATCH_SIZE, totalBlocks));
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(totalBlocks / BATCH_SIZE);
    const label = `[${batchNum}/${totalBatches}]`;

    await appendBatch(childPageId, batch, label);

    appended += batch.length;
    log(`${label} appended ${batch.length} blocks (${appended}/${totalBlocks})`);
  }

  log(`Step E: 完成 — 共 append ${appended} blocks`);
}

// ============================================================
// Step F: State Update (10.8)
// ============================================================

function updateState(mapping, batch, outputMd, mappingPath) {
  log('Step F: 更新 mapping state...');

  const batchData = mapping.batches[batch];
  const md5 = md5File(outputMd);

  batchData.sandbox.last_synced_at = new Date().toISOString();
  batchData.sandbox.last_synced_source_md5 = md5;
  saveMapping(mapping, mappingPath);

  log(`Step F: last_synced_source_md5 = ${md5}`);
  log(`Step F: last_synced_at = ${batchData.sandbox.last_synced_at}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  const { batch, mapping: mappingPath, dryRun, discover: discoverMode } = args;

  const mapping = loadMapping(mappingPath);

  if (!mapping.batches || !mapping.batches[batch]) {
    die(`錯誤：mapping 中找不到 batch "${batch}"`);
  }

  // --discover mode: find child_page and exit
  if (discoverMode) {
    await discover(mapping, batch, mappingPath);
    return;
  }

  const batchData = mapping.batches[batch];
  const childPageId = batchData.sandbox && batchData.sandbox.child_page_id;

  if (!childPageId) {
    die(
      `錯誤：batch "${batch}" 的 sandbox.child_page_id 尚未設定。\n` +
      `請先執行：node scripts/publish-to-notion.js --discover --batch ${batch}`
    );
  }

  const outputMd = resolveOutputMd(batch);

  log(`batch: ${batch}`);
  log(`output: ${outputMd}`);
  log(`target: ${childPageId}`);
  log(`mode: ${dryRun ? 'dry-run' : 'publish'}`);
  log('');

  // Step A: Archive existing content
  const archivedCount = await archiveExistingContent(childPageId);

  // Step B: Upload images
  const manifestPath = uploadImages(batch, outputMd, mappingPath);

  // Step C: Convert markdown → block JSON
  const blocks = convertMarkdown(outputMd, manifestPath);

  // Step D: Safety check
  const stats = safetyCheck(blocks);

  if (dryRun) {
    log('');
    log('=== DRY-RUN PREVIEW ===');
    console.log(JSON.stringify({
      batch,
      mode: 'dry-run',
      archived_blocks: archivedCount,
      top_level_blocks: blocks.length,
      total_blocks: stats.totalCount,
      max_depth: stats.maxDepth,
      column_list_count: stats.columnListCount,
      estimated_append_batches: stats.appendBatches,
      estimated_api_calls: stats.estimatedCalls,
      images_manifest: manifestPath || null,
    }, null, 2));
    log('dry-run 完成 — Steps E/F 已跳過');
    return;
  }

  // Step E: Append blocks
  await appendBlocks(childPageId, blocks);

  // Step F: State update
  // Reload mapping from disk — Step B's child processes wrote image cache
  // entries directly to the file, so our in-memory copy is stale.
  const freshMapping = loadMapping(mappingPath);
  updateState(freshMapping, batch, outputMd, mappingPath);

  // Final report
  log('');
  log('=== PUBLISH COMPLETE ===');
  console.log(JSON.stringify({
    batch,
    mode: 'publish',
    archived_blocks: archivedCount,
    appended_blocks: blocks.length,
    total_blocks: stats.totalCount,
    column_list_count: stats.columnListCount,
    child_page_id: childPageId,
    child_page_url: notionPageUrl(childPageId),
    synced_at: freshMapping.batches[batch].sandbox.last_synced_at,
    source_md5: freshMapping.batches[batch].sandbox.last_synced_source_md5,
  }, null, 2));
}

main().catch((err) => {
  process.stderr.write(`\n[publish] 錯誤：${err.message || err}\n`);
  if (err.status) {
    process.stderr.write(`  Notion API: ${err.status} ${err.code} — ${err.message}\n`);
  }
  if (err.requestId) {
    process.stderr.write(`  Request ID: ${err.requestId}\n`);
  }
  process.exit(1);
});
