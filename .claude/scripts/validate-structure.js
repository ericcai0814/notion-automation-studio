#!/usr/bin/env node
/**
 * Validate SRS batch structure.
 *
 * Checks:
 *   - Batch directory exists
 *   - src/ exists and contains at least one R*.md
 *   - All src/R*.md filenames match R\d{4}_.+\.md
 *   - Each R*.md contains the 六大章節 (一-六) as substring (any heading level)
 *   - assets/R{NNNN}/ subfolders match an existing R-number (orphan check)
 *   - Non-R named subfolders in assets/ (e.g., 共用) are SKIPPED (intentional)
 *
 * Exit code:
 *   0 — all checks passed
 *   1 — one or more issues found (issues listed)
 *   2 — fatal error (batch / src dir missing)
 *
 * Usage:
 *   node scripts/validate-structure.js <batch-dir>
 */

const fs = require('fs');
const path = require('path');

const batchDir = process.argv[2];
if (!batchDir) {
  console.error('Usage: node scripts/validate-structure.js <batch-dir>');
  process.exit(2);
}

const issues = [];
const errors = [];

const srcDir = path.join(batchDir, 'src');
const assetsDir = path.join(batchDir, 'assets');

if (!fs.existsSync(batchDir)) errors.push(`Batch directory not found: ${batchDir}`);
if (!fs.existsSync(srcDir)) errors.push(`src/ directory not found: ${srcDir}`);

const REQUIRED_SECTIONS = [
  '一、需求說明',
  '二、使用情境',
  '三、功能需求',
  '四、非功能需求',
  '五、驗收條件',
  '六、待釐清項目',
];
const validRPattern = /^R\d{4}_.+\.md$/;
const rNumbers = new Set();

if (errors.length === 0) {
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) {
    issues.push('src/ has no .md files');
  }
  for (const f of files) {
    if (!validRPattern.test(f)) {
      issues.push(`src/${f}: filename does not match R\\d{4}_.+\\.md`);
      continue;
    }
    const rNum = f.match(/^R(\d{4})/)[1];
    rNumbers.add(rNum);
    const content = fs.readFileSync(path.join(srcDir, f), 'utf8');
    for (const sec of REQUIRED_SECTIONS) {
      if (!content.includes(sec)) {
        issues.push(`src/${f}: missing section "${sec}"`);
      }
    }
  }

  if (fs.existsSync(assetsDir)) {
    const subdirs = fs.readdirSync(assetsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    for (const sub of subdirs) {
      const m = sub.match(/^R(\d{4})$/);
      if (!m) {
        // Non-R named subfolder (e.g., 共用 / shared) — intentional, skip
        continue;
      }
      if (!rNumbers.has(m[1])) {
        issues.push(`assets/${sub}: no matching src/R${m[1]}_*.md (orphan)`);
      }
    }
  }
}

console.log(`Validating ${batchDir}/`);
console.log('');

if (errors.length > 0) {
  console.error('✗ Fatal errors:');
  errors.forEach(e => console.error(`  · ${e}`));
  process.exit(2);
}

if (issues.length === 0) {
  console.log('✓ All checks passed');
  console.log(`  · ${rNumbers.size} requirement(s) found: ${[...rNumbers].sort().map(r => 'R' + r).join(', ')}`);
  process.exit(0);
}

console.log(`⚠ ${issues.length} issue(s) found:`);
issues.forEach(i => console.log(`  · ${i}`));
process.exit(1);
