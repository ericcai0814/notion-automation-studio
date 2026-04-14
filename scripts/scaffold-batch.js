#!/usr/bin/env node
/**
 * Scaffold a new SRS batch directory.
 *
 * Behavior:
 *   - Creates {batch-name}-SRS/{src,output,assets}/
 *   - Drops .gitkeep in each subdir
 *   - Writes a starter R0001_範例需求.md template in src/
 *   - Refuses to overwrite if {batch-name}-SRS/ already exists
 *
 * Usage:
 *   node scripts/scaffold-batch.js <batch-name>
 *   e.g.  node scripts/scaffold-batch.js 4-A
 */

const fs = require('fs');
const path = require('path');

const batchName = process.argv[2];
if (!batchName) {
  console.error('Usage: node scripts/scaffold-batch.js <batch-name>');
  console.error('  e.g.  node scripts/scaffold-batch.js 4-A');
  process.exit(1);
}

const root = `${batchName}-SRS`;
const subdirs = ['src', 'output', 'assets'];

if (fs.existsSync(root)) {
  console.error(`✗ Directory already exists: ${root}`);
  console.error('  Refusing to overwrite. Remove it first if you really want to start over.');
  process.exit(1);
}

fs.mkdirSync(root);
subdirs.forEach(sub => {
  const dir = path.join(root, sub);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '.gitkeep'), '');
});

const TEMPLATE = `# R0001_範例需求

## 一、需求說明

（功能目的與業務脈絡）

## 二、使用情境

（角色 + 動作 + 順序，主詞是「人」）

## 三、功能需求

（系統行為與規格，主詞是「系統」）

## 四、非功能需求

（效能、安全、相容性）

## 五、驗收條件

- AC-01：（前置條件 → 操作步驟 → 預期結果）

## 六、待釐清項目

（無）
`;

fs.writeFileSync(path.join(root, 'src', 'R0001_範例需求.md'), TEMPLATE);

console.log(`✓ Scaffolded batch: ${root}/`);
console.log(`  · ${root}/src/R0001_範例需求.md  (template)`);
console.log(`  · ${root}/src/.gitkeep`);
console.log(`  · ${root}/output/.gitkeep`);
console.log(`  · ${root}/assets/.gitkeep`);
console.log('');
console.log('Next steps:');
console.log(`  1. Edit ${root}/src/R0001_範例需求.md (or rename to your real R-number)`);
console.log('  2. Add more R-files as needed (one per requirement)');
console.log(`  3. Run: node scripts/merge-srs.js ${root}`);
