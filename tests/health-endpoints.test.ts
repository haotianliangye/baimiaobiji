/**
 * Issue P1-002 (MoN-8): 健康检查 4 端点 E2E 测试
 *
 * 覆盖旅程：
 *   H1. /api/health 仍返回 #002 沉淀的 4 字段（兼容性）
 *   H2. /api/ready 返回 200 + db.reachable + db_version 是数字
 *   H3. /api/version 200 + version 匹配 package.json
 *   H4. /api/storage 200 + ratio ∈ [0,1] + level 是 4 档之一
 *   H5. /api/ready 节流：第二次 < 50ms 返回（缓存命中）
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/health-endpoints.test.ts`。
 * 端口 4180（避开 4173-4179 既有测试）。
 */

import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:4180';
let serverProc: ChildProcess | null = null;

const results: { name: string; pass: boolean; detail: string }[] = [];
function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

interface FetchResult {
  status: number;
  body: any;
  ms: number;
}

function fetchJson(urlPath: string): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    http
      .get(`${BASE_URL}${urlPath}`, (res) => {
        let chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf-8');
          let body: any;
          try { body = JSON.parse(raw); } catch { body = raw; }
          resolve({ status: res.statusCode ?? 0, body, ms: Date.now() - start });
        });
      })
      .on('error', reject);
  });
}

function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      http
        .get(url, (res) => {
          if (res.statusCode === 200 || res.statusCode === 304) return resolve();
          retry();
        })
        .on('error', retry);
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) return reject(new Error(`server ${url} not ready`));
      setTimeout(check, 500);
    };
    check();
  });
}

async function startServer(): Promise<void> {
  console.log('[setup] starting server.cjs on 4180...');
  const projectRoot = process.cwd();
  serverProc = spawn('node', ['dist/server.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '4180', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer(`${BASE_URL}/`);
}

async function stopServer(): Promise<void> {
  if (serverProc && serverProc.pid) {
    try { process.kill(serverProc.pid, 'SIGTERM'); } catch {}
    serverProc = null;
  }
}

function getExpectedVersion(): string {
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

async function run() {
  const expectedVersion = getExpectedVersion();

  // ===== H1: /api/health 兼容 #002 沉淀 =====
  const r1 = await fetchJson('/api/health');
  assert('H1 /api/health 返回 200', r1.status === 200, `got status=${r1.status}`);
  assert('H1 /api/health body.ok=true', r1.body?.ok === true, `got ok=${r1.body?.ok}`);
  assert('H1 /api/health version 匹配 package.json',
    r1.body?.version === expectedVersion,
    `got ${r1.body?.version}, expected ${expectedVersion}`);
  assert('H1 /api/health uptime 是正数',
    typeof r1.body?.uptime === 'number' && r1.body.uptime >= 0,
    `got uptime=${r1.body?.uptime}`);
  assert('H1 /api/health timestamp 是 number',
    typeof r1.body?.timestamp === 'number',
    `got type=${typeof r1.body?.timestamp}`);

  // ===== H2: /api/ready =====
  const r2 = await fetchJson('/api/ready');
  assert('H2 /api/ready 返回 200', r2.status === 200, `got status=${r2.status}`);
  assert('H2 /api/ready body.ok=true', r2.body?.ok === true, `got ok=${r2.body?.ok}`);
  assert('H2 /api/ready db 字段存在',
    typeof r2.body?.db === 'string',
    `got db=${r2.body?.db} (type ${typeof r2.body?.db})`);
  assert('H2 /api/ready db_version 是 number',
    typeof r2.body?.db_version === 'number' && r2.body.db_version > 0,
    `got db_version=${r2.body?.db_version}`);

  // ===== H3: /api/version =====
  const r3 = await fetchJson('/api/version');
  assert('H3 /api/version 返回 200', r3.status === 200, `got status=${r3.status}`);
  assert('H3 /api/version 匹配 package.json',
    r3.body?.version === expectedVersion,
    `got ${r3.body?.version}, expected ${expectedVersion}`);
  assert('H3 /api/version db_version 是 number',
    typeof r3.body?.db_version === 'number',
    `got ${r3.body?.db_version}`);
  assert('H3 /api/version node_version 字段',
    typeof r3.body?.node_version === 'string' && r3.body.node_version.startsWith('v'),
    `got ${r3.body?.node_version}`);

  // ===== H4: /api/storage =====
  const r4 = await fetchJson('/api/storage');
  assert('H4 /api/storage 返回 200', r4.status === 200, `got status=${r4.status}`);
  assert('H4 /api/storage ratio 是 number 且 ∈ [0,1]',
    typeof r4.body?.ratio === 'number' && r4.body.ratio >= 0 && r4.body.ratio <= 1,
    `got ratio=${r4.body?.ratio}`);
  assert('H4 /api/storage level 是 4 档之一',
    ['ok', 'warning', 'critical', 'danger'].includes(r4.body?.level),
    `got level=${r4.body?.level}`);
  assert('H4 /api/storage used_bytes 是 number',
    typeof r4.body?.used_bytes === 'number' && r4.body.used_bytes >= 0,
    `got used_bytes=${r4.body?.used_bytes}`);

  // ===== H5: /api/ready 节流 =====
  const t1 = await fetchJson('/api/ready');
  const t2 = await fetchJson('/api/ready');
  assert('H5 第二次 /api/ready 命中缓存（< 50ms）',
    t2.ms < 50,
    `1st=${t1.ms}ms, 2nd=${t2.ms}ms`);

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

(async () => {
  try {
    await startServer();
    await run();
  } catch (err) {
    console.error('测试运行异常:', err);
    process.exit(1);
  } finally {
    await stopServer();
  }
})();