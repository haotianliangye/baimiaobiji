/**
 * Issue P1-003 (ADR-0003) v15 → v16 迁移测试
 *
 * settings.store.ts 的 migrate 函数承担：
 *   1) 把 localStorage 中残留的 apiKey/embedApiKey/ttsApiKey 顶层镜像写到 IDB
 *   2) 把 nested configs[*].apiKey / embedConfigs[*].apiKey / ttsConfigs[*].apiKey
 *      按 (type, provider) 维度逐个写到 IDB
 *   3) 从 persistedState 删除所有 apiKey 字段，避免 partialize 又把它们写回 localStorage
 *
 * 因 settings.store 模块耦合 zustand persist（默认 localStorage + Dexie IDB），
 * Node 跑不动整个 rehydrate 流程。本测试退化为：
 *   - K1-K6 静态检查 migrate v16 块的语义（注释 / 代码模式）
 *   - K7-K8 静态检查 partialize exclude apiKey/configs
 *   - K9 静态检查 onRehydrateStorage + bootstrapApiKeysIntoState 已串起来
 *   - K10 静态检查 version 已是 16
 *
 * 行为验证留给手测：
 *   - devtools → Application → Local Storage → `whitewash-settings` 应不含 apiKey/configs
 *   - IndexedDB → whitewash_diary → settings_kv 应有 api_key.<type>.<provider> 行
 *   - 老用户（v15）升级后首次启动自动迁移，配置仍在
 *
 * 运行：`npx tsx tests/apiKeyStore.migration.test.ts`
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
  const src = fs.readFileSync(
    path.resolve(process.cwd(), 'src/store/settings.store.ts'),
    'utf-8'
  );
  // 去掉注释再扫（与 apiKeyStore.test.ts 一致）
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // ===== K1: version 已是 16 =====
  assert.ok(
    /version:\s*16/.test(src),
    'K1 settings.store.ts version 应为 16（不是 15）'
  );
  record('K1 version 16', true, 'version found');

  // ===== K2: migrate 含 version < 16 分支 =====
  assert.ok(
    /version\s*<\s*16/.test(src),
    'K2 migrate 应有 `version < 16` 分支'
  );
  record('K2 migrate v16 分支存在', true, 'branch found');

  // ===== K3: v16 migrate 调用 setApiKey（异步 IDB 写入）=====
  assert.ok(
    /version\s*<\s*16[\s\S]{0,3000}migrateKey\(\s*['"]llm['"]\s*,\s*chatProvider[\s\S]{0,500}migrateKey\(\s*['"]embed['"]\s*,\s*embedProvider[\s\S]{0,500}migrateKey\(\s*['"]tts['"]\s*,\s*ttsProvider/.test(src),
    'K3 v16 migrate 应调 migrateKey 写顶层 llm/embed/tts 三个 key'
  );
  record('K3 v16 migrate 写顶层三个 key', true, 'migrateKey calls found');

  // ===== K4: v16 migrate 处理 nested configs（每个 provider 独立写）=====
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}for\s*\(\s*const\s*\[p,\s*cfg\]\s*of\s*Object\.entries\(persistedState\.configs\)/.test(src),
    'K4 v16 migrate 应遍历 persistedState.configs 各 provider 写 IDB'
  );
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}for\s*\(\s*const\s*\[p,\s*cfg\]\s*of\s*Object\.entries\(persistedState\.embedConfigs\)/.test(src),
    'K4 v16 migrate 应遍历 persistedState.embedConfigs'
  );
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}for\s*\(\s*const\s*\[p,\s*cfg\]\s*of\s*Object\.entries\(persistedState\.ttsConfigs\)/.test(src),
    'K4 v16 migrate 应遍历 persistedState.ttsConfigs'
  );
  record('K4 v16 migrate 遍历 nested configs/embedConfigs/ttsConfigs', true, 'loops found');

  // ===== K5: v16 migrate 从 persistedState 删除 apiKey 等字段 =====
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}delete\s+persistedState\.apiKey\s*;/.test(src),
    'K5 v16 migrate 应 delete persistedState.apiKey'
  );
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}delete\s+persistedState\.embedApiKey\s*;/.test(src),
    'K5 v16 migrate 应 delete persistedState.embedApiKey'
  );
  assert.ok(
    /version\s*<\s*16[\s\S]{0,5000}delete\s+persistedState\.ttsApiKey\s*;/.test(src),
    'K5 v16 migrate 应 delete persistedState.ttsApiKey'
  );
  record('K5 v16 migrate 删除顶层 apiKey 字段', true, 'delete statements found');

  // ===== K6: partialize exclude apiKey / configs =====
  // partialize 函数体内应有 `apiKey, embedApiKey, ttsApiKey, configs, embedConfigs, ttsConfigs, ...rest`
  assert.ok(
    /partialize\s*:\s*\(state\)\s*=>\s*\{[^}]*apiKey[^}]*embedApiKey[^}]*ttsApiKey[^}]*configs[^}]*embedConfigs[^}]*ttsConfigs[^}]*\.\.\.rest/s.test(src),
    'K6 partialize 应解构出 apiKey/embedApiKey/ttsApiKey/configs/embedConfigs/ttsConfigs'
  );
  record('K6 partialize exclude apiKey 字段', true, 'destructuring found');

  // ===== K7: onRehydrateStorage 触发 bootstrap =====
  assert.ok(
    /onRehydrateStorage\s*:\s*\(\)\s*=>\s*\(state\s*,\s*error\)\s*=>\s*\{[\s\S]{0,500}bootstrapApiKeysIntoState/.test(src),
    'K7 onRehydrateStorage 应调 bootstrapApiKeysIntoState'
  );
  record('K7 onRehydrateStorage → bootstrapApiKeysIntoState', true, 'callback found');

  // ===== K8: bootstrapApiKeysIntoState 已导出 =====
  assert.ok(
    /export\s+async\s+function\s+bootstrapApiKeysIntoState/.test(src),
    'K8 bootstrapApiKeysIntoState 应被 export'
  );
  record('K8 bootstrapApiKeysIntoState exported', true, 'export found');

  // ===== K9: setApiKeyField action 在 store 上 =====
  assert.ok(
    /setApiKeyField\s*:\s*\(type\s*,\s*provider\s*,\s*value\)\s*=>/.test(src),
    'K9 store 应有 setApiKeyField action 签名'
  );
  record('K9 setApiKeyField action 存在', true, 'action signature found');

  // ===== K10: setApiKeyField 同步镜像 + 异步 setApiKey =====
  assert.ok(
    /setApiKeyField\s*:\s*\(type\s*,\s*provider\s*,\s*value\)\s*=>\s*\{[\s\S]{0,3000}setApiKey\(\s*type\s*,\s*provider\s*,\s*value\s*\)/.test(src),
    'K10 setApiKeyField 应异步调 setApiKey(type, provider, value) 写 IDB'
  );
  record('K10 setApiKeyField → IDB', true, 'IDB write call found');

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
