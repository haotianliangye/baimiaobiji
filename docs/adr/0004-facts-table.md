# ADR-0004: 长期记忆 facts 表

**状态**：已决策（实施 P1-004 中）
**日期**：2026-07-23
**决策者**：基于 P0 #004（settings_kv 表）+ P0 #008（backups 表）扩展

## 背景

### 当前问题

白描笔记目前是"无长期记忆"产品：
- raw_logs 记瞬时事件（一天后基本忘）
- daily_reviews 记日记（按日期组织）
- insights 是从上面抽取的"明悟"
- **但**没有"关于用户的事实"——用户的生日、偏好、习惯

AI 提示词每次都要从零推断用户。**没有"事实层"**。

### 现状

- `db.ts` 16 个表，0 个是"事实"
- `daily_reviews` 里有些"复述"——但散落在日记正文里
- `insights` 是 AI 抽的——但**置信度无记录**
- `settings_kv` 有 user.birthday 之类的**键值空间**——但**语义不可结构化**

## 决策：路径 A（facts 表 + 手动维护）

**做法**：
- 加新表 `facts`（v17 schema 迁移）
- 字段：id / key / value / category / confidence / source / created_at / updated_at
- 加 `src/lib/factsStore.ts`：CRUD 函数
- **不加 UI**（P1-004 follow-up）
- **不接 AI 自动抽取**（P2 候选）
- **不接 Copilot prompt**（P2 候选）

**为什么路径 A**：
- ✅ 80% 收益 / 20% 工作量（基础设施先行）
- ✅ 不破坏现有数据（v17 是纯新增）
- ✅ 留 P2 升级空间（自动抽取 / UI / 提示词注入）

**为什么不接 AI 自动抽取**（路径 B）：
- ❌ P1 范围超控
- ❌ 抽取算法需 grounded（引用回溯，#005 沉淀的 verifyCitations 可用，但 P1 没预算）
- ❌ 错误事实污染比没有事实更糟
- ✅ 留 P2

**为什么不接 Copilot prompt**（路径 C）：
- ❌ P1 范围超控
- ❌ prompt 模板改动跨多个组件
- ✅ 留 P2

## 实施范围（P1-004）

| 文件 | 改动 |
|------|------|
| `src/db/db.ts` | v17 schema 迁移：加 facts 表 + Fact interface + class 字段 |
| `src/lib/factsStore.ts` (新) | CRUD 函数：add / get / list / search / update / delete / count |
| `tests/factsStore.test.ts` (新) | 单测：CRUD + 搜索 + 范围查询 |
| `src/lib/autoBackup.ts` | 显式排除 facts（不备份） |
| `docs/issues/p1/004-facts-table.md` (新) | spec |
| `docs/adr/0004-facts-table.md` (本文件) | 决策记录 |

## 表结构

```ts
interface Fact {
  id: string;            // uuid, primary key
  key: string;           // 主索引，e.g. 'user.birthday', 'preference.theme'
  value: string;         // 事实值
  category: string;      // 'user' | 'preference' | 'event' | 'context'
  confidence: number;    // 0-1, P0 阶段都填 1.0
  source: 'manual' | 'extracted'; // P0 阶段只 manual
  created_at: number;    // unix ms
  updated_at: number;    // unix ms
}
```

索引设计：
- `id` (主键)
- `key` (唯一键空间，UPSERT 用)
- `category` (按分类筛)
- `created_at` (时间排序)

## 迁移策略

v16 → v17 迁移：
- 纯新增（不改现有表）
- 旧用户首次启动自动升级
- 旧用户的 settings_kv 里如果有 `fact.*` 之类的 key 留那里不动

## 不做（范围控制）

- ❌ 不加 UI（Settings → Facts tab）—— 留 P1-004 follow-up
- ❌ 不接 AI 自动抽取 —— 留 P2
- ❌ 不接 Copilot prompt 注入 —— 留 P2
- ❌ 不做跨设备同步 —— 留 P2（依赖云同步的 facts 处理）
- ❌ 不做自动备份（facts 默认排除）—— 与 P0 #008 一致

## 验收

- [ ] `npx tsc --noEmit` 0 error
- [ ] `npm run build` 通过
- [ ] `npx tsx tests/factsStore.test.ts` 全过
- [ ] 现有 16 个单测仍全过
- [ ] `autoBackup.ts` 显式排除 facts
- [ ] v16 → v17 迁移测试（P0 #004 已有模式）

## 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| v17 schema 漏字段 | 低 | 中 | 完整 unit test 覆盖 |
| factsStore 接口设错 | 中 | 中 | 先加最少 CRUD，P2 再扩展 |
| backup 误含 facts | 低 | 低（KB 占用）| 显式排除 |
| 用户没 UI 看不到 facts | 中 | 低 | 留 follow-up，本 P1 主打 infra |

## 不 push — 等用户决定

本 PR 仍走本地流程。push 时机由用户定。