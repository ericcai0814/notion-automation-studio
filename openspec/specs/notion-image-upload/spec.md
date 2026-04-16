# notion-image-upload Specification

## Purpose

Node.js CLI that uploads a single local image to Notion via the `/v1/file_uploads`
three-step API, caches the resulting `file_upload_id` in `notion-mapping.json`
keyed by file md5, and supports idempotent re-runs. Invoked by the publish
orchestrator once per image before conversion.

## Requirements

### Requirement: Uploader CLI contract

The plugin SHALL provide a CLI at `scripts/notion-upload-image.js`
that uploads a single local image file to Notion via the
`/v1/file_uploads` three-step flow (create → send → [complete, only
for multi_part]). The script SHALL NOT support `multi_part` or
`external_url` modes in v1; only `single_part` is required.

The CLI accepts:

- `--batch <id>` — required; target batch id for mapping lookup
- `--file <relative_path>` — required; path relative to the batch
  `{batch}-SRS/assets/` directory
- `--mapping <path>` — optional; defaults to
  `./.claude/notion-mapping.json`

#### Scenario: Happy-path upload

- **WHEN** the CLI runs against a 1 MB PNG at a path not yet in the
  mapping
- **THEN** the script calls `createFileUpload({mode: "single_part",
  filename, content_type: "image/png"})`, then `sendFileUpload` with
  the file buffer
- **AND** after receiving `status: "uploaded"` in the response, the
  script writes back to mapping.json and prints
  `{file_upload_id, md5, cached: false}` to stdout
- **AND** exits with code 0

#### Scenario: File not found

- **WHEN** the `--file` path does not resolve to an existing file
- **THEN** stderr names the expected absolute path and exits with
  code 1

#### Scenario: File exceeds 20 MB

- **WHEN** the target file is larger than 20 MB (single_part limit)
- **THEN** stderr reports the size and advises using a smaller image
  or waiting for multi_part support
- **AND** exits with code 1 without attempting any API call

---
### Requirement: md5 cache semantics

The uploader SHALL cache uploaded file identities in
`notion-mapping.json` under
`batches[{batch}].images[{relative_path}]` with schema:

```json
{
  "md5": "<hex_digest>",
  "file_upload_id": "<uuid>",
  "uploaded_at": "<iso8601>"
}
```

The cache key is the relative path from the `{batch}-SRS/` root
(for example `R0001/diagram.png`, not
`../assets/R0001/diagram.png` or the absolute path).

#### Scenario: Cache hit

- **WHEN** the CLI runs and the mapping already contains an entry
  for the target relative path with an md5 matching the file's
  current md5
- **THEN** the script skips all network calls and prints
  `{file_upload_id, md5, cached: true}` to stdout with exit code 0
- **AND** the mapping file SHALL NOT be rewritten (preserving
  existing `uploaded_at`)

#### Scenario: Cache miss due to md5 change

- **WHEN** the mapping contains an entry whose md5 does not match
  the current file
- **THEN** the script re-uploads the file, obtains a new
  `file_upload_id`, and overwrites the entry with the new md5 and
  new id and new timestamp

#### Scenario: Cache miss due to missing entry

- **WHEN** the mapping has no entry for the given relative path
- **THEN** the script uploads normally and creates a new mapping
  entry; other entries under `images` are untouched

---
### Requirement: Idempotence

Repeated invocations with identical file content SHALL be
idempotent: after the first successful upload, subsequent runs
SHALL produce identical output JSON (except for `cached: true`) and
SHALL NOT make any network calls.

#### Scenario: Double invocation

- **WHEN** the CLI is invoked twice with the same `--batch` and
  `--file` against an unchanged file
- **THEN** the first run reports `cached: false` and the second
  reports `cached: true`
- **AND** both print the same `file_upload_id`
- **AND** the mapping file's `uploaded_at` reflects only the first
  run

---
### Requirement: Secure mapping rewrite

When updating the mapping file, the uploader SHALL preserve all
existing top-level keys and other batches' data. Writes SHALL use
atomic replacement semantics (write to temp file, rename) to
prevent corruption if the process is interrupted.

#### Scenario: Preserving other batches

- **WHEN** the mapping contains entries for two batches and the
  uploader runs for one of them
- **THEN** after the run, the other batch's entries (including
  `parent_page_id`, `sandbox`, `images`) are unchanged byte-for-byte

#### Scenario: Interrupt during write

- **WHEN** the write-to-disk step is interrupted (SIGKILL or disk
  full)
- **THEN** the original mapping file is left intact (no partial
  write visible on disk)

---
### Requirement: Error propagation

API errors from the file upload endpoints SHALL be surfaced via
standardized error output:

- stderr contains a one-line summary with HTTP status and Notion
  error code
- exit code 1 for user-fixable errors (401 token, 403 permissions,
  413 too large)
- exit code 2 for server / transient errors (5xx, network failure)

#### Scenario: Token invalid

- **WHEN** the API responds with 401 to `createFileUpload`
- **THEN** stderr reports `unauthorized: invalid NOTION_TOKEN`
- **AND** exits with code 1
- **AND** the mapping is not modified

#### Scenario: Server error during send

- **WHEN** `createFileUpload` succeeds but `sendFileUpload` returns
  503
- **THEN** stderr reports the failing step and status
- **AND** exits with code 2
- **AND** the mapping is not modified (partial upload state is not
  persisted)

---
### Requirement: Orchestrator integration

The `scripts/publish-to-notion.js` orchestrator SHALL invoke the
uploader as a subprocess (`execFileSync`) once per image in the
source markdown, collect the resulting `file_upload_id` values into
a manifest object, and write that manifest to a temp file for the
markdown converter to consume via its `--images-manifest` flag.

#### Scenario: Batch upload from orchestrator

- **WHEN** the orchestrator publishes a batch with 11 images
- **THEN** it invokes the uploader 11 times sequentially (respecting
  the API client's rate limiter)
- **AND** assembles a manifest such as
  `{"R0001/a.png": {"file_upload_id": "uuid-1"}, ...}`
- **AND** passes the manifest path to the converter

#### Scenario: Partial upload failure

- **WHEN** the uploader fails for image #5 out of 11 (exit code 1
  or 2)
- **THEN** the orchestrator halts before calling the converter
- **AND** images #1–4 remain cached in mapping.json (so a retry
  re-uploads only #5–11)
- **AND** no Notion page content has been modified at this point
