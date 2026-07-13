/**
 * #11 随机漫步（RandomWalk）E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 沉思页右上角灯泡入口 -> 打开随机漫步 -> 展示 3 条卡片。
 *   2. 滑动/下一张浏览卡片堆叠。
 *   3. 去重过滤：换一批后已展示记录被冷却期过滤 -> 空态；重置历史后恢复。
 *   4. 已阅后不再出现：冷却期设为 0 隔离已阅效果 -> 已阅卡片不再出现。
 *   5. 复制：复制当前卡片正文 -> 剪贴板内容一致。
 *   6. 删除：删除当前卡片 -> IndexedDB 对应记录消失。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/random-walk.test.ts`。
 * 通过退出码 0/1 反映结果。E2E 由验证代理统一串行执行（避免 vite 端口冲突）。
 *
 * 参考 tests/foundation-migration.test.ts / tests/thoughts.test.ts：
 * 独立 browser.createBrowserContext 隔离存储、data-testid 定位、直接读 IndexedDB 校验。
 * 数据通过应用 UI 创建（走 Dexie 建表 + thoughts.store），保证可预测且集成真实路径。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

// 用 4175 端口，与 foundation-migration(4173) / thoughts(4174) 区分，避免串行执行端口占用。
const BASE_URL = 'http://localhost:4175';
const DB_NAME = 'whitewash_diary';

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

/** 取当前激活卡片（data-active="true"）的正文文本。 */
async function getActiveCardContent(page: Page): Promise<string> {
  return page.evaluate(() => {
    const card = document.querySelector('[data-testid="walk-card"][data-active="true"]');
    const el = card?.querySelector('[data-testid="walk-card-content"]');
    return el ? (el.textContent || '').trim() : '';
  });
}

/** 取所有可见卡片的正文文本数组。 */
async function getAllCardContents(page: Page): Promise<string[]> {
  return page.$$eval('[data-testid="walk-card"] [data-testid="walk-card-content"]', (els) =>
    els.map((e) => (e.textContent || '').trim())
  );
}

/** 等待可见卡片数量等于 n。 */
async function waitForCardCount(page: Page, n: number, timeout = 5000) {
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid="walk-card"]').length === count,
    { timeout },
    n
  );
}

/** 通过应用 UI 创建一条沉思笔记（走 RichEditor + thoughts.store）。 */
async function createThought(page: Page, content: string, expectedCount: number) {
  await page.click('[data-testid="thought-quick-input"]');
  await page.waitForSelector('[data-testid="thought-create-textarea"]', { timeout: 5000 });
  // 用原生 setter 写入中文内容（比 page.type 的逐字 keydown 更可靠，规避 IME 问题）
  await page.$eval(
    '[data-testid="thought-create-textarea"]',
    (el: any, val: string) => {
      const ta = el as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(ta, val);
      else ta.value = val;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    content
  );
  await page.click('[data-testid="thought-create-save"]');
  // 等待卡片数量达到预期（确认本次创建已落库渲染）
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-testid="thought-card"]').length >= n,
    { timeout: 5000 },
    expectedCount
  );
  await new Promise((r) => setTimeout(r, 300));
}

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4175', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // 独立浏览器上下文（全新存储），授予剪贴板权限以便校验复制
  const ctx = await browser.createBrowserContext();
  await ctx.overridePermissions(BASE_URL, ['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // 自动接受原生 confirm()（删除时弹出）
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  // 导航到沉思页
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="thought-quick-input"]', { timeout: 15000 });

  // ---------- 准备：创建 3 条沉思笔记（内容确定，便于断言） ----------
  const NOTE_A = '随机漫步测试内容甲';
  const NOTE_B = '随机漫步测试内容乙';
  const NOTE_C = '随机漫步测试内容丙';
  await createThought(page, NOTE_A, 1);
  await createThought(page, NOTE_B, 2);
  await createThought(page, NOTE_C, 3);

  // ---------- 1. 灯泡入口 -> 展示 3 条 ----------
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  // 首次抽取：3 条全部可漫步（无展示历史），等待 3 张卡片
  await waitForCardCount(page, 3);
  const cardCountInitial = await page.$$eval(
    '[data-testid="walk-card"]',
    (els) => els.length
  );
  assert('1 随机漫步展示 3 条卡片', cardCountInitial === 3, `卡片数=${cardCountInitial}`);

  // ---------- 2. 滑动/下一张浏览 ----------
  const firstContent = await getActiveCardContent(page);
  await page.click('[data-testid="walk-next"]');
  await new Promise((r) => setTimeout(r, 350)); // 等待切换动画
  const secondContent = await getActiveCardContent(page);
  assert(
    '2a 下一张切换到不同卡片',
    secondContent.length > 0 && secondContent !== firstContent,
    `首=${firstContent.slice(0, 8)}, 次=${secondContent.slice(0, 8)}`
  );

  // 再下一张到第 3 张
  await page.click('[data-testid="walk-next"]');
  await new Promise((r) => setTimeout(r, 350));
  const thirdContent = await getActiveCardContent(page);
  assert(
    '2b 浏览到第 3 张',
    thirdContent.length > 0 &&
      thirdContent !== firstContent &&
      thirdContent !== secondContent,
    `第3张=${thirdContent.slice(0, 8)}`
  );

  // ---------- 3. 去重过滤：换一批 -> 冷却期内已展示 -> 空态 ----------
  // 默认冷却期 7 天：3 条都已展示 -> 全部被过滤 -> 无可漫步记录
  await page.click('[data-testid="walk-shuffle"]');
  await page.waitForSelector('[data-testid="walk-empty"]', { timeout: 5000 });
  const emptyVisible = await page.$('[data-testid="walk-empty"]');
  assert('3a 换一批后冷却期去重 -> 空态', !!emptyVisible, emptyVisible ? '空态已展示' : '未出现空态');

  // 重置历史 -> 清空展示记录 -> 重新可漫步
  await page.click('[data-testid="walk-reset"]');
  await waitForCardCount(page, 3);
  const afterResetCount = await page.$$eval('[data-testid="walk-card"]', (els) => els.length);
  assert('3b 重置历史后恢复 3 条', afterResetCount === 3, `卡片数=${afterResetCount}`);

  // ---------- 4. 已阅后不再出现（冷却期设 0 隔离已阅效果） ----------
  // 打开设置面板，把冷却期改为 0（已展示记录不再被冷却期过滤，仅已阅永久排除）
  await page.click('[data-testid="walk-settings"]');
  await page.waitForSelector('[data-testid="walk-cooldown-input"]', { timeout: 3000 });
  await page.$eval(
    '[data-testid="walk-cooldown-input"]',
    (el: any, val: string) => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      if (setter) setter.call(input, val);
      else input.value = val;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    '0'
  );
  // 收起设置面板
  await page.click('[data-testid="walk-settings"]');
  await new Promise((r) => setTimeout(r, 200));

  // 换一批（冷却期 0：已展示记录重新可抽取）
  await page.click('[data-testid="walk-shuffle"]');
  await waitForCardCount(page, 3);

  // 记下当前激活卡片内容 C1，点击「已阅」
  const c1 = await getActiveCardContent(page);
  assert('4a 已阅前捕获激活卡片内容', c1.length > 0, `C1=${c1.slice(0, 8)}`);
  await page.click('[data-testid="walk-read"]');
  await new Promise((r) => setTimeout(r, 300));

  // 换一批：C1 已阅 -> 永久排除；其余 2 条冷却期 0 仍可抽取 -> 2 张卡片
  await page.click('[data-testid="walk-shuffle"]');
  await waitForCardCount(page, 2);
  const contentsAfterRead = await getAllCardContents(page);
  const c1Absent = !contentsAfterRead.some((c) => c === c1);
  assert(
    '4b 已阅后不再出现',
    c1Absent && contentsAfterRead.length === 2,
    `C1缺席=${c1Absent}, 卡片数=${contentsAfterRead.length}`
  );

  // ---------- 5. 复制 ----------
  const c2 = await getActiveCardContent(page);
  assert('5a 复制前捕获激活卡片内容', c2.length > 0, `C2=${c2.slice(0, 8)}`);
  // headless Chrome 即便授予 clipboard-write 权限，navigator.clipboard.writeText 仍抛
  // NotAllowedError（无真实系统剪贴板/用户激活）。mock 为成功 resolve 并把文本存到
  // window.__copiedText 供断言。useCopyToClipboard 在真实浏览器走标准 clipboard API，
  // 此处仅验证按钮接线（点击 -> copy(rawText) -> copied 反馈）。
  await page.evaluate(() => {
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true, writable: true });
    }
    (navigator.clipboard as any).writeText = (text: string) => {
      (window as any).__copiedText = text;
      return Promise.resolve();
    };
  });
  await page.click('[data-testid="walk-copy"]');
  // 等待复制成功态（按钮文案变为「已复制」）
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="walk-copy"]');
      return !!btn && (btn.textContent || '').includes('已复制');
    },
    { timeout: 3000 }
  );
  // 校验 mock 捕获的文本与卡片正文一致
  const clipText = await page.evaluate(() => (window as any).__copiedText || '');
  assert(
    '5b 复制内容与卡片正文一致',
    clipText.trim() === c2.trim(),
    `clipboard="${clipText.slice(0, 12)}", card="${c2.slice(0, 12)}"`
  );

  // ---------- 6. 删除 ----------
  // 删除前 DB 中应有 3 条 thoughts
  const thoughtsBefore = await readStore(page, 'thoughts');
  const beforeCount = thoughtsBefore ? thoughtsBefore.length : 0;
  await page.click('[data-testid="walk-delete"]');
  // 删除后激活卡片切换（confirm 已自动接受），等待 DB 变化
  await new Promise((r) => setTimeout(r, 600));
  const thoughtsAfter = await readStore(page, 'thoughts');
  const afterCount = thoughtsAfter ? thoughtsAfter.length : 0;
  const c2StillInDb = thoughtsAfter ? thoughtsAfter.some((t) => (t.content || '').trim() === c2.trim()) : true;
  assert(
    '6a 删除后 IndexedDB 记录消失',
    afterCount === beforeCount - 1 && !c2StillInDb,
    `删除前=${beforeCount}, 删除后=${afterCount}, C2仍在DB=${c2StillInDb}`
  );
  // 删除后仍有卡片（剩余 1 张）或可继续浏览
  const remainingCards = await page.$$eval('[data-testid="walk-card"]', (els) => els.length);
  assert(
    '6b 删除后剩余卡片切换',
    remainingCards >= 1,
    `剩余卡片数=${remainingCards}`
  );

  // 关闭随机漫步
  await page.click('[data-testid="walk-close"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="random-walk-overlay"]'),
    { timeout: 3000 }
  );

  await page.close();
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
