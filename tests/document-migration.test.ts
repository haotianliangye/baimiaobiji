import assert from 'node:assert/strict';
import {
  migrateDocumentContent,
  resolveDocumentContent,
} from '../src/db/db';
import { documentToText, extractAttachmentIds } from '../src/lib/documentModel';
import type { AttachmentMeta } from '../src/db/db';

const helloDocument = {
  type: 'doc',
  content: [{ type: 'paragraph', attrs: { textAlign: null }, content: [{ type: 'text', text: '你好' }] }],
};

const oldRawLog = { id: 'raw-1', content: '你好' };
const migratedRawLog = migrateDocumentContent(oldRawLog);
assert.equal(documentToText(migratedRawLog.content_doc), '你好', '旧 raw_logs content 应转换为 RichDocument');
assert.equal(migratedRawLog.content, '你好', '迁移后应保留旧 content');

const oldThought = { id: 'thought-1', content: '你好' };
const migratedThought = migrateDocumentContent(oldThought);
assert.equal(documentToText(migratedThought.content_doc), '你好', '旧 thoughts content 应转换为 RichDocument');
assert.equal(migratedThought.content, '你好', '迁移后应保留旧 content');

const existingDocument = {
  type: 'doc',
  content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '保留' }] }],
};
const withExistingDocument = { id: 'raw-2', content: '旧文本', content_doc: existingDocument };
assert.strictEqual(
  migrateDocumentContent(withExistingDocument),
  withExistingDocument,
  '已有合法 content_doc 时迁移应幂等且不覆盖',
);

const emptyMigrated = migrateDocumentContent({ id: 'raw-empty', content: '' });
assert.equal(documentToText(emptyMigrated.content_doc), '', '空 content 应迁移为合法空文档');
assert.equal(emptyMigrated.content_doc.type, 'doc');
assert.ok(Array.isArray(emptyMigrated.content_doc.content) && emptyMigrated.content_doc.content.length > 0);

assert.strictEqual(
  resolveDocumentContent(withExistingDocument),
  existingDocument,
  'resolveDocumentContent 应优先返回合法 content_doc',
);
assert.equal(
  documentToText(resolveDocumentContent({ content: '你好', content_doc: { type: 'not-a-doc' } })),
  '你好',
  'content_doc 不合法时应回退转换 content 字符串',
);
assert.equal(documentToText(resolveDocumentContent({})), '', '无内容时应返回合法空文档');
const legacyWithAttachment = resolveDocumentContent({
  content: '旧文字',
  attachments: [{ kind: 'image', ref: 'legacy-image', name: '旧图', summary: '旧图说明' }],
});
assert.deepEqual(extractAttachmentIds(legacyWithAttachment), ['legacy-image'], '旧附件应被追加为文档媒体节点');
assert.ok(documentToText(legacyWithAttachment).includes('旧图说明'), '旧附件说明应进入派生文本');

// v18 升级：旧记录已带 attachments 但未带 content_doc 时，应升级为带图片节点的文档
const migratedLegacy = migrateDocumentContent({
  content: '每天下午散步',
  attachments: [
    { kind: 'image', ref: 'att-A' },
    { kind: 'image', ref: 'att-B' },
  ],
});
assert.deepEqual(
  extractAttachmentIds(migratedLegacy.content_doc),
  ['att-A', 'att-B'],
  '升级应把旧 attachments 吸收进 content_doc'
);
assert.deepEqual(
  migratedLegacy.content_doc.content.length,
  3,
  '升级后文档应保留原段落并追加两个媒体节点'
);

console.log('document migration tests passed');
