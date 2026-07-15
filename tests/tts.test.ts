/**
 * #10 TTS 朗读 E2E 测试（Puppeteer）
 *
 * 旅程：
 *   A. 回顾 AI 输出朗读：mock window.speechSynthesis -> 回顾卡片有播放按钮 ->
 *      点击调用 speechSynthesis.speak -> 再次点击停止（cancel 被调用）。
 *   B. 设置切换 TTS 服务：从 Web Speech 切换到外部 API。
 *   C. 拾微与沉淀无朗读按钮：Record(/) 与 Thoughts(/thoughts) 页面均不出现 TTS 按钮。
 *
 * 运行：先 `npm run build`，再 `tsx tests/tts.test.ts`。
 * 通过退出码 0/1 反映结果，便于 CI。
 *
 * 注：使用独立浏览器上下文 + page.evaluate 注入 speechSynthesis mock，
 * 避免与其它 E2E 的 IndexedDB / vite 端口冲突。端口 4176 与其它测试错开。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4176';
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

/** 计算今天的 yyyy-MM-dd 日期字符串 */
function todayStr(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * 向已存在的 whitewash_diary 库插入一条 daily_reviews 样本数据（今日回顾）。
 */
async function seedReview(page: Page, dateStr: string) {
  await page.evaluate(
    (args: { name: string; date: string }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(['daily_reviews'], 'readwrite');
          tx.objectStore('daily_reviews').put({
            id: 'test-review-tts-1',
            review_date: args.date,
            raw_log_ids: [],
            ai_review: '这是回顾正文内容，用于测试 TTS 朗读功能。今天完成了一些重要任务，包括阅读和运动。',
            ai_summary: '回顾摘要',
            ai_editorial: '',
            entry_type: 'review',
            prompt_index: 1,
            prompt_name: '回顾',
            updated_at: Date.now(),
            tags: [],
            chat_history: [],
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { name: DB_NAME, date: dateStr }
  );
}

/**
 * 在页面加载后注入 window.speechSynthesis 与 SpeechSynthesisUtterance 的 mock，
 * 并在 window.__ttsMockState 上追踪 speak / cancel 调用。
 *
 * 必须在 page.goto 之后调用（而非 evaluateOnNewDocument）：Chrome 会在
 * evaluateOnNewDocument 脚本执行之后才初始化原生 speechSynthesis，覆盖掉 mock。
 * 在导航完成后用 Object.defineProperty 覆盖原生属性才能生效。
 * 同时定义 __name 为 no-op，避免 tsx 编译 class/function 时注入的 __name
 * 调用在浏览器上下文抛 ReferenceError。
 */
async function installTtsMock(page: Page) {
  await page.evaluate(() => {
    // tsx 编译 named class/function 时注入 __name(cls, "name")，浏览器无此 helper
    (window as any).__name = (cls: any) => cls;

    const state = {
      speakCalls: [] as string[],
      cancelCalls: 0,
    };
    (window as any).__ttsMockState = state;

    const mockSynth = {
      speak: function (u: any) { state.speakCalls.push(u?.text || ''); },
      cancel: function () { state.cancelCalls++; },
      getVoices: function () { return []; },
      pending: false,
      speaking: false,
      paused: false,
      onvoiceschanged: null,
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return false; },
      resume: function () {},
      pause: function () {},
    };

    Object.defineProperty(window, 'speechSynthesis', {
      value: mockSynth,
      configurable: true,
      writable: true,
    });

    function MockUtterance(this: any, text: string) {
      this.text = text;
      this.lang = '';
      this.rate = 1;
      this.voice = null;
      this.onend = null;
      this.onerror = null;
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', {
      value: MockUtterance,
      configurable: true,
      writable: true,
    });
  });
}

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4176', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // 独立浏览器上下文（隔离的存储），避免其它 E2E 的库干扰
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  const dateStr = todayStr();

  // ---------- 旅程 A：回顾 AI 输出朗读 ----------
  // 首次加载 -> 应用创建 DB -> 插入样本数据 -> 重新加载使 useLiveQuery 生效
  await page.goto(`${BASE_URL}/review`, { waitUntil: 'networkidle2' });
  await seedReview(page, dateStr);
  await page.goto(`${BASE_URL}/review`, { waitUntil: 'networkidle2' });
  // 在页面加载完成后注入 speechSynthesis mock（导航前注入会被原生 API 覆盖）
  await installTtsMock(page);
  await new Promise((r) => setTimeout(r, 1200));

  // 等待回顾卡片自动展开并渲染播放按钮
  await page.waitForSelector('[data-testid="review-tts-btn"]', { timeout: 15000 });

  // A1: 点击播放按钮 -> speechSynthesis.speak 被调用
  await page.click('[data-testid="review-tts-btn"]');
  await new Promise((r) => setTimeout(r, 400));
  const state1 = await page.evaluate(() => (window as any).__ttsMockState);
  assert(
    'A1 点击播放按钮调用 speechSynthesis.speak',
    state1.speakCalls.length >= 1,
    `speakCalls=${state1.speakCalls.length}, first=${state1.speakCalls[0]?.slice(0, 30) || ''}...`
  );
  // 验证朗读内容包含回顾正文（stripMarkdown 后）
  assert(
    'A2 speak 文本含回顾正文内容',
    state1.speakCalls.some((t: string) => t.includes('回顾正文内容')),
    `speak texts=${JSON.stringify(state1.speakCalls.map((t: string) => t.slice(0, 20)))}`
  );

  // A3: 再次点击 -> 停止（cancel 被调用）
  const cancelBefore = state1.cancelCalls;
  await page.click('[data-testid="review-tts-btn"]');
  await new Promise((r) => setTimeout(r, 400));
  const state2 = await page.evaluate(() => (window as any).__ttsMockState);
  assert(
    'A3 再次点击调用 speechSynthesis.cancel 停止朗读',
    state2.cancelCalls > cancelBefore,
    `cancel before=${cancelBefore}, after=${state2.cancelCalls}`
  );

  // ---------- 旅程 B：设置切换 TTS 服务 ----------
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="tts-config-section"]', { timeout: 10000 });

  // B1: 点击「外部 TTS API」按钮
  await page.click('[data-testid="tts-service-external"]');
  await new Promise((r) => setTimeout(r, 400));
  const externalActive = await page.$eval(
    '[data-testid="tts-service-external"]',
    (el) => (el as HTMLElement).className.includes('from-baimiao-mysteria')
  );
  assert(
    'B1 设置切换 TTS 服务为外部 API',
    externalActive,
    `external button active=${externalActive}`
  );

  // B2: Web Speech 按钮应变为非选中态
  const webspeechActive = await page.$eval(
    '[data-testid="tts-service-webspeech"]',
    (el) => (el as HTMLElement).className.includes('from-baimiao-mysteria')
  );
  assert(
    'B2 Web Speech 按钮变为非选中',
    !webspeechActive,
    `webspeech button active=${webspeechActive}`
  );

  // ---------- 旅程 C：拾微与沉淀无朗读按钮 ----------
  // C1: 拾微页（/）无 TTS 按钮
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const ttsOnRecord = await page.$$eval('[data-testid*="tts"]', (els) => els.length);
  assert(
    'C1 拾微页无朗读按钮',
    ttsOnRecord === 0,
    `tts elements on record page=${ttsOnRecord}`
  );

  // C2: 沉淀页（/thoughts）无 TTS 按钮
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const ttsOnThoughts = await page.$$eval('[data-testid*="tts"]', (els) => els.length);
  assert(
    'C2 沉淀页无朗读按钮',
    ttsOnThoughts === 0,
    `tts elements on thoughts page=${ttsOnThoughts}`
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
