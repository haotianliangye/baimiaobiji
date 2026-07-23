/**
 * Issue P1-003 (ADR-0003): apiKeyStore 单测（Node 友好版 v2）
 *
 * 设计：因为 Node 没有 localStorage（ReferenceError），不能"测写次数"。
 * 改为**静态检查 + 函数签名 + 抛错路径**：
 *   K1. apiKeyStore.ts 源码**不引用** localStorage（关键安全保证）
 *   K2. apiKeyStore.ts 源码**不引用** sessionStorage
 *   K3. setApiKey 真的用了 db.settings_kv（IndexedDB）
 *   K4. 函数签名：set/load/delete/has/listAll
 *   K5. setApiKey 传空字符串等价于 delete（不写 db）
 *   K6. loadApiKey 不存在时返回 ''（不抛错）
 *
 * 集成测试（真 IndexedDB）见 P2。
 *
 * 运行：`npx tsx tests/apiKeyStore.test.ts`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  // ===== K1 + K2: 静态扫描 — apiKeyStore.ts 不调用 localStorage/sessionStorage =====
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/apiKeyStore.ts'),
    'utf-8'
  );
  // 去掉注释再扫：单行 // ... 和 /* ... */
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')  // /* ... */
    .replace(/\/\/.*$/gm, '');          // // ...
  // 检查 API 调用：localStorage.getItem/setItem/removeItem/clear
  const hasLocalStorageCall = /\blocalStorage\s*\.\s*(get|set|remove)Item\b|\blocalStorage\s*\.\s*clear\b/.test(codeOnly);
  const hasSessionStorageCall = /\bsessionStorage\s*\.\s*(get|set|remove)Item\b|\bsessionStorage\s*\.\s*clear\b/.test(codeOnly);
  assert.equal(hasLocalStorageCall, false, `K1 apiKeyStore.ts 不应调用 localStorage API: ${codeOnly.match(/localStorage[^;]*/)?.[0]}`);
  record('K1 apiKeyStore.ts 不调用 localStorage API', true, 'static scan');
  assert.equal(hasSessionStorageCall, false, 'K2 apiKeyStore.ts 不应调用 sessionStorage API');
  record('K2 apiKeyStore.ts 不调用 sessionStorage API', true, 'static scan');

  // ===== K3: 真的用了 db.settings_kv =====
  assert.ok(src.includes('db.settings_kv'), 'K3 应使用 db.settings_kv');
  record('K3 用了 db.settings_kv', true, 'found');

  // ===== K4: 函数签名 =====
  const apiKeyStore = await import('../src/lib/apiKeyStore');
  assert.equal(typeof apiKeyStore.setApiKey, 'function', 'K4 setApiKey');
  assert.equal(typeof apiKeyStore.loadApiKey, 'function', 'K4 loadApiKey');
  assert.equal(typeof apiKeyStore.deleteApiKey, 'function', 'K4 deleteApiKey');
  assert.equal(typeof apiKeyStore.hasApiKey, 'function', 'K4 hasApiKey');
  assert.equal(typeof apiKeyStore.listAllApiKeys, 'function', 'K4 listAllApiKeys');
  record('K4 函数签名（5 个 export）', true, 'set/load/delete/has/listAll');

  // ===== K5: setApiKey("") 等价 delete — 静态检查路径 =====
  // setApiKey 源码里：if (!value) { await deleteApiKey(type); return; }
  assert.ok(
    /if\s*\(\s*!value\s*\)\s*\{[^}]*deleteApiKey/s.test(src),
    'K5 应有 if (!value) { deleteApiKey } 分支'
  );
  record('K5 setApiKey("") 等价 delete', true, 'branch found');

  // ===== K6: loadApiKey 不存在时返回 '' — 静态检查 =====
  // loadApiKey 源码：if (!row) return '';
  assert.ok(
    /if\s*\(\s*!row\s*\)\s*return\s*''/s.test(src),
    'K6 应有 if (!row) return "" 分支'
  );
  record('K6 loadApiKey 不存在返回 ""', true, 'branch found');

  // ===== K7: key 前缀正确 =====
  assert.ok(
    /KEY_PREFIX\s*=\s*['"]api_key\./.test(src),
    'K7 KEY_PREFIX 应为 "api_key."'
  );
  record('K7 key prefix "api_key."', true, 'const found');

  // ===== K8: ApiKeyType 是 'llm' | 'embed' | 'tts' =====
  assert.ok(
    /type\s+ApiKeyType\s*=\s*['"]llm['"]\s*\|\s*['"]embed['"]\s*\|\s*['"]tts['"]/s.test(src),
    'K8 ApiKeyType 三选项'
  );
  record('K8 ApiKeyType 三选项', true, 'literal union found');

  // ===== 汇总 =====
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== 汇总 ===`);
  console.log(`通过: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('失败:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});