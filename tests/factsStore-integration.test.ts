/**
 * Issue P1-004 (ADR-0004): factsStore 真行为测试（puppeteer 集成）
 *
 * 关键：验证 db.facts 在 dexie schema 里**真存在**，
 *       add/get/list/delete 真能跑通。
 *
 * 之前 F1-F10 都是静态 regex 检查，**漏了 v17 schema 注册**这一关键。
 * 本测试确保 facts 表**真在 dexie 里**，addFact 等函数**真能跑**。
 *
 * 运行：`npm run build && npx tsx tests/factsStore-integration.test.ts`
 */

import puppeteer, { type Browser } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4190';
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
  console.log('[setup] starting server.cjs on 4190...');
  const projectRoot = process.cwd();
  serverProc = spawn('node', ['dist/server.cjs'], {
    cwd: projectRoot,
    env: { ...process.env, PORT: '4190', HOST: '127.0.0.1' },
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
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

async function run() {
  // 启 puppeteer
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();

  // 1. 加载主页（会触发 db upgrade 到 v17）
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等 hydration / initial load
  await new Promise((r) => setTimeout(r, 2000));

  // 2. 关键：验证 db.facts **真在 dexie schema 里**
  const schemaCheck = await page.evaluate(async () => {
    // @ts-ignore
    const mod = await import('/src/lib/factsStore.ts').catch(() => null);
    // 直接 import 不行（vite dev 不支持）—— 通过 dexie 查询
    return new Promise<{ hasFacts: boolean; error: string | null }>((resolve) => {
      const req = indexedDB.open('whitewash_diary');
      req.onsuccess = () => {
        const db = req.result;
        const hasFacts = db.objectStoreNames.contains('facts');
        // 检查版本
        const v = db.version;
        db.close();
        resolve({ hasFacts, error: null, version: v } as any);
      };
      req.onerror = () => resolve({ hasFacts: false, error: 'open failed' } as any);
      req.onblocked = () => resolve({ hasFacts: false, error: 'blocked' } as any);
    });
  });
  assert(
    'FI1 db.facts 在 IndexedDB schema 里真存在',
    (schemaCheck as any).hasFacts === true,
    `hasFacts=${(schemaCheck as any).hasFacts}, version=${(schemaCheck as any).version}`
  );

  // 3. 真调 addFact + getFactByKey
  const addTest = await page.evaluate(async () => {
    try {
      // 用 vite 的 dynamic import 加载 factsStore
      // @ts-ignore
      const factsStore = await import('/src/lib/factsStore.ts');
      const added = await factsStore.addFact({
        key: 'user.birthday',
        value: '1990-05-15',
        category: 'user',
      });
      const got = await factsStore.getFactByKey('user.birthday');
      return { ok: true, added, got };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  assert(
    'FI2 addFact 真成功（不在静态层失败）',
    addTest.ok === true && (addTest as any).got?.value === '1990-05-15',
    `ok=${addTest.ok}, value=${(addTest as any).got?.value}`
  );

  // 4. count
  const countTest = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const factsStore = await import('/src/lib/factsStore.ts');
      const n = await factsStore.countFacts();
      return { ok: true, n };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  assert(
    'FI3 countFacts 真能跑（>=1）',
    countTest.ok === true && (countTest as any).n >= 1,
    `n=${(countTest as any).n}`
  );

  // 5. delete + get null
  const deleteTest = await page.evaluate(async () => {
    try {
      // @ts-ignore
      const factsStore = await import('/src/lib/factsStore.ts');
      const added = await factsStore.addFact({
        key: 'test.delete',
        value: 'x',
        category: 'preference',
      });
      const deleted = await factsStore.deleteFact(added.id);
      const got = await factsStore.getFact(added.id);
      return { ok: true, deleted, got };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  });
  assert(
    'FI4 deleteFact 后 getFact 返回 undefined',
    deleteTest.ok === true && (deleteTest as any).deleted === true && (deleteTest as any).got === undefined,
    `deleted=${(deleteTest as any).deleted}, got=${JSON.stringify((deleteTest as any).got)}`
  );

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
    console.error('集成测试运行异常:', err);
    process.exit(1);
  } finally {
    await stopServer();
  }
})();