# Issue #003: 任务队列指数退避

**优先级**：P0
**分支**：`feat/issue-003-backoff`
**版本号**：0.1.1 → 0.1.2（patch）
**预计工作量**：1 小时
**schema 变更**：无

## 目标

任务队列失败重试使用指数退避 + jitter，避免并发重试撞 rate limit。

## 当前问题

[src/store/app.store.ts:924](file:///d:/baimiaobiji/src/store/app.store.ts#L924) 是 `retryCount + 1` 固定重试，[src/store/app.store.ts:935](file:///d:/baimiaobiji/src/store/app.store.ts#L935) 是固定延时 `API_RATE_LIMIT_DELAY_MS`。

10 个并发失败的 LLM 请求同时重试 → 再次撞 rate limit → 形成雪崩。

## 文件改动

### [src/store/app.store.ts](file:///d:/baimiaobiji/src/store/app.store.ts) 新增 helper

```typescript
function getBackoffMs(
  retryCount: number,
  baseMs = 2000,
  maxMs = 60000
): number {
  const exp = Math.min(baseMs * 2 ** retryCount, maxMs);
  const jitter = exp * 0.3 * Math.random(); // ±30% jitter
  return Math.floor(exp + jitter);
}
```

### 区分错误类型

```typescript
function isRetryableError(err: any): boolean {
  // 4xx（API Key 错、配额耗尽）不重试
  if (err?.status >= 400 && err?.status < 500) return false;
  // 5xx、网络错误、超时 → 重试
  return true;
}
```

### 替换固定延时

[src/store/app.store.ts:614](file:///d:/baimiaobiji/src/store/app.store.ts#L614)：
```typescript
// 旧
await new Promise(r => setTimeout(r, SYNC_CONSTANTS.API_RATE_LIMIT_DELAY_MS));

// 新
await new Promise(r => setTimeout(r, getBackoffMs(task.retryCount)));
```

[src/store/app.store.ts:935](file:///d:/baimiaobiji/src/store/app.store.ts#L935)：同上。

### 重试上限调整

网络错误/5xx：5 次
4xx：直接 fail
其他：保持 3 次

## TDD checklist

- [ ] 单元测试 `getBackoffMs`：retryCount=0 → 接近 baseMs（±30%）
- [ ] 单元测试 `getBackoffMs`：retryCount=10 → 不超过 maxMs
- [ ] 单元测试 `getBackoffMs`：jitter 范围 [0.7x, 1.3x]
- [ ] 单元测试 `isRetryableError`：401/403/429 → false；500/网络错误 → true

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] 手动测试：连续失败 5 次，每次间隔明显拉开
- [ ] API Key 错（401）不再重试，直接 fail

## commit 后

1. 合并 main
2. `git tag v0.1.2 && git push origin v0.1.2`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #003 行：⏳ → ✅

## 风险

低。需要回归任务队列的所有调用路径。