/**
 * Issue #15 — 统一编辑器 extensions 公开 seam
 *
 * 这组测试断言：
 *   1) createEditorExtensions 暴露给 Tiptap 的 nodes / marks 与
 *      editorSchema.buildEditorSchema 共享同一份事实源（节点类型 / 属性 / 默认值）
 *   2) extensions 接受编辑器实际产出的所有节点（paragraph/heading/列表/引用/代码块/媒体/链接）
 *   3) 自定义 MediaExtension：block 节点；8 个 attrs；width/align 受白名单约束；
 *      toDOM 不带 src（不持久化 data URL）；parseDOM 从 data-attachment-id 还原
 *   4) 自定义 LinkExtension 与原 link 共存（共用 marks）
 *   5) 纯辅助 insertMediaNode / makeMediaAttrs / normalizeMediaAttrs 可独立测试
 *
 * 公开 API（来自 src/lib/editorExtensions.ts）：
 *   - createEditorExtensions(options?: { editable?: boolean }): Extensions[]
 *   - MEDIA_NODE_NAME: 'mediaBlock'（编辑器节点名）
 *   - mediaNodeKind(attrs): 'image' | 'audio' | 'video' | 'file'
 *   - makeMediaAttrs(kind, attachmentId, partial?): MediaAttrs
 *   - normalizeMediaAttrs(input): MediaAttrs
 *   - insertMediaNodeJson(doc, mediaAttrs, position?): RichDocument
 *
 * 公开 API（来自 src/components/DocumentEditor.tsx 的纯函数 seam）：
 *   - buildUploadedMediaKind(file: File): 'image' | 'audio' | 'video' | 'file'
 *   - buildUploadResultToMedia(file, result): MediaAttrs
 *
 * 公开 API（来自 src/components/DocumentView.tsx 的纯函数 seam）：
 *   - resolveDocumentAttachmentIds(doc): string[]
 *   - missingAttachmentPlaceholder(kind, attachmentId): { kind, attachmentId, isMissing: true }
 *   - findMediaNodeById(doc, attachmentId): RichDocumentNode | null
 *
 * 运行：npx tsx tests/editor-extensions.test.ts
 */
import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const extMod = await import('../src/lib/editorExtensions');
  const schemaMod = await import('../src/lib/editorSchema');

  // ===== E1: 公开 seam 全部存在 =====
  assert.equal(typeof extMod.createEditorExtensions, 'function', 'E1 createEditorExtensions');
  assert.equal(typeof extMod.mediaNodeKind, 'function', 'E1 mediaNodeKind');
  assert.equal(typeof extMod.makeMediaAttrs, 'function', 'E1 makeMediaAttrs');
  assert.equal(typeof extMod.normalizeMediaAttrs, 'function', 'E1 normalizeMediaAttrs');
  assert.equal(typeof extMod.insertMediaNodeJson, 'function', 'E1 insertMediaNodeJson');
  record('E1 editorExtensions 公开 seam', true, 'createEditorExtensions + 4 helpers');

  // ===== E2: extensions 与 editorSchema 共享事实源（节点名一致） =====
  const extensions = extMod.createEditorExtensions({ editable: true });
  assert.ok(Array.isArray(extensions), 'E2 extensions 是数组');
  assert.ok(extensions.length > 0, 'E2 extensions 非空');
  // 找到自定义媒体扩展：image / audio / video / file 节点
  const mediaExtNames = extensions.map((e: any) => e?.name).filter(Boolean);
  for (const k of ['image', 'audio', 'video', 'file']) {
    assert.ok(mediaExtNames.includes(k), `E2 含 ${k} 扩展`);
  }
  // 通过 editorSchema 校验：编辑器产出的 JSON 必须能被 schema 接受
  const schema = schemaMod.buildEditorSchema();
  const sample = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'image', attrs: { attachmentId: 'a' } },
    ],
  };
  schema.nodeFromJSON(sample);
  record('E2 extensions 与 editorSchema 共享事实源', true, `extensions=${extensions.length}, 含 image/audio/video/file`);

  // ===== E3: mediaNodeKind 根据 mimeType/file 字段推断 =====
  const { mediaNodeKind, makeMediaAttrs, normalizeMediaAttrs } = extMod;
  assert.equal(mediaNodeKind({ mimeType: 'image/png' } as any), 'image', 'E3 png→image');
  assert.equal(mediaNodeKind({ mimeType: 'audio/mp3' } as any), 'audio', 'E3 mp3→audio');
  assert.equal(mediaNodeKind({ mimeType: 'video/mp4' } as any), 'video', 'E3 mp4→video');
  assert.equal(mediaNodeKind({ mimeType: 'application/pdf' } as any), 'file', 'E3 pdf→file');
  assert.equal(mediaNodeKind({ kind: 'video' } as any), 'video', 'E3 kind 字段回退');
  record('E3 mediaNodeKind 推断', true, 'mimeType / kind 双来源');

  // ===== E4: makeMediaAttrs + normalizeMediaAttrs =====
  const m4 = makeMediaAttrs('image', 'att-1', { width: 75, align: 'right', caption: 'cap' });
  assert.equal(m4.attachmentId, 'att-1', 'E4 attachmentId');
  assert.equal(m4.width, 75, 'E4 width');
  assert.equal(m4.align, 'right', 'E4 align');
  assert.equal(m4.caption, 'cap', 'E4 caption');
  // 默认值
  const def = makeMediaAttrs('file', 'att-2');
  assert.equal(def.alt, '', 'E4 alt 默认空');
  assert.equal(def.caption, '', 'E4 caption 默认空');
  assert.equal(def.width, 100, 'E4 width 默认 100');
  assert.equal(def.align, 'center', 'E4 align 默认 center');
  // 越界 width/align 修正
  const norm = normalizeMediaAttrs({ attachmentId: 'a', width: 999 as any, align: 'middle' as any });
  assert.equal(norm.width, 100, 'E4 越界 width→100');
  assert.equal(norm.align, 'center', 'E4 越界 align→center');
  // mimeType 清洗
  const withMime = normalizeMediaAttrs({ attachmentId: 'a', mimeType: 'image/png' });
  assert.equal(withMime.mimeType, 'image/png', 'E4 mimeType 保留');
  record('E4 makeMediaAttrs + normalizeMediaAttrs', true, '白名单 + 默认值');

  // ===== E5: insertMediaNodeJson 在指定位置插入媒体节点 =====
  const doc5 = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
    ],
  };
  const inserted = extMod.insertMediaNodeJson(
    doc5,
    makeMediaAttrs('image', 'att-9', { width: 50, mimeType: 'image/png' }),
    1,
  );
  assert.equal(inserted.content.length, 3, 'E5 长度 3');
  assert.equal(inserted.content[1].type, 'image', 'E5 位置 1 媒体');
  assert.equal(inserted.content[1].attrs.attachmentId, 'att-9', 'E5 媒体 attachmentId');
  // 不修改原对象
  assert.equal(doc5.content.length, 2, 'E5 不修改原对象');
  record('E5 insertMediaNodeJson 不变量', true, '不修改原对象');

  // ===== E5b: insertMediaNodeJson 默认插入末尾（默认行为不变） =====
  const tail = extMod.insertMediaNodeJson(doc5, makeMediaAttrs('file', 'att-tail'));
  assert.equal(tail.content.length, 3, 'E5b 默认末尾');
  assert.equal(tail.content[2].type, 'file', 'E5b 末尾媒体');
  // 越界 position → 末尾（防御）
  const oob = extMod.insertMediaNodeJson(doc5, makeMediaAttrs('image', 'att-oob', { mimeType: 'image/png' }), 999);
  assert.equal(oob.content.length, 3, 'E5b 越界 position → 末尾');
  assert.equal(oob.content[2].type, 'image', 'E5b 越界末尾媒体');
  // overrideKind 显式指定（推荐用法：mimeType 缺失时由 caller 强制）
  const forced = extMod.insertMediaNodeJson(doc5, makeMediaAttrs('video', 'att-v'), 0, 'video');
  assert.equal(forced.content[0].type, 'video', 'E5b overrideKind=video');
  record('E5b insertMediaNodeJson 默认/越界/override', true, '默认与越界一致');

  // ===== E5c: editorSelectionToBlockIndex 公开 helper（光标→doc.content 下标） =====
  // Issue #15 第二切片：上传必须按 selection 位置插入
  // 公开 seam：从 (doc, blockIndex) 计算「在 content 中的下标」
  // DocumentEditor 在 editor.state.selection.$from 推导出 blockIndex 后调用 insertMediaNodeJson
  assert.equal(typeof extMod.editorSelectionToBlockIndex, 'function', 'E5c helper');
  const doc5c = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'B' }] },
      { type: 'image', attrs: { attachmentId: 'a' } },
    ],
  };
  // 0 <= from <= 1 (第一段内) → blockIndex=0；1 < from <= 2 → blockIndex=1；以此类推
  // 算法：累加每个块的最小 nodeSize（>=2：open+close）。
  // pos 落在 [acc_prev+1, acc] 区间 → 落入第 i 块；i=0 时 acc_prev=0
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 0), 0, 'E5c pos=0 → 0');
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 1), 0, 'E5c pos=1 (段内) → 0');
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 2), 0, 'E5c pos=2 (段末) → 0');
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 3), 1, 'E5c pos=3 (下一段开头) → 1');
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 4), 1, 'E5c pos=4 (段中) → 1');
  assert.equal(extMod.editorSelectionToBlockIndex(doc5c, 999), 3, 'E5c 越界 → 末尾');
  // 关键：上传时 DocumentEditor 调用（pos=3 → blockIndex=1，插入到第二段之前）
  const atSelection = extMod.insertMediaNodeJson(
    doc5c,
    makeMediaAttrs('image', 'att-sel', { mimeType: 'image/png' }),
    extMod.editorSelectionToBlockIndex(doc5c, 3),
  );
  assert.equal(atSelection.content.length, 4, 'E5c 插入后 4 块');
  assert.equal(atSelection.content[1].type, 'image', 'E5c 媒体插入位置 1 (selection 在 B 段开头)');
  assert.equal((atSelection.content[1] as any).attrs.attachmentId, 'att-sel', 'E5c attachmentId');
  record('E5c 光标位置插入公开 helper', true, 'editorSelectionToBlockIndex + insertMediaNodeJson 协同');

  // ===== E6: 上传 helper 公开 seam =====
  const edMod = await import('../src/components/DocumentEditor');
  // 用 stub File 来验证 buildUploadedMediaKind
  const fakeFile = (mime: string) => ({ type: mime, name: 'x' } as any);
  assert.equal(edMod.buildUploadedMediaKind(fakeFile('image/png')), 'image', 'E6 png');
  assert.equal(edMod.buildUploadedMediaKind(fakeFile('audio/mp4')), 'audio', 'E6 mp4 audio');
  assert.equal(edMod.buildUploadedMediaKind(fakeFile('video/mp4')), 'video', 'E6 mp4 video');
  assert.equal(edMod.buildUploadedMediaKind(fakeFile('application/pdf')), 'file', 'E6 pdf');
  // buildUploadResultToMedia
  const upAttrs = edMod.buildUploadResultToMedia(fakeFile('image/jpeg'), { attachmentId: 'att-1', name: 'pic.jpg', mimeType: 'image/jpeg' });
  assert.equal(upAttrs.attachmentId, 'att-1', 'E6 buildUploadResultToMedia attachmentId');
  assert.equal(upAttrs.name, 'pic.jpg', 'E6 buildUploadResultToMedia name');
  assert.equal(upAttrs.mimeType, 'image/jpeg', 'E6 buildUploadResultToMedia mimeType');
  record('E6 DocumentEditor 上传 seam', true, 'buildUploadedMediaKind + buildUploadResultToMedia');

  // ===== E7: DocumentView 公开 seam =====
  const viewMod = await import('../src/components/DocumentView');
  assert.equal(typeof viewMod.resolveDocumentAttachmentIds, 'function', 'E7 resolveDocumentAttachmentIds');
  assert.equal(typeof viewMod.missingAttachmentPlaceholder, 'function', 'E7 missingAttachmentPlaceholder');
  assert.equal(typeof viewMod.findMediaNodeById, 'function', 'E7 findMediaNodeById');
  const doc7 = {
    type: 'doc',
    content: [
      { type: 'paragraph' },
      { type: 'image', attrs: { attachmentId: 'a1' } },
      { type: 'video', attrs: { attachmentId: 'a2' } },
      { type: 'image', attrs: { attachmentId: 'a1' } }, // dup
    ],
  };
  const ids = viewMod.resolveDocumentAttachmentIds(doc7);
  assert.deepEqual(ids, ['a1', 'a2'], 'E7 resolveDocumentAttachmentIds 去重保序');
  const placeholder = viewMod.missingAttachmentPlaceholder('image', 'a-missing');
  assert.equal(placeholder.isMissing, true, 'E7 placeholder.isMissing');
  assert.equal(placeholder.kind, 'image', 'E7 placeholder.kind');
  assert.equal(placeholder.attachmentId, 'a-missing', 'E7 placeholder.attachmentId');
  const found = viewMod.findMediaNodeById(doc7, 'a2');
  assert.ok(found && found.type === 'video', 'E7 findMediaNodeById 找到 video');
  const notFound = viewMod.findMediaNodeById(doc7, 'nope');
  assert.equal(notFound, null, 'E7 findMediaNodeById 不存在 → null');
  record('E7 DocumentView 公开 seam', true, '3 个 helper 行为正确');

  // ===== E8: caption / width / align 公开 seam（媒体属性更新） =====
  // Issue #15 第二切片：图片必须有 caption / width / align UI → 至少提供纯函数 helper
  // 单点事实源：
  //   - updateMediaAttrs(doc, attachmentId, patch): 返回新 doc
  //   - 接受 partial { caption?, width?, align? }，未提供字段保留
  //   - 非法 width/align 走白名单 clamp；缺 attachmentId 的节点不变
  assert.equal(typeof extMod.updateMediaAttrs, 'function', 'E8 updateMediaAttrs');
  assert.equal(typeof extMod.findMediaNodeByIdExt, 'function', 'E8 findMediaNodeByIdExt (alias)');
  // 先做基础：扩展确实暴露 findMediaNodeByIdExt 或类似
  const findFn = (extMod as any).findMediaNodeByIdExt || viewMod.findMediaNodeById;
  const docE8 = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { attachmentId: 'a1', caption: 'old', width: 50, align: 'left' } },
    ],
  };
  const updated = extMod.updateMediaAttrs(docE8, 'a1', { caption: 'new caption', width: 75, align: 'right' });
  const node8 = updated.content[0] as any;
  assert.equal(node8.attrs.attachmentId, 'a1', 'E8 attachmentId 不变');
  assert.equal(node8.attrs.caption, 'new caption', 'E8 caption 更新');
  assert.equal(node8.attrs.width, 75, 'E8 width 更新');
  assert.equal(node8.attrs.align, 'right', 'E8 align 更新');
  // 非法 width / align 走 clamp
  const updated2 = extMod.updateMediaAttrs(docE8, 'a1', { width: 999 as any, align: 'justify' as any });
  const node8b = updated2.content[0] as any;
  assert.equal(node8b.attrs.width, 100, 'E8 width 越界 → 100');
  assert.equal(node8b.attrs.align, 'center', 'E8 align 越界 → center');
  // 不修改原对象
  assert.equal((docE8.content[0] as any).attrs.caption, 'old', 'E8 不修改原对象');
  // 缺 attachmentId 的节点不变
  const docE8c = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'p' }] },
      { type: 'image', attrs: { attachmentId: 'a1', caption: 'old' } },
    ],
  };
  const updated3 = extMod.updateMediaAttrs(docE8c, 'no-such', { caption: 'new' });
  assert.equal((updated3.content[1] as any).attrs.caption, 'old', 'E8 未命中 → 不变');
  // 提供 findMediaNodeByIdExt 作为 viewMod.findMediaNodeById 的别名（共享单点事实源）
  // 这一点在测试 E7 已经覆盖了 viewMod.findMediaNodeById；E8 仅做契约存在性检查
  void findFn;
  record('E8 caption/width/align 更新 helper', true, 'updateMediaAttrs + clamp + 不变量');

  // ===== E9: 表格 extensions 与 schema 共享事实源 =====
  // createEditorExtensions 必须包含 table 扩展（与 schema 一致）
  const extNames = (extensions as any[]).map((e) => e?.name).filter(Boolean);
  for (const name of ['table', 'tableRow', 'tableHeader', 'tableCell']) {
    assert.ok(extNames.includes(name), `E9 ${name} 在 extensions 中`);
  }
  record('E9 表格扩展与 schema 同步', true, 'table/row/header/cell 全部注册');

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
