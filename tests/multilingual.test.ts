/**
 * #12 多语言 UI E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 默认中文：TabBar 显示「拾微」
 *   2. 进 Settings 切换英文
 *   3. 回首页：TabBar 显示「Gleanings」、不含「拾微」
 *   4. 切回中文：TabBar 恢复「拾微」
 *
 * 运行：npx tsx tests/multilingual.test.ts
 * 使用 vite dev 服务器（无需预先 build），退出码 0/1 反映结果。
 */
import puppeteer, { type Browser } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4175';
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

/** 读取首个 TabBar nav 的文本（含所有 Tab label）。 */
async function getTabText(page: import('puppeteer').Page): Promise<string> {
  return page.$eval('nav', (el) => el.textContent || '');
}

async function main() {
  serverProc = spawn('npx', ['vite', '--port', '4175', '--strictPort'], {
    cwd: 'D:/baimiaobiji',
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: 'new' });
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // ---------- 1. 默认中文：Tab「拾微」 ----------
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800)); // 等 i18n 订阅稳定
  const tabZh = await getTabText(page);
  assert('1 默认中文 Tab 含拾微', tabZh.includes('拾微'), `tabText=${tabZh.replace(/\s+/g, ' ').slice(0, 60)}`);

  // ---------- 2. 进 Settings 切英文 ----------
  await page.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="language-en"]', { timeout: 15000 });
  await page.click('[data-testid="language-en"]');
  await new Promise((r) => setTimeout(r, 600)); // 等 store 更新 + 持久化 + UI 重渲染

  // ---------- 3. 回首页验证英文 ----------
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  const tabEn = await getTabText(page);
  assert('2 英文 Tab 含 Gleanings', tabEn.includes('Gleanings'), `tabText=${tabEn.replace(/\s+/g, ' ').slice(0, 60)}`);
  assert('3 英文 Tab 不含拾微', !tabEn.includes('拾微'), `含拾微=${tabEn.includes('拾微')}`);

  // ---------- 4. 切回中文 ----------
  await page.goto(BASE_URL + '/settings', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="language-zh"]', { timeout: 15000 });
  await page.click('[data-testid="language-zh"]');
  await new Promise((r) => setTimeout(r, 600));

  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('nav', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 800));
  const tabZh2 = await getTabText(page);
  assert('4 切回中文 Tab 含拾微', tabZh2.includes('拾微'), `tabText=${tabZh2.replace(/\s+/g, ' ').slice(0, 60)}`);

  // ---------- 结果 ----------
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} 通过`);

  await browser.close();
  browser = null;
  if (serverProc) {
    serverProc.kill();
    serverProc = null;
  }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (e) => {
  console.error('测试出错:', e);
  if (browser) await browser.close();
  if (serverProc) serverProc.kill();
  process.exit(1);
});
