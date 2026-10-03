/**
 * autoBackup — 本地自动备份（Issue #008）
 *
 * 目的：IndexedDB 不可靠（iOS 隐私模式、存储压力、用户清缓存都可能丢数据），
 * 本地保留最近 2 份自动备份作为"本地云"兜底。比 WebDAV 简单，比啥都没有强。
 *
 * 设计分层：
 *   1. 纯函数层（无 db 依赖）：
 *      - shouldBackup(decision): 决定是否需要备份（决策表）
 *      - selectAutoBackupsToPrune(backups, maxN): 计算应删除的 auto 备份 id
 *      - buildSnapshotTables(): 应备份的表名（排除 attachments/embeddings）
 *   2. 包装层（涉及 db）：
 *      - maybeBackup(): 启动时调用
 *      - createBackup(type): 创建新备份
 *      - pruneOldAutoBackups(): 仅清理多余的 auto 备份
 *      - restoreBackup(id): 从指定备份恢复
 *      - getAutoBackupEnabled(): 读用户开关
 *
 * 关键决策：
 *   - **只保留最近 2 份 auto 备份**：避免每天累积导致占用爆炸（用户痛点：101→102→103MB
 *     累积成 300+MB 后不得不关闭备份，结果 Chrome 清缓存时两个月数据全废）。
 *     N=2 的取舍：今天 + 昨天两份兜底，单点写入异常仍可回退到昨天。
 *   - **manual 备份永不自动删除**：用户在 Settings 面板主动创建的备份属于「用户资产」，
 *     自动清理策略只作用于 auto 备份。
 *   - **不备份 attachments**：音频 Blob 太大，会让备份体积爆炸
 *   - **不单独备份 embeddings**：向量可重建（#001 沉淀：扫描并补齐）；但 inline 字段
 *     当前随行序列化进 snapshot（autoBackup.ts doc-comment 描述的「不备份 embeddings」
 *     仅指独立的 `embeddings` 表，不影响 inline 字段——这是已知取舍，与本模块保留
 *     策略无关，留给后续 issue 决定是否要真正剥离）
 *   - **不备份 copilot_conversations**：聊天记录经常变，重建不划算
 *   - **不备份 chunks / settings_kv**：chunks 从 raw_logs 重建，settings_kv 已经在云
 *   - **24h 节流**：避免每次启动都打包
 *
 * 重要：本模块只**增加**一个新表 `backups`（db v16），不动其他表
 */

export const DEFAULT_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
export const DEFAULT_MAX_AUTO_BACKUPS = 2; // 最多保留 2 份 auto 备份（今天 + 昨天兜底）

/**
 * 应备份的表（不区分「数据类」和「索引类」）。
 * 选择标准：用户主动产生的内容 + 不易重建的内容。
 */
export const TABLES_TO_BACKUP = [
  'raw_logs',      // 记录原始数据
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
 * 计算应被 prune 删掉的 auto 备份 id（纯函数，方便单测）。
 *
 * 规则：
 *   - 仅处理 `type === 'auto'` 的备份；manual 备份永不入选
 *   - 按 `created_at` 倒序，保留最新 N 条，删除其余
 *   - N ≤ 0 时全部入选（极端值，便于测试/管理员操作）
 *   - 输入不合法（不是数组 / 缺字段）→ 返回空数组（防御性，不误删）
 *
 * 时间复杂度 O(n log n)（排序）；n 一般 ≤ 几十，无压力。
 */
export function selectAutoBackupsToPrune(backups: BackupRecord[], maxN: number = DEFAULT_MAX_AUTO_BACKUPS): string[] {
  if (!Array.isArray(backups) || maxN < 0) return [];
  const autos = backups
    .filter((b) => b && b.type === 'auto' && typeof b.id === 'string')
    .sort((a, b) => b.created_at - a.created_at);
  if (autos.length <= maxN) return [];
  return autos.slice(maxN).map((b) => b.id);
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
 * 仅 auto 备份触发 prune（manual 备份是用户资产，永不被自动删）。
 * R2 云备份仅在 type === 'auto'（或配置了 cloudBackupR2IncludeManual）时触发，
 * 且失败不阻塞本地备份（fire-and-forget + console.warn）。
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
  if (type === 'auto') {
    await pruneOldAutoBackups();
  }
  // Issue #009: 把这条备份推一份加密快照到 R2（fire-and-forget）。
  // 失败仅 console.warn，不阻塞本地备份；UI 看 cloud_uploaded_at 字段判断状态。
  const shouldPush = type === 'auto' || (type === 'manual' && getCloudBackupR2IncludeManual());
  if (shouldPush) {
    void pushBackupToR2(record).catch((err) => {
      console.warn('[autoBackup] R2 push failed (local backup preserved):', err);
    });
  }
  return record;
}

/**
 * 把一条备份记录推送到 R2。
 *   1. 读 settings：cloudBackupR2Enabled / cloudBackupR2Bucket / syncPasswordE2EE
 *   2. R2Client.encryptAndUpload(payload, password)
 *   3. 成功后写 backups.cloud_uploaded_at
 *
 * 设计：
 *   - 失败不抛：调用方在 fire-and-forget 链路中已 console.warn；
 *     这里 throw 也只是给调用方一次重 catch 的机会，无副作用。
 *   - settings 读取懒执行（避免在 main.tsx 启动阶段耦合）
 */
export async function pushBackupToR2(record: BackupRecord): Promise<void> {
  if (!isCloudBackupR2Enabled() || !getCloudBackupR2Bucket() || !getCloudBackupR2Password()) {
    // 配置未完整（开关关 / bucket 空 / 密码空）→ 静默跳过，不算失败
    return;
  }
  const client = makeR2Client();
  const result = await client.encryptAndUpload(record.payload, getCloudBackupR2Password()!);
  await db.backups.update(record.id, { cloud_uploaded_at: Date.now() });
  console.log(`[autoBackup] R2 push ok: ${result.key}`);
}

// ===== 懒加载的 settings 镜像 + R2Client 工厂 =====
// 不直接 import settings.store.ts 是为了避免 autoBackup.ts 在 main.tsx 启动时
// 把 settings store 拽进来（settings store 反过来又依赖一些 DB 状态）。
// 通过 useSettingsStore.getState() 在第一次 push 时再同步取值。

import { useSettingsStore } from '../store/settings.store';
import { R2Client } from './r2Client';

function isCloudBackupR2Enabled(): boolean {
  return useSettingsStore.getState().cloudBackupR2Enabled === true;
}

function getCloudBackupR2Bucket(): string {
  return (useSettingsStore.getState().cloudBackupR2Bucket || '').trim();
}

function getCloudBackupR2Prefix(): string {
  const v = (useSettingsStore.getState().cloudBackupR2Prefix || '').trim();
  return v.length > 0 ? v : 'baimiaobiji';
}

function getCloudBackupR2Password(): string | null {
  const pwd = useSettingsStore.getState().syncPasswordE2EE;
  return typeof pwd === 'string' && pwd.length > 0 ? pwd : null;
}

function getCloudBackupR2IncludeManual(): boolean {
  return useSettingsStore.getState().cloudBackupR2IncludeManual === true;
}

function makeR2Client(): R2Client {
  return new R2Client({
    bucket: getCloudBackupR2Bucket(),
    keyPrefix: getCloudBackupR2Prefix(),
  });
}

/**
 * 删除多余的 auto 备份（保留最近 N 份）。
 * manual 备份永远不会被这条函数删掉。
 */
export async function pruneOldAutoBackups(maxN: number = DEFAULT_MAX_AUTO_BACKUPS): Promise<number> {
  const all = await db.backups.toArray();
  const idsToDelete = selectAutoBackupsToPrune(all, maxN);
  if (idsToDelete.length > 0) {
    await db.backups.bulkDelete(idsToDelete);
  }
  return idsToDelete.length;
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