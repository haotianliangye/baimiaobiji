/**
 * Desktop width sanity test — measure the actual rendered box width of
 * Review/Thoughts/Insights cards against the wrapper width on desktop.
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4181';
let serverProc: ChildProcess | null = null;
let browser: Browser | null = null;

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

async function seedOneThoughtAndOneInsight(page: Page) {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('thoughts') || !idb.objectStoreNames.contains('insights')) {
            idb.close();
            return reject(new Error('missing stores'));
          }
          const tx = idb.transaction(['thoughts', 'insights'], 'readwrite');
          const now = Date.now();
          tx.objectStore('thoughts').put({
            id: 'width-test-thought-1',
            content: '# 一段沉淀\n\n这是一段用于宽度测试的沉淀内容，用于观察卡片是否与右边的洞察卡片宽度一致。',
            tags: [],
            created_at: now,
            original_created_at: now,
            attachments: [],
          });
          tx.objectStore('insights').put({
            id: 'width-test-insight-1',
            insight_type: 'insight',
            content: '# 洞察摘要\n\n这是一段洞察正文，用于观察卡片宽度。',
            ai_summary: '这是一段洞察摘要',
            range_type: 'week',
            range_label: '本周',
            start_date: '2026-07-20',
            end_date: '2026-07-26',
            created_at: now,
            tags: [],
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    'whitewash_diary'
  );
}

async function measureOnPage(page: Page) {
  return page.evaluate(() => {
    const result: Record<string, { w: number; l: number; r: number; tag: string }> = {};
    result.viewport = { w: window.innerWidth, l: 0, r: window.innerWidth, tag: 'viewport' };
    const main = document.querySelector('main');
    result.main = main
      ? { w: main.getBoundingClientRect().width, l: main.getBoundingClientRect().left, r: main.getBoundingClientRect().right, tag: 'main' }
      : { w: 0, l: 0, r: 0, tag: 'main' };

    const insightCardList = document.querySelector('[data-testid="mingwu-card-list"]');
    if (insightCardList) {
      const r = insightCardList.getBoundingClientRect();
      result.insightList = { w: r.width, l: r.left, r: r.right, tag: insightCardList.tagName.toLowerCase() };
    }
    const insightCard = document.querySelector('[data-testid="insight-card"]');
    if (insightCard) {
      const r = insightCard.getBoundingClientRect();
      result.insightCard = { w: r.width, l: r.left, r: r.right, tag: 'insight-card' };
    }
    const thoughtCard = document.querySelector('[data-testid="thought-card"]');
    if (thoughtCard) {
      const r = thoughtCard.getBoundingClientRect();
      result.thoughtCard = { w: r.width, l: r.left, r: r.right, tag: 'thought-card' };
    }
    const reviewCard = document.querySelector('[data-testid="review-card"]');
    if (reviewCard) {
      const r = reviewCard.getBoundingClientRect();
      result.reviewCard = { w: r.width, l: r.left, r: r.right, tag: 'review-card' };
    }
    return result;
  });
}

async function run() {
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4181', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  // desktop viewport
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });

  // ---- Insights ----
  await page.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await seedOneThoughtAndOneInsight(page);
  await page.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const insight = await measureOnPage(page);
  console.log('INSIGHT', JSON.stringify(insight));

  // ---- Thoughts ----
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const thought = await measureOnPage(page);
  console.log('THOUGHT', JSON.stringify(thought));

  // ---- Review ----
  await page.goto(`${BASE_URL}/review`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 600));
  const review = await measureOnPage(page);
  console.log('REVIEW', JSON.stringify(review));

  await page.close();
  await ctx.close();
}

run()
  .catch((err) => console.error(err))
  .finally(async () => {
    if (browser) await browser.close();
    if (serverProc) serverProc.kill();
  });