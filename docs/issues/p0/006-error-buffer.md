# Issue #006: 错误日志环形缓冲

**优先级**：P0
**分支**：`feat/issue-006-error-buffer`
**版本号**：0.2.1 → 0.2.2（patch）
**预计工作量**：2 小时
**schema 变更**：无

## 目标

用户反馈问题时能导出错误现场。本地环形缓冲，不接第三方监控（隐私优先）。

## 当前问题

所有错误处理都是 `console.error(err)` 就完了。用户手机上的错误你永远看不到。

## 文件改动

### 新建 [src/lib/errorLog.ts](file:///d:/baimiaobiji/src/lib/errorLog.ts)

```typescript
interface ErrorEntry {
  ts: number;
  msg: string;
  ctx?: any;
  stack?: string;
}

const ERROR_BUFFER: ErrorEntry[] = [];
const MAX_SIZE = 100;

export function logError(msg: string, ctx?: any): void {
  ERROR_BUFFER.push({
    ts: Date.now(),
    msg,
    ctx,
    stack: ctx instanceof Error ? ctx.stack : undefined,
  });
  if (ERROR_BUFFER.length > MAX_SIZE) {
    ERROR_BUFFER.shift();
  }
  // 仍然输出到 console
  console.error(msg, ctx);
}

export function exportErrorLog(): string {
  return JSON.stringify({
    exported_at: Date.now(),
    version: import.meta.env.VITE_APP_VERSION,
    errors: ERROR_BUFFER,
  }, null, 2);
}

export function clearErrorLog(): void {
  ERROR_BUFFER.length = 0;
}

export function getErrorCount(): number {
  return ERROR_BUFFER.length;
}
```

### 替换所有 `console.error` 调用点

重点位置（Grep 结果）：
- [src/store/app.store.ts](file:///d:/baimiaobiji/src/store/app.store.ts)
- [src/lib/embedding.ts](file:///d:/baimiaobiji/src/lib/embedding.ts)
- [src/lib/dataExport.ts](file:///d:/baimiaobiji/src/lib/dataExport.ts)
- 所有 `src/pages/*.tsx` 的 catch 块

### [src/pages/Settings.tsx](file:///d:/baimiaobiji/src/pages/Settings.tsx) 新增「调试」section

- 显示当前缓冲大小
- 「导出错误日志」按钮 → 下载 `error-log-<timestamp>.json`
- 「清空错误日志」按钮

**触发入口**：连点 Settings 页版本号 5 次显示调试 section（避免普通用户误触）。

## TDD checklist

- [ ] 单元测试环形缓冲：满 100 条时正确丢弃最旧
- [ ] 单元测试：导出格式是合法 JSON
- [ ] 单元测试：清空后 getErrorCount() = 0
- [ ] 单元测试：logError 仍然输出到 console

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] 触发一个错误后，导出的 JSON 文件能看到完整记录
- [ ] 环形缓冲超过 100 条时旧的被丢弃

## commit 后

1. 合并 main
2. `git tag v0.2.2 && git push origin v0.2.2`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #006 行：⏳ → ✅

## 风险

无（纯本地功能，不影响核心流程）。