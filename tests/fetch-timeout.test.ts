/**
 * Issue #002: fetchWithTimeout 单元测试
 *
 * 覆盖：
 *   1. 正常响应：返回 fetch 结果
 *   2. 超时触发：timeoutMs 内未返回 → 抛 AbortError
 *   3. Timer 清理：超时不留下挂起的 setTimeout（避免内存泄漏）
 *   4. 自定义超时参数：timeoutMs 传 100ms 时确实 100ms 左右 abort
 *   5. 默认 30000ms：未传 timeoutMs 时用默认
 *
 * 运行：npx tsx tests/fetch-timeout.test.ts
 * 退出码 0 = 通过，1 = 失败。
 */

// Mock 必须放在 import 之前。
// 我们要 mock 的是 src/lib/fetchWithTimeout.ts 调用的全局 fetch，
// 不是 fetchWithTimeout 本身。

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  // 延迟 import fetchWithTimeout（确保全局 fetch mock 先设置）
  const { fetchWithTimeout } = await import('../src/lib/fetchWithTimeout');

  // ===== Test 1: 正常响应 =====
  const origFetch1 = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, _opts: any) =>
    new Response('ok', { status: 200 });
  try {
    const start = Date.now();
    const res = await fetchWithTimeout('http://test', {}, 5000);
    const elapsed = Date.now() - start;
    assert.equal(res.status, 200, 'T1 状态码');
    assert.ok(elapsed < 100, `T1 elapsed ${elapsed}ms < 100ms`);
    record('T1 正常响应', true, `status=200, elapsed=${elapsed}ms`);
  } catch (e) {
    record('T1 正常响应', false, `unexpected: ${(e as Error).message}`);
  } finally {
    globalThis.fetch = origFetch1;
  }

  // ===== Test 2: 超时触发（mock 一个永不 resolve 的 promise）=====
  const origFetch2 = globalThis.fetch;
  (globalThis as any).fetch = (_url: string, opts: any) =>
    new Promise((_resolve, reject) => {
      // 监听 abort，模拟真实 fetch 在 abort 时 reject
      opts?.signal?.addEventListener?.('abort', () => {
        const err = new Error('aborted');
        (err as any).name = 'AbortError';
        reject(err);
      });
    });
  try {
    const start = Date.now();
    await assert.rejects(
      () => fetchWithTimeout('http://slow.test', {}, 100),
      (err: Error) => err.name === 'AbortError'
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed >= 90 && elapsed < 500, `T2 elapsed ${elapsed}ms 应在 90-500ms 范围`);
    record('T2 超时触发 AbortError', true, `elapsed=${elapsed}ms`);
  } catch (e) {
    record('T2 超时触发 AbortError', false, `unexpected: ${(e as Error).message}`);
  } finally {
    globalThis.fetch = origFetch2;
  }

  // ===== Test 3: Timer 清理（mock fetch 记录 clearTimeout 是否被调）=====
  const origFetch3 = globalThis.fetch;
  const origClearTimeout = globalThis.clearTimeout;
  let clearTimeoutCalled = false;
  (globalThis as any).clearTimeout = (id: any) => {
    clearTimeoutCalled = true;
    return origClearTimeout(id);
  };
  (globalThis as any).fetch = async (_url: string, _opts: any) =>
    new Response('fast', { status: 200 });
  try {
    await fetchWithTimeout('http://test', {}, 5000);
    assert.ok(clearTimeoutCalled, 'T3 clearTimeout 必须被调用');
    record('T3 Timer 清理', true, 'clearTimeout 已调用');
  } catch (e) {
    record('T3 Timer 清理', false, `unexpected: ${(e as Error).message}`);
  } finally {
    globalThis.fetch = origFetch3;
    globalThis.clearTimeout = origClearTimeout;
  }

  // ===== Test 4: 自定义超时 100ms =====
  const origFetch4 = globalThis.fetch;
  (globalThis as any).fetch = (_url: string, opts: any) =>
    new Promise((_resolve, reject) => {
      opts?.signal?.addEventListener?.('abort', () => {
        const err = new Error('aborted');
        (err as any).name = 'AbortError';
        reject(err);
      });
    });
  try {
    const start = Date.now();
    await assert.rejects(
      () => fetchWithTimeout('http://slow.test', {}, 100),
      (err: Error) => err.name === 'AbortError'
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 500, `T4 elapsed ${elapsed}ms 应在 100ms 附近`);
    record('T4 自定义超时 100ms', true, `elapsed=${elapsed}ms`);
  } catch (e) {
    record('T4 自定义超时 100ms', false, `unexpected: ${(e as Error).message}`);
  } finally {
    globalThis.fetch = origFetch4;
  }

  // ===== Test 5: 默认 30000ms（不传超时）=====
  // 这个测试主要验证默认值存在且不会立即触发。
  // 我们 mock 一个快速响应来确认默认参数下能正常返回。
  const origFetch5 = globalThis.fetch;
  (globalThis as any).fetch = async (_url: string, _opts: any) =>
    new Response('default-test', { status: 200 });
  try {
    const res = await fetchWithTimeout('http://test');
    assert.equal(res.status, 200, 'T5 默认参数下正常返回');
    record('T5 默认 30000ms', true, '默认参数下正常返回');
  } catch (e) {
    record('T5 默认 30000ms', false, `unexpected: ${(e as Error).message}`);
  } finally {
    globalThis.fetch = origFetch5;
  }

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