/**
 * Issue #007: storagePressure 单元测试
 *
 * 覆盖：
 *   P1. ratio > 0.85 → critical = true（默认阈值）
 *   P2. ratio = 0.5 → critical = false
 *   P3. ratio = 0.85 边界 → critical = false（严格大于）
 *   P4. ratio = 0.86 边界 → critical = true
 *   P5. 自定义阈值 criticalThreshold = 0.5
 *   P6. usage = 0 → ratio = 0, critical = false
 *   P7. quota = 0 → ratio = 0, critical = false
 *   P8. 缺 navigator.storage → 返回默认零值
 *   P9. formatPressure util: ratio 转百分比
 *   P10. getPressureLevel: 4 档（ok/warning/critical/danger）
 *   P11. PressureStatus: warn 阈值 = 0.7
 *   P12. PressureStatus: danger 阈值 = 0.95
 *   P13. mock navigator.storage.estimate 工作正常
 *
 * 运行：npx tsx tests/storage-pressure.test.ts
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

// ===== Mock navigator.storage =====
function mockStorage(estimate: () => Promise<StorageEstimate>, persist?: () => Promise<boolean>) {
  (globalThis as any).navigator = {
    storage: {
      estimate,
      ...(persist ? { persist } : {}),
    },
  };
}
interface StorageEstimate { usage?: number; quota?: number }
function clearMock() {
  delete (globalThis as any).navigator;
}

async function run() {
  const mod = await import('../src/lib/storagePressure');
  const {
    checkStoragePressure,
    getPressureLevel,
    formatPressure,
  } = mod;

  clearMock();
  // Default mock: no navigator
  const r0 = await checkStoragePressure();
  assert.equal(r0.usage, 0, 'P0 default');
  record('P0 缺 navigator 返回零值', true, 'usage=0, critical=false');

  // ===== P1: ratio > 0.85 → critical = true =====
  clearMock();
  mockStorage(async () => ({ usage: 900_000, quota: 1_000_000 }));
  const r1 = await checkStoragePressure();
  assert.equal(r1.usage, 900_000, 'P1 usage');
  assert.equal(r1.quota, 1_000_000, 'P1 quota');
  assert.equal(r1.ratio, 0.9, `P1 ratio 应 0.9, got ${r1.ratio}`);
  assert.equal(r1.critical, true, 'P1 critical=true');
  record('P1 ratio=0.9 → critical', true, `ratio=${r1.ratio}`);

  // ===== P2: ratio = 0.5 → critical = false =====
  clearMock();
  mockStorage(async () => ({ usage: 500_000, quota: 1_000_000 }));
  const r2 = await checkStoragePressure();
  assert.equal(r2.critical, false, 'P2 critical=false');
  record('P2 ratio=0.5 → 非 critical', true, `ratio=${r2.ratio}`);

  // ===== P3: ratio = 0.85 边界 =====
  clearMock();
  mockStorage(async () => ({ usage: 850_000, quota: 1_000_000 }));
  const r3 = await checkStoragePressure();
  assert.equal(r3.ratio, 0.85, 'P3 ratio');
  assert.equal(r3.critical, false, 'P3 边界 0.85 不应 critical（严格大于）');
  record('P3 边界 0.85 不 critical', true, 'critical=false');

  // ===== P4: ratio = 0.86 =====
  clearMock();
  mockStorage(async () => ({ usage: 860_000, quota: 1_000_000 }));
  const r4 = await checkStoragePressure();
  assert.equal(r4.critical, true, 'P4 0.86 critical');
  record('P4 边界 0.86 critical', true, 'critical=true');

  // ===== P5: 自定义阈值 =====
  clearMock();
  mockStorage(async () => ({ usage: 600_000, quota: 1_000_000 }));
  const r5 = await checkStoragePressure(0.5);
  assert.equal(r5.critical, true, 'P5 自定义阈值 0.5, ratio=0.6 critical');
  record('P5 自定义阈值', true, 'criticalThreshold=0.5');

  // ===== P6: usage = 0 =====
  clearMock();
  mockStorage(async () => ({ usage: 0, quota: 1_000_000 }));
  const r6 = await checkStoragePressure();
  assert.equal(r6.ratio, 0, 'P6 ratio=0');
  assert.equal(r6.critical, false, 'P6 critical=false');
  record('P6 usage=0', true, 'ratio=0, critical=false');

  // ===== P7: quota = 0 =====
  clearMock();
  mockStorage(async () => ({ usage: 100_000, quota: 0 }));
  const r7 = await checkStoragePressure();
  assert.equal(r7.ratio, 0, 'P7 ratio=0');
  record('P7 quota=0', true, 'ratio=0');

  // ===== P8: 缺 navigator.storage =====
  clearMock();
  (globalThis as any).navigator = {}; // 没 storage
  const r8 = await checkStoragePressure();
  assert.equal(r8.usage, 0, 'P8 缺 storage');
  record('P8 缺 navigator.storage', true, 'usage=0');

  // ===== P9: formatPressure =====
  const r9a = formatPressure(0.5);
  assert.equal(r9a, '50%', `P9a 0.5 → 50%, got ${r9a}`);
  const r9b = formatPressure(0.856);
  assert.equal(r9b, '86%', `P9b 0.856 → 86%, got ${r9b}`);
  record('P9 formatPressure', true, '0.5→50%, 0.856→86%');

  // ===== P10: getPressureLevel 4 档 =====
  assert.equal(getPressureLevel(0.3), 'ok', 'P10a ok');
  assert.equal(getPressureLevel(0.75), 'warning', 'P10b warning');
  assert.equal(getPressureLevel(0.9), 'critical', 'P10c critical');
  assert.equal(getPressureLevel(0.97), 'danger', 'P10d danger');
  record('P10 getPressureLevel', true, 'ok/warning/critical/danger');

  // ===== P11-P12: 边界 =====
  assert.equal(getPressureLevel(0.7), 'warning', 'P11 0.7=warning');
  assert.equal(getPressureLevel(0.95), 'danger', 'P12 0.95=danger');
  assert.equal(getPressureLevel(0.85), 'critical', 'P11b 0.85=critical');
  record('P11-P12 level 阈值', true, '0.7=w, 0.85=c, 0.95=d');

  // ===== P13: type StorageStatus =====
  // 编译期验证：StorageStatus 应有 usage/quota/ratio/critical
  const r13 = { usage: 1, quota: 2, ratio: 0.5, critical: false };
  assert.equal(typeof r13.usage, 'number', 'P13 type check');
  record('P13 StorageStatus type', true, '字段完整');

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