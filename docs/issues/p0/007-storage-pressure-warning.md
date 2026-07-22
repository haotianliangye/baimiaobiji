# Issue #007: 存储预警

**优先级**：P0
**分支**：`feat/issue-007-storage-pressure`
**版本号**：0.2.2 → 0.2.3（patch）
**预计工作量**：半天
**schema 变更**：无

## 目标

IndexedDB 快满时提醒用户备份。iOS 隐私模式、存储压力、用户清缓存都可能丢数据，这是可预期的失败模式。

## 当前问题

浏览器在存储压力下会 evict IndexedDB。应用没有任何感知。

## 文件改动

### [src/lib/storage.ts](file:///d:/baimiaobiji/src/lib/storage.ts) 新增 helper

```typescript
// 申请持久化存储（避免浏览器自动 evict）
export async function ensurePersistentStorage(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    const isPersisted = await navigator.storage.persisted();
    if (!isPersisted) {
      return await navigator.storage.persist();
    }
    return isPersisted;
  }
  return false;
}

export interface StorageStatus {
  usage: number;
  quota: number;
  ratio: number;
  critical: boolean;
}

export async function checkStoragePressure(
  criticalThreshold = 0.85
): Promise<StorageStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0, ratio: 0, critical: false };
  }
  const est = await navigator.storage.estimate();
  if (!est.quota || !est.usage) {
    return { usage: 0, quota: 0, ratio: 0, critical: false };
  }
  const ratio = est.usage / est.quota;
  return {
    usage: est.usage,
    quota: est.quota,
    ratio,
    critical: ratio > criticalThreshold,
  };
}
```

### 新建 [src/hooks/useStorageMonitor.ts](file:///d:/baimiaobiji/src/hooks/useStorageMonitor.ts)

```typescript
import { useEffect, useState } from 'react';
import { checkStoragePressure, type StorageStatus } from '../lib/storage';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

export function useStorageMonitor() {
  const [status, setStatus] = useState<StorageStatus | null>(null);

  useEffect(() => {
    const check = async () => {
      const s = await checkStoragePressure();
      setStatus(s);
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return status;
}
```

### [src/App.tsx](file:///d:/baimiaobiji/src/App.tsx) 启动时申请持久化

```typescript
import { ensurePersistentStorage } from './lib/storage';

// 在 useEffect 里
useEffect(() => {
  ensurePersistentStorage();
}, []);
```

### [src/App.tsx](file:///d:/baimiaobiji/src/App.tsx) 触发 Toast

使用 [src/hooks/useStorageMonitor.ts](file:///d:/baimiaobiji/src/hooks/useStorageMonitor.ts)：

```typescript
const storageStatus = useStorageMonitor();

useEffect(() => {
  if (storageStatus?.critical) {
    showToast({
      type: 'warning',
      message: `存储空间紧张（${(storageStatus.ratio * 100).toFixed(0)}%），建议立即导出备份`,
      action: { label: '去备份', onClick: () => navigate('/settings') },
    });
  }
}, [storageStatus?.critical]);
```

### [src/components/Toast.tsx](file:///d:/baimiaobiji/src/components/Toast.tsx) 支持 action 按钮

扩展 Toast 类型支持 action 按钮。

## TDD checklist

- [ ] 单元测试 `checkStoragePressure`：mock `navigator.storage.estimate`，验证临界值
- [ ] 单元测试：mock ratio = 0.9 → critical = true
- [ ] 单元测试：mock ratio = 0.5 → critical = false
- [ ] 单元测试 hook：模拟时间推进，检查轮询触发
- [ ] 单元测试 hook：unmount 时清理 timer

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] 手动测试：mock 一个 85%+ 的存储状态，5 分钟内能看到 Toast
- [ ] Toast 有「去备份」按钮，点击跳转到 Settings

## commit 后

1. 合并 main
2. `git tag v0.2.3 && git push origin v0.2.3`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #007 行：⏳ → ✅

## 风险

低。`navigator.storage.persist()` 在某些浏览器会弹用户确认，需要 UX 文案得当。