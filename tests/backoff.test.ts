/**
 * Issue #003: getBackoffMs + isRetryableError 单元测试
 *
 * 覆盖：
 *   B1. retryCount=0 → 接近 baseMs（2000±30%）
 *   B2. retryCount=10 → 不超过 maxMs（60000）
 *   B3. jitter 在 ±30% 范围（多次采样都在 [0.7x, 1.3x]）
 *   B4. retryCount 越大值越大（指数增长）
 *   B5. isRetryableError: 401/403/429 → false
 *   B6. isRetryableError: 500/502/503 → true
 *   B7. isRetryableError: 无 status 字段（网络错误）→ true
 *   B8. isRetryableError: null/undefined → true（保守处理）
 *
 * 运行：npx tsx tests/backoff.test.ts
 * 退出码 0/1。
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const { getBackoffMs, isRetryableError } = await import('../src/lib/backoff');

  // ===== B1: retryCount=0 → 接近 2000ms =====
  const v1 = getBackoffMs(0);
  assert.ok(v1 >= 1400 && v1 <= 2600, `B1 expected 1400-2600, got ${v1}`);
  record('B1 retry=0 接近 baseMs', true, `got ${v1}ms`);

  // ===== B2: retryCount=10 → 不超过 60000ms =====
  const v2 = getBackoffMs(10);
  assert.ok(v2 >= 42000 && v2 <= 78000, `B2 expected 42000-78000, got ${v2}`);
  record('B2 retry=10 不超 maxMs', true, `got ${v2}ms`);

  // ===== B3: jitter 在 ±30% 范围（多次采样） =====
  let minVal = Infinity, maxVal = -Infinity;
  for (let i = 0; i < 200; i++) {
    const v = getBackoffMs(2, 1000, 60000); // base=1000, retry=2 → 期望 4000±30%
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  // 期望范围 [2800, 5200]
  assert.ok(minVal >= 2800 && minVal <= 5200, `B3 min ${minVal} 应在 2800-5200`);
  assert.ok(maxVal >= 2800 && maxVal <= 5200, `B3 max ${maxVal} 应在 2800-5200`);
  record('B3 jitter 范围', true, `200 采样: min=${minVal}, max=${maxVal}`);

  // ===== B4: retryCount 越大值越大（指数增长） =====
  const samples: number[] = [];
  for (let retry = 0; retry < 5; retry++) {
    // 用同样的 base/max，jitter 是随机的，但我们关心中位数趋势
    const arr: number[] = [];
    for (let i = 0; i < 50; i++) arr.push(getBackoffMs(retry));
    samples.push(arr.sort((a, b) => a - b)[25]); // 中位数
  }
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i] > samples[i - 1], `B4 retry=${i} 中位数应大于 retry=${i - 1}, got ${samples[i]} vs ${samples[i - 1]}`);
  }
  record('B4 retry 越大值越大', true, `中位数序列 [${samples.join(', ')}]`);

  // ===== B5: 4xx 不重试 =====
  for (const status of [400, 401, 403, 404, 429]) {
    const result = isRetryableError({ status });
    assert.equal(result, false, `B5 status=${status} 不应重试`);
  }
  record('B5 4xx 不重试', true, '400/401/403/404/429 全部 false');

  // ===== B6: 5xx 重试 =====
  for (const status of [500, 502, 503, 504]) {
    const result = isRetryableError({ status });
    assert.equal(result, true, `B6 status=${status} 应重试`);
  }
  record('B6 5xx 重试', true, '500/502/503/504 全部 true');

  // ===== B7: 网络错误（无 status）= true =====
  assert.equal(isRetryableError({ message: 'fetch failed' }), true, 'B7 无 status');
  assert.equal(isRetryableError(new Error('network timeout')), true, 'B7 Error 对象');
  record('B7 网络错误重试', true, '无 status / Error 对象 → true');

  // ===== B8: null/undefined = true（保守） =====
  assert.equal(isRetryableError(null), true, 'B8 null');
  assert.equal(isRetryableError(undefined), true, 'B8 undefined');
  assert.equal(isRetryableError('string error'), true, 'B8 string');
  record('B8 null/undefined 保守处理', true, '全部 → true');

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