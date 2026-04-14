#!/usr/bin/env node
/**
 * Merge SRS pipeline:
 *   {batch}-SRS/src/R*.md  →  {batch}-SRS/output/requirements-{batch}.md
 *
 * Output filename is derived from batch dir name:
 *   "3-B-SRS" → "requirements-3-B.md"
 *   "4-A-SRS" → "requirements-4-A.md"
 *
 * Behavior:
 *   - Reads all src/R*.md files, sorts by R-number
 *   - Builds 貳、需求大綱 from each file's first heading (H1 or H2)
 *   - Builds 參、需求內容 by concatenating each file's body
 *     (normalizes hierarchy so each R-section title sits at H2 under
 *     the H1 参、需求內容)
 *   - Preserves existing 壹、版本說明 table from output if present
 *
 * Heading normalization:
 *   - If src title is H1 (`# ...`): demote ALL headings by 1 (H1→H2, H2→H3, ...)
 *   - If src title is H2 (`## ...`): keep as-is
 *   - If src has no heading: prepend H2 title from filename
 *
 * Usage:
 *   node scripts/merge-srs.js <batch-dir>
 *   e.g.  node scripts/merge-srs.js 3-B-SRS
 */

const fs = require('fs');
const path = require('path');

const HEADING_RE = /^#{1,6}\s+/;
const H1_RE = /^#\s+/;
const H1_CAPTURE_RE = /^#\s+(.+?)\s*$/;

const batchDir = process.argv[2];
if (!batchDir) {
  console.error('Usage: node scripts/merge-srs.js <batch-dir>');
  process.exit(1);
}

const batchId = path.basename(batchDir).replace(/-SRS$/, '');
if (!batchId || batchId === path.basename(batchDir)) {
  console.error(`Batch dir name must end with "-SRS": ${batchDir}`);
  process.exit(1);
}

const srcDir = path.join(batchDir, 'src');
const outputDir = path.join(batchDir, 'output');
const outputFile = path.join(outputDir, `requirements-${batchId}.md`);

if (!fs.existsSync(srcDir)) {
  console.error(`Source directory not found: ${srcDir}`);
  process.exit(1);
}
fs.mkdirSync(outputDir, { recursive: true });

const files = fs.readdirSync(srcDir)
  .filter(f => /^R\d{4}_.+\.md$/.test(f))
  .sort();

if (files.length === 0) {
  console.error(`No R*.md files found in ${srcDir}`);
  process.exit(1);
}

function normalizeSection(content, title) {
  const lines = content.split('\n');
  const firstHeadingIdx = lines.findIndex(l => HEADING_RE.test(l));

  if (firstHeadingIdx === -1) {
    return `## ${title}\n\n${content.trim()}`;
  }

  const firstHeading = lines[firstHeadingIdx];
  const level = firstHeading.match(/^(#+)/)[1].length;

  if (level === 1) {
    const demoted = lines.map(l => HEADING_RE.test(l) ? '#' + l : l);
    demoted[firstHeadingIdx] = `## ${title}`;
    return demoted.join('\n').trim();
  }

  if (level === 2) {
    const out = [...lines];
    out[firstHeadingIdx] = `## ${title}`;
    return out.join('\n').trim();
  }

  return `## ${title}\n\n${content.trim()}`;
}

const sections = files.map(f => {
  const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
  const titleMatch = content.match(/^#{1,2}\s+(.+?)\s*$/m);
  const title = titleMatch ? titleMatch[1].trim() : f.replace(/\.md$/, '');
  const body = normalizeSection(content, title);
  return { file: f, title, body };
});

function extractH1Section(text, h1Title) {
  const lines = text.split('\n');
  const startIdx = lines.findIndex(l => {
    const m = l.match(H1_CAPTURE_RE);
    return m !== null && m[1] === h1Title;
  });
  if (startIdx === -1) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (H1_RE.test(lines[i])) {
      endIdx = i;
      break;
    }
  }
  return lines.slice(startIdx, endIdx).join('\n').trim();
}

const DEFAULT_VERSION = `# 壹、版本說明

| 修改日期 | 需求編號 | 修改項目 |
|---|---|---|
| (尚無記錄) | | |`;

let versionSection = DEFAULT_VERSION;
if (fs.existsSync(outputFile)) {
  const existing = fs.readFileSync(outputFile, 'utf8');
  const found = extractH1Section(existing, '壹、版本說明');
  if (found) versionSection = found;
}

const outlineSection = '# 貳、需求大綱\n\n' +
  sections.map(s => `- ${s.title}`).join('\n');

const contentSection = '# 參、需求內容\n\n' +
  sections.map(s => s.body).join('\n\n---\n\n');

const output = [versionSection, outlineSection, contentSection].join('\n\n') + '\n';

fs.writeFileSync(outputFile, output);
console.log(`✓ Merged ${sections.length} requirements → ${outputFile}`);
console.log(`  batch: ${batchId}`);
sections.forEach(s => console.log(`  · ${s.file}  ${s.title}`));
