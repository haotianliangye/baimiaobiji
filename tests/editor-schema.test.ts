/**
 * Issue #15 — 统一文档编辑器 schema（公开 seam）
 *
 * 这组测试是 issue #15 第二纵向切片的「红绿源头」：
 *   1) 抽出一套共享 schema 作为 documentModel 与编辑器 extensions 的唯一事实源
 *   2) schema 接受编辑器实际产出的全部节点 / marks：
 *        paragraph, heading, bulletList, orderedList, listItem,
 *        blockquote, codeBlock, hardBreak, text,
 *        bold, italic, code, link,
 *        image, audio, video, file
 *   3) 媒体是 block 节点，独占行编排
 *   4) normalizeEditorDocument 接受所有合法节点，丢弃未知节点，缺字段补齐
 *   5) schema 与 documentModel.normalizeDocument 共享；documentModel
 *      暴露的 RichDocument 经过编辑后能被同一个 schema 接受
 *
 * 公开 API（单点事实源）：
 *   - buildEditorSchema()                              → Schema
 *   - MEDIA_KINDS / MEDIA_ATTR_KEYS / MEDIA_WIDTHS / MEDIA_ALIGNS
 *   - normalizeEditorDocument(input)                   → RichDocument
 *   - richDocumentToEditorJson(doc)                    → RichDocument
 *   - editorJsonToRichDocument(json)                   → RichDocument
 *
 * 运行：npx tsx tests/editor-schema.test.ts
 */
import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const mod = await import('../src/lib/editorSchema');
  const {
    buildEditorSchema,
    normalizeEditorDocument,
    richDocumentToEditorJson,
    editorJsonToRichDocument,
    MEDIA_KINDS,
    MEDIA_ATTR_KEYS,
    MEDIA_WIDTHS,
    MEDIA_ALIGNS,
  } = mod;

  // ===== S1: 公开 seam 都存在 =====
  assert.equal(typeof buildEditorSchema, 'function', 'S1 buildEditorSchema');
  assert.equal(typeof normalizeEditorDocument, 'function', 'S1 normalizeEditorDocument');
  assert.equal(typeof richDocumentToEditorJson, 'function', 'S1 richDocumentToEditorJson');
  assert.equal(typeof editorJsonToRichDocument, 'function', 'S1 editorJsonToRichDocument');
  for (const a of [MEDIA_KINDS, MEDIA_ATTR_KEYS, MEDIA_WIDTHS, MEDIA_ALIGNS]) {
    assert.ok(a, `S1 常量存在: ${a && (a as any).constructor?.name}`);
  }
  record('S1 公开 seam 全部存在', true, 'buildEditorSchema / normalizeEditorDocument / 4 个常量');

  // ===== S2: 常量契约 =====
  assert.deepEqual(
    [...MEDIA_KINDS].sort(),
    ['audio', 'file', 'image', 'video'],
    'S2 MEDIA_KINDS',
  );
  for (const k of ['attachmentId', 'alt', 'caption', 'name', 'width', 'align', 'mimeType', 'duration']) {
    assert.ok(MEDIA_ATTR_KEYS.includes(k as any), `S2 MEDIA_ATTR_KEYS 包含 ${k}`);
  }
  assert.deepEqual(
    [...MEDIA_WIDTHS].sort((a, b) => a - b),
    [25, 50, 75, 100],
    'S2 MEDIA_WIDTHS',
  );
  assert.deepEqual(
    [...MEDIA_ALIGNS].sort(),
    ['center', 'left', 'right'],
    'S2 MEDIA_ALIGNS',
  );
  record('S2 常量契约正确', true, '4 类媒体 / 8 个 attrs / 4 档宽度 / 3 档对齐');

  // ===== S3: schema 接受编辑器产出的所有节点与 marks =====
  const schema = buildEditorSchema();
  const sample = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
          { type: 'hardBreak' },
          { type: 'text', text: 'more' },
        ],
      },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'title' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
          },
        ],
      },
      {
        type: 'orderedList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
          },
        ],
      },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'const x = 1;' }] },
      {
        type: 'image',
        attrs: {
          attachmentId: 'att-1',
          alt: 'a',
          caption: 'c',
          name: 'n',
          width: 75,
          align: 'center',
          mimeType: 'image/png',
          duration: 0,
        },
      },
    ],
  };
  let parsed;
  try {
    parsed = schema.nodeFromJSON(sample);
  } catch (err) {
    assert.fail(`S3 schema 接受编辑器完整节点集失败: ${(err as Error).message}`);
  }
  assert.equal(parsed.type.name, 'doc', 'S3 root=doc');
  assert.ok(parsed.childCount >= 7, `S3 doc 子节点数 >=7, got=${parsed.childCount}`);
  record('S3 schema 接受完整节点 / marks 集', true, `childCount=${parsed.childCount}`);

  // ===== S4: 媒体是 block，独占行 =====
  // image/audio/video/file 必须是 block group，不能放进 paragraph
  for (const k of ['image', 'audio', 'video', 'file'] as const) {
    const spec = schema.nodes[k];
    assert.ok(spec, `S4 ${k} node 存在`);
    assert.ok(spec!.isBlock, `S4 ${k} 是 block 节点`);
    assert.ok(!spec!.isInline, `S4 ${k} 不是 inline`);
  }
  // 在编辑器位置约束里：doc 至少能容纳一个媒体节点作为顶层 child
  const mediaDoc = {
    type: 'doc',
    content: [{ type: 'image', attrs: { attachmentId: 'x', width: 50, align: 'left' } }],
  };
  schema.nodeFromJSON(mediaDoc);
  record('S4 媒体为 block、可作 doc 顶层 child', true, 'image/audio/video/file 均为 block');

  // ===== S5: 媒体默认 attrs 一旦缺省被填充 =====
  const minimal = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { attachmentId: 'att-x' } },
      { type: 'audio', attrs: { attachmentId: 'att-y' } },
      { type: 'video', attrs: { attachmentId: 'att-z' } },
      { type: 'file', attrs: { attachmentId: 'att-w' } },
    ],
  };
  const normalized = schema.nodeFromJSON(minimal).toJSON() as any;
  for (const node of normalized.content) {
    for (const k of MEDIA_ATTR_KEYS) {
      assert.ok(
        node.attrs && k in node.attrs,
        `S5 ${node.type} 默认 attrs 含 ${k}, got=${JSON.stringify(node.attrs)}`,
      );
    }
  }
  record('S5 媒体默认 attrs 完整补齐', true, '8 个 attrs 全部默认填充');

  // ===== S6: normalizeEditorDocument 接受完整节点集 =====
  const messy = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'unknown', content: [] },
      { type: 'image', attrs: { attachmentId: '' } }, // 缺 attachmentId → 丢弃
      { type: 'image', attrs: { attachmentId: 'a1' } }, // 缺字段 → 补默认
      { type: 'heading', attrs: { level: 5 } }, // level 保留为 5
      { type: 'paragraph' },
    ],
  };
  const norm = normalizeEditorDocument(messy);
  assert.equal(norm.type, 'doc', 'S6 root=doc');
  // 应当保留：paragraph(text=hi) / image(att=a1) / heading(level=5) / paragraph()
  const blocks = norm.content;
  // 找到 image 节点与 heading 节点（忽略空 paragraph）
  const img = blocks.find((b: any) => b.type === 'image');
  assert.ok(img, 'S6 含 image');
  assert.equal((img as any).attrs.attachmentId, 'a1', 'S6 image attachmentId');
  const head = blocks.find((b: any) => b.type === 'heading');
  assert.ok(head, 'S6 含 heading');
  assert.ok([1, 2, 3, 4, 5, 6].includes((head as any).attrs.level), 'S6 heading level 合法');
  // 未知节点被丢弃
  assert.ok(!blocks.some((b: any) => b.type === 'unknown'), 'S6 未知节点被丢弃');
  record('S6 normalizeEditorDocument 完整节点集', true, `blocks=${blocks.length}`);

  // ===== S7: normalizeEditorDocument 兼容非法输入 =====
  for (const bad of [null, undefined, 'string', 42, true, [], () => {}]) {
    const d = normalizeEditorDocument(bad as any);
    assert.equal(d.type, 'doc', `S7 ${typeof bad} root=doc`);
    assert.ok(Array.isArray(d.content) && d.content.length > 0, `S7 ${typeof bad} 至少 1 块`);
  }
  record('S7 非法输入归一为空文档', true, '所有原始类型通过');

  // ===== S8: richDocumentToEditorJson / editorJsonToRichDocument 互逆 =====
  // 互逆以"经过 normalizeEditorDocument 归一化"为标准形式（默认值会被填充）。
  const original = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      { type: 'image', attrs: { attachmentId: 'a', width: 75, align: 'right' } },
    ],
  };
  const normalizedOriginal = normalizeEditorDocument(original);
  const asEditor = richDocumentToEditorJson(original);
  const back = editorJsonToRichDocument(asEditor);
  assert.deepEqual(back, normalizedOriginal, 'S8 JSON 互逆（归一化后形式）');
  assert.deepEqual(asEditor, normalizedOriginal, 'S8 to-editor-json 归一');
  record('S8 richDocument ↔ editor JSON 互逆', true, 'parity');

  // ===== S9: buildEditorSchema 是单点事实源（多调得到同一 schema 引用） =====
  const s1 = buildEditorSchema();
  const s2 = buildEditorSchema();
  assert.equal(s1, s2, 'S9 buildEditorSchema 幂等返回同一 schema');
  record('S9 buildEditorSchema 幂等', true, '同引用');

  // ===== S10: cleanInline 必须保留 marks（bold/italic/code/link） =====
  // Issue #15 第二切片：保存后 marks 不丢
  const doc10 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'plain ' },
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
          { type: 'text', text: ' code', marks: [{ type: 'code' }] },
          { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
        ],
      },
    ],
  };
  const norm10 = normalizeEditorDocument(doc10);
  const p10 = norm10.content[0];
  assert.ok(Array.isArray(p10.content), 'S10 paragraph.content[]');
  const textNodes = p10.content as Array<{ type: string; text?: string; marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }>;
  const findByText = (t: string) => textNodes.find((n) => n.text === t);
  const boldNode = findByText('bold');
  assert.ok(boldNode && boldNode.marks && boldNode.marks.some((m) => m.type === 'bold'), 'S10 bold marks 保留');
  const italicNode = findByText(' italic');
  assert.ok(italicNode && italicNode.marks && italicNode.marks.some((m) => m.type === 'italic'), 'S10 italic marks 保留');
  const codeNode = findByText(' code');
  assert.ok(codeNode && codeNode.marks && codeNode.marks.some((m) => m.type === 'code'), 'S10 code marks 保留');
  const linkNode = findByText(' link');
  assert.ok(linkNode && linkNode.marks && linkNode.marks.some((m) => m.type === 'link'), 'S10 link marks 保留');
  const doc10b = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'x', marks: [{ type: 'unknownMark' }] },
        ],
      },
    ],
  };
  const norm10b = normalizeEditorDocument(doc10b);
  const txtB = norm10b.content[0].content[0];
  assert.ok(!txtB.marks || txtB.marks.length === 0, 'S10 未知 marks 被丢弃');
  record('S10 marks 保留与白名单', true, 'bold/italic/code/link 保留; 未知 mark 丢弃');

  // ===== S11: paragraph / heading 必须保留 textAlign attr =====
  // Issue #15 第二切片：保存后对齐方式不丢
  for (const type of ['paragraph', 'heading'] as const) {
    const attrs: Record<string, unknown> = type === 'heading' ? { level: 2, textAlign: 'center' } : { textAlign: 'right' };
    const doc11 = {
      type: 'doc',
      content: [
        {
          type,
          attrs,
          content: [{ type: 'text', text: 'aligned' }],
        },
      ],
    };
    const norm11 = normalizeEditorDocument(doc11);
    const block = norm11.content[0];
    assert.ok(block.attrs, `S11 ${type} attrs 存在`);
    assert.equal((block.attrs as Record<string, unknown>).textAlign, type === 'heading' ? 'center' : 'right', `S11 ${type} textAlign 保留`);
  }
  const doc11b = {
    type: 'doc',
    content: [
      { type: 'paragraph', attrs: { textAlign: 'justify' }, content: [{ type: 'text', text: 'x' }] },
    ],
  };
  const norm11b = normalizeEditorDocument(doc11b);
  const p11b = norm11b.content[0];
  const textAlignVal = p11b.attrs ? (p11b.attrs as Record<string, unknown>).textAlign : undefined;
  // 非法 textAlign 应被丢弃：要么 attrs 不存在，要么 textAlign 是 null/undefined
  assert.ok(textAlignVal === undefined || textAlignVal === null, `S11 非法 textAlign 被丢弃, got=${JSON.stringify(textAlignVal)}`);
  record('S11 paragraph/heading textAlign 保留', true, '白名单 left/center/right');

  // ===== S12: schema 接受 table / tableRow / tableHeader / tableCell =====
  // Issue #15 第二切片：工具栏支持表格 → 单点事实源必须包含
  for (const name of ['table', 'tableRow', 'tableHeader', 'tableCell']) {
    const spec = schema.nodes[name];
    assert.ok(spec, `S12 ${name} node 存在`);
  }
  const tableDoc = {
    type: 'doc',
    content: [
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H1' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'H2' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
            ],
          },
        ],
      },
    ],
  };
  const parsed12 = schema.nodeFromJSON(tableDoc);
  const back12 = parsed12.toJSON() as any;
  assert.equal(back12.content[0].type, 'table', 'S12 table 节点保留');
  assert.equal(back12.content[0].content.length, 2, 'S12 2 行');
  assert.equal(back12.content[0].content[0].content[0].type, 'tableHeader', 'S12 tableHeader');
  assert.equal(back12.content[0].content[1].content[0].type, 'tableCell', 'S12 tableCell');
  record('S12 table/tableRow/tableHeader/tableCell', true, 'schema + round-trip');

  // ===== S13: normalizeEditorDocument 接受 table 节点，不丢内容 =====
  const norm13 = normalizeEditorDocument(tableDoc);
  const tbl = norm13.content[0];
  assert.equal(tbl.type, 'table', 'S13 table 保留');
  assert.equal(tbl.content.length, 2, 'S13 行数');
  const row0 = tbl.content[0];
  const row1 = tbl.content[1];
  assert.equal(row0.content.length, 2, 'S13 row0 cols');
  assert.equal(row1.content.length, 2, 'S13 row1 cols');
  const headerText = row0.content[0].content[0].content[0].text;
  assert.equal(headerText, 'H1', 'S13 header text');
  const cellText = row1.content[1].content[0].content[0].text;
  assert.equal(cellText, 'b', 'S13 cell text');
  record('S13 normalize 接受 table 不丢内容', true, 'rows=2 cols=2');

  // ===== S14: documentModel.documentToText 支持 table / tableCell / 不泄漏 JSON =====
  // Issue #15 第二切片：documentToText 单点事实源必须覆盖表格
  const docMod = await import('../src/lib/documentModel');
  const text14 = docMod.documentToText(norm13 as any);
  assert.ok(text14.includes('H1'), 'S14 documentToText 含 header text');
  assert.ok(text14.includes('H2'), 'S14 documentToText 含 H2');
  assert.ok(text14.includes('a'), 'S14 documentToText 含 cell a');
  assert.ok(text14.includes('b'), 'S14 documentToText 含 cell b');
  // 不泄漏 JSON 属性名
  for (const leak of ['tableRow', 'tableCell', 'tableHeader', 'attachmentId', '"attrs"', '"content"']) {
    assert.ok(!text14.includes(leak), `S14 不泄漏 ${leak}, actual=${JSON.stringify(text14)}`);
  }
  record('S14 documentToText 表格支持', true, '不泄漏 JSON');

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
