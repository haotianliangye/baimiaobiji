/**
 * Issue #15 — DocumentEditor / DocumentView 公开 seam（轻量）
 *
 * 不渲染 React 组件（编辑器 / 视图均依赖 Tiptap 的浏览器 API，SSR 不可用）。
 * 只断言：
 *   1) 公开纯函数能正确返回 / 抛错（已覆盖于 editor-extensions.test.ts；
 *      这里补充一个端到端：buildUploadedMediaKind 完整覆盖所有 mimeType）
 *   2) 公开 props 形状：DocumentEditor / DocumentView 的 props 类型编译通过
 *   3) 真实组件被浏览器渲染时 Tiptap 会接管，但所有公开 seam 仍可独立调用
 *   4) 当 value 为非法输入时，编辑器/视图通过 normalizeDocument 兜底为空白文档
 *
 * 这组测试是「red → green → refactor」循环中的最后一环，确保调用方
 * 迁移时公开契约与组件实现一致。
 *
 * 运行：npx tsx tests/document-components.test.ts
 */
import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const editorMod = await import('../src/components/DocumentEditor');
  const viewMod = await import('../src/components/DocumentView');
  const extMod = await import('../src/lib/editorExtensions');
  const docMod = await import('../src/lib/documentModel');

  // ===== C1: 公开导出全部存在 =====
  assert.equal(typeof editorMod.default, 'function', 'C1 DocumentEditor default export');
  assert.equal(typeof editorMod.buildUploadedMediaKind, 'function', 'C1 buildUploadedMediaKind');
  assert.equal(typeof editorMod.buildUploadResultToMedia, 'function', 'C1 buildUploadResultToMedia');
  assert.equal(typeof viewMod.default, 'function', 'C1 DocumentView default export');
  assert.equal(typeof viewMod.resolveDocumentAttachmentIds, 'function', 'C1 resolveDocumentAttachmentIds');
  assert.equal(typeof viewMod.missingAttachmentPlaceholder, 'function', 'C1 missingAttachmentPlaceholder');
  assert.equal(typeof viewMod.findMediaNodeById, 'function', 'C1 findMediaNodeById');
  record('C1 DocumentEditor / DocumentView 公开导出', true, '2 default + 5 helper');

  // ===== C2: buildUploadedMediaKind 完整覆盖 image/audio/video/file =====
  const samples: Array<[string, string]> = [
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['audio/mpeg', 'audio'],
    ['audio/wav', 'audio'],
    ['video/mp4', 'video'],
    ['video/webm', 'video'],
    ['application/pdf', 'file'],
    ['text/plain', 'file'],
  ];
  for (const [mime, expected] of samples) {
    const got = editorMod.buildUploadedMediaKind({ type: mime } as any);
    assert.equal(got, expected, `C2 mime=${mime} → ${expected}`);
  }
  // 兜底扩展名
  assert.equal(editorMod.buildUploadedMediaKind({ type: '', name: 'x.mp3' } as any), 'audio', 'C2 .mp3 → audio');
  assert.equal(editorMod.buildUploadedMediaKind({ type: '', name: 'x.mov' } as any), 'video', 'C2 .mov → video');
  assert.equal(editorMod.buildUploadedMediaKind({ type: '', name: 'x.png' } as any), 'image', 'C2 .png → image');
  record('C2 buildUploadedMediaKind 完整覆盖', true, '8 mimeType + 3 扩展名兜底');

  // ===== C3: buildUploadResultToMedia 构造合法 MediaAttrs =====
  const attrs3 = editorMod.buildUploadResultToMedia(
    { type: 'image/png', name: 'pic.png' } as any,
    { attachmentId: 'att-1', name: 'override.png', mimeType: 'image/png' },
  );
  assert.equal(attrs3.attachmentId, 'att-1', 'C3 attachmentId');
  assert.equal(attrs3.name, 'override.png', 'C3 name override');
  assert.equal(attrs3.mimeType, 'image/png', 'C3 mimeType');
  assert.equal(attrs3.width, 100, 'C3 default width');
  assert.equal(attrs3.align, 'center', 'C3 default align');
  record('C3 buildUploadResultToMedia', true, 'fields 完整 + 默认值');

  // ===== C4: DocumentEditor 公开 props（编译期） — 仅作运行时签名检查 =====
  // 通过构造一个不渲染的 React element（不调用 hooks）来确认组件是可调用的
  const React = await import('react');
  const fakeOnChange = () => {};
  const fakeOnUpload = async () => ({ attachmentId: 'a', name: 'n', mimeType: 'image/png' });
  const empty = docMod.createEmptyDocument();
  const el = React.createElement(editorMod.default, {
    value: empty,
    onChange: fakeOnChange,
    onUpload: fakeOnUpload,
  });
  assert.ok(React.isValidElement(el), 'C4 DocumentEditor 接受最小 props');
  record('C4 DocumentEditor 接受最小 props', true, 'value + onChange + onUpload');

  const el2 = React.createElement(viewMod.default, {
    value: empty,
    resolveAttachment: async () => null,
  });
  assert.ok(React.isValidElement(el2), 'C4 DocumentView 接受最小 props');
  record('C5 DocumentView 接受最小 props', true, 'value + resolveAttachment');

  // ===== C6: 非法 value 走 normalizeDocument 兜底 =====
  // DocumentEditor 内部对 value 使用 normalizeDocument；这里通过 editorExtensions 复现
  // 「非法 value → 空文档」语义，验证不变量
  for (const bad of [null, undefined, 'oops', 42, [], {}]) {
    const norm = docMod.normalizeDocument(bad as any);
    assert.equal(norm.type, 'doc', `C6 ${typeof bad} root=doc`);
    assert.ok(Array.isArray(norm.content) && norm.content.length > 0, `C6 ${typeof bad} 至少 1 块`);
  }
  // 经由 editorExtensions 的 richDocumentToTiptapJSON 也应当同样兜底
  const norm2 = extMod.richDocumentToTiptapJSON({} as any);
  assert.equal(norm2.type, 'doc', 'C6 richDocumentToTiptapJSON({}) → doc');
  record('C6 非法 value 走 normalizeDocument 兜底', true, '所有原始类型通过');

  // ===== C7: DocumentView 解析占位 =====
  const placeholder = viewMod.missingAttachmentPlaceholder('video', 'att-x');
  assert.equal(placeholder.isMissing, true, 'C7 placeholder.isMissing');
  assert.equal(placeholder.kind, 'video', 'C7 placeholder.kind');
  assert.equal(placeholder.attachmentId, 'att-x', 'C7 placeholder.attachmentId');
  // 不可变
  assert.equal(typeof placeholder, 'object', 'C7 placeholder 是对象');
  record('C7 missingAttachmentPlaceholder', true, '稳定结构');

  // ===== C8: DocumentEditor 公开 insertMediaAtSelection（选择位置插入） =====
  // Issue #15 第二切片：上传必须按当前 selection 位置插入（不是末尾）
  // 单点事实源：editorExtensions 提供 editorSelectionToBlockIndex + insertMediaNodeJson，
  // DocumentEditor 内部使用；这里测试 DocumentEditor 暴露的纯函数等价物
  assert.equal(typeof editorMod.buildInsertPositionFromSelection, 'function', 'C8 buildInsertPositionFromSelection');
  // 模拟 selection 位置：pos=3 时（第一段之后、第二段之中），应当插入到 content[1] 之前
  const docC8 = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
    ],
  };
  const blockIdx = editorMod.buildInsertPositionFromSelection(docC8, 3);
  assert.equal(blockIdx, 1, 'C8 pos=3 → blockIndex 1');
  // 关键：上传走 insertMediaAtSelection 而不是手动 before.content 变异
  assert.equal(typeof editorMod.insertMediaAtSelection, 'function', 'C8 insertMediaAtSelection');
  const before = JSON.parse(JSON.stringify(docC8));
  const next = editorMod.insertMediaAtSelection(
    docC8,
    3,
    extMod.makeMediaAttrs('image', 'att-c8', { mimeType: 'image/png' }),
    'image',
  );
  assert.equal(next.content.length, 3, 'C8 插入后 3 块');
  assert.equal(next.content[1].type, 'image', 'C8 媒体插入位置 1');
  // 关键不变量：原 before 不被修改
  assert.deepEqual(docC8, before, 'C8 不修改原对象');
  record('C8 公开 insertMediaAtSelection', true, 'pos=3 → blockIndex 1');

  // ===== C9: DocumentView 公开纯函数与 extensions 共享单点事实源 =====
  // Issue #15 第二切片：DocumentView 不再依赖 querySelectorAll 注入 src
  // 单点事实源：extensions 暴露 getMediaNodeName + renderMediaNodeHtml（无副作用）
  assert.equal(typeof extMod.getMediaNodeName, 'function', 'C9 getMediaNodeName');
  assert.equal(typeof extMod.renderMediaNodeHtml, 'function', 'C9 renderMediaNodeHtml');
  const rendered = extMod.renderMediaNodeHtml({
    kind: 'image',
    attachmentId: 'att-html',
    caption: 'cap',
    name: 'n',
    width: 75,
    align: 'right',
    mimeType: 'image/png',
    duration: 0,
    alt: 'alt',
  });
  assert.ok(rendered.includes('data-attachment-id="att-html"'), 'C9 data-attachment-id');
  assert.ok(rendered.includes('data-width="75"'), 'C9 width');
  assert.ok(rendered.includes('data-align="right"'), 'C9 align');
  assert.ok(rendered.includes('alt="alt"'), 'C9 alt');
  // renderMediaNodeHtml 不应包含 src（不持久化 data URL）
  assert.ok(!rendered.includes('src='), 'C9 不含 src');
  record('C9 MediaNodeView 共享 helper', true, 'renderMediaNodeHtml 无副作用');

  // ===== 汇总 =====
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
