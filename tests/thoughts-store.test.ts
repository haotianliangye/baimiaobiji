/**
 * Issue #15 第三切片 — Thoughts 沉淀业务接入（纵向切片）
 *
 * 设计：Node 端无 IndexedDB，对 thoughts.store 的可观察行为通过
 * 「公开纯函数 seam + 静态契约」覆盖。
 *
 * 纯函数 seam（从 thoughts.store 暴露，零 IDB 依赖）：
 *   - createThoughtParamsToRow(params, now, parsedTags)  → Thought
 *   - updateThoughtParamsToPatch(existing, params, parsedTags)  → Partial<Thought>
 *   - collectReferencedAttachmentIds(thoughtLike)  → string[]
 *   - filterAttachmentIdsToDelete(referencedIds, candidateIds)  → string[]
 *
 * 静态契约（源码扫描）：
 *   - thoughts.store.ts 调用 db.attachments.delete 删除孤儿 Blob
 *   - thoughts.store.ts 不再用 JSON.stringify(content_doc) → string
 *   - 标签从 content_doc 的 plainText 派生（documentToText）
 *   - 创建/更新优先 content_doc；保留 attachments 兼容旧输入
 *   - DocumentEditor 的 onUpload 走 saveFileAsAttachment，不走 data URL
 *
 * 运行：`npx tsx tests/thoughts-store.test.ts`
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  // ============================================================
  // Section A — 公开纯函数 seam：createThoughtParamsToRow
  // ============================================================
  const mod = await import('../src/store/thoughts.store');
  assert.equal(typeof mod.createThoughtParamsToRow, 'function', 'A0 createThoughtParamsToRow 应是 export 函数');
  assert.equal(typeof mod.updateThoughtParamsToPatch, 'function', 'A0 updateThoughtParamsToPatch 应是 export 函数');
  assert.equal(typeof mod.collectReferencedAttachmentIds, 'function', 'A0 collectReferencedAttachmentIds 应是 export 函数');
  assert.equal(typeof mod.filterAttachmentIdsToDelete, 'function', 'A0 filterAttachmentIdsToDelete 应是 export 函数');
  record('A0 thoughts.store 公开 4 个纯函数 seam', true, 'create/update/collect/filter');

  // A1: content_doc 优先；旧 attachments 兼容保留；标签从 documentToText 派生
  const now = 1730000000000;
  const row = mod.createThoughtParamsToRow(
    {
      content_doc: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: '你好 #生活/灵感' }] },
          { type: 'image', attrs: { attachmentId: 'att-1', alt: '一只猫' } },
        ],
      },
      attachments: [{ kind: 'image', ref: 'att-legacy' }], // 兼容旧输入
    },
    'id-1',
    now,
  );
  assert.equal(row.id, 'id-1', 'A1 id 透传');
  assert.ok(row.content_doc, 'A1 写入 content_doc');
  assert.equal(row.content, '', 'A1 不再以 JSON.stringify(content_doc) 写 content 字符串');
  assert.equal(typeof row.original_created_at, 'number', 'A1 original_created_at');
  assert.equal(row.created_at, now, 'A1 created_at=now');
  assert.ok(Array.isArray(row.tags), 'A1 tags 是数组');
  assert.ok(row.tags.includes('生活/灵感'), 'A1 标签从 documentToText 派生（含 #生活/灵感）');
  // 兼容 attachments：旧 attachments 仍可作为 AttachmentMeta 列表
  assert.ok(Array.isArray(row.attachments), 'A1 兼容 attachments 是数组');
  record('A1 createThoughtParamsToRow 写入 content_doc + 标签从文档派生 + 兼容 attachments', true, JSON.stringify(row.tags));

  // A2: 仅传 content 字符串（兼容）→ 派生为 content_doc
  const row2 = mod.createThoughtParamsToRow(
    { content: '快速想法 #工作' },
    'id-2',
    now,
  );
  assert.ok(row2.content_doc, 'A2 字符串 content 派生为 content_doc');
  assert.equal(row2.content, '', 'A2 字符串 content 不再作为兼容 Markdown 主存（保留字段以兼容旧读路径）');
  assert.ok(row2.tags.includes('工作'), 'A2 标签从字符串派生');
  record('A2 仅传 content 字符串也派生 content_doc', true, JSON.stringify(row2.tags));

  // A3: created_at 用户显式指定 → 透传；original_created_at 仍是 now
  const row3 = mod.createThoughtParamsToRow(
    { content_doc: { type: 'doc', content: [{ type: 'paragraph' }] }, created_at: now - 1000 },
    'id-3',
    now,
  );
  assert.equal(row3.created_at, now - 1000, 'A3 created_at 透传');
  assert.equal(row3.original_created_at, now, 'A3 original_created_at 仍是 now');
  record('A3 created_at 透传 / original_created_at 锁定为 now', true, `${row3.created_at} vs ${row3.original_created_at}`);

  // ============================================================
  // Section B — updateThoughtParamsToPatch：保留 tags/created_at 语义
  // ============================================================
  const existing = {
    id: 'id-1',
    content: '旧',
    content_doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '旧内容 #生活' }] },
        { type: 'image', attrs: { attachmentId: 'att-old' } },
      ],
    },
    tags: ['生活'],
    attachments: [{ kind: 'image', ref: 'att-old' }],
    created_at: 1700000000000,
    original_created_at: 1700000000000,
  };
  const patch = mod.updateThoughtParamsToPatch(existing, {
    content_doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '新内容 #工作' }] },
        { type: 'image', attrs: { attachmentId: 'att-new' } },
      ],
    },
    created_at: 1750000000000,
  });
  assert.ok(patch.content_doc, 'B1 patch.content_doc 存在');
  assert.equal(patch.content, '', 'B1 patch 不再以 JSON.stringify 写 content');
  assert.deepEqual(patch.tags, ['工作'], 'B1 patch.tags 重新派生自新文档');
  assert.equal(patch.created_at, 1750000000000, 'B1 created_at 透传');
  assert.ok(!('original_created_at' in patch), 'B1 不覆盖 original_created_at');
  record('B1 updateThoughtParamsToPatch 替换 content_doc / 重新派生 tags / 不动溯源时间', true, JSON.stringify(patch.tags));

  // B2: 仅传 content 字符串（兼容） → 派生 content_doc
  const patch2 = mod.updateThoughtParamsToPatch(existing, { content: '补充 #随笔' });
  assert.ok(patch2.content_doc, 'B2 字符串 content 派生 content_doc');
  assert.deepEqual(patch2.tags, ['随笔'], 'B2 tags 重新派生');
  // 触发重算路径时 attachments 也会从新 doc 派生（同步兼容旧读路径）
  assert.ok(Array.isArray(patch2.attachments), 'B2 attachments 同步从新 doc 派生');
  record('B2 字符串 content 兼容派生 + attachments 同步', true, JSON.stringify(patch2.tags));

  // B3: 仅传 created_at → 不重算 content_doc / tags
  const patch3 = mod.updateThoughtParamsToPatch(existing, { created_at: 1760000000000 });
  assert.equal(patch3.created_at, 1760000000000, 'B3 created_at 透传');
  assert.ok(!('content_doc' in patch3), 'B3 不重算 content_doc');
  assert.ok(!('tags' in patch3), 'B3 不重算 tags');
  record('B3 仅 created_at 时不动 content/tags', true, 'OK');

  // B4: 仅 attachments 兼容输入（不含 content/content_doc） → 不重算 content_doc
  const patch4 = mod.updateThoughtParamsToPatch(existing, { attachments: [{ kind: 'image', ref: 'att-x' }] });
  assert.ok(!('content_doc' in patch4), 'B4 不重算 content_doc');
  assert.ok(!('tags' in patch4), 'B4 不重算 tags');
  assert.deepEqual(patch4.attachments, [{ kind: 'image', ref: 'att-x' }], 'B4 透传 attachments 兼容');
  record('B4 仅 attachments 兼容时不重算 doc/tags', true, 'OK');

  // ============================================================
  // Section C — collectReferencedAttachmentIds
  // ============================================================
  const thought = {
    content_doc: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'image', attrs: { attachmentId: 'att-A' } },
        { type: 'audio', attrs: { attachmentId: 'att-B' } },
        { type: 'image', attrs: { attachmentId: 'att-A' } }, // 重复
      ],
    },
    attachments: [{ kind: 'image', ref: 'att-legacy' }, { kind: 'file', ref: 'att-B' }], // 兼容旧数组
  };
  const ids = mod.collectReferencedAttachmentIds(thought);
  assert.deepEqual(ids, ['att-A', 'att-B', 'att-legacy'], `C1 去重保序 + content_doc 优先, got=${JSON.stringify(ids)}`);
  record('C1 collectReferencedAttachmentIds 合并 content_doc + 旧 attachments 去重保序', true, JSON.stringify(ids));

  // C2: 空 / 非法 doc → 仅返回 attachments 中的 ref
  const ids2 = mod.collectReferencedAttachmentIds({ attachments: [{ kind: 'image', ref: 'att-X' }] });
  assert.deepEqual(ids2, ['att-X'], 'C2 无 content_doc 时仅取 attachments');
  const ids3 = mod.collectReferencedAttachmentIds({});
  assert.deepEqual(ids3, [], 'C3 空 thought → []');
  record('C2/C3 兼容无 content_doc / 空 thought', true, JSON.stringify(ids3));

  // ============================================================
  // Section D — filterAttachmentIdsToDelete（引用感知）
  // ============================================================
  // 引用 {A, B, legacy}；候选 {A, B, legacy, X, Y} → 删 X, Y（其它 thought 仍引用过的 A/B/legacy 不动）
  const candidates = ['att-A', 'att-B', 'att-legacy', 'att-X', 'att-Y'];
  const toDelete = mod.filterAttachmentIdsToDelete(['att-A', 'att-B', 'att-legacy'], candidates);
  assert.deepEqual(toDelete, ['att-X', 'att-Y'], `D1 引用感知删除, got=${JSON.stringify(toDelete)}`);
  record('D1 filterAttachmentIdsToDelete 仅返回不在引用中的候选', true, JSON.stringify(toDelete));

  // D2: 引用集为空 → 不删任何（保守：不知道还有谁引用，宁可保留）
  const toDelete2 = mod.filterAttachmentIdsToDelete([], ['att-X', 'att-Y']);
  assert.deepEqual(toDelete2, [], 'D2 引用为空时保守不删');
  record('D2 引用为空时保守不删', true, JSON.stringify(toDelete2));

  // D3: 引用集不为空但与候选无交集 → 删全部候选
  const toDelete3 = mod.filterAttachmentIdsToDelete(['att-Z'], ['att-X', 'att-Y']);
  assert.deepEqual(toDelete3, ['att-X', 'att-Y'], 'D3 引用与候选无交集 → 全部候选可删');
  record('D3 引用与候选无交集 → 全部候选可删', true, JSON.stringify(toDelete3));

  // ============================================================
  // Section E — 静态契约（源码扫描）
  // ============================================================
  const storeSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/store/thoughts.store.ts'),
    'utf-8',
  );
  const codeOnly = storeSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  // E1: store 内部用 createThoughtParamsToRow 构造新行（不直接 inline 拼装）
  assert.ok(
    /createThoughtParamsToRow\s*\(/.test(codeOnly),
    'E1 createThought 应使用 createThoughtParamsToRow seam',
  );
  record('E1 store.createThought 调用 createThoughtParamsToRow', true, 'single source of truth');

  // E2: store 内部用 updateThoughtParamsToPatch 构造 patch
  assert.ok(
    /updateThoughtParamsToPatch\s*\(/.test(codeOnly),
    'E2 updateThought 应使用 updateThoughtParamsToPatch seam',
  );
  record('E2 store.updateThought 调用 updateThoughtParamsToPatch', true, 'single source of truth');

  // E3: store 不再用 JSON.stringify(content_doc) 把文档存为字符串
  assert.ok(
    !/JSON\.stringify\s*\(\s*[a-zA-Z_$][\w$]*\.?content_doc\s*\)/.test(codeOnly),
    'E3 store 不应 JSON.stringify(content_doc) 存为字符串',
  );
  assert.ok(
    !/JSON\.stringify\s*\(\s*content_doc\s*\)/.test(codeOnly),
    'E3 store 不应 JSON.stringify(content_doc) 存为字符串（直接）',
  );
  record('E3 store 不再把 content_doc JSON 序列化为字符串', true, 'no JSON.stringify(content_doc)');

  // E4: store.createThought / updateThought 用 documentToText 派生标签
  assert.ok(
    /documentToText\s*\(/.test(codeOnly),
    'E4 store 应调用 documentToText 派生标签',
  );
  record('E4 store 用 documentToText 派生标签', true, 'plain text 单一事实源');

  // E5: deleteThought 调用 collectReferencedAttachmentIds + filterAttachmentIdsToDelete
  assert.ok(
    /collectReferencedAttachmentIds\s*\(/.test(codeOnly),
    'E5 store.deleteThought 应调用 collectReferencedAttachmentIds',
  );
  assert.ok(
    /filterAttachmentIdsToDelete\s*\(/.test(codeOnly),
    'E5 store.deleteThought 应调用 filterAttachmentIdsToDelete',
  );
  record('E5 store.deleteThought 使用引用感知 seam', true, 'collect + filter');

  // E6: store 包含 db.attachments.* 清理逻辑（delete 或 bulkDelete）
  assert.ok(
    /db\.attachments[\s\S]{0,200}?(\.delete|\.bulkDelete)\s*\(/.test(codeOnly),
    'E6 store.deleteThought 应调用 db.attachments.delete/bulkDelete',
  );
  record('E6 store.deleteThought 删除孤儿 Blob', true, 'db.attachments.delete/bulkDelete 存在');

  // E7: src/lib/multimedia.ts 暴露 saveFileAsAttachment
  const multimediaSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/lib/multimedia.ts'),
    'utf-8',
  );
  assert.ok(
    /export\s+async\s+function\s+saveFileAsAttachment/.test(multimediaSrc),
    'E7 multimedia.ts 应 export saveFileAsAttachment(File) → { attachmentId }',
  );
  record('E7 multimedia.saveFileAsAttachment 存在', true, 'export');

  // E8: Thoughts.tsx 不再 import ReactMarkdown / RichEditor / MediaPreview
  const thoughtsSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/pages/Thoughts.tsx'),
    'utf-8',
  );
  assert.ok(
    !/from\s+['"]react-markdown['"]/.test(thoughtsSrc),
    'E8 Thoughts.tsx 不应 import react-markdown',
  );
  assert.ok(
    !/import\s+RichEditor\s+from/.test(thoughtsSrc),
    'E8 Thoughts.tsx 不应 import RichEditor',
  );
  assert.ok(
    !/import\s+MediaPreview\s+from/.test(thoughtsSrc),
    'E8 Thoughts.tsx 不应 import MediaPreview',
  );
  record('E8 Thoughts.tsx 移除 ReactMarkdown / RichEditor / MediaPreview 引用', true, '替换为 DocumentView');

  // E9: Thoughts.tsx 使用 DocumentEditor 创建/编辑
  assert.ok(
    /import\s+DocumentEditor\s+from/.test(thoughtsSrc),
    'E9 Thoughts.tsx 应 import DocumentEditor',
  );
  assert.ok(
    /import\s+DocumentView\s+from/.test(thoughtsSrc),
    'E9 Thoughts.tsx 应 import DocumentView',
  );
  record('E9 Thoughts.tsx 接入 DocumentEditor + DocumentView', true, 'two components');

  // E10: Thoughts.tsx 卡片正文用 documentToText / resolveDocumentContent
  assert.ok(
    /documentToText\s*\(/.test(thoughtsSrc) && /resolveDocumentContent\s*\(/.test(thoughtsSrc),
    'E10 Thoughts.tsx 卡片正文/统计/复制 应基于 documentToText + resolveDocumentContent',
  );
  record('E10 Thoughts.tsx 卡片/统计/复制走 documentToText', true, 'plain text 单点事实源');

  // E11: thoughts store 的 createThoughtParamsToRow 输出附件用兼容 attachments 数组（保留旧 ref）
  const row4 = mod.createThoughtParamsToRow(
    {
      content_doc: {
        type: 'doc',
        content: [
          { type: 'image', attrs: { attachmentId: 'att-A' } },
          { type: 'audio', attrs: { attachmentId: 'att-B' } },
        ],
      },
    },
    'id-4',
    now,
  );
  assert.ok(Array.isArray(row4.attachments), 'E11 兼容 attachments 数组存在');
  // 兼容 attachments 应含两个 media 项（kind 由 type 推断）
  const refSet = new Set((row4.attachments || []).map((a) => a.ref));
  assert.ok(refSet.has('att-A') && refSet.has('att-B'), 'E11 兼容 attachments 含 content_doc 媒体 ID');
  record('E11 createThoughtParamsToRow 同步生成兼容 attachments 数组', true, JSON.stringify(row4.attachments));

  // ============================================================
  // 汇总
  // ============================================================
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== 汇总 ===`);
  console.log(`通过: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('失败:');
    failed.forEach((f) => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('测试运行异常:', err);
  process.exit(1);
});
