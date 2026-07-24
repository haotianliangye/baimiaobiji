/**
 * Issue #15 — 统一文档模型纯函数单元测试（第一个纵向 TDD 切片）
 *
 * 覆盖：
 *   M1. 公开接口存在：RichDocument / createEmptyDocument / plainTextToDocument
 *      / documentToText / extractAttachmentIds / normalizeDocument
 *   M2. createEmptyDocument = 单段段落；段落不包含空 text 节点（合法空段落）
 *   M3. plainTextToDocument 保留单换行（→ hardBreak），空行形成新段落
 *   M4. plainTextToDocument 首尾纯空白被去除
 *   M5. plainTextToDocument 非法/空输入 → 空文档
 *   M6. documentToText 不泄漏 JSON 属性名（type/attrs/content/marks 都不应出现在 isJSON 中）
 *   M7. documentToText 媒体节点（image/audio/video/file）仅在有 caption/alt/name 时输出可读文字
 *   M8. documentToText 媒体节点无 caption/alt/name 时不输出任何 char
 *   M9. extractAttachmentIds 去重，且保持首次出现顺序
 *  M10. extractAttachmentIds 对非法/空文档返回空数组
 *  M11. extractAttachmentIds 支持 image/audio/video/file 四种媒体
 *  M12. normalizeDocument 接受不规范的 JSON，输出符合 schema 的 RichDocument
 *  M13. normalizeDocument 对 null/undefined/非对象输入 → 空文档
 *  M14. RichDocument 是结构性类型（必须能被 JSON.stringify 往返）
 *  M15. plainTextToDocument 多行：每行之间用 hardBreak 拼接，最后一段保留 trailing text
 *  M16. createEmptyDocument / normalizeDocument 输出必须被同一 ProseMirror schema 接受
 *
 * 运行：npx tsx tests/document-model.test.ts
 * 退出码 0/1。
 */

import assert from 'node:assert/strict';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const mod = await import('../src/lib/documentModel');
  const {
    createEmptyDocument,
    plainTextToDocument,
    documentToText,
    extractAttachmentIds,
    normalizeDocument,
  } = mod;

  // ===== M1: 公开接口存在 =====
  assert.equal(typeof mod.createEmptyDocument, 'function', 'M1 createEmptyDocument');
  assert.equal(typeof mod.plainTextToDocument, 'function', 'M1 plainTextToDocument');
  assert.equal(typeof mod.documentToText, 'function', 'M1 documentToText');
  assert.equal(typeof mod.extractAttachmentIds, 'function', 'M1 extractAttachmentIds');
  assert.equal(typeof mod.normalizeDocument, 'function', 'M1 normalizeDocument');
  record('M1 公开接口（5 个 export）', true, 'createEmpty/plainTextTo/documentToText/extractAttachmentIds/normalizeDocument');

  // ===== M2: createEmptyDocument = 单段段落（不带空 text 节点） =====
  const empty = createEmptyDocument();
  assert.equal(empty.type, 'doc', 'M2 type=doc');
  assert.ok(Array.isArray(empty.content), 'M2 content 是数组');
  assert.equal(empty.content.length, 1, 'M2 单段');
  const emptyPar = empty.content[0];
  assert.equal(emptyPar.type, 'paragraph', 'M2 段落');
  // 合法空段落：要么没有 content 字段，要么 content 为空数组；严禁出现 text:'' 节点
  if (emptyPar.content !== undefined) {
    assert.ok(Array.isArray(emptyPar.content), 'M2 paragraph.content 必须是数组');
    assert.equal(emptyPar.content.length, 0, 'M2 段内不应有任何 inline 节点（含空 text）');
    for (const c of emptyPar.content) {
      assert.ok(!(c.type === 'text' && c.text === ''), 'M2 不应包含空 text 节点');
    }
  }
  record('M2 createEmptyDocument = 单段空段落（无空 text）', true, JSON.stringify(empty));

  // ===== M3: plainTextToDocument 保留单换行（hardBreak），空行形成新段落 =====
  const doc3 = plainTextToDocument('第一行\n第二行\n\n第三段');
  // 期望：[ paragraph([text, hardBreak, text]), paragraph([text]) ]
  assert.equal(doc3.type, 'doc', 'M3 type=doc');
  assert.equal(doc3.content.length, 2, 'M3 2 个段落');
  const p1 = doc3.content[0];
  assert.equal(p1.type, 'paragraph', 'M3 p1 paragraph');
  assert.equal(p1.content.length, 3, 'M3 p1 内 3 节点');
  assert.equal(p1.content[0].type, 'text', 'M3 p1[0] text');
  assert.equal(p1.content[0].text, '第一行', 'M3 p1[0] text');
  assert.equal(p1.content[1].type, 'hardBreak', 'M3 p1[1] hardBreak');
  assert.equal(p1.content[2].type, 'text', 'M3 p1[2] text');
  assert.equal(p1.content[2].text, '第二行', 'M3 p1[2] text');
  const p2 = doc3.content[1];
  assert.equal(p2.type, 'paragraph', 'M3 p2 paragraph');
  assert.equal(p2.content.length, 1, 'M3 p2 单 text');
  assert.equal(p2.content[0].text, '第三段', 'M3 p2 text');
  record('M3 单换行=hardBreak / 空行=新段落', true, 'OK');

  // ===== M4: plainTextToDocument首尾纯空白被去除 =====
  const doc4 = plainTextToDocument('   \n\n  hello  \n  ');
  // 期望只一个段落，text='hello'
  assert.equal(doc4.content.length, 1, 'M4 单段');
  assert.equal(doc4.content[0].content.length, 1, 'M4 单 text');
  assert.equal(doc4.content[0].content[0].text, 'hello', 'M4 text=hello');
  record('M4 首尾空行/空白被去除', true, 'trimmed');

  // ===== M5: plainTextToDocument 非法/空输入 → 空文档 =====
  for (const bad of [null, undefined, '', '   ', '\n\n', '\t \n']) {
    const d = plainTextToDocument(bad as any);
    assert.deepEqual(d, createEmptyDocument(), `M5 非法输入 ${JSON.stringify(bad)} → 空文档`);
  }
  record('M5 非法输入归一为空文档', true, 'null/undefined/空白 均通过');

  // ===== M6: documentToText 不泄漏 JSON 属性名 =====
  const doc6 = plainTextToDocument('hello\nworld');
  const t6 = documentToText(doc6);
  // 文本里不应出现 'type' / 'attrs' / 'content' / 'marks' / 'paragraph' / 'doc' / 'hardBreak' / 'text' 等 JSON 结构键
  for (const leak of ['"type"', '"attrs"', '"content"', '"marks"', 'paragraph', 'hardBreak', '\"text\"']) {
    assert.ok(!t6.includes(leak), `M6 输出不应含 ${leak}，实际=${JSON.stringify(t6)}`);
  }
  assert.equal(t6, 'hello\nworld', 'M6 文本一致');
  record('M6 documentToText 不泄漏 JSON 属性名', true, JSON.stringify(t6));

  // ===== M7: 媒体节点 caption/alt/name 输出可读文字 =====
  const doc7 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '前面' },
          { type: 'image', attrs: { attachmentId: 'att-1', alt: '一只猫', caption: '街角的猫' } },
          { type: 'text', text: '后面' },
        ],
      },
    ],
  };
  const t7 = documentToText(doc7 as any);
  assert.ok(t7.includes('前面'), 'M7 含前面');
  assert.ok(t7.includes('后面'), 'M7 含后面');
  assert.ok(t7.includes('一只猫') || t7.includes('街角的猫'), 'M7 含 alt/caption 之一');
  assert.ok(!t7.includes('attachmentId'), 'M7 不含 JSON 属性名');
  record('M7 媒体 caption/alt 输出可读文字', true, JSON.stringify(t7));

  // ===== M8: 媒体节点无 caption/alt/name 时不输出任何 char =====
  const doc8 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'AB' },
          { type: 'image', attrs: { attachmentId: 'att-1' } },
          { type: 'text', text: 'CD' },
        ],
      },
    ],
  };
  const t8 = documentToText(doc8 as any);
  assert.equal(t8, 'ABCD', `M8 媒体无文本属性 → 不输出任何 char, got=${JSON.stringify(t8)}`);
  record('M8 媒体无 caption/alt/name 不输出', true, JSON.stringify(t8));

  // ===== M9: extractAttachmentIds 去重 + 保持首次出现顺序 =====
  const doc9 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'image', attrs: { attachmentId: 'att-1' } },
          { type: 'text', text: 'x' },
          { type: 'image', attrs: { attachmentId: 'att-2' } },
          { type: 'image', attrs: { attachmentId: 'att-1' } }, // 重复
          { type: 'audio', attrs: { attachmentId: 'att-3' } },
          { type: 'image', attrs: { attachmentId: 'att-2' } }, // 重复
        ],
      },
    ],
  };
  const ids9 = extractAttachmentIds(doc9 as any);
  assert.deepEqual(ids9, ['att-1', 'att-2', 'att-3'], `M9 去重保序, got=${JSON.stringify(ids9)}`);
  record('M9 extractAttachmentIds 去重 + 保序', true, JSON.stringify(ids9));

  // ===== M10: extractAttachmentIds 非法/空文档 → 空数组 =====
  for (const bad of [null, undefined, {}, { type: 'doc' }, { type: 'doc', content: 'wrong' }]) {
    const ids = extractAttachmentIds(bad as any);
    assert.ok(Array.isArray(ids) && ids.length === 0, `M10 非法输入 ${JSON.stringify(bad)} → [], got=${JSON.stringify(ids)}`);
  }
  record('M10 非法/空文档 → 空数组', true, 'all empty');

  // ===== M11: extractAttachmentIds 支持 image/audio/video/file =====
  const doc11 = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'image', attrs: { attachmentId: 'i1' } },
          { type: 'audio', attrs: { attachmentId: 'a1' } },
          { type: 'video', attrs: { attachmentId: 'v1' } },
          { type: 'file', attrs: { attachmentId: 'f1' } },
        ],
      },
    ],
  };
  const ids11 = extractAttachmentIds(doc11 as any);
  assert.deepEqual(ids11, ['i1', 'a1', 'v1', 'f1'], `M11 4 种媒体, got=${JSON.stringify(ids11)}`);
  record('M11 image/audio/video/file 都支持', true, JSON.stringify(ids11));

  // ===== M12: normalizeDocument 接受不规范 JSON，输出符合 schema =====
  const messy = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
      { type: 'unknown', content: [] }, // 未知节点应被丢弃
      { type: 'paragraph', content: 'oops' }, // 非数组 content
      { type: 'paragraph' }, // 无 content
    ],
  };
  const norm12 = normalizeDocument(messy);
  assert.equal(norm12.type, 'doc', 'M12 type=doc');
  assert.ok(Array.isArray(norm12.content), 'M12 content[]');
  for (const p of norm12.content) {
    assert.equal(p.type, 'paragraph', 'M12 只留 paragraph');
    // 合法空段落可以省略 content；有 content 时必须是数组，且节点类型合法
    if (p.content !== undefined) {
      assert.ok(Array.isArray(p.content), 'M12 paragraph.content[]');
      for (const c of p.content) {
        assert.ok(['text', 'hardBreak', 'image', 'audio', 'video', 'file'].includes(c.type), `M12 节点类型合法: ${c.type}`);
      }
    }
  }
  record('M12 normalizeDocument 过滤未知节点 + 修正非法结构', true, JSON.stringify(norm12).slice(0, 80) + '...');

  // ===== M13: normalizeDocument null/undefined/非对象 → 空文档 =====
  for (const bad of [null, undefined, 'string', 42, true, [], () => {}]) {
    const d = normalizeDocument(bad as any);
    assert.deepEqual(d, createEmptyDocument(), `M13 ${typeof bad} → 空文档`);
  }
  record('M13 非法输入归一为空文档', true, 'null/undefined/原始类型/函数 均通过');

  // ===== M13b: 回归断言 — 4 个「同语义空文档」入口必须返回 deepEqual 的同一结构 =====
  // 防 ProseMirror `nodeFromJSON(...).toJSON()` 给段落补 `attrs.textAlign:null`
  // 污染空段落，导致跨入口 deepEqual 失败（issue #15 第二切片 regression）。
  const { resolveDocumentContent } = await import('../src/db/db');
  const canonicalEmpty = {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  };
  const fromCreate = createEmptyDocument();
  const fromPlain = plainTextToDocument('');
  const fromNormEmpty = normalizeDocument({});
  const fromNormNull = normalizeDocument(null);
  const fromDbEmpty = resolveDocumentContent({});
  const fromDbContent = resolveDocumentContent({ content: '' });
  for (const [label, d] of [
    ['createEmptyDocument()', fromCreate],
    ['plainTextToDocument("")', fromPlain],
    ['normalizeDocument({})', fromNormEmpty],
    ['normalizeDocument(null)', fromNormNull],
    ['resolveDocumentContent({})', fromDbEmpty],
    ['resolveDocumentContent({content:""})', fromDbContent],
  ] as const) {
    assert.deepEqual(d, canonicalEmpty, `M13b ${label} 应等于 canonical empty`);
    // 段落上不能有 attrs（避免 schema 默认值 textAlign:null 泄漏）
    const p = (d as any).content[0];
    assert.ok(
      p.attrs === undefined,
      `M13b ${label} 段落不应有 attrs（schema 默认 textAlign:null 必须被剥离）, got=${JSON.stringify(p.attrs)}`,
    );
  }
  // 跨入口两两 deepEqual
  assert.deepEqual(fromCreate, fromPlain, 'M13b createEmpty vs plainText("")');
  assert.deepEqual(fromCreate, fromNormEmpty, 'M13b createEmpty vs normalize({})');
  assert.deepEqual(fromCreate, fromNormNull, 'M13b createEmpty vs normalize(null)');
  assert.deepEqual(fromCreate, fromDbEmpty, 'M13b createEmpty vs resolveDocumentContent({})');
  assert.deepEqual(fromPlain, fromNormEmpty, 'M13b plainText("") vs normalize({})');
  record('M13b 同语义空文档 6 入口 deepEqual', true, 'createEmpty / plainText("") / normalize({}) / normalize(null) / resolveDocumentContent({}) / resolveDocumentContent({content:""}) 全部 deepEqual canonical empty');

  // ===== M14: RichDocument 是结构性类型，可 JSON 往返 =====
  const doc14 = plainTextToDocument('foo\nbar');
  const round = JSON.parse(JSON.stringify(doc14));
  assert.equal(documentToText(round), 'foo\nbar', 'M14 round-trip');
  record('M14 RichDocument JSON 往返一致', true, 'OK');

  // ===== M15: plainTextToDocument 多行 =====
  const doc15 = plainTextToDocument('第一行\n第二行\n第三行');
  // 期望单段：[text, hardBreak, text, hardBreak, text]
  assert.equal(doc15.content.length, 1, 'M15 单段');
  const p15 = doc15.content[0];
  assert.equal(p15.content.length, 5, 'M15 5 节点');
  assert.equal(p15.content[0].text, '第一行', 'M15[0]');
  assert.equal(p15.content[1].type, 'hardBreak', 'M15[1] hardBreak');
  assert.equal(p15.content[2].text, '第二行', 'M15[2]');
  assert.equal(p15.content[3].type, 'hardBreak', 'M15[3] hardBreak');
  assert.equal(p15.content[4].text, '第三行', 'M15[4]');
  record('M15 多行单段全部为 hardBreak', true, 'OK');

  // ===== M16: createEmptyDocument / normalizeDocument 输出必须通过同 schema 校验 =====
  const schema = mod.__schema;
  assert.ok(schema && typeof schema.nodeFromJSON === 'function', 'M16 暴露内部 schema');
  for (const [label, doc] of [
    ['createEmptyDocument', createEmptyDocument()],
    ['normalizeDocument(null)', normalizeDocument(null)],
    ['normalizeDocument(messy)', normalizeDocument({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] },
        { type: 'unknown', content: [] },
        { type: 'paragraph', content: 'oops' },
        { type: 'paragraph' },
      ],
    })],
    ['normalizeDocument({})', normalizeDocument({})],
    ['plainTextToDocument("")', plainTextToDocument('')],
    ['plainTextToDocument("hi")', plainTextToDocument('hi')],
  ] as const) {
    let node;
    try {
      node = schema.nodeFromJSON(doc as any);
    } catch (err) {
      assert.fail(`M16 ${label} 未通过 schema 校验: ${(err as Error).message}; doc=${JSON.stringify(doc)}`);
    }
    // 进一步：normalizeDocument 之后的节点不应包含任何 text:'' 节点
    const json = node.toJSON() as any;
    const hasEmptyText = JSON.stringify(json).includes('"text":""');
    assert.ok(!hasEmptyText, `M16 ${label} 不应包含空 text 节点, got=${JSON.stringify(json)}`);
  }
  record('M16 createEmptyDocument / normalizeDocument 通过 schema 校验', true, 'all 6 个样本通过 schema.nodeFromJSON 且无空 text');

  // ===== M17: 媒体是 block，独占行（v2 schema 契约） =====
  // 新建一个 doc：段落 + image(block) + 段落
  const v2Doc = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '前面' }] },
      { type: 'image', attrs: { attachmentId: 'att-1', alt: '一只猫', caption: '街角的猫' } },
      { type: 'paragraph', content: [{ type: 'text', text: '后面' }] },
    ],
  };
  const v2Norm = normalizeDocument(v2Doc);
  assert.equal(v2Norm.content.length, 3, 'M17 doc 顶层 3 块');
  assert.equal(v2Norm.content[0].type, 'paragraph', 'M17[0] paragraph');
  assert.equal(v2Norm.content[1].type, 'image', 'M17[1] image 独立 block');
  assert.equal(v2Norm.content[2].type, 'paragraph', 'M17[2] paragraph');
  // 文本提取：媒体独占一行，前后各换行
  const t17 = documentToText(v2Norm);
  assert.ok(t17.includes('前面'), 'M17 含前面');
  assert.ok(t17.includes('后面'), 'M17 含后面');
  assert.ok(t17.includes('街角的猫') || t17.includes('一只猫'), 'M17 含 caption/alt');
  assert.ok(!t17.includes('attachmentId'), 'M17 不泄漏 JSON');
  record('M17 媒体是 block 节点 / documentToText 独占行', true, JSON.stringify(t17));

  // ===== M18: 媒体是 block 后 extractAttachmentIds 仍然去重保序 =====
  const ids18 = extractAttachmentIds(v2Norm);
  assert.deepEqual(ids18, ['att-1'], 'M18 block 媒体 attachmentIds');
  record('M18 block 媒体 extractAttachmentIds', true, JSON.stringify(ids18));

  // ===== M19: 缺 attachmentId 的媒体节点被丢弃 =====
  const missing = {
    type: 'doc',
    content: [
      { type: 'image', attrs: { alt: 'no id' } }, // 缺 attachmentId → 丢弃
      { type: 'image', attrs: { attachmentId: 'good' } },
    ],
  };
  const norm19 = normalizeDocument(missing);
  assert.equal(norm19.content.length, 1, 'M19 缺 id 媒体丢弃');
  assert.equal(norm19.content[0].type, 'image', 'M19 保留合法媒体');
  assert.equal(norm19.content[0].attrs.attachmentId, 'good', 'M19 attachmentId 正确');
  record('M19 缺 attachmentId 的媒体被丢弃', true, JSON.stringify(norm19.content));

  // ===== M20: heading / list / blockquote / codeBlock 通过 schema =====
  const rich = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'h' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
        ],
      },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'q' }] }] },
      { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] },
    ],
  };
  const norm20 = normalizeDocument(rich);
  assert.equal(norm20.content.length, 4, 'M20 4 个 block');
  const types = norm20.content.map((b: any) => b.type);
  assert.deepEqual(types, ['heading', 'bulletList', 'blockquote', 'codeBlock'], 'M20 节点类型顺序');
  record('M20 heading/list/blockquote/codeBlock 通过 schema', true, JSON.stringify(types));

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
