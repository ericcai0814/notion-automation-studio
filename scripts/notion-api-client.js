#!/usr/bin/env node
/**
 * notion-api-client.js — Notion REST API client (zero npm dependencies)
 *
 * Node 18+ built-in fetch wrapper with token bucket rate limiter
 * and 429 retry. Designed for the publish-to-notion orchestrator.
 *
 * Token resolution order:
 *   1. process.env.NOTION_TOKEN
 *   2. ./.mcp.json → mcpServers.notionApi.env.NOTION_TOKEN
 *   3. ~/.mcp.json → mcpServers.notionApi.env.NOTION_TOKEN
 *
 * Usage:
 *   const api = require('./notion-api-client');
 *   const page = await api.retrievePage(pageId);
 *   const { results } = await api.getBlockChildren(blockId);
 *   await api.appendBlockChildren(blockId, blocks);
 *   await api.deleteBlock(blockId);
 *   const upload = await api.createFileUpload({ mode: 'single_part', filename, content_type });
 *   await api.sendFileUpload(upload.id, buffer, filename, 'image/png');
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================================
// Constants
// ============================================================

const API_BASE = 'https://api.notion.com/v1';
const API_VERSION = '2022-06-28';
const MAX_RETRIES = 5;
const BACKOFF_FACTOR = 2;
const BUCKET_CAPACITY = 5;
const BUCKET_REFILL_RATE = 3; // tokens per second

// ============================================================
// Token Resolution
// ============================================================

let _cachedToken = null;

/**
 * Resolve Notion API token from env → ./.mcp.json → ~/.mcp.json.
 * Caches on first successful resolution.
 */
function resolveToken() {
  if (_cachedToken) return _cachedToken;

  // 1. Environment variable
  if (process.env.NOTION_TOKEN) {
    _cachedToken = process.env.NOTION_TOKEN;
    return _cachedToken;
  }

  // 2. Local .mcp.json
  const localToken = _readMcpToken(path.join(process.cwd(), '.mcp.json'));
  if (localToken) {
    _cachedToken = localToken;
    return _cachedToken;
  }

  // 3. Home .mcp.json
  const homeToken = _readMcpToken(path.join(os.homedir(), '.mcp.json'));
  if (homeToken) {
    _cachedToken = homeToken;
    return _cachedToken;
  }

  throw new Error(
    'NOTION_TOKEN not found. Checked: process.env.NOTION_TOKEN, ' +
    './.mcp.json → mcpServers.notionApi.env.NOTION_TOKEN, ' +
    '~/.mcp.json → mcpServers.notionApi.env.NOTION_TOKEN'
  );
}

function _readMcpToken(filePath) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const token = data &&
      data.mcpServers &&
      data.mcpServers.notionApi &&
      data.mcpServers.notionApi.env &&
      data.mcpServers.notionApi.env.NOTION_TOKEN;
    return token || null;
  } catch {
    return null;
  }
}

// ============================================================
// Token Bucket Rate Limiter
// ============================================================

const _bucket = {
  tokens: BUCKET_CAPACITY,
  lastRefill: Date.now(),
};

const _sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquire one token from the bucket. Blocks until a token is available.
 */
async function _acquireToken() {
  const now = Date.now();
  const elapsed = (now - _bucket.lastRefill) / 1000;
  _bucket.tokens = Math.min(
    BUCKET_CAPACITY,
    _bucket.tokens + elapsed * BUCKET_REFILL_RATE
  );
  _bucket.lastRefill = now;

  if (_bucket.tokens >= 1) {
    _bucket.tokens -= 1;
    return;
  }

  // Wait until one token is available
  const waitMs = Math.ceil((1 - _bucket.tokens) / BUCKET_REFILL_RATE * 1000);
  await _sleep(waitMs);
  _bucket.tokens = 0;
  _bucket.lastRefill = Date.now();
}

// ============================================================
// Error Handling
// ============================================================

/**
 * Build standardized error from Notion API response.
 */
function _makeError(status, body, requestId) {
  const err = new Error(body.message || `Notion API error ${status}`);
  err.status = status;
  err.code = body.code || 'unknown';
  err.requestId = requestId;
  return err;
}

async function _safeJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ============================================================
// Core Request (with rate limit + 429 retry)
// ============================================================

/**
 * Send a request to the Notion API.
 *
 * @param {string} method       HTTP method
 * @param {string} apiPath      Path relative to API_BASE (e.g. '/pages/xxx')
 * @param {*} bodyOrFactory     JSON-serializable body, FormData, or
 *                              a function returning FormData (for retry support)
 * @param {object} extraHeaders Additional headers to merge
 */
async function request(method, apiPath, bodyOrFactory, extraHeaders) {
  const token = resolveToken();
  const url = `${API_BASE}${apiPath}`;

  const baseHeaders = {
    'Authorization': `Bearer ${token}`,
    'Notion-Version': API_VERSION,
  };
  if (extraHeaders) {
    Object.assign(baseHeaders, extraHeaders);
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await _acquireToken();

    const headers = { ...baseHeaders };
    const options = { method, headers };

    if (bodyOrFactory !== undefined && bodyOrFactory !== null) {
      const body = typeof bodyOrFactory === 'function'
        ? bodyOrFactory()
        : bodyOrFactory;

      if (body instanceof FormData) {
        // Let fetch set Content-Type with multipart boundary
        options.body = body;
      } else {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }
    }

    const res = await fetch(url, options);

    if (res.status === 429) {
      if (attempt >= MAX_RETRIES) {
        const errBody = await _safeJson(res);
        throw _makeError(429, errBody, res.headers.get('x-request-id'));
      }
      const retryAfter = parseFloat(res.headers.get('Retry-After'))
        || (BACKOFF_FACTOR ** attempt);
      console.error(
        `[notion-api] 429 rate limited, retry ${attempt + 1}/${MAX_RETRIES} ` +
        `after ${retryAfter}s`
      );
      await _sleep(retryAfter * 1000);
      continue;
    }

    if (!res.ok) {
      const errBody = await _safeJson(res);
      throw _makeError(res.status, errBody, res.headers.get('x-request-id'));
    }

    // 204 No Content (e.g. some DELETE responses)
    if (res.status === 204) return {};

    return res.json();
  }
}

// ============================================================
// Public API Methods
// ============================================================

async function postPage(body) {
  return request('POST', '/pages', body);
}

async function retrievePage(pageId) {
  return request('GET', `/pages/${pageId}`);
}

async function getBlockChildren(blockId, startCursor) {
  const qs = startCursor ? `?start_cursor=${encodeURIComponent(startCursor)}` : '';
  return request('GET', `/blocks/${blockId}/children${qs}`);
}

async function appendBlockChildren(blockId, children) {
  return request('PATCH', `/blocks/${blockId}/children`, { children });
}

async function deleteBlock(blockId) {
  return request('DELETE', `/blocks/${blockId}`);
}

async function createFileUpload(payload) {
  return request('POST', '/file_uploads', payload);
}

/**
 * Send file data to a pending file_upload.
 * Uses a body factory so the FormData can be reconstructed on 429 retry.
 *
 * @param {string} uploadId     file_upload ID from createFileUpload
 * @param {Buffer} buffer       File content
 * @param {string} filename     Original filename
 * @param {string} contentType  MIME type (must match createFileUpload's content_type)
 */
async function sendFileUpload(uploadId, buffer, filename, contentType) {
  const bodyFactory = () => {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: contentType }), filename);
    return form;
  };
  return request('POST', `/file_uploads/${uploadId}/send`, bodyFactory);
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  postPage,
  retrievePage,
  getBlockChildren,
  appendBlockChildren,
  deleteBlock,
  createFileUpload,
  sendFileUpload,
};
