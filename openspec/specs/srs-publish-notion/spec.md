# srs-publish-notion Specification

## Purpose

TBD - created by archiving change 'bootstrap-existing-specs'. Update Purpose after archive.

## Requirements

### Requirement: Notion structure contract

After every successful publish, the target Notion child page SHALL be
in the following state. Any manual edit that violates this contract
WILL be overwritten on the next publish:

1. **Flat structure** — the page SHALL contain zero child pages; all
   requirements SHALL be inlined on this page
2. **Top warning callout** — the first block SHALL be a callout whose
   body instructs the reader not to edit manually and warns that next
   publish will overwrite everything
3. **Fixed three-section order** — `壹、版本說明` → `貳、需求大綱` →
   `參、需求內容`
4. **One-way flow** — markdown is source of truth, Notion is a mirror;
   reverse synchronization SHALL NOT occur

#### Scenario: Existing child pages found on publish target

- **WHEN** the target child page contains one or more sub-pages at
  publish time
- **THEN** the skill SHALL archive each sub-page via
  `notion-update-page` with command `archive` before writing new
  content, and SHALL halt if any archive fails

#### Scenario: Warning callout missing after manual edit

- **WHEN** a user manually removed the top warning callout and the
  skill runs again
- **THEN** the skill SHALL reinject the warning callout as the first
  block of the new content

---
### Requirement: V1 sandbox limitations

The v1 publish skill SHALL explicitly decline the following operations:

- Block-level diff (the skill performs full page rewrite via archive-then-append)
- Cross-requirement references as clickable mentions (rendered as plain
  text with warn; users can locate them with Ctrl+F)
- Automatic creation of the toggle block and initial child page (Notion
  API cannot parent a page to a `block_id`; the operator MUST perform
  the Bootstrap steps manually before first publish)
- Bidirectional sync (prohibited permanently; Notion is output-only)

> **Change note (add-publish-via-api)**: "Automatic image upload" is no
> longer a limitation — images are now uploaded via `/v1/file_uploads`
> API with md5 cache. Image placeholders are replaced with `file_upload`
> image blocks.

#### Scenario: Source file contains image references

- **WHEN** the source markdown contains one or more `![...](../assets/R00XX/*.png)` paths
- **THEN** the orchestrator SHALL upload each image via `file_uploads`
  API (md5 cache for dedup), generate an images manifest, and the
  converter SHALL produce `{type: "image", image: {type: "file_upload"}}`
  blocks with the corresponding `file_upload_id`

#### Scenario: Source file contains cross-requirement reference

- **WHEN** the source markdown contains `詳見【R00XX】{name}`
- **THEN** the skill SHALL pass it through as plain text without
  attempting to convert it to a Notion block mention

---
### Requirement: Batch resolution

The skill SHALL resolve the target batch ID using the following ordered
rules:

1. If the user explicitly named a batch (e.g., `PUBLISH {batch}`), use that value
2. Otherwise, use Glob to enumerate `*-SRS/` directories under the repo root
   - Exactly one directory found → use the derived batch ID automatically
   - Zero directories found → halt with "找不到任何 SRS batch"
   - Two or more directories found → halt with the candidate list and demand explicit specification

The batch ID is used to locate `{batch}-SRS/output/requirements-{batch}.md`
and to read `batches[{batch}]` from `.claude/notion-mapping.json` as
defined by the **notion-mapping-schema** capability spec. If no entry
exists for the resolved batch, the skill SHALL halt.

The skill SHALL NOT guess when auto-detection is ambiguous, because
publish is a destructive operation on Notion content.

#### Scenario: Multiple batches with no user specification

- **WHEN** the user did not specify a batch and multiple `*-SRS/`
  directories exist
- **THEN** the skill SHALL halt with a batch candidate list and MUST NOT
  make any Notion API calls

---
### Requirement: Pre-check gate before publish

Before any Notion operation, the skill SHALL run
`workflow-state.js pre-check-publish` as specified by the
**workflow-state** capability spec. The gate verifies three conditions:

1. The output file `{batch}-SRS/output/requirements-{batch}.md` exists
2. `batches.{batch}.last_sync_output_md5` is set in workflow state
3. The current md5 of the output file matches the stored value

On exit 0, the skill continues to Step 1. On exit 1 (BLOCKED), the
skill SHALL present the three-choice prompt (run srs-sync / force
continue / cancel) and act on the user's selection. On exit 2
(ERROR), the skill SHALL surface the stderr and halt.

The skill SHALL NOT write any override record when the user chooses
force continue.

#### Scenario: Output file never created

- **WHEN** pre-check-publish runs and the output file does not exist
- **THEN** the script exits 1, the skill presents the three-choice
  prompt, and MUST NOT make any Notion API calls unless the user
  explicitly chooses force continue

#### Scenario: Output file modified after last sync

- **WHEN** the output file's current md5 differs from the stored
  `last_sync_output_md5`
- **THEN** the pre-check script exits 1 and the skill SHALL present the
  three-choice prompt before proceeding

---
### Requirement: Publish gate user confirmation

Before performing any destructive Notion operation (archive or
replace_content), the skill SHALL display a preview containing source
file path, size, md5, detected requirement IDs, the list of child pages
that will be archived, the planned Notion API calls, and the risk
summary. The skill SHALL NOT advance to Step 6 without waiting for
explicit user input.

The skill SHALL accept the following agreement tokens:
`confirm`, `yes`, `y`, `OK`, `ok`, `go`, `推`, `OK 推`, `好`, `確認`,
`沒問題`. Any other input SHALL be treated as cancellation.

Cancellation SHALL result in zero Notion API calls, and the skill SHALL
report "已取消發佈，未做任何 Notion 操作".

#### Scenario: User types "cancel" at publish gate

- **WHEN** the publish preview is shown and the user types `cancel` or
  any token that is not in the agreement vocabulary
- **THEN** the skill SHALL halt with the cancellation message and make
  no Notion API calls

#### Scenario: User confirms with "推"

- **WHEN** the user types `推` at the publish gate
- **THEN** the skill SHALL treat this as confirmation and proceed to
  archive existing child pages and write new content

---
### Requirement: Discovery mode for first publish

When `batches.{batch}.sandbox.child_page_id` is null in
`.claude/notion-mapping.json` (as defined by the
**notion-mapping-schema** capability spec), the skill SHALL enter
Discovery mode:

1. Fetch the parent page identified by `batches.{batch}.parent_page_id`
   using `notion-fetch`
2. Locate the `<details>` toggle block whose `<summary>` matches
   `sandbox.toggle_label`
3. Within that toggle, find the `<page url="...">` tag whose title
   matches `sandbox.child_page_title`
4. Extract the page ID from the URL and write both `child_page_id` and
   `child_page_url` back into `.claude/notion-mapping.json`

If Discovery cannot locate the expected toggle or child page, the
skill SHALL halt with instructions pointing to the manual Bootstrap
steps and SHALL NOT modify the mapping file.

#### Scenario: Bootstrap not yet performed

- **WHEN** Discovery mode runs but no matching toggle exists under the
  parent page, or the toggle exists but the named child page is absent
- **THEN** the skill SHALL halt with Bootstrap guidance and leave the
  mapping file unmodified

#### Scenario: First publish with null child_page_id

- **WHEN** `child_page_id` is null and Discovery locates the correct
  child page under the toggle
- **THEN** the skill SHALL write the discovered `child_page_id` and
  `child_page_url` into `.claude/notion-mapping.json` and proceed to
  the pre-check gate

---
### Requirement: Content transformation to Notion-flavored markdown

The skill SHALL apply the content-layer rules defined by the
**notion-doc-writing** capability spec when transforming the source
markdown into Notion blocks. The skill SHALL load the
notion-doc-writing Pre-Write Checklist and Anti-Patterns before
constructing output.

The transformation SHALL perform the following operations in order:

1. Strip the outermost `# {child_page_title}` H1 if present; preserve
   the three fixed chapter H1 headings
2. Downgrade H5/H6 headings to H4 or convert to `<details>` toggle
3. Split paragraphs longer than 1800 characters at semantic boundaries
4. Replace each image reference `![...](../assets/R00XX/*.png)` with a
   placeholder callout and add the image to the pending-upload list
5. Pass through `詳見【R00XX】{name}` cross-references as plain text
6. Inject the top warning callout as the first content block

The skill SHALL NOT duplicate Notion-flavored markdown format rules
inline; the notion-doc-writing capability spec is the single source of
truth for those rules.

#### Scenario: Source paragraph exceeds 1800 characters

- **WHEN** a paragraph in the source file is longer than 1800
  characters
- **THEN** the skill SHALL split it at a semantic boundary before
  passing the content to Notion

#### Scenario: Source heading is H5 or H6

- **WHEN** the source markdown contains an H5 or H6 heading
- **THEN** the skill SHALL downgrade it to H4 or convert it to a
  `<details>` toggle, and SHALL count the number of such changes for
  the post-publish report

---
### Requirement: Block count estimation and large-content fallback

Before calling `replace_content`, the skill SHALL estimate the total
block count by treating each heading, paragraph, list item, and table
row as one block.

- If the estimate is 900 or fewer, the skill SHALL publish with a
  single `replace_content` call
- If the estimate exceeds 900, the skill SHALL use chunked append: a
  first `replace_content` call writes the callout and first section,
  followed by sequential `update_content` append calls, each under the
  900-block threshold

The skill SHALL report the publish mode (single call or chunked) in the
post-publish report.

#### Scenario: Batch SRS exceeds 900-block threshold

- **WHEN** the estimated block count of the transformed content exceeds
  900
- **THEN** the skill SHALL enter chunked-append mode and SHALL NOT
  attempt a single replace_content call with the full content

#### Scenario: Batch SRS is within the normal range

- **WHEN** the estimated block count is 900 or fewer
- **THEN** the skill SHALL publish with a single `replace_content` call

---
### Requirement: Mapping metadata update after publish

After replace_content succeeds, the skill SHALL update the following
fields in `.claude/notion-mapping.json` (fields defined by the
**notion-mapping-schema** capability spec):

- `batches.{batch}.sandbox.last_synced_at` — current ISO timestamp
- `batches.{batch}.sandbox.last_synced_source_md5` — md5 of the source
  file computed during the publish-gate preview

If the mapping file update fails, the skill SHALL report the failure
and SHALL NOT call `record-publish`.

#### Scenario: Successful publish updates mapping fields

- **WHEN** replace_content completes without error
- **THEN** the skill SHALL write `last_synced_at` and
  `last_synced_source_md5` into `.claude/notion-mapping.json` before
  calling record-publish

---
### Requirement: Workflow state publish record

After archive, replace_content, and mapping file update all succeed,
the skill SHALL record the batch-level publish timestamp by calling
`workflow-state.js record-publish` as specified by the
**workflow-state** capability spec.

The timestamp SHALL NOT be written if any earlier step (archive,
replace_content, or mapping update) fails, so that
`batches.{batch}.last_publish.ts` faithfully reflects the last fully
successful publish.

#### Scenario: Archive step fails mid-way

- **WHEN** one of the sub-page archive calls returns an error
- **THEN** the skill SHALL halt before replace_content and SHALL NOT
  write the publish timestamp to workflow state

#### Scenario: Full publish completes without error

- **WHEN** archive, replace_content, and mapping update all succeed
- **THEN** the skill SHALL call `workflow-state.js record-publish` and
  verify exit 0 before emitting the final post-publish report

---
### Requirement: Content-layer rules loaded from notion-doc-writing

The skill SHALL load the **notion-doc-writing** capability spec (by
reading `SKILL.md` and its support files `markdown-gotchas.md`,
`block-selection.md`, and `property-conventions.md`) before
constructing any Notion-ready markdown. The skill SHALL apply those
rules when generating callouts, headings, rich-text blocks, tables,
and code blocks.

The skill SHALL NOT re-document or inline those rules; the
notion-doc-writing capability spec is authoritative for all
content-layer formatting decisions.

#### Scenario: Callout needs emphasis markup

- **WHEN** the skill emits content inside a `<callout>` block
- **THEN** it SHALL use markdown emphasis (`**bold**`) and SHALL NOT
  emit HTML tags, per the notion-doc-writing content rules

#### Scenario: Single rich-text span exceeds limit

- **WHEN** transformed content contains a rich-text span approaching
  the 2000-character limit defined by the notion-doc-writing capability
  spec
- **THEN** the skill SHALL split the span to stay within the limit
  before the Notion API call
