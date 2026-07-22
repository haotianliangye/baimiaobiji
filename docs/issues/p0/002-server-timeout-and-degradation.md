# Issue #002: 服务端超时 + 降级

**优先级**：P0
**分支**：`feat/issue-002-server-timeout`
**版本号**：0.1.0 → 0.1.1（patch）
**预计工作量**：1-2 小时
**schema 变更**：无

## 目标

LLM 服务商挂掉不拖死 Express 进程。所有外网调用必须有超时，所有外网调用失败必须有清晰的错误返回。

## 当前问题

[server.ts:1225](file:///d:/baimiaobiji/server.ts#L1225) 的 `fetch(apiUrl, ...)` 没有 `signal`，挂死请求会拖死整个进程。

## 文件改动

### [server.ts](file:///d:/baimiaobiji/server.ts) 顶部新增 helper
```typescript
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 30000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
```

### 替换所有 fetch 调用点

| 位置 | 当前 | 改为 | 超时 |
|------|------|------|------|
| [server.ts:250](file:///d:/baimiaobiji/server.ts#L250) embedding | `fetch(apiUrl, ...)` | `fetchWithTimeout(apiUrl, ..., 15000)` | 15s |
| [server.ts:311](file:///d:/baimiaobiji/server.ts#L311) test-connection chat | `fetch(...)` | `fetchWithTimeout(..., 8000)` | 8s |
| [server.ts:347](file:///d:/baimiaobiji/server.ts#L347) test-connection embed | `fetch(...)` | `fetchWithTimeout(..., 8000)` | 8s |
| [server.ts:789](file:///d:/baimiaobiji/server.ts#L789) volcengine transcribe | `fetchRes = await fetch(apiUrl, ...)` | `fetchWithTimeout(apiUrl, ..., 60000)` | 60s |
| [server.ts:898](file:///d:/baimiaobiji/server.ts#L898) transcribe fetch | `fetchRes = await fetch(apiUrl, ...)` | `fetchWithTimeout(apiUrl, ..., 60000)` | 60s |
| [server.ts:1052](file:///d:/baimiaobiji/server.ts#L1052) volcengine TTS | `fetchRes = await fetch(apiUrl, ...)` | `fetchWithTimeout(apiUrl, ..., 30000)` | 30s |
| [server.ts:1110](file:///d:/baimiaobiji/server.ts#L1110) WebDAV proxy | `response = await fetch(url, ...)` | `fetchWithTimeout(url, ..., 30000)` | 30s |

### 新增 `/api/health` 端点

```typescript
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    version: pkg.version,
    timestamp: Date.now(),
  });
});
```

### 错误返回统一化

所有超时错误返回：
```json
{ "error": "服务暂时不可用：请求超时。请稍后重试。" }
```

## TDD checklist

- [ ] 单元测试 `fetchWithTimeout`：mock 慢端点（5s 才返回），传 timeout=1s，确认 AbortController 触发
- [ ] 单元测试：超时后清理 timer（不留下挂起的 timer）
- [ ] 集成测试 `/api/health` 返回 `{ok, uptime, version}`
- [ ] 集成测试：所有 `/api/*` 端点对超时返回正确错误信息

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] 手动测试：模拟 LLM 服务商挂掉（用 mock），前端能在合理时间内收到错误而不是挂死
- [ ] `/api/health` 返回正确数据

## commit 后

1. 合并 main
2. `git tag v0.1.1 && git push origin v0.1.1`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #002 行：⏳ → ✅

## 风险

低（纯代码改动，不改 API 契约）。但要回归所有 `/api/*` 端点确保没破坏现有逻辑。