# notion-api-client Specification

## Purpose

Reusable Node.js module providing a rate-limited, retry-capable wrapper around
the Notion REST API. Zero npm dependencies, Node 18+ stdlib only. Consumed via
CommonJS `require()` by the publish orchestrator and image uploader.

## Requirements

### Requirement: Client module surface

The plugin SHALL provide a reusable Notion REST API client at
`scripts/notion-api-client.js`. The module SHALL export, at minimum,
the following functions:

- `postPage(parent, properties, children)` — create page
- `retrievePage(pageId)` — get page metadata
- `getBlockChildren(blockId, options)` — paginated list
- `appendBlockChildren(blockId, children, options)` — append blocks
- `deleteBlock(blockId)` — archive block
- `createFileUpload(options)` — initiate file upload
- `sendFileUpload(fileUploadId, buffer, filename, contentType)` —
  upload bytes

The client SHALL run under Node.js 18+ using only stdlib APIs
(`fetch`, `FormData`, `Blob`, `fs`, `path`, `crypto`, `process`). The
plugin SHALL NOT add npm dependencies for this capability.

#### Scenario: Module consumers

- **WHEN** another script in `scripts/` requires
  `./notion-api-client.js`
- **THEN** the module exports are available via CommonJS
  `require()` or ESM `import` (whichever matches plugin convention)
- **AND** each function returns a Promise that resolves to the
  Notion API JSON body on 2xx responses, or rejects with a
  standardized error shape on non-2xx

---
### Requirement: Token discovery

The client SHALL discover the Notion integration token from the
following sources, in order of precedence:

1. `process.env.NOTION_TOKEN`
2. `./.mcp.json` at
   `mcpServers.notionApi.env.NOTION_TOKEN`
3. `~/.mcp.json` at the same path

The client SHALL NOT log the token, print it to stderr, pass it to
child processes unless explicitly required, or cache it in any file.

#### Scenario: Environment variable present

- **WHEN** `NOTION_TOKEN=secret` is exported in the shell
- **THEN** the client uses that value and does not read any
  `.mcp.json`

#### Scenario: Fallback to project .mcp.json

- **WHEN** `NOTION_TOKEN` env var is empty and `./.mcp.json`
  contains a valid `notionApi` server with a token
- **THEN** the client reads the token from `./.mcp.json`

#### Scenario: No token found

- **WHEN** none of the three sources yield a token
- **THEN** the client throws an error on first request attempt,
  with message naming all three sources and guidance to configure
  one of them
- **AND** the error SHALL NOT contain token-shaped strings

---
### Requirement: Standard headers

Every request SHALL include:

- `Authorization: Bearer <token>`
- `Notion-Version: 2022-06-28`
- `Content-Type: application/json` (for JSON body requests;
  multipart uploads use automatic boundary)
- `Accept: application/json`

#### Scenario: JSON POST request

- **WHEN** `appendBlockChildren` is called
- **THEN** the outgoing request includes all four headers and a
  JSON-serialized body
- **AND** the `Notion-Version` value is the literal string
  `2022-06-28`

#### Scenario: Multipart file upload

- **WHEN** `sendFileUpload` is called with a Buffer
- **THEN** the outgoing request uses `FormData` with a `Blob` wrapper
  for the buffer
- **AND** the client does NOT set a `Content-Type` header, allowing
  `fetch` to inject the multipart boundary automatically

---
### Requirement: Rate limit enforcement

The client SHALL implement a token bucket rate limiter with:

- Capacity: 5 tokens (initial and maximum)
- Refill rate: 3 tokens per second (continuously)
- Acquire cost: 1 token per request

Before every API call, the client SHALL `await acquireToken()`, which
blocks until at least 1 token is available. The implementation SHALL
be process-local (no cross-process coordination).

#### Scenario: Burst within capacity

- **WHEN** 5 requests are issued in rapid succession starting from a
  full bucket
- **THEN** all 5 requests dispatch immediately, without wait

#### Scenario: Sustained rate

- **WHEN** the client issues 10 sequential requests from an empty
  bucket
- **THEN** the average throughput over the last 9 requests is
  approximately 3 per second (total duration >= 2.67 seconds and
  <= 3.33 seconds)

#### Scenario: Rate limiter is per-process

- **WHEN** two `node` processes each require the module and issue
  requests concurrently
- **THEN** they do NOT share token state; each has its own bucket
- **AND** the module SHALL NOT guarantee a global aggregate rate
  limit across independent processes

---
### Requirement: 429 retry with Retry-After

When the server responds with HTTP 429, the client SHALL read the
`Retry-After` header (in seconds), wait for that duration, and
retry the same request. Retries SHALL be limited to 5 attempts per
request with exponential backoff factor 2 if `Retry-After` is absent.

#### Scenario: Explicit Retry-After

- **WHEN** the server responds with `429` and `Retry-After: 2`
- **THEN** the client waits 2 seconds before retry

#### Scenario: Missing Retry-After header

- **WHEN** the server responds with `429` but no `Retry-After`
- **THEN** the client applies exponential backoff:
  1 second, 2 seconds, 4 seconds, 8 seconds, 16 seconds

#### Scenario: Retry budget exhausted

- **WHEN** 5 consecutive retries all fail with 429
- **THEN** the client throws an error with code `rate_limited`,
  message naming the endpoint, and a `retriesExhausted: true` flag

---
### Requirement: Standardized error shape

On non-2xx responses (other than 429 handled above), the client SHALL
throw an error object with:

- `status` — HTTP status code (integer)
- `code` — Notion API error code (string, from response body) or
  fallback `http_<status>`
- `message` — human-readable message (from response body or status
  text)
- `requestId` — Notion `request_id` header if present, else null
- `endpoint` — the path segment that failed (e.g., `/v1/blocks/xxx`)

#### Scenario: 404 on delete

- **WHEN** `deleteBlock("nonexistent-id")` returns 404
- **THEN** the thrown error has `status: 404`, `code:
  "object_not_found"` (or similar), and `endpoint: "/v1/blocks/nonexistent-id"`

#### Scenario: 400 validation error

- **WHEN** `appendBlockChildren` receives a 400 with a Notion error
  body `{code: "validation_error", message: "body failed validation"}`
- **THEN** the thrown error has `status: 400`,
  `code: "validation_error"`, and the full Notion message

#### Scenario: 5xx server error

- **WHEN** the server returns 503
- **THEN** the client does NOT retry (retries are reserved for 429)
- **AND** the thrown error has `status: 503`, `code: "http_503"`

---
### Requirement: Pagination helpers

`getBlockChildren` SHALL handle cursor-based pagination automatically
when called with `{fetchAll: true}` option, returning a flat array of
all children across pages. Without that option, it returns a single
page response as-is.

#### Scenario: Single page

- **WHEN** `getBlockChildren(id)` is called and the response has
  `has_more: false`
- **THEN** the client returns the response object with `results` and
  other metadata intact

#### Scenario: Fetch all pages

- **WHEN** `getBlockChildren(id, {fetchAll: true})` is called and
  the parent has 250 children
- **THEN** the client makes 3 requests (page_size 100, 100, 50) and
  returns a single array of 250 block objects
- **AND** the rate limiter correctly accounts for the 3 underlying
  requests
