# Issue P1-004 (ADR-0004): 长期记忆 facts 表

**优先级**：P1
**分支**：`feat/p1-004-facts-table`
**版本号**：0.3.0 → 0.3.0（无产品功能变更）
**预计工作量**：半天
**schema 变更**：v16 → v17（新增 facts 表）
**新依赖**：0

## 目标

加 `facts` 表 + CRUD 函数，作为"长期记忆"层的基础设施。
**0 新产品功能**——UI 留 P1-004 follow-up。

详见 `docs/adr/0004-facts-table.md`

## 当前问题

- 白描笔记是"无长期记忆"产品——AI 每次从零推断用户
- `db.ts` 16 个表，0 个是"事实"
- 没有"用户生日 / 偏好 / 习惯"的结构化记录

## 设计摘要

```ts
interface Fact {
  id: string;
  key: string;           // 'user.birthday', 'preference.theme'
  value: string;
  category: string;      // 'user' | 'preference' | 'event' | 'context'
  confidence: number;    // 0-1, P0 都 1.0
  source: 'manual' | 'extracted';
  created_at: number;
  updated_at: number;
}
```

索引：id / key / category / created_at

## 实施步骤

### Step 1: db.ts v17 schema 迁移
- 加 `interface Fact`
- `class BaimiaoDB` 加 `facts!: Table<Fact>;`
- `this.version(17).stores({ facts: 'id, key, category, created_at' })`
- 不动 v16 及之前

### Step 2: factsStore.ts CRUD
- `addFact(input)` → upsert by key
- `getFact(id)` / `getFactByKey(key)`
- `listFacts({ category?, limit?, offset? })`
- `searchFacts(query)` — key/value LIKE
- `updateFact(id, patch)`
- `deleteFact(id)`
- `countFacts()`

### Step 3: autoBackup 排除 facts
- `src/lib/autoBackup.ts` 显式加 `facts` 到 `EXCLUDED_TABLES` 数组
- 与 attachments / chunks / settings_kv / copilot_conversations 一起不备份

### Step 4: 单测
- `tests/factsStore.test.ts`：
  - F1: addFact → getFactByKey 拿到
  - F2: 同样 key 二次 add → 覆盖（不是新建）
  - F3: listFacts 按 category 过滤
  - F4: searchFacts 模糊匹配
  - F5: updateFact 改 value
  - F6: deleteFact 后 get 返回 null
  - F7: countFacts 准确
  - F8: factsStore.ts 不引用 localStorage（保持后端 + 离线性质）

## 设计取舍

| 决策 | 理由 |
|------|------|
| **加 `confidence` 字段**（0-1）| 未来 AI 抽取时区分"用户填的" vs "AI 猜的" |
| **`source: 'manual' \| 'extracted'`** | 现在只 manual，P2 升级时不破坏 schema |
| **UPSERT by key** | 用户改生日时，key 一致就覆盖 value，不是新建第二条 |
| **不加 UI** | P1 主打 infra；UI 是 P1-004 follow-up |
| **不加自动备份** | facts 默认排除（KB 占用 + 重提） |
| **不接 Copilot prompt** | P2 候选，需要 prompt 模板设计 |

## 验收

- [ ] `npx tsc --noEmit` 0 error
- [ ] `npm run build` 通过
- [ ] `npx tsx tests/factsStore.test.ts` 全过
- [ ] 现有 16 个单测仍全过
- [ ] `src/lib/autoBackup.ts` 显式排除 facts

## 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| v17 schema 漏字段 | 低 | 完整 unit test |
| factsStore 异步 + 调用方忘 await | 中 | P1 不被现有代码调用（0 调用方）—— 风险被推迟到 P1-004 follow-up |
| 旧用户升级失败 | 低 | 纯新增表，dexie 自动迁移 |

## commit 后

1. 合并到 `refactor/mingwu-to-insight`（**本地合并，不 push**）
2. **不打 tag**（无版本变更）
3. **不 push** —— 等用户决定

## 后续

P1-004 follow-up（如果做）：
- 加 UI：Settings → Facts tab（增删改查）
- 集成到 Copilot prompt：把 facts 当 system context
- 集成到检索：搜索时 recall facts

P2 候选：
- AI 自动抽取 facts（基于 daily_reviews / insights 引用回溯 #005 沉淀）
- 跨设备同步（云同步时如何处理 facts）