/**
 * Issue #009: R2 云备份单元测试
 *
 * 设计：纯函数层测试（key 生成、加密往返、输入校验），不触 db。
 * 不跑网络请求（fetch mock 不引入，避免 fake-fetch 与真实 fetch 行为漂移）。
 *
 * 覆盖：
 *   R1. normalizeKeyPrefix：默认值 / 首尾斜杠 / .. 攻击
 *   R2. buildBackupKey：key 命名规范（prefix / 日期 / uuid）
 *   R3. validateBackupKey：合法 / 非法输入
 *   R4. encryptAndUpload：fetch mock → 验证 presign + PUT 调用链
 *
 * 运行：npx tsx tests/r2-client.test.ts
 */

import assert from 'node:assert/strict';

// Node 没有 window.crypto.subtle（crypto.ts 用的是浏览器 Web Crypto API）。
// 用 Node 标准库的 webcrypto 给 window 打补丁，让 encryptData 在 Node 下也能跑。
// 这一步必须在 import '../src/lib/r2Client' 之前完成（模块顶层就引用了 window.crypto.subtle）。
if (typeof (globalThis as any).window === 'undefined') {
  const { webcrypto } = await import('node:crypto');
  (globalThis as any).window = { crypto: webcrypto };
}

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function run() {
  const { normalizeKeyPrefix, buildBackupKey, validateBackupKey, R2Client } =
    await import('../src/lib/r2Client');

  // ===== R1: normalizeKeyPrefix =====
  assert.equal(normalizeKeyPrefix('baimiaobiji'), 'baimiaobiji', 'R1 default');
  assert.equal(normalizeKeyPrefix('/baimiaobiji/'), 'baimiaobiji', 'R1 strip slashes');
  assert.equal(normalizeKeyPrefix('///'), 'baimiaobiji', 'R1 empty falls back to default');
  assert.equal(normalizeKeyPrefix('../etc/passwd'), 'baimiaobiji', 'R1 path traversal blocked');
  assert.equal(normalizeKeyPrefix('foo/../bar'), 'baimiaobiji', 'R1 mid path traversal blocked');
  assert.equal(normalizeKeyPrefix(undefined), 'baimiaobiji', 'R1 undefined');
  record('R1 normalizeKeyPrefix', true, '默认值 / 斜杠 / .. 攻击');

  // ===== R2: buildBackupKey =====
  const fixedDate = new Date('2026-08-19T12:00:00Z');
  const fixedUuid = '550e8400-e29b-41d4-a716-446655440000';
  const r2 = buildBackupKey('baimiaobiji', fixedDate, fixedUuid);
  // 注意：本地时区影响日期，所以只校验格式而不校验具体日期
  assert.ok(r2.key.startsWith('baimiaobiji/'), `R2 key 前缀, got ${r2.key}`);
  assert.ok(r2.key.endsWith(`/${fixedUuid}.enc`), `R2 key 结尾, got ${r2.key}`);
  assert.ok(/^baimiaobiji\/\d{4}-\d{2}-\d{2}\/[\w-]+\.enc$/.test(r2.key), `R2 key 格式, got ${r2.key}`);
  assert.equal(r2.uuid, fixedUuid, 'R2 uuid');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(r2.dateStr), `R2 dateStr 格式, got ${r2.dateStr}`);
  record('R2 buildBackupKey', true, `${r2.key}`);

  // ===== R3: validateBackupKey =====
  assert.equal(validateBackupKey('baimiaobiji/2026-08-19/abc.enc'), true, 'R3 valid');
  assert.equal(validateBackupKey('foo bar/baz.enc'), true, 'R3 space allowed');
  assert.equal(validateBackupKey(''), false, 'R3 empty');
  assert.equal(validateBackupKey('a'.repeat(1025)), false, 'R3 too long');
  assert.equal(validateBackupKey('a'.repeat(1024)), true, 'R3 max length');
  assert.equal(validateBackupKey('/etc/passwd'), false, 'R3 leading slash');
  assert.equal(validateBackupKey('foo/../bar'), false, 'R3 traversal');
  assert.equal(validateBackupKey('foo;DROP TABLE'), false, 'R3 illegal chars');
  record('R3 validateBackupKey', true, '合法 + 各种非法 case');

  // ===== R4: encryptAndUpload + presign + PUT (fetch mock) =====
  let presignCalled = 0;
  let putCalled = 0;
  let lastPresignBody: any = null;
  let lastPutBody: ArrayBuffer | null = null;
  let lastPutHeaders: Record<string, string> | null = null;
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    if (url.endsWith('/api/r2-presign')) {
      presignCalled++;
      const body = init?.body ? JSON.parse(init.body) : null;
      lastPresignBody = body;
      return new Response(JSON.stringify({
        url: 'https://test.r2.cloudflarestorage.com/test-bucket/' + encodeURIComponent(body.key) + '?X-Amz-Signature=fake',
        key: body.key,
        bucket: body.bucket,
        expiresIn: 300,
      }), { status: 200 });
    }
    if (url.includes('r2.cloudflarestorage.com')) {
      putCalled++;
      lastPutBody = init?.body as ArrayBuffer;
      lastPutHeaders = init?.headers as Record<string, string>;
      return new Response(null, { status: 200, headers: { ETag: '"fake-etag"' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const client = new R2Client({ bucket: 'test-bucket', keyPrefix: 'baimiaobiji' });
    const result = await client.encryptAndUpload('{"hello":"world"}', 'test-password-123');
    assert.equal(presignCalled, 1, 'R4 presign called once');
    assert.equal(putCalled, 1, 'R4 PUT called once');
    assert.equal(lastPresignBody.kind, 'put', 'R4 presign kind=put');
    assert.equal(lastPresignBody.bucket, 'test-bucket', 'R4 presign bucket');
    assert.equal(lastPresignBody.contentType, 'application/octet-stream', 'R4 contentType');
    assert.ok(typeof lastPresignBody.contentLength === 'number' && lastPresignBody.contentLength > 0, 'R4 contentLength > 0');
    assert.ok(lastPresignBody.key.startsWith('baimiaobiji/'), 'R4 key 前缀');
    assert.ok(lastPresignBody.key.endsWith('.enc'), 'R4 key 结尾');
    assert.ok(lastPutBody !== null && lastPutBody.byteLength > 0, 'R4 PUT body 非空');
    assert.equal(lastPutHeaders?.['Content-Type'], 'application/octet-stream', 'R4 PUT contentType');
    // 验证 PUT body 是 encryptData 的输出：前 16 字节是 salt + 12 字节是 iv（28 字节头部）
    assert.ok((lastPutBody as ArrayBuffer).byteLength >= 28, 'R4 密文至少 28 字节 header');
    assert.equal(result.key, lastPresignBody.key, 'R4 返回 key');
    assert.equal(result.etag, '"fake-etag"', 'R4 返回 etag');
    record('R4 encryptAndUpload', true, `presign + PUT 链路通`);
  } finally {
    globalThis.fetch = origFetch;
  }

  // ===== R5: listBackups 仅返回 .enc =====
  const origFetch2 = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    if (url.endsWith('/api/r2-list')) {
      return new Response(JSON.stringify({
        objects: [
          { key: 'baimiaobiji/2026-08-19/aaa.enc', size: 1024, lastModified: 1700000000000 },
          { key: 'baimiaobiji/2026-08-18/bbb.enc', size: 2048, lastModified: 1699900000000 },
          { key: 'baimiaobiji/2026-08-17/ccc.txt', size: 100, lastModified: 1699800000000 }, // 非 .enc
          { key: 'baimiaobiji/2026-08-16/ddd', size: 50, lastModified: 1699700000000 }, // 无扩展名
        ],
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const client = new R2Client({ bucket: 'test-bucket' });
    const list = await client.listBackups();
    assert.equal(list.length, 2, `R5 仅 2 条 .enc, got ${list.length}`);
    assert.ok(list[0].key.endsWith('.enc'), 'R5 列表项以 .enc 结尾');
    assert.equal(list[0].size, 1024, 'R5 size');
    assert.equal(list[0].lastModified, 1700000000000, 'R5 lastModified');
    // 排序：按 key 倒序
    assert.ok(list[0].key > list[1].key, 'R5 倒序');
    record('R5 listBackups', true, `过滤 .enc + 倒序`);
  } finally {
    globalThis.fetch = origFetch2;
  }

  // ===== R6: testConnection =====
  const origFetch3 = globalThis.fetch;
  globalThis.fetch = (async (input: any) => {
    const url = typeof input === 'string' ? input : (input?.url ?? '');
    if (url.endsWith('/api/r2-presign')) {
      return new Response(JSON.stringify({
        url: 'https://test.r2.cloudflarestorage.com/x.enc?sig=ok',
        key: 'x',
        bucket: 'test-bucket',
      }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;

  try {
    const client = new R2Client({ bucket: 'test-bucket' });
    const r = await client.testConnection();
    assert.equal(r.ok, true, 'R6 ok');
    assert.ok(r.message.includes('R2 连接正常'), 'R6 message');
    record('R6 testConnection', true, 'presign ok');
  } finally {
    globalThis.fetch = origFetch3;
  }

  // ===== R7: presign 503 处理 =====
  const origFetch4 = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'R2 未在服务端配置' }), { status: 503 })
  ) as typeof fetch;

  try {
    const client = new R2Client({ bucket: 'test-bucket' });
    let threw = false;
    try {
      await client.encryptAndUpload('plaintext', 'password');
    } catch (err: any) {
      threw = true;
      assert.ok(err.message.includes('R2 presign'), 'R7 错误消息含 presign');
    }
    assert.equal(threw, true, 'R7 503 时抛错');
    record('R7 503 错误处理', true, 'presign 失败 → 抛错');
  } finally {
    globalThis.fetch = origFetch4;
  }

  // ===== R8: 加密往返 =====
  const client = new R2Client({ bucket: 'test-bucket' });
  const plaintext = JSON.stringify({
    meta: { exportedAt: new Date().toISOString() },
    raw_logs: [{ id: 'a', content: 'hello world' }],
  });
  const encrypted = await client.prepareEncryptedBackup(plaintext, 'round-trip-password');
  assert.equal(encrypted.contentType, 'application/octet-stream', 'R8 contentType');
  assert.ok(encrypted.contentLength > 0, 'R8 contentLength > 0');
  assert.ok(encrypted.ciphertext.byteLength >= 28, 'R8 密文 header');
  // 解密：复用 crypto.ts:decryptData
  const { decryptData } = await import('../src/lib/crypto');
  const decrypted = await decryptData(encrypted.ciphertext, 'round-trip-password');
  assert.equal(decrypted, plaintext, 'R8 往返解密得到原内容');
  record('R8 encryptAndDecrypt 往返', true, 'AES-GCM + gzip 正确');

  // ===== 汇总 =====
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== 汇总 ===`);
  console.log(`通过: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('失败:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('测试运行异常:', err);
  process.exit(1);
});