# CURRENT_STATE — 断点恢复专用

> **场景**：你开了一个新窗口/重新打开了 Trae，想继续 P0 实施。
> **用法**：先读这个文件，了解当前进度，再读对应 issue 文件开工。

---

## 当前进度（截至 2026-07-19）

| Issue | 标题 | 状态 | 分支 | 验收 |
|-------|------|------|------|------|
| #001 | 版本号与发布纪律 | ⏳ 待开始 | — | — |
| #002 | 服务端超时 + 降级 | ⏳ 待开始 | — | — |
| #003 | 任务队列指数退避 | ⏳ 待开始 | — | — |
| #004 | 转写幻觉检测升级 | ⏳ 待开始 | — | — |
| #005 | 引用回溯验证 | ⏳ 待开始 | — | — |
| #006 | 错误日志环形缓冲 | ⏳ 待开始 | — | — |
| #007 | 存储预警 | ⏳ 待开始 | — | — |
| #008 | 自动备份 | ⏳ 待开始 | — | — |

**图例**：⏳ 待开始 / 🚧 进行中 / ✅ 已合并 / ❌ 已回滚

## 下一步动作

**如果你是新 session 接手，从这里开始**：

1. 读 `CONTEXT.md`（已读，跳过）
2. 检查上方进度表，找到第一个 ⏳ 的 issue
3. 读 `docs/issues/p0/NNN-xxx.md` 对应文件
4. 切分支：`git checkout -b feat/issue-NNN-<short-name>`
5. 跑 TDD 流程：`red → green → refactor → review → commit`

## 跨 issue 的硬约束（不要破坏）

### Schema 迁移顺序
- `#004` → db version 14（新增 `settings_kv` 表）
- `#008` → db version 15（新增 `backups` 表）
- **不能并行或倒序**，否则迁移冲突

### 渲染约定
- `#005` 完成后，所有 Markdown 渲染前必经 `verifyCitations`
- 新写页面时**默认**集成此约定，不要绕过

### 版本号
- `#001` 起 `0.1.0`
- `#004` 后 `0.2.0`（schema 变更 = minor）
- `#008` 后 `0.3.0`（schema 变更 = minor）
- 其余 patch bump

## 已知的坑（来自 Karpathy 评估）

### issue #004 转写黑名单外置
- 风险：默认 pattern 缺失导致转写被错杀
- 缓解：保留旧硬编码逻辑作 fallback，pattern 为空时回退

### issue #005 引用回溯验证
- 风险：长日记几千引用导致性能问题
- 缓解：批量查询缓存 + 大文本跳过（如 > 100KB 跳过 verify）

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