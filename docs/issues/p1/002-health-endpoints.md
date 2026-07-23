# Issue P1-002 (MoN-8): 健康检查端点扩 4 个

**优先级**：P1
**分支**：`feat/p1-002-health-endpoint`
**版本号**：0.3.0 → 0.3.0（无功能变更，patch 都不打）
**预计工作量**：30-60 分钟
**schema 变更**：无
**新增依赖**：无

## 目标

把现有的 1 个 `/api/health` 端点扩展为 4 个独立端点，覆盖**监控/诊断**的不同场景。
**纯基础设施加固，不加任何产品功能**。

## 当前问题

`server.ts` line 1285 已有 `/api/health`（#002 沉淀），返回：
```json
{ ok: true, uptime, version, timestamp }
```

**不够用**：
- ❌ **没有 readiness 探针**：外部监控无法区分"进程跑着" vs "进程跑着 + db 正常"
- ❌ **没有版本端点**：客户端启动时拿不到 build version
- ❌ **没有存储端点**：Issue #007 沉淀的 `getStoragePressure` 没暴露给监控
- ❌ **没有 build 元信息**：build 时间 / commit hash / db version 没法看

## 设计：4 个端点

| 端点 | 用途 | 状态码 | 频率限制 |
|------|------|--------|----------|
| `GET /api/health` | liveness（进程在跑？） | 总是 200 | 无（低成本）|
| `GET /api/ready` | readiness（db 连得上？）| 200 ok / 503 not ready | 30s 节流 |
| `GET /api/version` | 纯版本信息 | 200 | 无 |
| `GET /api/storage` | 存储压力（#007 集成）| 200 | 60s 节流 |

## 端点详情

### `GET /api/health`（保留现有）
```json
{
  "ok": true,
  "uptime": 1234.5,
  "version": "0.3.0",
  "timestamp": 1721740000000
}
```
- **保持完全兼容**（#002 沉淀）
- 不改任何字段

### `GET /api/ready`（新增）
```json
{
  "ok": true,
  "db": "reachable",      // or "unreachable"
  "db_version": 16,        // db.verno
  "uptime": 1234.5,
  "timestamp": 1721740000000
}
```
- 检查 Dexie db 是否能 `db.open()`
- 失败时返回 **503**（让 K8s / uptime robot 重试）
- 30s 节流：缓存上次结果，避免每次请求都 open db

### `GET /api/version`（新增）
```json
{
  "version": "0.3.0",
  "db_version": 16,
  "build_time": "2026-07-23T11:00:00Z",  // 启动时间
  "node_version": "v22.16.0",
  "platform": "win32"
}
```
- **纯 metadata**，不检查任何状态
- 客户端启动时调一次

### `GET /api/storage`（新增）
```json
{
  "used_bytes": 12345678,
  "quota_bytes": 268435456,
  "ratio": 0.046,
  "level": "ok"  // "ok" | "warning" | "critical" | "danger"
}
```
- 复用 `src/lib/storagePressure.ts` 的 `checkStoragePressure` (#007 沉淀)
- 60s 节流

## 文件改动

### [server.ts](file:///d:/baimiaobiji/server.ts) line 1285 区域

- 在 `/api/health` 后加 3 个新端点
- **不删** `/api/health`（保持兼容）
- 节流用闭包 + `Map<string, timestamp>`，**不引入**新依赖

### [tests/health-endpoints.test.ts](file:///d:/baimiaobiji/tests/health-endpoints.test.ts)（新增）

- 跑 `node dist/server.cjs` 启动 server
- 4 个端点各一组：
  - H1: /api/health 返回 200 + 现有 4 字段
  - H2: /api/ready 返回 200 + db.reachable + db_version 是数字
  - H3: /api/version 返回 200 + version 匹配 package.json
  - H4: /api/storage 返回 200 + ratio 在 [0, 1] + level 是 4 档之一
- 端口 4180（避开 4173-4179）

## 设计取舍

| 决策 | 理由 |
|------|------|
| **不删** /api/health | 保持 #002 沉淀的兼容（外部监控可能在用）|
| **不引入** 节流库 | 用闭包 + Date.now() 即可，< 20 行 |
| **不加** auth | 这些是 debug/monitoring 端点，部署在内网；如果要加 auth 留 P2 |
| **/api/storage 单独端点** | 不和 /api/ready 混；关注点分离 |
| **60s 节流** storage | estimate 调 navigator.storage.estimate 浏览器侧，server 端用 process.memoryUsage() 替代 |

## TDD checklist

- [ ] H1 /api/health 仍返回 4 字段
- [ ] H2 /api/ready 返回 ok + db_version
- [ ] H3 /api/version 匹配 package.json
- [ ] H4 /api/storage ratio ∈ [0, 1] + level 4 档
- [ ] 节流工作：连续两次 ready，第二次 < 50ms 返回（用缓存）

## 验收标准

- [ ] `npx tsc --noEmit` 通过
- [ ] `npm run build` 通过
- [ ] `npx tsx tests/health-endpoints.test.ts` 全过
- [ ] `npx tsx tests/server-health.test.ts` 仍过（兼容性）

## commit 后

1. 合并到 `refactor/mingwu-to-insight`（**本地合并，不 push**）
2. **不打 tag**（无版本变更）
3. **不 push** —— 等用户决定
4. 更新 `docs/handoff/CURRENT_STATE.md` P1 进度表

## 风险

**低**。原因：
- 加 3 个端点，diff < 80 行
- 不改现有 /api/health
- 失败最差：外部监控看到 readiness=false（不会引发线上事故）
- 节流失败最差：高 QPS 时多次开 db（但 30s 节流已经够保守）

## 后续

P1 阶段按这个顺序继续：
- ✅ P1-001 (MoN-7) 测试接 CI（本地完成）
- 🚧 P1-002 (MoN-8) 本 PR
- P1-003 (ADR-0003) API Key 真隔离
- P1-004 (ADR-0004) 长期记忆 facts 表