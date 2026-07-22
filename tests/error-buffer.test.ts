/**
 * Issue #006: errorBuffer 单元测试
 *
 * 覆盖：
 *   B1. 初始为空
 *   B2. logError 后 count=1
 *   B3. 满 100 条时正确丢弃最旧
 *   B4. 超过 100 条时 total 仍 = 100
 *   B5. 导出 JSON 合法且含 ts/msg/ctx
 *   B6. 清空后 count=0
 *   B7. Error 对象自动提取 stack
 *   B8. level: 'error' / 'warn' / 'info' 区分
 *   B9. 导出 JSON 含 version 字段
 *   B10. 导出 JSON 含 exported_at 字段
 *
 * 运行：npx tsx tests/error-buffer.test.ts
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const mod = await import('../src/lib/errorBuffer');
  const { logError, getErrorCount, exportErrorLog, clearErrorLog } = mod;

  // 清理（避免顺序依赖）
  clearErrorLog();

  // ===== B1: 初始为空 =====
  assert.equal(getErrorCount(), 0, 'B1 initial');
  record('B1 初始为空', true, 'count=0');

  // ===== B2: logError 后 count=1 =====
  logError('test 1', { foo: 1 });
  assert.equal(getErrorCount(), 1, 'B2 after one log');
  record('B2 logError 后 count=1', true, 'count=1');

  // ===== B3: 满 100 条时正确丢弃最旧 =====
  clearErrorLog();
  for (let i = 0; i < 100; i++) logError(`msg-${i}`);
  assert.equal(getErrorCount(), 100, 'B3a 满 100');
  logError('msg-100'); // 第 101 条
  assert.equal(getErrorCount(), 100, 'B3b 仍 100');
  // 验证最旧被丢弃：导出看第一条
  const log3 = JSON.parse(exportErrorLog());
  assert.equal(log3.errors[0].msg, 'msg-1', `B3c oldest 应为 msg-1, got ${log3.errors[0].msg}`);
  assert.equal(log3.errors[99].msg, 'msg-100', 'B3d newest 应为 msg-100');
  record('B3 满 100 后正确丢弃最旧', true, 'oldest=msg-1, newest=msg-100');

  // ===== B4: 超过 100 条 total 仍 = 100 =====
  for (let i = 0; i < 50; i++) logError(`overflow-${i}`);
  assert.equal(getErrorCount(), 100, 'B4 total=100');
  record('B4 超过 100 total 仍 100', true, 'count=100');

  // ===== B5: 导出 JSON 合法 =====
  const exported = exportErrorLog();
  let parsed: any;
  try {
    parsed = JSON.parse(exported);
  } catch (e) {
    assert.fail(`B5 JSON.parse 失败: ${e}`);
  }
  assert.ok(Array.isArray(parsed.errors), 'B5 errors 是数组');
  assert.equal(parsed.errors.length, 100, 'B5 errors.length=100');
  // 每条都有 ts 和 msg
  for (const e of parsed.errors.slice(0, 5)) {
    assert.equal(typeof e.ts, 'number', 'B5 ts 是 number');
    assert.equal(typeof e.msg, 'string', 'B5 msg 是 string');
  }
  record('B5 导出 JSON 合法', true, `errors.length=${parsed.errors.length}`);

  // ===== B6: 清空后 count=0 =====
  clearErrorLog();
  assert.equal(getErrorCount(), 0, 'B6 after clear');
  const log6 = JSON.parse(exportErrorLog());
  assert.equal(log6.errors.length, 0, 'B6 exported 数组空');
  record('B6 清空后 count=0', true, 'count=0, exported=空');

  // ===== B7: Error 对象自动提取 stack =====
  clearErrorLog();
  const err = new Error('boom');
  logError('caught error', err);
  const log7 = JSON.parse(exportErrorLog());
  assert.equal(log7.errors[0].ctx?.message, 'boom', 'B7 ctx 保留 Error 引用');
  // 至少 stack 字段存在（不一定非空，V8 可能省略）
  assert.ok('stack' in log7.errors[0], 'B7 应有 stack 字段');
  assert.equal(typeof log7.errors[0].stack, 'string', 'B7 stack 是 string');
  record('B7 Error 对象提取 stack', true, `stack.len=${log7.errors[0].stack?.length}`);

  // ===== B8: level 区分 =====
  clearErrorLog();
  logError('e1', null, 'error');
  logError('w1', null, 'warn');
  logError('i1', null, 'info');
  const log8 = JSON.parse(exportErrorLog());
  assert.equal(log8.errors[0].level, 'error', 'B8 error');
  assert.equal(log8.errors[1].level, 'warn', 'B8 warn');
  assert.equal(log8.errors[2].level, 'info', 'B8 info');
  record('B8 level 区分', true, 'error/warn/info');

  // ===== B9: 导出 JSON 含 version =====
  assert.equal(typeof log8.version, 'string', 'B9 version 是 string');
  assert.ok(log8.version.length > 0, 'B9 version 非空');
  record('B9 version 字段', true, `version=${log8.version}`);

  // ===== B10: 导出 JSON 含 exported_at =====
  assert.equal(typeof log8.exported_at, 'number', 'B10 exported_at 是 number');
  record('B10 exported_at 字段', true, `exported_at=${log8.exported_at}`);

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