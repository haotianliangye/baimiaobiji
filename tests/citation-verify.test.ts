/**
 * Issue #005: citationVerify 单元测试
 *
 * 设计：
 *   - 纯函数 verifyCitationsAgainstIds(markdown, validIds)：核心匹配+标记
 *   - 包装 verifyCitations(markdown)：自动查 db.raw_logs 拿 validIds
 *   - 单测只测纯函数（不依赖 IndexedDB）
 *
 * 覆盖：
 *   V1: 空 markdown → 返回原值
 *   V2: 无 UUID 引用 → cleaned==原值, broken=[], total=0
 *   V3: 1 个有效 UUID → 不标记，cleaned 保持原样
 *   V4: 1 个无效 UUID → 标记 broken，cleaned 加 marker
 *   V5: 混合（2 有效 + 1 无效）→ 只标记无效的
 *   V6: context 提取（前 20 + 后 20）
 *   V7: 重复 UUID 计数 1 次（Set 去重）
 *   V8: 性能 — 100KB 日记 < 100ms
 *   V9: 同一 UUID 在文本中多次出现，只算 1 个 broken
 *   V10: 已经被 washCitations 包成 [引用](#log_id_xxx) 的格式仍能验证
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const { verifyCitationsAgainstIds } = await import('../src/lib/citationVerify');

  const VALID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const BROKEN = '11111111-2222-3333-4444-555555555555';

  // ===== V1: 空 markdown =====
  const r1 = await verifyCitationsAgainstIds('', new Set([VALID]));
  assert.equal(r1.cleaned, '', 'V1 cleaned');
  assert.equal(r1.broken.length, 0, 'V1 broken');
  assert.equal(r1.total, 0, 'V1 total');
  record('V1 空 markdown', true, '原样返回');

  // ===== V2: 无 UUID 引用 =====
  const r2 = await verifyCitationsAgainstIds('今天天气不错', new Set([VALID]));
  assert.equal(r2.cleaned, '今天天气不错', 'V2 cleaned');
  assert.equal(r2.broken.length, 0, 'V2 broken');
  assert.equal(r2.total, 0, 'V2 total');
  record('V2 无 UUID', true, 'cleaned=原值');

  // ===== V3: 1 个有效 UUID =====
  const text3 = `[吃了早餐](#log_id_${VALID})`;
  const r3 = await verifyCitationsAgainstIds(text3, new Set([VALID]));
  assert.equal(r3.broken.length, 0, 'V3 不应标记');
  assert.equal(r3.total, 1, 'V3 total=1');
  assert.equal(r3.cleaned.includes('<!--broken-citation-->'), false, 'V3 无 marker');
  record('V3 1个有效', true, '无 broken');

  // ===== V4: 1 个无效 UUID =====
  const text4 = `[编造的](#log_id_${BROKEN})`;
  const r4 = await verifyCitationsAgainstIds(text4, new Set([VALID]));
  assert.equal(r4.broken.length, 1, 'V4 应有 1 broken');
  assert.equal(r4.broken[0].uuid, BROKEN, 'V4 uuid 正确');
  assert.equal(r4.total, 1, 'V4 total=1');
  assert.ok(r4.cleaned.includes('<!--broken-citation-->'), 'V4 应有 marker');
  record('V4 1个无效', true, 'broken=1');

  // ===== V5: 混合 =====
  const text5 = `开头 [a](#log_id_${VALID}) 中间 [b](#log_id_${BROKEN}) 结尾 [c](#log_id_${VALID})`;
  const r5 = await verifyCitationsAgainstIds(text5, new Set([VALID]));
  assert.equal(r5.broken.length, 1, 'V5 混合 broken=1');
  assert.equal(r5.broken[0].uuid, BROKEN, 'V5 broken uuid');
  assert.equal(r5.total, 3, 'V5 total=3');
  // 只 marker 1 个
  const markerCount5 = (r5.cleaned.match(/<!--broken-citation-->/g) || []).length;
  assert.equal(markerCount5, 1, `V5 marker 应只 1 个, got ${markerCount5}`);
  record('V5 混合', true, 'broken=1, marker=1');

  // ===== V6: context 提取 =====
  const text6 = 'A'.repeat(50) + `[x](#log_id_${BROKEN})` + 'B'.repeat(50);
  const r6 = await verifyCitationsAgainstIds(text6, new Set([VALID]));
  assert.equal(r6.broken.length, 1, 'V6 broken=1');
  assert.ok(r6.broken[0].context.length > 0, 'V6 context 应有内容');
  // context 应包含 uuid 之前的 20 字符和之后的 20 字符
  assert.ok(r6.broken[0].context.includes('AAAA'), 'V6 context 应含前文 A');
  assert.ok(r6.broken[0].context.includes('BBBB'), 'V6 context 应含后文 B');
  record('V6 context', true, `len=${r6.broken[0].context.length}`);

  // ===== V7: 重复 UUID（去重） =====
  const text7 = `[a](#log_id_${VALID}) [b](#log_id_${VALID}) [c](#log_id_${VALID})`;
  const r7 = await verifyCitationsAgainstIds(text7, new Set([VALID]));
  // total 是「出现次数」还是「unique」？规格的 total 字段是 matches.length（不去重）
  assert.equal(r7.total, 3, 'V7 total 反映出现次数');
  assert.equal(r7.broken.length, 0, 'V7 broken 仍 0');
  record('V7 重复有效', true, 'total=3, broken=0');

  // ===== V8: 性能 100KB < 100ms =====
  // 构造 100KB 文本：每行约 100 字节，含 1 个引用 → 1000 行 ≈ 100KB
  const longLine = 'X'.repeat(50) + `[ref](#log_id_${VALID})` + 'Y'.repeat(40) + '\n';
  const longText = longLine.repeat(1000); // 约 100KB
  assert.ok(longText.length > 100_000, `V8 文本应 >100KB, got ${longText.length}`);
  const t0 = Date.now();
  const r8 = await verifyCitationsAgainstIds(longText, new Set([VALID]));
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 100, `V8 应 <100ms, got ${elapsed}ms`);
  assert.equal(r8.broken.length, 0, 'V8 全有效无 broken');
  record('V8 100KB 性能', true, `elapsed=${elapsed}ms, ${longText.length}bytes`);

  // ===== V9: 同一无效 UUID 多次出现 — broken 只 1 个 =====
  const text9 = `[a](#log_id_${BROKEN}) [b](#log_id_${BROKEN}) [c](#log_id_${BROKEN})`;
  const r9 = await verifyCitationsAgainstIds(text9, new Set());
  assert.equal(r9.broken.length, 1, 'V9 broken 应去重到 1');
  // 但 marker 仍标 3 处（每处都可见）
  const markerCount9 = (r9.cleaned.match(/<!--broken-citation-->/g) || []).length;
  assert.equal(markerCount9, 3, `V9 marker 应标 3 处, got ${markerCount9}`);
  record('V9 重复无效', true, 'broken=1, marker=3');

  // ===== V10: washCitations 之后的格式仍能验证 =====
  const washed = `[引用](#log_id_${BROKEN})`; // 模拟 washCitations 输出
  const r10 = await verifyCitationsAgainstIds(washed, new Set());
  assert.equal(r10.broken.length, 1, 'V10 washed format 仍能检测');
  record('V10 washed format', true, 'wash 后能验证');

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
  console.error('测试运行异常:', err);
  process.exit(1);
});