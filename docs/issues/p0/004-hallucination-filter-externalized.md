# Issue #004: 转写幻觉检测升级

**优先级**：P0
**分支**：`feat/issue-004-hallucination-filters`
**版本号**：0.1.2 → 0.2.0（**minor**，schema 变更）
**预计工作量**：半天
**schema 变更**：v13 → v14（新增 `settings_kv` 表）

## 目标

把转写黑名单从硬编码外置到 IndexedDB，用户可编辑。

## 当前问题

[server.ts:743](file:///d:/baimiaobiji/server.ts#L743) 是硬编码字符串数组。新出现的幻觉模式要改代码 + 重新部署。

## 文件改动

### [src/db/db.ts](file:///d:/baimiaobiji/src/db/db.ts) v14

```typescript
this.version(14).stores({
  // 保留 v13 所有表
  settings_kv: 'key',
});
```

新增 `SettingsKVRecord` 接口：
```typescript
interface SettingsKVRecord {
  key: string;
  value: any;
  updated_at: number;
}
```

### 新建 [src/lib/hallucinationFilter.ts](file:///d:/baimiaobiji/src/lib/hallucinationFilter.ts)

```typescript
export interface HallucinationPattern {
  key: string;          // 唯一标识
  type: 'exact' | 'regex';
  value: string;
  description?: string; // 用户备注
  created_at: number;
}

const DEFAULT_PATTERNS: Omit<HallucinationPattern, 'created_at'>[] = [
  { key: 'default-empty-audio', type: 'exact', value: '[EMPTY_AUDIO]' },
  { key: 'default-thanks-watching', type: 'exact', value: '谢谢观看' },
  { key: 'default-subtitle', type: 'exact', value: '字幕提供' },
  { key: 'default-subscribe', type: 'regex', value: '关注.*订阅' },
  // ... 从 server.ts:743 搬过来
];

export async function getPatterns(): Promise<HallucinationPattern[]> {
  // 从 IndexedDB 读，没有则写入默认
}

export async function addPattern(p: Omit<HallucinationPattern, 'created_at'>): Promise<void>;

export async function removePattern(key: string): Promise<void>;

export function matchPattern(text: string, patterns: HallucinationPattern[]): {
  matched: HallucinationPattern | null;
  confidence: 'high' | 'medium' | 'low';
};

export function shouldDropTranscript(
  transcript: string,
  matched: HallucinationPattern | null,
  confidence: 'high' | 'medium' | 'low'
): { drop: boolean; reason?: string };
```

**confidence 评分规则**：
- `transcript.length < 5` + 命中 pattern → high（直接丢弃）
- `transcript.length > 50` + 命中 pattern → low（保留但标记）
- 其他 → medium（保留但标记）

### [server.ts](file:///d:/baimiaobiji/server.ts) 接收 patterns

`/api/transcribe` 请求体加 `patterns: HallucinationPattern[]`，由前端从 IndexedDB 读后传入。

[server.ts:743](file:///d:/baimiaobiji/server.ts#L743) 硬编码逻辑改为：使用请求体传入的 patterns 进行匹配，**没有 patterns 时回退到硬编码列表**（向后兼容）。

### [src/pages/Settings.tsx](file:///d:/baimiaobiji/src/pages/Settings.tsx) 新增「转写幻觉过滤」面板

- 列出所有 pattern
- 「添加 pattern」按钮（type 选择 + value 输入 + description 可选）
- 「删除」按钮
- 「恢复默认」按钮

### [src/pages/Record.tsx](file:///d:/baimiaobiji/src/pages/Record.tsx) 转写调用

转写请求前从 IndexedDB 读 patterns，传给后端。confidence = low 时，UI 显示「⚠️ 转写可信度较低」提示。

## TDD checklist

- [ ] 单元测试 pattern 匹配：exact、regex、混合
- [ ] 单元测试 confidence 评分：边界值（4字/5字、49字/51字）
- [ ] 单元测试：patterns 为空时回退到硬编码
- [ ] 集成测试：转写请求体能正确传递 patterns
- [ ] 回归测试：现有所有转写功能没坏

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] db migration v13 → v14 平滑（老数据不丢）
- [ ] 用户能在 Settings 添加 pattern 后立即生效
- [ ] confidence = low 时 UI 有可见提示
- [ ] patterns 为空时行为与改造前完全一致

## commit 后

1. 合并 main
2. `git tag v0.2.0 && git push origin v0.2.0`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #004 行：⏳ → ✅

## 风险

**中**。涉及：
- schema 迁移（虽然只新增表，但要让老用户平滑升级）
- 转写是核心功能，必须充分回归

缓解：
- 保留旧硬编码逻辑作 fallback（patterns 为空时回退）
- 自动化测试覆盖所有边界值