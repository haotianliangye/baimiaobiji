# Issue P1-003 (ADR-0003): API Key 真隔离

**优先级**：P1
**分支**：`feat/p1-003-api-key-isolation`
**版本号**：0.3.0 → 0.3.0（无产品功能变更）
**预计工作量**：半天-1 天
**schema 变更**：无（复用 #004 沉淀的 `settings_kv` 表）
**新依赖**：0

## 目标

把 3 组 API Key（LLM / embedding / TTS）从 localStorage 迁移到 IndexedDB。
**不引 Web Crypto 加密**——只是把"明文散在 localStorage"换成"明文散在 IndexedDB"，
收益有限但风险也低，作为路径 B（Web Crypto 加密）的预演。

详见 `docs/adr/0003-api-key-isolation.md`

## 当前问题

- `src/store/settings.store.ts` 把 3 组 apiKey 字段都通过 zustand persist 写到 localStorage
- localStorage 会被浏览器同步（Chrome Sync）、DevTools 看见、第三方 JS 可读
- 已用 base64 编码 syncPassword（防"casual eyeballing"），但 apiKey **没**做

## 决策摘要（ADR-0003 路径 A）

- 抽离 3 组 apiKey 到新模块 `src/lib/apiKeyStore.ts`
- 存到 `db.settings_kv`（P0 #004 沉淀）
- zustand state 里这 3 个字段改为 `null` 初始 + **不写 partialize**
- 加 1 次性迁移：旧 localStorage 的 key 字段 → IndexedDB
- Settings UI 通过 `await setApiKey('llm', value)` 写
- 调用方通过 `await loadApiKey('llm')` 读

## 实施步骤

### Step 1: 新增 apiKeyStore.ts

```ts
// src/lib/apiKeyStore.ts
type ApiKeyType = 'llm' | 'embed' | 'tts';
const KEY_PREFIX = 'api_key.';

export async function loadApiKey(type: ApiKeyType): Promise<string> {
  const row = await db.settings_kv.get(KEY_PREFIX + type);
  return (row?.value as { key?: string } | undefined)?.key ?? '';
}

export async function setApiKey(type: ApiKeyType, value: string): Promise<void> {
  await db.settings_kv.put({ key: KEY_PREFIX + type, value: { key: value }, updated_at: Date.now() });
}

export async function deleteApiKey(type: ApiKeyType): Promise<void> {
  await db.settings_kv.delete(KEY_PREFIX + type);
}
```

### Step 2: zustand store 改动（settings.store.ts）

- `apiKey` / `embedApiKey` / `ttsApiKey` 字段**保留**（兼容性）
- 初始值改为 `''`
- **不进 partialize**（不在 zustand persist）
- 加方法 `setApiKeyField(type, value)`：写 IndexedDB + 不动 state（state 仅作 UI 镜像）
- merge 函数（v13 migration）：读旧 localStorage 的 apiKey → 写到 IndexedDB → 从 state 删掉

### Step 3: 调用点改造

| 文件 | 改动 |
|------|------|
| `src/pages/Settings.tsx` (3 处) | input 改 onChange 调 `setApiKeyField('llm', v)` |
| `src/lib/multimedia.ts:35` | `settings.apiKey` 改成 `await loadApiKey('llm')`（call site 加 await）|
| `src/lib/tts.ts` / `ttsStream.ts` | `settings.ttsApiKey` → `await loadApiKey('tts')` |
| `src/lib/embedding.ts` | `settings.embedApiKey` → `await loadApiKey('embed')` |
| `src/store/app.store.ts:1047` | 计算逻辑改用 store 镜像（不 await，store 字段保留 `''` 初始）|
| `src/pages/Copilot.tsx:38/91` | 同上，用 store 镜像 |

**关键不变量**：
- Settings UI 显示仍然用 zustand state（同步，不抖）
- 写操作双写：state + IndexedDB
- 读操作：UI 用 state（同步），外部 LLM 调用用 `loadApiKey`（async）

### Step 4: 单测

- `tests/apiKeyStore.test.ts`：get/set/delete 循环 + 验证不写 localStorage
- `tests/apiKeyStore.migration.test.ts`：模拟 v12 旧 state，验证迁移到 IndexedDB + localStorage 不再含

## 设计取舍

| 决策 | 理由 |
|------|------|
| **抽到 IndexedDB，不 Web Crypto 加密** | 80% 收益 / 20% 工作量；留路径 B 给 P2 |
| **保留 zustand state 字段**（空字符串）| UI 显示不需要 await，不抖 |
| **写操作双写**（state + IDB）| 减少重渲染，保持 UI 同步 |
| **不主动清 localStorage** | 万一迁移失败，残留也读不到（partialize 不写）|
| **加 v13 migration** | 旧用户首次启动自动迁移；不弹窗 |

## 验收

- [ ] `npx tsc --noEmit` 0 error
- [ ] `npm run build` 通过
- [ ] `npx tsx tests/apiKeyStore.test.ts` 全过
- [ ] `npx tsx tests/apiKeyStore.migration.test.ts` 全过
- [ ] 所有 16 个单测仍全过（API key 改动不能影响其他测试）
- [ ] devtools 验证：localStorage 不含明文 apiKey

## 风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| 改 partialize 漏字段 | **中** | 完整 diff 审查 + 16 个测试全过 |
| async load 慢 | 低 | state 字段保留 → UI 不抖；只 call site async |
| 旧 key 迁移失败 | 低 | merge 仍写 state（兼容）；不弹窗 |
| 调用方漏改 | 中 | 跑现有 16 测试 + 新增 IDB 测试 |

## commit 后

1. 合并到 `refactor/mingwu-to-insight`（**本地合并，不 push**）
2. **不打 tag**（无版本变更）
3. **不 push** —— 等用户决定

## 后续

- P1-004 (ADR-0004) 长期记忆 facts 表
- P2 候选：API Key Web Crypto 加密（路径 B，需要用户口令 UX）