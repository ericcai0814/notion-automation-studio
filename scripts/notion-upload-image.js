#!/usr/bin/env node
/**
 * notion-upload-image.js — Notion file_upload CLI for single images
 *
 * Uploads a single image file via Notion's file_upload API (single_part mode).
 * Uses md5 cache in notion-mapping.json to skip re-uploads when file content
 * hasn't changed.
 *
 * Exit codes:
 *   0 — success (uploaded or cache hit)
 *   1 — error (file not found, too large, API error)
 *
 * Usage:
 *   node scripts/notion-upload-image.js --batch <id> --file <relative_path> [--mapping <path>]
 *
 * stdout (JSON):
 *   { "file_upload_id": "...", "md5": "...", "cached": true|false }
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

// ============================================================
// CLI Argument Parsing
// ============================================================

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = { mapping: './.claude/notion-mapping.json' };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch' && args[i + 1]) {
      parsed.batch = args[++i];
    } else if (args[i] === '--file' && args[i + 1]) {
      parsed.file = args[++i];
    } else if (args[i] === '--mapping' && args[i + 1]) {
      parsed.mapping = args[++i];
    }
  }

  if (!parsed.batch || !parsed.file) {
    console.error(
      'Usage: node scripts/notion-upload-image.js --batch <id> --file <relative_path> [--mapping <path>]'
    );
    process.exit(1);
  }

  return parsed;
}

// ============================================================
// MIME Type Detection
// ============================================================

function detectContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.bmp': 'image/bmp',
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ============================================================
// Main
// ============================================================

async function main() {
  const { batch, file: relativeFile, mapping: mappingPath } = parseArgs();

  // --- Resolve the actual file path ---
  // relativeFile is relative to {batch}-SRS/assets/ in the downstream project
  // The mapping is in the project root, so resolve from cwd
  const batchAssetsDir = path.join(process.cwd(), `${batch}-SRS`, 'assets');
  const filePath = path.join(batchAssetsDir, relativeFile);

  // --- Validate file ---
  if (!fs.existsSync(filePath)) {
    console.error(`錯誤：找不到檔案 ${filePath}`);
    process.exit(1);
  }

  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_SIZE) {
    console.error(
      `錯誤：檔案 ${relativeFile} 大小 ${(stat.size / 1024 / 1024).toFixed(1)} MB 超過 20 MB 上限`
    );
    process.exit(1);
  }

  // --- Read file and compute md5 ---
  const buffer = fs.readFileSync(filePath);
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');

  // --- Load mapping ---
  const absMappingPath = path.resolve(mappingPath);
  let mapping;
  try {
    mapping = JSON.parse(fs.readFileSync(absMappingPath, 'utf-8'));
  } catch (e) {
    console.error(`錯誤：無法讀取 mapping 檔案 ${absMappingPath}: ${e.message}`);
    process.exit(1);
  }

  if (!mapping.batches || !mapping.batches[batch]) {
    console.error(`錯誤：mapping 中找不到 batch "${batch}"`);
    process.exit(1);
  }

  const batchData = mapping.batches[batch];
  if (!batchData.images) {
    batchData.images = {};
  }

  // --- Cache check ---
  const cached = batchData.images[relativeFile];
  if (cached && cached.md5 === md5 && cached.file_upload_id) {
    const result = {
      file_upload_id: cached.file_upload_id,
      md5,
      cached: true,
    };
    console.log(JSON.stringify(result));
    return;
  }

  // --- Cache miss: upload via Notion API ---
  const api = require('./notion-api-client');
  const filename = path.basename(filePath);
  const contentType = detectContentType(filePath);

  console.error(`上傳 ${relativeFile} (${contentType}, ${(stat.size / 1024).toFixed(0)} KB)...`);

  // Step 1: Create file_upload
  const createRes = await api.createFileUpload({
    mode: 'single_part',
    filename,
    content_type: contentType,
  });

  const uploadId = createRes.id;
  if (!uploadId) {
    console.error('錯誤：createFileUpload 回應缺少 id', JSON.stringify(createRes));
    process.exit(1);
  }

  // Step 2: Send file data
  const sendRes = await api.sendFileUpload(uploadId, buffer, filename, contentType);

  if (sendRes.status && sendRes.status !== 'uploaded') {
    console.error(
      `警告：sendFileUpload 回傳 status="${sendRes.status}"（預期 "uploaded"）`
    );
  }

  // --- Update mapping ---
  batchData.images[relativeFile] = {
    md5,
    file_upload_id: uploadId,
    uploaded_at: new Date().toISOString(),
  };
  fs.writeFileSync(absMappingPath, JSON.stringify(mapping, null, 2) + '\n', 'utf-8');

  const result = {
    file_upload_id: uploadId,
    md5,
    cached: false,
  };
  console.log(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`錯誤：${err.message || err}`);
  if (err.status) {
    console.error(`  Notion API: ${err.status} ${err.code} — ${err.message}`);
  }
  if (err.requestId) {
    console.error(`  Request ID: ${err.requestId}`);
  }
  process.exit(1);
});
