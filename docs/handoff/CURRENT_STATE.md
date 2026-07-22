# CURRENT_STATE — 断点恢复专用

> **场景**：你开了一个新窗口/重新打开了 Trae，想继续 P0 实施。
> **用法**：先读这个文件，了解当前进度，再读对应 issue 文件开工。

---

## 当前进度（截至 2026-07-19）

| Issue | 标题 | 状态 | 分支 | 验收 |
|-------|------|------|------|------|
| #001 | 版本号与发布纪律 | ✅ 已合并 (commit `8fb380f`, tag `v0.1.0`) | feat/issue-001-versioning | bundle 含 `b6="0.1.0"` |
| #002 | 服务端超时 + 降级 | ✅ 已合并 (commit `8b5f671`, tag `v0.1.1`) | feat/issue-002-server-timeout | 5/5 fetch + 8/8 health 通过 |
| #003 | 任务队列指数退避 | ✅ 已合并 (commit `f08cef4`, tag `v0.1.2`) | feat/issue-003-backoff | 8/8 backoff 测试通过 |
| #004 | 转写幻觉检测升级 | ✅ 已合并 (commit `37a66bc`, tag `v0.2.0`) | feat/issue-004-hallucination-filters | 16/16 filter 测试通过 + db v15 |
| #005 | 引用回溯验证 | ✅ 已合并 (commit `586ae56`, tag `v0.2.1`) | feat/issue-005-cite-verification | 10/10 verify 测试通过 + 100KB 2ms |
| #006 | 错误日志环形缓冲 | ✅ 已合并 (commit `98047e7`, tag `v0.2.2`) | feat/issue-006-error-buffer | 10/10 buffer 测试通过 + 累积版本号修正 |
| #007 | 存储预警 | ⏳ 待开始 | — | — |
| #008 | 自动备份 | ⏳ 待开始 | — | — |

**图例**：⏳ 待开始 / 🚧 进行中 / ✅ 已合并 / ❌ 已回滚

## 下一步动作

**如果你是新 session 接手，从这里开始**：

1. 读这个文件（CURRENT_STATE.md，了解当前进度 + 硬约束）
2. 检查上方进度表，找到第一个 ⏳ 的 issue
3. 读 `docs/issues/p0/NNN-xxx.md` 对应文件
4. 切分支：`git checkout -b feat/issue-NNN-<short-name>`
5. 跑 TDD 流程：`red → green → refactor → review → commit`

## 跨 issue 的硬约束（不要破坏）

### Schema 迁移顺序
- `#004` → db version 15（新增 `settings_kv` 表）
- `#008` → db version 16（新增 `backups` 表）
- **不能并行或倒序**，否则迁移冲突
- 注：原 spec 写 v13→v14，但 v14 已被 mingwu→insights 占用，故 #004 取 v15

### 渲染约定
- `#005` 完成后，所有 Markdown 渲染前必经 `verifyCitations`
- 新写页面时**默认**集成此约定，用 `<VerifiedMarkdown>` 而不是裸 `<ReactMarkdown>`
- 严禁绕过：LLM 编造的引用在 UI 不可见会误导用户

### 版本号
- `#001` 起 `0.1.0`
- `#004` 后 `0.2.0`（schema 变更 = minor）
- `#008` 后 `0.3.0`（schema 变更 = minor）
- 其余 patch bump

## 已建立的约定（Issue 实施中沉淀）

### src/lib/ 模块组织
- 纯函数模块放 `src/lib/<name>.ts`，零依赖、可独立测试
- 单测放 `tests/<name>.test.ts`，npx tsx 直接跑
- 涉及 IndexedDB 的模块要分两层：纯函数（againstIds）+ 包装层（查 db）
  - 例：`citationVerify.verifyCitationsAgainstIds(pure) + verifyCitations(wrapper)`
  - 例：`hallucinationFilter.matchPattern(pure) + db persistence(wrapper)`

### 后端 fetch 调用
- 所有外网 fetch 必走 `fetchWithTimeout`（Issue #002 引入）
- 按任务分档：embedding 15s / tts 30s / transcribe 60s / llm 45s
- 任何新增 /api/* 端点必读 `FETCH_TIMEOUTS`

### 任务队列重试
- 用 `getBackoffMs(retryCount)` 替代固定延时（Issue #003 引入）
- 用 `isRetryableError(err)` 区分 4xx（不重试）和 5xx（重试）
- 4xx 直接从队列移除，避免无限循环

### 客户端 settings 持久化
- 用 `db.settings_kv` 通用 KV 表（Issue #004 引入）
- key 命名约定：`'<domain>.<subKey>'`（如 `'transcription.hallucinationPatterns'`）
- value 字段存 `{ data, updated_at }` 结构
- 首次访问懒写入默认（避免 upgrade 长事务）

### 错误诊断
- 用 `src/lib/errorBuffer.ts`（Issue #006 引入）
- 内存 100 条 FIFO，不持久化（隐私优先）
- 自定义 JSON replacer 显式提取 Error.name/message/stack
- Settings → About tab 有 ErrorInspector 面板（不需要隐藏入口）
- 仍走 console.error（不破坏现有调试路径）

### 包版本号管理
- package.json 的 version 必须随每个 git tag 同步更新
- Issue #006 累积修正 0.1.0 → 0.2.2 的漂移（前 5 个 issue 没 bump）
- vite.config.ts 通过 `import pkg` 注入 VITE_APP_VERSION 到 bundle

## 已知的坑（来自 Karpathy 评估）

### issue #004 转写黑名单外置
- 风险：默认 pattern 缺失导致转写被错杀
- 缓解：保留旧硬编码逻辑作 fallback，pattern 为空时回退

### issue #005 引用回溯验证
- 风险：长日记几千引用导致性能问题
- 缓解：批量查询 + 100KB 实测 2ms
- 替代 path：`<VerifiedMarkdown>` 而非 `<ReactMarkdown>`

### issue #008 自动备份
- 风险：IndexedDB 存储压力加剧
- 缓解：backup 不带 attachments（音频 Blob 太大） + 自动 prune

## 跑 issue 的标准流程（Matt `/implement`）

每个 issue 一个 session：

```
1. 读 docs/issues/p0/NNN-xxx.md（5分钟）
2. 切分支
3. 写测试（red）—— 至少 1 个核心场景
4. 写实现（green）
5. 重构
6. /code-review 跑两轴审查
7. 修复 review 发现的问题
8. 跑 npm run lint && npm test && npm run build
9. git add + commit + push
10. 合并 main + 删分支
11. 如果是 minor 版本，git tag v<version>
12. 更新本文档进度表
```

## 不要做的事

- ❌ 跨 issue 写代码改动（一个 session 只做一个 issue）
- ❌ 跳过 TDD 直接写实现
- ❌ 把 schema 变更放在 minor version 之外（db version 必须跟 package.json version 同步）
- ❌ 在 main 分支直接改代码

## 进度更新模板

完成一个 issue 后，编辑本文件进度表对应行：
- ⏳ → 🚧：开始时改
- 🚧 → ✅：合并后改（带合并 commit SHA）
- 添加 `git tag v<version>` 备注

## 紧急恢复

如果完全不知道进度：
```bash
git log --oneline -20        # 看最近 20 个 commit
git branch -a                # 看所有分支
git tag -l                   # 看所有 tag
```

然后回头更新本文件。