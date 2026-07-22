# Issue #008: 自动备份

**优先级**：P0
**分支**：`feat/issue-008-auto-backup`
**版本号**：0.2.3 → 0.3.0（**minor**，schema 变更）
**预计工作量**：半天
**schema 变更**：v14 → v15（新增 `backups` 表）

## 目标

本地保留最近 4 周快照，用户可选开关。轻量本地云——比 WebDAV 简单，比啥都没有强。

## 当前问题

只有手动导出。IndexedDB 不可靠，用户用一周丢数据是可预期失败模式。

## 文件改动

### [src/db/db.ts](file:///d:/baimiaobiji/src/db/db.ts) v15

```typescript
this.version(15).stores({
  // 保留 v14 所有表
  backups: 'id, created_at, type',
});
```

新增 `BackupRecord` 接口：
```typescript
interface BackupRecord {
  id: string;
  created_at: number;
  type: 'auto' | 'manual';
  payload: string;       // JSON 快照
  size_bytes: number;
  source_version: string; // package.json version
  db_version: number;     // db.verno
}
```

### 新建 [src/lib/autoBackup.ts](file:///d:/baimiaobiji/src/lib/autoBackup.ts)

```typescript
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const RETENTION_DAYS = 28; // 4 周

export async function maybeBackup(): Promise<BackupRecord | null> {
  const enabled = await getAutoBackupEnabled();
  if (!enabled) return null;

  const last = await db.backups.orderBy('created_at').last();
  if (last && Date.now() - last.created_at < BACKUP_INTERVAL_MS) {
    return null; // 24h 内已备份
  }

  return await createBackup('auto');
}

export async function createBackup(type: 'auto' | 'manual'): Promise<BackupRecord> {
  // 备份数据：raw_logs + daily_reviews + thoughts + mingwu + tags
  // 不备份：attachments（音频 Blob 太大）+ embeddings（重建）
  const snapshot = {
    raw_logs: await db.raw_logs.toArray(),
    daily_reviews: await db.daily_reviews.toArray(),
    thoughts: await db.thoughts.toArray(),
    mingwu: await db.mingwu.toArray(),
    tags: await db.tags.toArray(),
  };
  const payload = JSON.stringify(snapshot);

  const record: BackupRecord = {
    id: crypto.randomUUID(),
    created_at: Date.now(),
    type,
    payload,
    size_bytes: payload.length,
    source_version: import.meta.env.VITE_APP_VERSION,
    db_version: db.verno,
  };

  await db.backups.add(record);
  await pruneOldBackups();
  return record;
}

export async function pruneOldBackups(): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const old = await db.backups.where('created_at').below(cutoff).toArray();
  if (old.length > 0) {
    await db.backups.bulkDelete(old.map(b => b.id));
  }
}

export async function restoreBackup(id: string): Promise<void> {
  const backup = await db.backups.get(id);
  if (!backup) throw new Error('备份不存在');

  const snapshot = JSON.parse(backup.payload);

  // ⚠️ 危险操作：先备份当前，再恢复
  await createBackup('manual');
  await db.transaction('rw', [db.raw_logs, db.daily_reviews, db.thoughts, db.mingwu, db.tags], async () => {
    await db.raw_logs.clear();
    await db.daily_reviews.clear();
    await db.thoughts.clear();
    await db.mingwu.clear();
    await db.tags.clear();
    await db.raw_logs.bulkAdd(snapshot.raw_logs);
    await db.daily_reviews.bulkAdd(snapshot.daily_reviews);
    await db.thoughts.bulkAdd(snapshot.thoughts);
    await db.mingwu.bulkAdd(snapshot.mingwu);
    await db.tags.bulkAdd(snapshot.tags);
  });
}
```

### [src/App.tsx](file:///d:/baimiaobiji/src/App.tsx) 监听 visibilitychange

```typescript
import { maybeBackup } from './lib/autoBackup';

useEffect(() => {
  const handler = async () => {
    if (document.visibilityState === 'hidden') {
      await maybeBackup();
    }
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}, []);
```

### [src/pages/Settings.tsx](file:///d:/baimiaobiji/src/pages/Settings.tsx) 新增「数据备份」section

- 「启用本地自动备份」开关（默认开启）
- 「最近备份列表」：显示时间、大小、类型
- 「手动备份」按钮
- 「恢复」按钮（每个备份条目旁）
- 显著提示：**备份不包含音频附件**，音频单独管理

### [src/store/settings.store.ts](file:///d:/baimiaobiji/src/store/settings.store.ts) 加配置项

```typescript
autoBackup: boolean; // 默认 true
```

## TDD checklist

- [ ] 单元测试 `maybeBackup`：24h 内不重复备份
- [ ] 单元测试 `maybeBackup`：开关关闭时不备份
- [ ] 单元测试 `pruneOldBackups`：4 周前的被清理
- [ ] 集成测试：导出 → 清库 → 导入，数据库完整恢复
- [ ] 集成测试：备份不含 attachments 和 embeddings
- [ ] 性能测试：1000 条 raw_logs + 100 条 daily_reviews 的备份时间 < 2s

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] db migration v14 → v15 平滑
- [ ] 开启开关后 24 小时内产生至少 1 条 backup 记录
- [ ] 超过 4 周的记录被自动清理
- [ ] 手动恢复后数据库内容正确（不含 attachments）
- [ ] Settings 页明确告知用户备份范围

## commit 后

1. 合并 main
2. `git tag v0.3.0 && git push origin v0.3.0`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #008 行：⏳ → ✅
4. **重要**：P0 全部完成。准备一次端到端回归测试，更新 `CONTEXT.md`

## 风险

**中**。涉及：
- schema 迁移（v14 → v15）
- IndexedDB 存储压力（备份本身占空间）
- 恢复操作的危险性（清库 + 导入）

缓解：
- backup 不带 attachments（已实现）+ 不带 embeddings
- 自动 prune（已实现）
- 恢复前自动备份当前状态（已实现）
- UI 必须明确告知备份范围