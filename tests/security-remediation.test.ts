import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as dns } from 'node:dns';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { S3Client } from '@aws-sdk/client-s3';
import { validateBaseUrl, resolveSafeDestination } from '../src/lib/safeBaseUrl';
import { safeFetchWithTimeout, createSafeFetch } from '../src/lib/safeFetch';
import { fetchWithTimeout } from '../src/lib/fetchWithTimeout';
import { readUpstreamFrames } from '../src/lib/upstreamFrames';
import { geminiCredentials } from '../src/lib/geminiCredentials';
import { buildGeminiClient } from '../src/lib/geminiClient';
import { evaluateTranscriptSafely } from '../src/lib/hallucinationFilterServer';
import { evaluateTranscript } from '../src/lib/hallucinationFilter';
import { transcodeToMp3 } from '../src/lib/audioTranscode';
import { r2Scope } from '../src/lib/r2Authorization';
import { beginOAuth, consumeOAuthFragment } from '../src/lib/oauthState';
import { upstreamLifecycle } from '../src/lib/upstreamLifecycle';
import { R2Client } from '../src/lib/r2Client';
import app from '../api/index';

const nativeFetch = globalThis.fetch;
let checks = 0;
async function check(name: string, test: () => Promise<void> | void) { await test(); checks++; console.log(`PASS ${name}`); }
function storage(): Storage {
  const items = new Map<string, string>();
  return { getItem: k => items.get(k) ?? null, setItem: (k, v) => { items.set(k, v); }, removeItem: k => { items.delete(k); }, clear: () => items.clear(), key: i => [...items.keys()][i] ?? null, get length() { return items.size; } };
}
function bytes(text: string) { return new TextEncoder().encode(text); }
async function listen(server: http.Server): Promise<string> { await new Promise<void>(r => server.listen(0, '127.0.0.1', r)); return `http://127.0.0.1:${(server.address() as any).port}`; }
async function close(server: http.Server) { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); }

async function main() {
  process.env.R2_OWNER_TOKEN = 'owner-canary-token-'.repeat(4);
  process.env.R2_BUCKET = 'owner-bucket'; process.env.R2_KEY_PREFIX = 'baimiaobiji';
  process.env.R2_ACCOUNT_ID = 'canary'; process.env.R2_ACCESS_KEY_ID = 'canary'; process.env.R2_SECRET_ACCESS_KEY = 'not-a-real-secret';
  process.env.GOOGLE_API_KEY = 'server-canary-google-key';
  let upstreamHits = 0; let key = ''; let lastHost = ''; let uploadedType = '';
  const upstream = http.createServer((req, res) => {
    upstreamHits++; key = String(req.headers['x-goog-api-key'] || ''); lastHost = String(req.headers.host); uploadedType = String(req.headers['content-type'] || '');
    req.resume();
    if (req.url === '/redirect') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); res.end(); }
    else if (req.url === '/redirect-local') { res.writeHead(307, { location: '/ok' }); res.end(); }
    else if (req.url === '/stall') { res.writeHead(200); res.flushHeaders(); }
    else if (req.url === '/status600') { res.writeHead(600); res.end('invalid'); }
    else if (req.url === '/large') res.end('x'.repeat(4096));
    else if (req.url?.includes('generateContent')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '正常摘要' }] } }] })); }
    else if (req.url?.toLowerCase().includes('embedcontent')) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ embeddings: [{ values: [0.1, 0.2] }], embedding: { values: [0.1, 0.2] } })); }
    else res.end('ok');
  });
  const base = await listen(upstream);
  const apiServer = http.createServer(app); const apiBase = await listen(apiServer);
  let sdkCalls = 0;
  const send = S3Client.prototype.send;
  (S3Client.prototype as any).send = async function(command: any) { sdkCalls++; assert.equal(command.input.Bucket, 'owner-bucket'); assert.equal(command.input.Prefix, 'baimiaobiji/'); return { Contents: [{ Key: 'baimiaobiji/day/backup.enc', Size: 5 }] }; };
  const post = (route: string, body: any, token?: string) => nativeFetch(`${apiBase}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  try {
    await check('R2 anonymous/wrong owner blocked before SDK', async () => {
      for (const route of ['/api/r2-presign', '/api/r2-list']) {
        for (const token of [undefined, 'incorrect']) assert.equal((await post(route, { kind: 'get', key: 'baimiaobiji/a.enc' }, token)).status, 401);
      }
      assert.equal(sdkCalls, 0);
      const token = process.env.R2_OWNER_TOKEN; delete process.env.R2_OWNER_TOKEN;
      assert.equal((await post('/api/r2-list', {})).status, 503); process.env.R2_OWNER_TOKEN = token;
    });
    await check('R2 owner signs get/put and list only configured bucket/root', async () => {
      const token = process.env.R2_OWNER_TOKEN!;
      for (const kind of ['get', 'put']) {
        const response = await post('/api/r2-presign', { kind, key: 'baimiaobiji/nested/a.enc', bucket: 'owner-bucket', contentType: 'application/octet-stream', contentLength: 10 }, token);
        assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.bucket, 'owner-bucket'); assert.ok(result.url.includes('baimiaobiji/nested/a.enc'));
      }
      assert.equal((await post('/api/r2-list', {}, token)).status, 200); assert.equal(sdkCalls, 1);
      for (const body of [{ bucket: 'other', key: 'baimiaobiji/a.enc' }, { key: 'baimiaobiji-evil/a.enc' }, { key: 'other/a.enc' }, { key: 'baimiaobiji/%2e%2e/a.enc' }]) {
        assert.equal((await post('/api/r2-presign', { kind: 'get', ...body }, token)).status, 400);
      }
      assert.equal((await post('/api/r2-list', { prefix: 'baimiaobiji-evil/' }, token)).status, 400);
      assert.equal((await post('/api/r2-presign', { kind: 'put', key: 'baimiaobiji/a.enc', contentType: 'application/octet-stream', contentLength: 0.5 }, token)).status, 400);
      assert.deepEqual(r2Scope(undefined, '', true), { bucket: 'owner-bucket', key: 'baimiaobiji/' });
    });
    await check('Server Gemini key cannot reach a custom recipient; caller key works', async () => {
      const before = upstreamHits;
      assert.equal((await post('/api/multimedia-summarize', { file_base64: 'AA==', mime_type: 'image/png', settings: { baseUrl: base } })).status, 500);
      assert.equal(upstreamHits, before);
      for (const url of ['https://generativelanguage.googleapis.com.evil/', 'https://generativelanguage.googleapis.com@evil.test/', 'https://generativelanguage.googleapis.com/?x=1']) assert.throws(() => geminiCredentials('', url, 'server-key'));
      assert.equal(geminiCredentials('', undefined, 'server-key').baseUrl, 'https://generativelanguage.googleapis.com');
      const response = await post('/api/multimedia-summarize', { file_base64: 'AA==', mime_type: 'image/png', settings: { apiKey: 'caller-canary', baseUrl: base, model: 'test-model' } });
      assert.equal(response.status, 200); assert.equal((await response.json()).summary, '正常摘要'); assert.equal(key, 'caller-canary');
    });
    await check('Vercel Volcengine rejects private and encoded-private URL forms before connection', async () => {
      for (const url of ['http://169.254.169.254', 'http://0x0a000001', 'http://[::ffff:a00:1]']) {
        const response = await post('/api/transcribe', { audio_base64: 'AA==', mime_type: 'audio/mp3', settings: { provider: 'volcengine', apiKey: 'caller', baseUrl: url } });
        assert.equal(response.status, 500); assert.match((await response.json()).error, /Invalid baseUrl/);
      }
    });
    await check('Redirect hops never contacted (metadata or same-origin)', async () => {
      for (const route of ['/redirect', '/redirect-local']) { const before = upstreamHits; await assert.rejects(safeFetchWithTimeout(base + route), /redirect/); assert.equal(upstreamHits, before + 1); }
    });
    await check('Body byte cap, post-header deadline and caller abort', async () => {
      const big = await safeFetchWithTimeout(base + '/large', {}, 1000, { maxResponseBytes: 1024 }); await assert.rejects(big.text(), /byte limit/);
      const slow = await safeFetchWithTimeout(base + '/stall', {}, 100); await assert.rejects(slow.text());
      const cancel = new AbortController(); const stopped = await safeFetchWithTimeout(base + '/stall', { signal: cancel.signal }, 5000); cancel.abort(); await assert.rejects(stopped.text());
      assert.equal(await (await safeFetchWithTimeout(base + '/ok')).text(), 'ok');
      await assert.rejects(safeFetchWithTimeout(base + '/status600'), /status/);
      await assert.rejects(safeFetchWithTimeout(base + '/status600', { method: 'HEAD' }), /status/);
      const form = new FormData(); form.append('file', new Blob(['audio']), 'sample.mp3'); await (await safeFetchWithTimeout(base + '/upload', { method: 'POST', body: form })).text(); assert.match(uploadedType, /multipart\/form-data; boundary=/);
    });
    await check('Explicit caller signal is combined with downstream lifecycle cancellation', async () => {
      const downstream: any = new EventEmitter(); downstream.writableEnded = false;
      const explicit = new AbortController();
      await new Promise<void>((resolve, reject) => {
        upstreamLifecycle({} as any, downstream, () => {
          (async () => {
            const response = await safeFetchWithTimeout(base + '/stall', { signal: explicit.signal }, 5000);
            downstream.emit('close'); await assert.rejects(response.text()); assert.equal(explicit.signal.aborted, false);
          })().then(resolve, reject);
        });
      });
    });
    await check('DNS policy rejects changed/mixed answers; local exceptions preserve blocked ports', async () => {
      const lookup = dns.lookup;
      try {
        (dns as any).lookup = async (host: string) => [{ address: host.endsWith('.local') ? '192.168.1.5' : '8.8.8.8', family: 4 }];
        assert.equal((await validateBaseUrl('http://public.test')).ok, true);
        assert.equal((await validateBaseUrl('http://nas.local:5006', { webdavLocal: true })).ok, true);
        (dns as any).lookup = async () => [{ address: '127.0.0.1', family: 4 }];
        assert.equal((await validateBaseUrl('http://public.test')).ok, false);
        (dns as any).lookup = async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }];
        assert.equal((await validateBaseUrl('http://mixed.test')).ok, false);
        for (const url of ['http://localhost:9200', 'http://nas.local:6379', 'ftp://nas.local', 'http://user:pass@nas.local']) assert.equal((await validateBaseUrl(url, { webdavLocal: true })).ok, false);
        assert.equal((await validateBaseUrl('http://localhost:11434/v1')).ok, true);
      } finally { dns.lookup = lookup; }
    });
    await check('Transport lookup is the approved IP with original Host preserved', async () => {
      const original = http.request; let resolved = 0; let lookedUp = 0;
      try {
        (http as any).request = (url: URL, options: any, callback: any) => {
          assert.equal(url.hostname, 'rebind.test'); assert.equal(options.agent, false);
          options.lookup(url.hostname, { all: true }, (_error: any, addresses: any[]) => { assert.deepEqual(addresses, [{ address: '8.8.8.8', family: 4 }]); lookedUp++; });
          const outgoing: any = new EventEmitter(); outgoing.destroy = () => {}; outgoing.end = () => {
            const incoming: any = Readable.from([Buffer.from('pinned')]); incoming.statusCode = 200; incoming.headers = {}; callback(incoming);
          }; return outgoing;
        };
        const fetchPinned = createSafeFetch(async () => { resolved++; return { url: new URL('http://rebind.test'), addresses: [{ address: '8.8.8.8', family: 4 }] }; });
        assert.equal(await (await fetchPinned('http://rebind.test')).text(), 'pinned'); assert.equal(resolved, 1); assert.equal(lookedUp, 1);
      } finally { http.request = original; }
      const ai = await buildGeminiClient('local-key', base);
      assert.equal((await ai.models.generateContent({ model: 'test', contents: 'hi' })).text, '正常摘要');
      assert.deepEqual((await ai.models.embedContent({ model: 'test', contents: 'hi' })).embeddings?.[0]?.values, [0.1, 0.2]);
      assert.equal(lastHost, new URL(base).host);
      assert.equal(await (await globalThis.fetch(base + '/ok')).text(), 'ok');
    });
    await check('Oversize and unterminated stream frames cancel readers; normal framing retained', async () => {
      let cancelled = false;
      const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes('x'.repeat(129))); }, cancel() { cancelled = true; } });
      await assert.rejects(async () => { for await (const _ of readUpstreamFrames(stream, '\n', 128)) {} }, /frame/); assert.equal(cancelled, true);
      const frames = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes('first\nsec')); c.enqueue(bytes('ond\n')); c.close(); } });
      const result: string[] = []; for await (const frame of readUpstreamFrames(frames, '\n')) result.push(frame); assert.deepEqual(result, ['first', 'second']);
    });
    await check('Hostile regex terminates outside event loop; legitimate exact/regex semantics preserved', async () => {
      const pattern = { key: 'test', type: 'regex' as const, value: '^(a+)+$', created_at: 1 };
      let responsive = false; const timer = setTimeout(() => { responsive = true; }, 25);
      await assert.rejects(evaluateTranscriptSafely('a'.repeat(10000) + '!', [pattern], 300), /deadline/); clearTimeout(timer); assert.equal(responsive, true);
      for (const value of ['关注.*订阅', '[', '^正常']) {
        const p = { ...pattern, value }; assert.deepEqual(await evaluateTranscriptSafely('正常关注与订阅', [p], 2000), evaluateTranscript('正常关注与订阅', [p]));
      }
      await assert.rejects(evaluateTranscriptSafely('normal', Array(129).fill(pattern)), /limits/);
    });
    await check('FFmpeg success, malformed input and pre-abort leave no files', async () => {
      const directory = await fs.mkdtemp(path.join(process.env.CODEX_SECURITY_TEST_TMP || os.tmpdir(), 'baimiao-conversion-test-'));
      try {
        await assert.rejects(transcodeToMp3(Buffer.from('invalid webm'), undefined, directory)); assert.deepEqual(await fs.readdir(directory), []);
        const pcm = Buffer.alloc(1600); const wav = Buffer.alloc(44 + pcm.length); wav.write('RIFF'); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
        assert.ok((await transcodeToMp3(wav, undefined, directory)).length > 0); assert.deepEqual(await fs.readdir(directory), []);
        const abort = new AbortController(); abort.abort(); await assert.rejects(transcodeToMp3(wav, abort.signal, directory)); assert.deepEqual(await fs.readdir(directory), []);
      } finally { await fs.rm(directory, { recursive: true, force: true }); }
    });
    await check('OAuth forged, duplicate, expired, replayed and wrong-tab callbacks rejected; providers retain flow', () => {
      const uri = 'https://app.example/settings';
      assert.equal(consumeOAuthFragment('#access_token=evil&state=gdrive', uri, storage()), null);
      for (const provider of ['onedrive', 'gdrive', 'dropbox'] as const) {
        const store = storage(); const state = beginOAuth(provider, uri, store, 1000); const fragment = `#access_token=valid&state=${state}`;
        assert.deepEqual(consumeOAuthFragment(fragment, uri, store, 1001), { token: 'valid', provider }); assert.equal(consumeOAuthFragment(fragment, uri, store, 1002), null);
      }
      for (const mode of ['wrong', 'duplicate', 'expired', 'uri', 'tab']) {
        const store = storage(); const state = beginOAuth('gdrive', uri, store, 1000); let fragment = `#access_token=valid&state=${state}`;
        if (mode === 'wrong') fragment = '#access_token=evil&state=gdrive'; if (mode === 'duplicate') fragment += '&state=evil';
        assert.equal(consumeOAuthFragment(fragment, mode === 'uri' ? uri + '/other' : uri, mode === 'tab' ? storage() : store, mode === 'expired' ? 9999999 : 1001), null);
      }
    });
    await check('Express production routes enforce owner scope and Gemini credential recipient', async () => {
      const probe = http.createServer(); const candidateBase = await listen(probe); await close(probe);
      const port = new URL(candidateBase).port;
      const child = spawn(process.execPath, ['dist/server.cjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: port }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
      try {
        let ready = false;
        for (let i = 0; i < 100; i++) {
          try { ready = (await nativeFetch(candidateBase + '/api/health')).ok; } catch {}
          if (ready) break;
          if (child.exitCode !== null) throw new Error(`Express exited: ${output}`);
          await new Promise(r => setTimeout(r, 100));
        }
        assert.ok(ready, output);
        const request = (route: string, body: any, auth = false) => nativeFetch(candidateBase + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${process.env.R2_OWNER_TOKEN}` } : {}) }, body: JSON.stringify(body) });
        assert.equal((await request('/api/r2-list', {})).status, 401);
        assert.equal((await request('/api/r2-presign', { kind: 'get', key: 'baimiaobiji/a.enc' })).status, 401);
        assert.equal((await request('/api/r2-presign', { kind: 'get', key: 'baimiaobiji/a.enc' }, true)).status, 200);
        assert.equal((await request('/api/r2-presign', { kind: 'get', bucket: 'other', key: 'baimiaobiji/a.enc' }, true)).status, 400);
        assert.equal((await request('/api/r2-list', { prefix: 'other/' }, true)).status, 400);
        const before = upstreamHits;
        assert.equal((await request('/api/multimedia-summarize', { file_base64: 'AA==', mime_type: 'image/png', settings: { baseUrl: base } })).status, 500);
        assert.equal(upstreamHits, before);
        const good = await request('/api/multimedia-summarize', { file_base64: 'AA==', mime_type: 'image/png', settings: { baseUrl: base, apiKey: 'express-caller', model: 'test' } });
        assert.equal(good.status, 200); assert.equal((await good.json()).summary, '正常摘要'); assert.equal(key, 'express-caller');
        const hostile = await request('/api/transcribe', { audio_base64: 'AA==', mime_type: 'audio/mp3', settings: { baseUrl: base, apiKey: 'caller', model: 'test' }, patterns: [{ key: 'bad', type: 'regex', value: '^(a+)+$', created_at: 1 }] });
        assert.equal(hostile.status, 200);
      } finally { const exited = new Promise<void>(r => child.once('exit', () => r())); if (child.exitCode === null) { child.kill(); await exited; } }
    });
    await check('R2 browser sends token to API only, never signed object URL', async () => {
      const requests: any[] = []; const saved = globalThis.fetch;
      globalThis.fetch = (async (url: any, options: any) => { requests.push({ url, options }); return new Response(JSON.stringify(String(url).includes('/api/') ? { url: 'https://r2.example/object' } : {})); }) as typeof fetch;
      try { await new R2Client({ bucket: 'owner-bucket', authToken: 'owner-token' }).upload({ key: 'baimiaobiji/a.enc', ciphertext: new ArrayBuffer(2), contentLength: 2, contentType: 'application/octet-stream' }); assert.equal(requests[0].options.headers.Authorization, 'Bearer owner-token'); assert.equal(requests[1].options.headers.Authorization, undefined); }
      finally { globalThis.fetch = saved; }
    });
    await check('Operator verification script uses the configured root for put/list/get', async () => {
      let verificationBase = ''; let object = Buffer.alloc(0); let storedKey = '';
      const mock = http.createServer(async (req, res) => {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const raw = Buffer.concat(chunks);
        if (req.url === '/api/health') { res.end('{}'); return; }
        if (req.url === '/object') {
          assert.equal(req.headers.authorization, undefined);
          if (req.method === 'PUT') { object = raw; res.end(); } else res.end(object);
          return;
        }
        assert.equal(req.headers.authorization, `Bearer ${process.env.R2_OWNER_TOKEN}`);
        const body = JSON.parse(raw.toString());
        if (req.url === '/api/r2-presign') { assert.ok(body.key.startsWith('personal/__verify__/')); storedKey = body.key; res.end(JSON.stringify({ url: verificationBase + '/object', key: body.key, bucket: 'owner-bucket' })); }
        else if (req.url === '/api/r2-list') { assert.equal(body.prefix, 'personal/'); res.end(JSON.stringify({ objects: [{ key: storedKey, size: object.length, lastModified: Date.now() }] })); }
        else { res.writeHead(404); res.end(); }
      });
      verificationBase = await listen(mock);
      try {
        const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-r2.ts', '--base-url', verificationBase], { cwd: process.cwd(), env: { ...process.env, R2_KEY_PREFIX: 'personal/' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; child.stdout.on('data', data => { output += data; }); child.stderr.on('data', data => { output += data; });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { child.kill(); reject(new Error('Verification script deadline exceeded')); }, 10000);
          child.once('error', error => { clearTimeout(timer); reject(error); });
          child.once('exit', code => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`Verification script failed: ${output}`)); });
        });
        assert.ok(storedKey.startsWith('personal/')); assert.ok(object.length > 0);
      } finally { await close(mock); }
    });
    await check('Generic timeout wrapper owns body deadline and caller signal', async () => {
      const saved = globalThis.fetch;
      globalThis.fetch = (async () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes('start')); } }))) as typeof fetch;
      try { const response = await fetchWithTimeout('http://mock.test', {}, 100); await assert.rejects(response.text(), /deadline/); }
      finally { globalThis.fetch = saved; }
    });
  } finally { S3Client.prototype.send = send; await close(apiServer); await close(upstream); }
  console.log(`Security regression groups passed: ${checks}`);
}
main().catch(err => { console.error(err); process.exitCode = 1; });
