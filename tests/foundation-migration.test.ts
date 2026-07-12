/**
 * #3 Foundation E2E 测试（Puppeteer）
 *
 * 覆盖三个旅程：
 *   A. 导航：底部 4 Tab 为「碎屑/回顾/沉思/明悟」；/diary 重定向到 /review、/insights 重定向到 /mingwu。
 *   B. 迁移：构造旧版 v7 IndexedDB（daily_diaries + insights + daily_reviews），启动应用触发 v8 升级，
 *      验证数据迁移到 daily_reviews(entry_type) / mingwu、旧表删除、migration_backups 写入。
 *   C. 回顾合并：迁移后 /review 同列展示「日记」与「回顾」卡片。
 *
 * 运行：先 `npm run build`，再 `npm run test:e2e`。
 * 通过退出码 0/1 反映结果，便于 CI。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4173';
const DB_NAME = 'whitewash_diary';

let serverProc: ChildProcess | null = null;
let browser: Browser | null = null;

const results: { name: string; pass: boolean; detail: string }[] = [];

function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} — ${detail}`);
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

/**
 * 构造一个「旧版 v7」的 whitewash_diary 库。Dexie v4 把 schema 版本 × 10 作为原生 IDB 版本
 * （见 dexie 源码 `Math.round(db.verno * 10)`），所以 schema 7 对应 IDB version 70。
 * 在 version 70 上创建 v7 累积 schema 的五张表（含索引），并写入样本数据。
 * Dexie 打开时读取 IDB version=70 -> 识别为 schema 7 -> 触发 v8 升级。
 */
async function seedV7Db(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, 70);
        req.onupgradeneeded = (e: any) => {
          const idb = e.target.result;
          // 只建表（keyPath=id）。Dexie 靠 IDB 版本号识别 schema 版本，索引非必需。
          for (const store of ['raw_logs', 'daily_diaries', 'daily_reviews', 'insights', 'copilot_conversations']) {
            if (!idb.objectStoreNames.contains(store)) idb.createObjectStore(store, { keyPath: 'id' });
          }
        };
        req.onsuccess = async (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(['daily_diaries', 'insights', 'daily_reviews'], 'readwrite');
          tx.objectStore('daily_diaries').put({
            id: 'd1',
            diary_date: '2026-07-10',
            raw_log_ids: [],
            timeline_json: '[]',
            ai_editorial: '# 日记正文内容',
            ai_summary: '日记摘要',
            ai_review: '',
            updated_at: 1739000000000,
            prompt_index: 0,
            prompt_name: '默认',
          });
          tx.objectStore('insights').put({
            id: 'i1',
            range_type: 'week',
            range_label: '本周',
            start_date: '2026-07-06',
            end_date: '2026-07-12',
            content: '洞察正文内容',
            ai_summary: '洞察摘要',
            created_at: 1739000000000,
          });
          tx.objectStore('daily_reviews').put({
            id: 'r1',
            review_date: '2026-07-10',
            raw_log_ids: [],
            ai_review: '回顾正文内容',
            ai_summary: '回顾摘要',
            review_prompt_index: 0,
            review_prompt_name: '默认',
            updated_at: 1739000000000,
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    DB_NAME
  );
}

/** 读取某 object store 的全部记录；表不存在返回 null。 */
async function readStore(page: Page, store: string): Promise<any[] | null> {
  return page.evaluate(
    (args: { name: string; store: string }) =>
      new Promise<any[] | null>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains(args.store)) {
            idb.close();
            return resolve(null);
          }
          const tx = idb.transaction(args.store, 'readonly');
          const allReq = tx.objectStore(args.store).getAll();
          allReq.onsuccess = () => {
            idb.close();
            resolve(allReq.result);
          };
          allReq.onerror = () => {
            idb.close();
            reject(allReq.error);
          };
        };
        req.onerror = () => reject(req.error);
      }),
    { name: DB_NAME, store }
  );
}

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ---------- 旅程 A：导航 ----------
  const pageA = await browser.newPage();
  await pageA.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  // 底部主导航 Tab 文案
  const tabLabels = await pageA.$$eval('nav button, nav a', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter(Boolean)
  );
  const navText = tabLabels.join('|');
  assert(
    'A1 底部导航 4 Tab',
    ['碎屑', '回顾', '沉思', '明悟'].every((t) => navText.includes(t)) && !navText.includes('日记'),
    `nav=${navText}`
  );
  // /diary -> /review 重定向
  await pageA.goto(`${BASE_URL}/diary`, { waitUntil: 'networkidle2' });
  assert('A2 /diary 重定向到 /review', pageA.url().includes('/review'), `url=${pageA.url()}`);
  // /insights -> /mingwu 重定向
  await pageA.goto(`${BASE_URL}/insights`, { waitUntil: 'networkidle2' });
  assert('A3 /insights 重定向到 /mingwu', pageA.url().includes('/mingwu'), `url=${pageA.url()}`);
  // 沉思占位页可达
  await pageA.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  const thoughtsText = await pageA.evaluate(() => document.body.textContent || '');
  assert('A4 沉思占位页可达', thoughtsText.includes('沉思'), `body含沉思=${thoughtsText.includes('沉思')}`);
  await pageA.close();

  // ---------- 旅程 B：迁移 ----------
  // 用独立的浏览器上下文（与导航测试隔离的全新存储），避免旧 v8 库/SW 干扰。
  // 用请求拦截阻止应用脚本执行，从而不打开 Dexie 连接；在同源页面上播种 v7 旧库。
  const ctx = await browser.createBrowserContext();
  const pageB = await ctx.newPage();
  await pageB.setRequestInterception(true);
  let blockScripts = true;
  pageB.on('request', (req) => {
    if (blockScripts && req.resourceType() === 'script') {
      req.abort();
    } else {
      req.continue();
    }
  });
  // 首次加载：HTML 可加载但脚本被拦截 -> 应用未运行 -> 无 DB 连接
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await seedV7Db(pageB);
  // 解除拦截并重新加载 -> 应用 JS 运行，Dexie 识别 v7 旧库触发 v8 升级
  blockScripts = false;
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const reviews = await readStore(pageB, 'daily_reviews');
  const mingwu = await readStore(pageB, 'mingwu');
  const backup = await readStore(pageB, 'migration_backups');
  const oldDiaries = await readStore(pageB, 'daily_diaries');
  const oldInsights = await readStore(pageB, 'insights');

  // daily_reviews 应含迁移后的日记（entry_type='diary', ai_editorial）与回顾（entry_type='review'）
  const migratedDiary = reviews?.find((r) => r.id === 'd1');
  const migratedReview = reviews?.find((r) => r.id === 'r1');
  assert(
    'B1 日记迁移到 daily_reviews(entry_type=diary)',
    !!migratedDiary && migratedDiary.entry_type === 'diary' && migratedDiary.ai_editorial === '# 日记正文内容' && migratedDiary.review_date === '2026-07-10',
    migratedDiary ? `entry_type=${migratedDiary.entry_type}` : '未找到 d1'
  );
  assert(
    'B2 旧回顾补 entry_type=review',
    !!migratedReview && migratedReview.entry_type === 'review',
    migratedReview ? `entry_type=${migratedReview.entry_type}` : '未找到 r1'
  );
  // insights -> mingwu
  const migratedInsight = mingwu?.find((m) => m.id === 'i1');
  assert(
    'B3 insights 迁移到 mingwu',
    !!migratedInsight && migratedInsight.mingwu_type === 'insight' && migratedInsight.content === '洞察正文内容',
    migratedInsight ? `mingwu_type=${migratedInsight.mingwu_type}` : '未找到 i1'
  );
  // 旧表删除
  assert('B4 旧 daily_diaries 表已删除', oldDiaries === null, `daily_diaries=${oldDiaries}`);
  assert('B5 旧 insights 表已删除', oldInsights === null, `insights=${oldInsights}`);
  // 迁移备份写入
  const v8Backup = backup?.find((b) => b.key === 'v8');
  assert('B6 migration_backups 写入 v8 快照', !!v8Backup && !!v8Backup.payload, v8Backup ? '有 payload' : '无备份');

  // ---------- 旅程 C：回顾合并 ----------
  await pageB.goto(`${BASE_URL}/review?date=2026-07-10`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const reviewPageText = await pageB.evaluate(() => document.body.textContent || '');
  // 日记卡片与回顾卡片同列展示。折叠卡片只在 header 显示 ai_summary，
  // 故用摘要（日记摘要 / 回顾摘要）与 entryType 标签判断两卡共存。
  assert(
    'C1 回顾页同时展示日记与回顾卡片',
    reviewPageText.includes('日记') &&
      reviewPageText.includes('回顾') &&
      reviewPageText.includes('日记摘要') &&
      reviewPageText.includes('回顾摘要'),
    `含日记摘要=${reviewPageText.includes('日记摘要')}, 含回顾摘要=${reviewPageText.includes('回顾摘要')}`
  );

  await pageB.close();
  await ctx.close();
}

run()
  .catch((err) => {
    console.error('E2E 运行异常:', err);
    results.push({ name: '运行异常', pass: false, detail: String(err) });
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (serverProc) serverProc.kill();
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} 通过`);
    process.exit(failed.length === 0 ? 0 : 1);
  });
