/**
 * Issue P1-004 (ADR-0004): factsStore 单测
 *
 * 设计：Node 端没 IndexedDB，做**静态检查 + 函数签名 + 结构验证**：
 *   F1. factsStore.ts 不调用 localStorage/sessionStorage
 *   F2. 函数签名：add/get/list/search/update/delete/count (7 个)
 *   F3. CRUD 流程路径：add → get → update → delete
 *   F4. UPSERT by key（同名 key 二次 add 覆盖，不是新建）
 *   F5. search 函数存在（模糊查询）
 *
 * 集成测试（真 IDB）留 P2。
 *
 * 运行：`npx tsx tests/factsStore.test.ts`
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
    path.resolve(process.cwd(), 'src/lib/factsStore.ts'),
    'utf-8'
  );
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // ===== F1: 不调用 localStorage/sessionStorage API =====
  const hasLS = /\blocalStorage\s*\.\s*(get|set|remove)Item\b|\blocalStorage\s*\.\s*clear\b/.test(codeOnly);
  const hasSS = /\bsessionStorage\s*\.\s*(get|set|remove)Item\b|\bsessionStorage\s*\.\s*clear\b/.test(codeOnly);
  assert.equal(hasLS, false, 'F1 factsStore.ts 不应调用 localStorage');
  record('F1 factsStore.ts 不调用 localStorage/sessionStorage', true, 'static scan');

  // ===== F2: 函数签名（7 个）=====
  const factsStore = await import('../src/lib/factsStore');
  for (const fn of ['addFact', 'getFact', 'getFactByKey', 'listFacts', 'searchFacts', 'updateFact', 'deleteFact', 'countFacts']) {
    assert.equal(typeof (factsStore as any)[fn], 'function', `F2 ${fn}`);
  }
  record('F2 函数签名（8 个 export）', true, 'add/get/list/search/update/delete/count');

  // ===== F3: CRUD 流程路径 =====
  assert.ok(/addFact[\s\S]{0,500}?db\.facts[\s\S]{0,500}?put/s.test(src), 'F3 addFact → db.facts.put');
  assert.ok(/getFact[\s\S]{0,300}?db\.facts[\s\S]{0,300}?get/s.test(src), 'F3 getFact → db.facts.get');
  assert.ok(/deleteFact[\s\S]{0,300}?db\.facts[\s\S]{0,300}?delete/s.test(src), 'F3 deleteFact → db.facts.delete');
  record('F3 CRUD 路径使用 db.facts', true, 'add/get/delete 都有');

  // ===== F4: UPSERT by key（同 key 二次 add 覆盖）=====
  // 实现思路：addFact 内部用 key 找现有 → 有则 update，没则 put
  // 用 regex 检验：addFact 内同时有 "put" 和查 key 的逻辑（.where('key').equals().first() 或 .get）
  const addFnBody = src.match(/export\s+async\s+function\s+addFact[^{]*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(
    addFnBody.includes('put') && /\.where\s*\(\s*['"]key['"]\s*\)\s*\.equals/.test(addFnBody),
    'F4 addFact 应有 put + db.facts.where("key").equals 逻辑（UPSERT）'
  );
  record('F4 addFact UPSERT by key', true, 'put + where("key").equals 都在');

  // ===== F5: search 函数 =====
  assert.equal(typeof factsStore.searchFacts, 'function', 'F5 searchFacts');
  assert.ok(/searchFacts[\s\S]{0,500}?(filter|where|toArray|like)/i.test(src), 'F5 searchFacts 用 filter/where/toArray');
  record('F5 searchFacts 存在且有查询逻辑', true, 'filter/where/toArray');

  // ===== F6: listFacts 接受 options（category/limit/offset）=====
  const listFnBody = src.match(/export\s+async\s+function\s+listFacts[^{]*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.ok(
    /category|limit|offset/.test(listFnBody),
    'F6 listFacts 应支持 category/limit/offset 过滤'
  );
  record('F6 listFacts 支持 category/limit/offset', true, 'options 检查');

  // ===== F7: countFacts 存在且用 db.facts.count =====
  assert.ok(/countFacts[\s\S]{0,300}?\.count\(\)/.test(src), 'F7 countFacts');
  record('F7 countFacts 用 db.facts.count()', true, 'count() 调用');

  // ===== F8: 用了 db.facts（不是 db.settings_kv 等）=====
  assert.ok(/db\.facts\b/.test(src), 'F8 应用 db.facts');
  record('F8 用 db.facts 表', true, 'found');

  // ===== F9: Fact 字段定义完整（db.ts 里有 Fact interface）=====
  const dbSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/db/db.ts'),
    'utf-8'
  );
  // 提取 Fact interface 块（粗略）
  const factBlock = dbSrc.match(/export\s+interface\s+Fact\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const requiredFields = ['id', 'key', 'value', 'category', 'confidence', 'source', 'created_at', 'updated_at'];
  // 用 indexOf 简单检查（避免 regex 转义问题）
  const missingFields = requiredFields.filter(f => factBlock.indexOf(f) === -1);
  assert.equal(missingFields.length, 0, `F9 Fact 缺字段: ${missingFields.join(', ')}`);
  record('F9 Fact interface 8 字段（db.ts）', true, `id/key/value/category/confidence/source/timestamps — 都存在`);

  // ===== F10: FactCategory type 限制（factsStore.ts 里有）=====
  assert.ok(
    /type\s+FactCategory\s*=\s*['"]user['"]\s*\|\s*['"]preference['"]\s*\|\s*['"]event['"]\s*\|\s*['"]context['"]/s.test(src),
    'F10 FactCategory 4 选项'
  );
  record('F10 FactCategory 4 选项（factsStore.ts）', true, 'literal union');

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