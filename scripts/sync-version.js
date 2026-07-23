#!/usr/bin/env node
/**
 * scripts/sync-version.js
 *
 * 单一职责：把 `package.json:version` 同步到 README.md 的「当前版本」表格。
 *
 * 设计原则：
 *   - 不修改「更新日志」（changelog 仍由人工维护，避免脚本生成空洞条目）
 *   - 只替换 README 里"当前版本"表格中「应用」那一行
 *   - 幂等：连续跑 N 次结果一致
 *   - 零依赖：纯 Node.js，标准库
 *   - ESM（package.json 声明 "type": "module"）
 *
 * 使用：
 *   node scripts/sync-version.js                # 同步 + 退出
 *   node scripts/sync-version.js --check        # 只检查，有漂移时 exit 1
 *
 * 退出码：
 *   0  一致 / 同步成功
 *   1  --check 模式下发现漂移
 *   2  异常（package.json 缺 version 字段 / README 找不到目标行等）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG_PATH = path.join(ROOT, 'package.json');
const README_PATH = path.join(ROOT, 'README.md');

const isCheck = process.argv.includes('--check');

// 读 package.json
let pkg;
try {
  pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
} catch (e) {
  console.error(`❌ 无法读取 ${PKG_PATH}: ${e.message}`);
  process.exit(2);
}
const version = pkg.version;
if (!version || typeof version !== 'string') {
  console.error('❌ package.json 缺少 version 字段');
  process.exit(2);
}
const versioned = `v${version}`;

// 读 README
let readme;
try {
  readme = fs.readFileSync(README_PATH, 'utf8');
} catch (e) {
  console.error(`❌ 无法读取 ${README_PATH}: ${e.message}`);
  process.exit(2);
}

// 目标行（regex）：
//   | 应用 | vX.Y.Z | 任意说明 |
// 匹配说明部分任意字符（不含换行）
const targetRe = /(\|\s*应用\s*\|\s*)v[\d.]+(\s*\|\s*[^|\n]*\|)/;
const match = readme.match(targetRe);

if (!match) {
  console.error('❌ README.md 找不到「当前版本」表里的「应用」行');
  console.error('   期望形如：| 应用 | v0.3.0 | ... |');
  process.exit(2);
}

const current = match[0];
const expected = `${match[1]}${versioned}${match[2]}`;

if (current === expected) {
  console.log(`✅ README 当前版本 = ${versioned}（已同步）`);
  process.exit(0);
}

if (isCheck) {
  console.error(`❌ README 版本号与 package.json 不一致：`);
  console.error(`   package.json: ${versioned}`);
  console.error(`   README.md:    ${current.match(/v[\d.]+/)[0]}`);
  console.error(`   修复：node scripts/sync-version.js`);
  process.exit(1);
}

// 替换
const newReadme = readme.replace(targetRe, expected);
fs.writeFileSync(README_PATH, newReadme, 'utf8');

console.log(`✅ README 当前版本已同步：${current.match(/v[\d.]+/)[0]} → ${versioned}`);
console.log(`   提示：更新日志仍需人工维护`);
