# Issue #005: 引用回溯验证

**优先级**：P0
**分支**：`feat/issue-005-citation-verify`
**版本号**：0.2.0 → 0.2.1（patch）
**预计工作量**：半天
**schema 变更**：无

## 目标

LLM 编造的 `#log_id_UUID` 引用在 UI 上可见。这是 Karpathy 视角评估中**杠杆最大的单点**。

## 当前问题

[src/lib/citationWash.ts](file:///d:/baimiaobiji/src/lib/citationWash.ts) 只洗格式（把 `[UUID]` 变成 `[引用](#log_id_UUID)`），**不验证 UUID 是否真存在于 raw_logs**。

LLM 可以编一个看起来像 UUID 的字符串，引用洗完之后 UI 渲染的就是一个无法跳转的死链。

## 文件改动

### 新建 [src/lib/citationVerify.ts](file:///d:/baimiaobiji/src/lib/citationVerify.ts)

```typescript
import { db } from '../db/db';

export interface CitationVerifyResult {
  cleaned: string;
  broken: Array<{ uuid: string; context: string }>;
  total: number;
}

const UUID_RE = /#log_id_([0-9a-fA-F-]{36})/g;

export async function verifyCitations(markdown: string): Promise<CitationVerifyResult> {
  if (!markdown) return { cleaned: markdown, broken: [], total: 0 };

  const matches = [...markdown.matchAll(UUID_RE)];
  if (matches.length === 0) {
    return { cleaned: markdown, broken: [], total: 0 };
  }

  // 收集所有 UUID
  const uuids = new Set(matches.map(m => m[1]));

  // 批量查 IndexedDB
  const existingIds = new Set<string>();
  await db.transaction('r', db.raw_logs, async () => {
    for (const id of uuids) {
      const log = await db.raw_logs.get(id);
      if (log) existingIds.add(id);
    }
  });

  // 标记 broken
  const broken: Array<{ uuid: string; context: string }> = [];
  const cleaned = markdown.replace(UUID_RE, (full, uuid) => {
    if (!existingIds.has(uuid)) {
      // 取引用上下文（前 20 字 + 后 20 字）
      const idx = full.indexOf(uuid);
      const start = Math.max(0, idx - 20);
      const end = Math.min(markdown.length, idx + uuid.length + 20);
      broken.push({ uuid, context: markdown.slice(start, end) });
      return `${full}<!--broken-citation-->`;
    }
    return full;
  });

  return { cleaned, broken, total: matches.length };
}
```

### 新建 [src/components/VerifiedMarkdown.tsx](file:///d:/baimiaobiji/src/components/VerifiedMarkdown.tsx)

```typescript
import { verifyCitations } from '../lib/citationVerify';
import { useEffect, useState } from 'react';

interface Props {
  markdown: string;
  className?: string;
}

export function VerifiedMarkdown({ markdown, className }: Props) {
  const [cleaned, setCleaned] = useState(markdown);
  const [brokenCount, setBrokenCount] = useState(0);

  useEffect(() => {
    verifyCitations(markdown).then(r => {
      setCleaned(r.cleaned);
      setBrokenCount(r.broken.length);
    });
  }, [markdown]);

  return (
    <>
      {brokenCount > 0 && (
        <div className="broken-citation-badge">⚠️ {brokenCount} 处引用待核实</div>
      )}
      <div
        className={className}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(cleaned) }}
      />
    </>
  );
}
```

### [src/index.css](file:///d:/baimiaobiji/src/index.css) 新增样式

```css
.citation-broken {
  border-bottom: 2px dashed orange;
  cursor: help;
  position: relative;
}
.citation-broken:hover::after {
  content: '此引用无法溯源，可能为 AI 编造';
  position: absolute;
  bottom: 100%;
  left: 50%;
  transform: translateX(-50%);
  background: #333;
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  white-space: nowrap;
  font-size: 12px;
}
.broken-citation-badge {
  display: inline-block;
  background: orange;
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 12px;
  margin-bottom: 8px;
}
```

### 替换现有 Markdown 渲染

| 文件 | 替换 |
|------|------|
| [src/pages/Review.tsx](file:///d:/baimiaobiji/src/pages/Review.tsx) | 现有 Markdown 渲染 → `<VerifiedMarkdown>` |
| [src/pages/Insights.tsx](file:///d:/baimiaobiji/src/pages/Insights.tsx) | 同上 |
| [src/components/ContextChat.tsx](file:///d:/baimiaobiji/src/components/ContextChat.tsx) | 同上 |

**注意**：`raw_logs` 之外的内容（diary / review / insight）也可能在 LLM 输出中引用 log_id，但 UUID 验证只查 `raw_logs` 表即可——因为所有引用最终指向的都是原始日志。

## TDD checklist

- [ ] 单元测试 `verifyCitations`：mock IndexedDB，确认 broken 标记正确插入
- [ ] 单元测试：UUID 存在时不被标记
- [ ] 单元测试：性能测试 —— 一篇 100KB 日记，verify 时间 < 50ms
- [ ] 单元测试：空 markdown 返回原值
- [ ] 集成测试：UI 高亮正确显示

## 验收标准

- [ ] `npm run lint && npm test && npm run build` 通过
- [ ] 故意让 LLM 生成含假 UUID 的输出，UI 能高亮
- [ ] 正常引用不受影响
- [ ] 100KB 长文 verify 时间 < 100ms
- [ ] broken 数量 > 0 时显示徽章

## commit 后

1. 合并 main
2. `git tag v0.2.1 && git push origin v0.2.1`
3. 更新 `docs/handoff/CURRENT_STATE.md` 进度表 #005 行：⏳ → ✅
4. **重要**：更新 `CONTEXT.md`「已建立的约定」section，加上「所有 Markdown 渲染前必经 verifyCitations」

## 风险

**中**。性能是大头（长日记几千引用）。缓解：
- 批量查询（已实现）
- 大文本跳过（>100KB 跳过 verify，加 TODO 后续优化）
- 加性能测试到 CI