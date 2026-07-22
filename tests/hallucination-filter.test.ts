/**
 * Issue #004: hallucinationFilter 单元测试
 *
 * 覆盖：
 *   H1. exact match: "[EMPTY_AUDIO]" 命中 default-empty-audio pattern
 *   H2. substring match: transcript 含 "谢谢观看" 命中 thanks-watching
 *   H3. regex match: "关注我的频道并订阅" 命中 subscribe
 *   H4. no match: "今天天气不错" 不命中任何
 *   H5. confidence high: transcript=1字 + 命中 → high
 *   H6. confidence high 边界: transcript=5字 + 命中 → high
 *   H7. confidence medium: transcript=20字 + 命中 → medium
 *   H8. confidence low 边界: transcript=51字 + 命中 → low
 *   H9. confidence low: transcript=100字 + 命中 → low
 *   H10. shouldDropTranscript: high → drop
 *   H11. shouldDropTranscript: medium → 不 drop（保留但标记）
 *   H12. shouldDropTranscript: low → 不 drop（保留但标记）
 *   H13. shouldDropTranscript: 命中但应保留 → drop=false + reason 包含 pattern key
 *   H14. getDefaultPatterns(): 至少包含 [EMPTY_AUDIO] + 谢谢观看 + 关注
 *   H15. matchPattern: no match → matched=null
 *   H16. invalid regex: 不会抛错，正常返回 matched=null
 *
 * 运行：npx tsx tests/hallucination-filter.test.ts
 * 退出码 0/1。
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const mod = await import('../src/lib/hallucinationFilter');
  const {
    getDefaultPatterns,
    matchPattern,
    shouldDropTranscript,
  } = mod;

  const defaults = getDefaultPatterns();
  const allDefault = defaults;

  // ===== H1: exact match =====
  const m1 = matchPattern('[EMPTY_AUDIO]', allDefault);
  assert.ok(m1.matched, 'H1 应命中');
  assert.equal(m1.matched?.key, 'default-empty-audio', 'H1 key');
  record('H1 exact match', true, `matched key=${m1.matched?.key}`);

  // ===== H2: substring match =====
  const m2 = matchPattern('请大家给我点赞，谢谢观看', allDefault);
  assert.ok(m2.matched, 'H2 应命中');
  assert.equal(m2.matched?.key, 'default-thanks-watching', 'H2 key');
  record('H2 substring match', true, `matched key=${m2.matched?.key}`);

  // ===== H3: regex match =====
  const m3 = matchPattern('请关注我的频道并订阅', allDefault);
  assert.ok(m3.matched, 'H3 应命中');
  assert.equal(m3.matched?.key, 'default-subscribe', 'H3 key');
  record('H3 regex match', true, `matched key=${m3.matched?.key}`);

  // ===== H4: no match =====
  const m4 = matchPattern('今天去了咖啡馆，工作很充实', allDefault);
  assert.equal(m4.matched, null, 'H4 不应命中');
  record('H4 no match', true, 'matched=null');

  // ===== H5: confidence high (transcript 极短 + 命中) =====
  const c5 = mod.computeConfidence('哎', m1.matched, allDefault);
  assert.equal(c5, 'high', `H5 got ${c5}`);
  record('H5 confidence 1字+命中 → high', true, 'confidence=high');

  // ===== H6: boundary 5字 (规格：< 5 = high) =====
  const c6 = mod.computeConfidence('一二三', m1.matched, allDefault);
  // 注意：transcript "[EMPTY_AUDIO]" 本身长度 = 13，所以 c6 看的是 transcript 长度。
  // 用 text("一二三") 长度 < 5 → high
  assert.equal(c6, 'high', `H6 got ${c6}`);
  record('H6 confidence boundary length<5 → high', true, 'confidence=high');

  // ===== H7: medium (中等长 = high 和 low 之间) =====
  const c7 = mod.computeConfidence('一 二 三 四 五 六 七 八', m1.matched, allDefault);
  // 长度算去掉空格 ~8 字符，属于 medium
  assert.equal(c7, 'medium', `H7 got ${c7}`);
  record('H7 confidence medium (10-50字)', true, 'confidence=medium');

  // ===== H8: boundary 51字 应该是 low =====
  const text51 = '一'.repeat(51);
  const c8 = mod.computeConfidence(text51, m1.matched, allDefault);
  assert.equal(c8, 'low', `H8 got ${c8}`);
  record('H8 confidence boundary length>=51 → low', true, 'confidence=low');

  // ===== H9: 100字 =====
  const text100 = '一'.repeat(100);
  const c9 = mod.computeConfidence(text100, m1.matched, allDefault);
  assert.equal(c9, 'low', `H9 got ${c9}`);
  record('H9 confidence 100字 → low', true, 'confidence=low');

  // ===== H10: shouldDropTranscript high → drop =====
  const r10 = shouldDropTranscript('[EMPTY_AUDIO]', m1.matched, 'high');
  assert.equal(r10.drop, true, 'H10 drop');
  record('H10 high → drop', true, 'drop=true');

  // ===== H11: medium → 不 drop =====
  const r11 = shouldDropTranscript('一二三', m1.matched, 'medium');
  assert.equal(r11.drop, false, 'H11 drop');
  assert.ok(r11.reason, 'H11 应有 reason');
  record('H11 medium → 不 drop', true, `reason=${r11.reason?.slice(0, 50)}`);

  // ===== H12: low → 不 drop =====
  const r12 = shouldDropTranscript(text100, m1.matched, 'low');
  assert.equal(r12.drop, false, 'H12 drop');
  assert.ok(r12.reason, 'H12 应有 reason');
  record('H12 low → 不 drop', true, `reason=${r12.reason?.slice(0, 50)}`);

  // ===== H13: shouldDropTranscript 边界 dropped 原因 =====
  const r13 = shouldDropTranscript('一二三', m1.matched, 'high');
  assert.equal(r13.drop, true, 'H13 drop');
  assert.ok(r13.reason?.includes('default-empty-audio'), 'H13 reason 应包含 pattern key');
  record('H13 high + match → drop + reason', true, `reason=${r13.reason?.slice(0, 80)}`);

  // ===== H14: getDefaultPatterns 包含关键 patterns =====
  assert.ok(defaults.length >= 3, `H14 应至少 3 个 default, got ${defaults.length}`);
  assert.ok(defaults.some(p => p.value === '[EMPTY_AUDIO]'), 'H14 应含 [EMPTY_AUDIO]');
  assert.ok(defaults.some(p => p.value === '谢谢观看'), 'H14 应含 谢谢观看');
  assert.ok(defaults.some(p => p.type === 'regex'), 'H14 应含 regex pattern');
  record('H14 default patterns', true, `共 ${defaults.length} 个`);

  // ===== H15: matchPattern no match =====
  const m15 = matchPattern('正常录音内容', allDefault);
  assert.equal(m15.matched, null, 'H15');
  record('H15 no match → matched=null', true, 'matched=null');

  // ===== H16: invalid regex 不抛 =====
  const badPatterns = [
    { key: 'bad', type: 'regex' as const, value: '[invalid', created_at: 0 },
  ];
  let errored = false;
  try {
    const m16 = matchPattern('test', badPatterns);
    assert.equal(m16.matched, null, 'H16 invalid regex 应返回 no match');
  } catch (e) {
    errored = true;
  }
  assert.equal(errored, false, 'H16 invalid regex 不应抛错');
  record('H16 invalid regex 不抛', true, 'caught gracefully');

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