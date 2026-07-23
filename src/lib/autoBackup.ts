/**
 * autoBackup — 本地自动备份（Issue #008）
 *
 * 目的：IndexedDB 不可靠（iOS 隐私模式、存储压力、用户清缓存都可能丢数据），
 * 本地保留最近 4 周快照作为"本地云"。比 WebDAV 简单，比啥都没有强。
 *
 * 设计分层：
 *   1. 纯函数层（无 db 依赖）：
 *      - shouldBackup(decision): 决定是否需要备份（决策表）
 *      - pruneCutoff(now, days): 计算过期时间
 *      - buildSnapshotTables(): 应备份的表名（排除 attachments/embeddings）
 *   2. 包装层（涉及 db）：
 *      - maybeBackup(): 启动时调用
 *      - createBackup(type): 创建新备份
 *      - pruneOldBackups(): 清掉过期备份
 *      - restoreBackup(id): 从指定备份恢复
 *      - getAutoBackupEnabled(): 读用户开关
 *
 * 关键决策：
 *   - **不备份 attachments**：音频 Blob 太大，会让备份体积爆炸
 *   - **不备份 embeddings**：向量可以重建（#001 沉淀：扫描并补齐）
 *   - **不备份 copilot_conversations**：聊天记录经常变，重建不划算
 *   - **不备份 chunks / settings_kv**：chunks 从 raw_logs 重建，settings_kv 已经在云
 *   - **保留 28 天（4 周）**：覆盖「最坏情况：用户 1 个月没打开 app」
 *   - **24h 节流**：避免每次启动都打包
 *
 * 重要：本模块只**增加**一个新表 `backups`（db v16），不动其他表
 */

export const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_RETENTION_DAYS = 28; // 4 周

/**
 * 应备份的表（不区分「数据类」和「索引类」）。
 * 选择标准：用户主动产生的内容 + 不易重建的内容。
 */
export const TABLES_TO_BACKUP = [
  'raw_logs',      // 拾微原始记录
  'daily_reviews', // 日记/回顾合并表
  'thoughts',      // 沉淀
  'insights',      // 明悟/洞察（v14 后改名为 insights）
  'tags',          // 标签体系
] as const;

/**
 * 故意不备份的表。
 */
export const TABLES_TO_EXCLUDE = [
  'attachments',           // 音频/图片 Blob（太大，重建代价 < 备份代价）
  'chunks',                // 文本切片（从 raw_logs 重建）
  'embeddings',            // （如有独立表）向量可重建
  'copilot_conversations', // 聊天记录经常变
  'settings_kv',           // 配置已在云同步覆盖
  'migration_backups',     // 旧 V2 迁移备份，不再需要
  'facts',                 // P1-004 (ADR-0004)：长期记忆 — 重建代价低（P2 候选：从 daily_reviews AI 抽取）
] as const;

export interface ShouldBackupArgs {
  enabled: boolean;
  lastBackupAt: number; // 0 = 从未备份
  now?: number;
  intervalMs?: number;
}

/**
 * 决策：是否需要备份？
 *   - 关闭 → false
 *   - 24h 内已备份 → false
 *   - 没备份过 / 24h 之前 → true
 *
 * 边界：lastBackupAt === now - intervalMs → false（严格大于才备份）
 */
export function shouldBackup(args: ShouldBackupArgs): boolean {
  const { enabled, lastBackupAt, now = Date.now(), intervalMs = DEFAULT_BACKUP_INTERVAL_MS } = args;
  if (!enabled) return false;
  if (lastBackupAt === 0) return true;
  return now - lastBackupAt > intervalMs;
}

/**
 * 计算过期 cutoff（cutoff 之前的备份被删）。
 */
export function pruneCutoff(now: number = Date.now(), retentionDays: number = DEFAULT_RETENTION_DAYS): number {
  return now - retentionDays * 24 * 60 * 60 * 1000;
}

/**
 * 返回应备份的表名列表（运行时调 db.table(name).toArray()）。
 */
export function buildSnapshotTables(): readonly string[] {
  return TABLES_TO_BACKUP;
}

// ===== 包装层：db 操作 =====

import { db, type BackupRecord } from '../db/db';
import pkg from '../../package.json' with { type: 'json' };

/** 复用 db.ts 的 BackupRecord（避免重复定义） */
export type { BackupRecord };

const AUTO_BACKUP_KEY = 'autoBackup.enabled';

/**
 * 读用户开关（settings_kv 表）。
 * 默认 true（开启）。
 */
export async function getAutoBackupEnabled(): Promise<boolean> {
  try {
    const row = await db.settings_kv.get(AUTO_BACKUP_KEY);
    if (row && typeof (row.value as any)?.enabled === 'boolean') {
      return (row.value as any).enabled;
    }
  } catch {
    // 缺表 / db 没初始化 → 默认 true
  }
  return true;
}

export async function setAutoBackupEnabled(enabled: boolean): Promise<void> {
  await db.settings_kv.put({
    key: AUTO_BACKUP_KEY,
    value: { enabled },
    updated_at: Date.now(),
  });
}

/**
 * 创建一条备份（auto / manual）。
 * 自动 prune 旧备份。
 */
export async function createBackup(type: 'auto' | 'manual'): Promise<BackupRecord> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of TABLES_TO_BACKUP) {
    // @ts-ignore — Dexie table() 接受任何已注册表名
    snapshot[table] = await db.table(table).toArray();
  }
  const payload = JSON.stringify(snapshot);

  const record: BackupRecord = {
    id: crypto.randomUUID(),
    created_at: Date.now(),
    type,
    payload,
    size_bytes: payload.length,
    source_version: pkg.version,
    db_version: db.verno,
  };

  await db.backups.add(record);
  await pruneOldBackups();
  return record;
}

/**
 * 删除早于 cutoff 的备份。
 */
export async function pruneOldBackups(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<number> {
  const cutoff = pruneCutoff(Date.now(), retentionDays);
  const old = await db.backups.where('created_at').below(cutoff).toArray();
  if (old.length > 0) {
    await db.backups.bulkDelete(old.map(b => b.id));
  }
  return old.length;
}

/**
 * 启动时调用：检查是否该备份了。
 *
 * 用途：App 启动时（visibilitychange === 'hidden'，或主入口 init）调用。
 * 返回创建的备份（或 null 表示跳过了）。
 */
export async function maybeBackup(): Promise<BackupRecord | null> {
  const enabled = await getAutoBackupEnabled();
  const last = await db.backups.orderBy('created_at').last();
  const lastAt = last?.created_at ?? 0;

  if (!shouldBackup({ enabled, lastBackupAt: lastAt })) {
    return null;
  }

  return await createBackup('auto');
}

/**
 * 列出最近 N 条备份（按时间倒序）。
 */
export async function listBackups(limit: number = 20): Promise<BackupRecord[]> {
  const all = await db.backups.orderBy('created_at').reverse().limit(limit).toArray();
  return all;
}

/**
 * 恢复指定备份（危险操作）。
 *
 * 流程：
 *   1. 先创建一条 manual 备份当前状态（防回不去）
 *   2. 在 transaction 里：清目标表 → bulkAdd 备份内容
 *   3. attachments / embeddings / chunks 不恢复（备份本就不含）
 *
 * ⚠️ 调用方必须 confirm
 */
export async function restoreBackup(id: string): Promise<void> {
  const backup = await db.backups.get(id);
  if (!backup) throw new Error('备份不存在');

  const snapshot = JSON.parse(backup.payload);

  // 防回不去：先备份当前
  await createBackup('manual');

  await db.transaction('rw', TABLES_TO_BACKUP as unknown as string[], async () => {
    for (const table of TABLES_TO_BACKUP) {
      // @ts-ignore
      await db.table(table).clear();
    }
    for (const table of TABLES_TO_BACKUP) {
      const data = snapshot[table];
      if (Array.isArray(data) && data.length > 0) {
        // @ts-ignore
        await db.table(table).bulkAdd(data);
      }
    }
  });
}

/**
 * 删除单条备份（手动清理用）。
 */
export async function deleteBackup(id: string): Promise<void> {
  await db.backups.delete(id);
}

/**
 * 估算存储占用（所有 backups 记录 size_bytes 总和）。
 */
export async function totalBackupSize(): Promise<number> {
  const all = await db.backups.toArray();
  return all.reduce((sum, b) => sum + b.size_bytes, 0);
}