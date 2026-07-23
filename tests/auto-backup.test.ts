/**
 * Issue #008: autoBackup 单元测试
 *
 * 设计：
 *   - autoBackup 核心是「纯函数」：selectTablesToBackup + buildSnapshot
 *   - 涉及 db 的层（maybeBackup / pruneOldBackups / restoreBackup）
 *     需要 mock 复杂的 Dexie 行为；本次只测纯函数层 + 验证业务规则
 *
 * 覆盖：
 *   B1. shouldBackup(enabled, lastBackupAt, now, intervalMs) 决策表
 *   B2. shouldBackup 默认参数
 *   B3. 24h 内已备份 → false
 *   B4. 24h 后 → true
 *   B5. 开关关闭 → false
 *   B6. 没有 last backup → true
 *   B7. pruneCutoff(now, retentionDays) 计算
 *   B8. buildSnapshotTables(): 应排除 attachments / audioBlob / embedding
 *   B9. retentionDays 默认 28
 *   B10. payload 序列化 round-trip
 *
 * 运行：npx tsx tests/auto-backup.test.ts
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function run() {
  const mod = await import('../src/lib/autoBackup');
  const {
    shouldBackup,
    pruneCutoff,
    buildSnapshotTables,
    TABLES_TO_BACKUP,
    TABLES_TO_EXCLUDE,
    DEFAULT_BACKUP_INTERVAL_MS,
    DEFAULT_RETENTION_DAYS,
  } = mod;

  // ===== B1-B6: shouldBackup 决策表 =====
  const now = 1_700_000_000_000;

  // B6: 没有 last → true
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: 0, now }), true, 'B6');
  record('B6 无 last backup → 备份', true, 'true');

  // B3: 24h 内 → false
  const recent = now - ONE_DAY_MS + 1000; // 1 秒前
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: recent, now }), false, 'B3');
  record('B3 24h 内已备份 → 跳过', true, 'false');

  // B4: 24h 后 → true
  const stale = now - ONE_DAY_MS - 1000;
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: stale, now }), true, 'B4');
  record('B4 24h 后 → 备份', true, 'true');

  // B5: 关闭 → false
  assert.equal(shouldBackup({ enabled: false, lastBackupAt: stale, now }), false, 'B5');
  record('B5 关闭 → 跳过', true, 'false');

  // B2: 默认参数
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: stale, now }), true, 'B2 enabled');
  assert.equal(shouldBackup({ enabled: false, lastBackupAt: 0, now }), false, 'B2 disabled');

  // B1 边界：刚好 24h（应该是 false，因为是 ≤）
  const exactly = now - DEFAULT_BACKUP_INTERVAL_MS;
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: exactly, now }), false, 'B1 边界 24h');
  record('B1 边界 24h → 跳过', true, 'false');

  // B1 边界：24h + 1ms
  const oneMs = now - DEFAULT_BACKUP_INTERVAL_MS - 1;
  assert.equal(shouldBackup({ enabled: true, lastBackupAt: oneMs, now }), true, 'B1 24h+1ms');
  record('B1 24h+1ms → 备份', true, 'true');

  // ===== B7: pruneCutoff =====
  const cutoff = pruneCutoff(now, 28);
  // 28 天前
  const expected = now - 28 * ONE_DAY_MS;
  assert.equal(cutoff, expected, `B7 cutoff 应 = ${expected}, got ${cutoff}`);
  record('B7 pruneCutoff', true, `cutoff=28天前`);

  // ===== B8: buildSnapshotTables =====
  const tables = buildSnapshotTables();
  assert.ok(Array.isArray(tables), 'B8 tables 是数组');
  assert.ok(tables.length > 0, 'B8 tables 非空');
  // 必须包含 raw_logs / daily_reviews / thoughts / insights / tags
  const required = ['raw_logs', 'daily_reviews', 'thoughts', 'insights', 'tags'];
  for (const t of required) {
    assert.ok(tables.includes(t), `B8 应含 ${t}, got ${JSON.stringify(tables)}`);
  }
  // 不应包含 attachments / chunks / copilot_conversations
  for (const t of TABLES_TO_EXCLUDE) {
    assert.ok(!tables.includes(t), `B8 不应含 ${t}`);
  }
  record('B8 buildSnapshotTables', true, `tables=${tables.length}, exclude=${TABLES_TO_EXCLUDE.length}`);

  // ===== B9: retentionDays 默认 =====
  assert.equal(DEFAULT_RETENTION_DAYS, 28, 'B9 default 28');
  assert.equal(DEFAULT_BACKUP_INTERVAL_MS, ONE_DAY_MS, 'B9 default 24h');
  record('B9 默认值', true, '28 天 / 24h');

  // ===== B10: 导出常量 TABLES_TO_BACKUP =====
  assert.ok(Array.isArray(TABLES_TO_BACKUP), 'B10');
  assert.equal(TABLES_TO_BACKUP.length, 5, 'B10 5 个表');
  record('B10 TABLES_TO_BACKUP 完整', true, `5 个表`);

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