/**
 * Issue #002: /api/health 端点 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   H1. GET /api/health 返回 200 + JSON 含 ok=true
 *   H2. 返回的 version 与 package.json 一致
 *   H3. 返回的 uptime 是正数
 *   H4. 返回的 timestamp 是合理范围（与请求时间接近）
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/server-health.test.ts`。
 * 通过退出码 0/1 反映结果。
 * 端口 4178，与既有测试端口（4173-4177）隔离，便于串行运行。
 */
import puppeteer, { type Browser } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:4178';
let serverProc: ChildProcess | null = null;
let browser: Browser | null = null;

const results: { name: string; pass: boolean; detail: string }[] = [];
function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
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
  console.log('[setup] starting server.cjs...');
  // 注：项目为 ESM（package.json "type":"module"），__dirname 不可用，用 process.cwd()
  // 测试假设在项目根目录运行：`npx tsx tests/server-health.test.ts`
  // 用 dist/server.cjs（不是 vite preview）是因为 vite preview 只服务静态文件，
  // 不挂载 Express 路由；/api/health 必须由 server.cjs 提供。
  const projectRoot = process.cwd();
  serverProc = spawn('node', ['dist/server.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '4178', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  serverProc.stdout?.on('data', (d) => process.stdout.write(`[server] ${d}`));
  serverProc.stderr?.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForServer(`${BASE_URL}/`);
}

async function stopServer(): Promise<void> {
  if (serverProc && serverProc.pid) {
    try {
      process.kill(serverProc.pid, 'SIGTERM');
    } catch {}
    serverProc = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

// 读 package.json 期望 version
function getExpectedVersion(): string {
  // 注：ESM 环境下用 process.cwd() 替代 __dirname，参见 startServer() 注释
  const pkgPath = path.resolve(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

async function getHealth(): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}/api/health`, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        try {
          resolve({ status: res.statusCode || 0, body: JSON.parse(text) });
        } catch (e) {
          reject(new Error(`invalid JSON: ${text.slice(0, 200)}`));
        }
      });
    }).on('error', reject);
  });
}

async function run() {
  await startServer();
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  try {
    const expectedVersion = getExpectedVersion();

    // ===== H1: GET /api/health 返回 200 + ok=true =====
    const t1Start = Date.now();
    const r1 = await getHealth();
    assert('H1 状态 200', r1.status === 200, `got status=${r1.status}`);
    assert('H1 body.ok=true', r1.body?.ok === true, `got ok=${r1.body?.ok}`);

    // ===== H2: version 与 package.json 一致 =====
    assert(
      'H2 version 匹配 package.json',
      r1.body?.version === expectedVersion,
      `got ${r1.body?.version}, expected ${expectedVersion}`
    );

    // ===== H3: uptime 是正数 =====
    const uptime = r1.body?.uptime;
    assert('H3 uptime 是 number', typeof uptime === 'number', `got type=${typeof uptime}`);
    assert('H3 uptime > 0', uptime > 0, `got ${uptime}`);
    // 不应太大（进程刚启动）
    assert('H3 uptime < 60s', uptime < 60, `got ${uptime}s`);

    // ===== H4: timestamp 与请求时间接近 =====
    const ts = r1.body?.timestamp;
    const drift = Math.abs(ts - t1Start);
    assert('H4 timestamp 是 number', typeof ts === 'number', `got type=${typeof ts}`);
    assert('H4 timestamp 偏差 < 5s', drift < 5000, `drift=${drift}ms`);
  } finally {
    await stopServer();
  }

  // 汇总
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

run().catch(async (err) => {
  console.error('测试运行异常:', err);
  await stopServer();
  process.exit(1);
});