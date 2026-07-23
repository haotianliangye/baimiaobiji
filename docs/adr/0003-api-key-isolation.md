# ADR-0003: API Key 存储隔离

**状态**：已决策（实施 P1-003 中）
**日期**：2026-07-23
**决策者**：基于 P0 #004（settings_kv 表沉淀）扩展

## 背景

API Key 现状（src/store/settings.store.ts）：
- `apiKey` (LLM provider key) — 明文存 localStorage
- `embedApiKey` (embedding provider key) — 明文存 localStorage
- `ttsApiKey` (TTS provider key) — 明文存 localStorage
- 存储位置：localStorage `whitewash-settings` zustand persist
- 隔离现状：`syncPassword` 用 base64 编码（**仅防"casual eyeballing"**——注释明示）

## 风险

1. **XSS 风险**：localStorage 可被任意 JS 读。如果用户用浏览器扩展 / 注入脚本 / 服务端 log，**明文 key 暴露**
2. **同源 JS 污染**：localStorage 是同源共享，第三方脚本污染则 key 泄漏
3. **调试泄漏**：DevTools / 浏览器同步（Chrome Sync）会复制 localStorage
4. **与服务端互补差**：server 端不持久化 key（让 client 传），但 client 持久化没加密

## 决策：路径 A（IndexedDB 隔离 + 不在 localStorage）

**做法**（与 P0 #004 沉淀的 `settings_kv` 表一致）：
- 3 组 API Key 从 zustand state **抽出来**，**不放 persist**
- 存到 `db.settings_kv`，key 用专用前缀：`api_key.llm` / `api_key.embed` / `api_key.tts`
- zustand state 改为**只读 + setter 时同步 db**
- localStorage 仍存 zustand 其他 state（custom prompts / UI 偏好）——**不动**
- 导出 / 备份时（如 P0 #008）**排除这 3 个 key**（默认不导出敏感）

**为什么 IndexedDB 比 localStorage 安全**：
- ✅ IndexedDB 是同源，但**不参与浏览器 Sync**
- ✅ DevTools 需打开 Application 面板才能查（不会在 Network / Console 出现）
- ✅ 第三方脚本读 IndexedDB **需要同源 JS 上下文**（比 localStorage 不多不少）—— 一样脆弱
- ✅ **未来 P2 可升级到 Web Crypto 加密**（路径 B），已具备基础设施

**为什么不直接 Web Crypto 加密**（路径 B）：
- ❌ P1 范围超控
- ❌ 加密 key 本身存在哪里是经典 chicken-and-egg
- ❌ 浏览器无内置"用户级密钥"API，需要用户口令，UX 复杂
- ✅ 路径 A 是 80% 收益 / 20% 工作量
- ✅ 留路径 B 作 P2 候选

## 实施范围（P1-003）

| 文件 | 改动 |
|------|------|
| `src/store/settings.store.ts` | apiKey/embedApiKey/ttsApiKey 改成 `null` 初始 + 不进 partialize；新增 `loadApiKeys()` + `setApiKey('llm'/'embed'/'tts', value)` 方法 |
| `src/lib/apiKeyStore.ts` (新) | 封装 IndexedDB 读写逻辑：get/set/delete 3 组 key |
| `src/lib/apiKeyStore.test.ts` (新) | 单测：get/set/delete 循环 + 验证不写 localStorage |
| `src/db/db.ts` | **不动**（settings_kv 表已存在，#004 沉淀）|
| `src/components/Settings.tsx` | 改用 store 的 `setApiKey` 方法（不直接 mutate state）|
| `src/lib/multimedia.ts` / `tts.ts` / `embedding.ts` 等调用方 | 改为 await `loadApiKey('llm')`（async）|

## 迁移策略（重要）

**v0.3.0 用户的 3 个 key 已经存在 localStorage**（明文）。两种处理：

1. **首次启动时自动迁移**：`zustand persist merge` 里读到 `apiKey` 字段则：
   - 写到 IndexedDB
   - 从 zustand state 删掉
   - 持久化时 partialize 已经不会写出
2. **不主动清 localStorage**：旧字段残留在 `whitewash-settings` localStorage，但**不再被读**

## 不做（范围控制）

- ❌ 不加 Web Crypto 加密（路径 B，留 P2）
- ❌ 不改 zustand persist 的其他 state
- ❌ 不改 syncPassword（它走 base64 + sessionStorage，另有 P2 候选）
- ❌ 不在 UI 加"已加密" badge（会引起用户误以为绝对安全）
- ❌ 不改 backup 导出（#008）—— 但 P1-004 (ADR-0004) 范围内，备份默认排除 apiKey（待定）

## 验收

- [ ] `npx tsc --noEmit` 0 error
- [ ] `npm run build` 通过
- [ ] `npx tsx tests/apiKeyStore.test.ts` 全过
- [ ] 旧 localStorage `whitewash-settings` 里的 apiKey 字段**首启后被迁移**到 IndexedDB
- [ ] localStorage 不再含明文 apiKey（devtools 验证）
- [ ] 所有 16 个单测 + 新增单测 全过

## 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 改 zustand partialize 漏字段 | 中 | 高（其他字段不持久化）| 完整 diff 审查 |
| IndexedDB 异步 vs zustand 同步签名 | 中 | 中 | 包装 async + 提供初始 null + lazy load |
| 旧用户 key 没迁走 | 低 | 低（key 仍可用）| merge 函数 + 删除 localStorage 旧字段 |
| 导出 backup 包含 key | 中 | 中 | #008 默认不含（已对，#004 沉淀）|

## 不 push — 等用户决定

PR 仍走本地流程。push 时机由用户定。