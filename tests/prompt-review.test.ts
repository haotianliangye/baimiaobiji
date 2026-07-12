/**
 * #5 Prompt 配置重构与回顾合并 E2E 测试（Puppeteer）
 *
 * 覆盖三个旅程：
 *   A. 多选边界：在生成面板取消最后一个 Prompt，验证无法取消。
 *   B. 多选生成：选中「日记 + 自定义1(知识)」，生成后验证出现两篇独立卡片，sub-header 显示对应名称。
 *   C. 自动队列：仅选中「日记」时，扫描补全只补日记索引，不补回顾。
 *
 * 运行：先 `npm run build`，再 `npm run test:e2e`。
 * 通过退出码 0/1 反映结果，便于 CI。
 *
 * 测试避免真实 LLM 调用：通过 request 拦截 mock /api/generate-timeline 和 /api/generate-review
 * 的响应，返回可预测的 Mock 内容。
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
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} - ${detail}`);
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
 * Mock API 响应拦截器：拦截 /api/generate-timeline 和 /api/generate-review，
 * 返回可预测的 Mock 内容，避免真实 LLM 调用。
 */
function setupApiMock(page: Page) {
  let timelineCallCount = 0;
  let reviewCallCount = 0;

  page.on('request', (req) => {
    const url = req.url();
    if (req.method() === 'POST' && url.includes('/api/generate-timeline')) {
      timelineCallCount++;
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ai_editorial: `# Mock 日记内容 #${timelineCallCount}`,
          ai_review: '',
          ai_summary: `Mock 日记摘要 #${timelineCallCount}`,
        }),
      });
    } else if (req.method() === 'POST' && url.includes('/api/generate-review')) {
      reviewCallCount++;
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ai_review: `# Mock 回顾内容 #${reviewCallCount}`,
          ai_summary: `Mock 回顾摘要 #${reviewCallCount}`,
        }),
      });
    } else {
      // 非 API 请求必须放行，否则 setRequestInterception 会使其永久挂起
      req.continue();
    }
  });

  return {
    getTimelineCount: () => timelineCallCount,
    getReviewCount: () => reviewCallCount,
    reset: () => { timelineCallCount = 0; reviewCallCount = 0; },
  };
}

/**
 * 在 IndexedDB 的 raw_logs 表中插入一条碎屑记录（当天）。
 */
async function seedRawLog(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('raw_logs')) {
            idb.close();
            return resolve();
          }
          const tx = idb.transaction('raw_logs', 'readwrite');
          tx.objectStore('raw_logs').put({
            id: 'test-log-1',
            content: '测试碎屑内容',
            created_at: Date.now(),
            audioBlob: undefined,
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

/** 清空 IndexedDB 和 localStorage */
async function clearStorage(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }),
    DB_NAME
  );
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
}

async function run() {
  // 1. 启动 vite preview
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ---------- 旅程 A：多选边界 ----------
  const ctxA = await browser.createBrowserContext();
  const pageA = await ctxA.newPage();
  await pageA.setRequestInterception(true);
  const mockA = setupApiMock(pageA);

  // 首次加载让应用初始化 DB
  await pageA.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await clearStorage(pageA);
  // 重新加载让应用以干净状态初始化
  await pageA.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // 插入一条碎屑
  await seedRawLog(pageA);

  // 导航到回顾页
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  await pageA.goto(`${BASE_URL}/review?date=${dateStr}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // 点击「AI 智能整理」按钮打开浮层
  const generateBtn = await pageA.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent && b.textContent.includes('AI 智能整理'));
  });
  if (generateBtn) {
    await (generateBtn as any).click();
    await new Promise((r) => setTimeout(r, 500));
  }

  // 验证浮层已打开 - 应包含「选择生成模板」文字
  const popoverText = await pageA.evaluate(() => document.body.textContent || '');
  assert(
    'A1 多选浮层已打开',
    popoverText.includes('选择生成模板'),
    `浮层文本包含「选择生成模板」=${popoverText.includes('选择生成模板')}`
  );

  // 验证默认选中「日记 + 回顾」（2 篇）
  assert(
    'A2 默认选中日记+回顾（生成 2 篇）',
    popoverText.includes('生成 2 篇回顾'),
    `文本包含「生成 2 篇回顾」=${popoverText.includes('生成 2 篇回顾')}`
  );

  // 尝试取消所有选中项 - 先取消日记，再取消回顾，验证回顾不可取消
  // 点击 slot 0（日记）取消选中
  const slot0 = await pageA.$('[data-testid="prompt-slot-0"]');
  if (slot0) {
    await slot0.click();
    await new Promise((r) => setTimeout(r, 300));
  }

  // 现在应该只剩回顾选中（生成 1 篇）
  const afterUncheck1 = await pageA.evaluate(() => document.body.textContent || '');
  assert(
    'A3 取消日记后只剩回顾（生成 1 篇）',
    afterUncheck1.includes('生成 1 篇回顾'),
    `文本包含「生成 1 篇回顾」=${afterUncheck1.includes('生成 1 篇回顾')}`
  );

  // 尝试取消回顾（最后一项）- 应该不可取消
  const slot1 = await pageA.$('[data-testid="prompt-slot-1"]');
  if (slot1) {
    await slot1.click();
    await new Promise((r) => setTimeout(r, 300));
  }

  // 回顾应该仍然选中（生成 1 篇），因为至少保留一项
  const afterUncheck2 = await pageA.evaluate(() => document.body.textContent || '');
  assert(
    'A4 取消最后一项不可取消（仍生成 1 篇）',
    afterUncheck2.includes('生成 1 篇回顾'),
    `文本仍包含「生成 1 篇回顾」=${afterUncheck2.includes('生成 1 篇回顾')}`
  );

  await pageA.close();
  await ctxA.close();

  // ---------- 旅程 B：多选生成 ----------
  const ctxB = await browser.createBrowserContext();
  const pageB = await ctxB.newPage();
  await pageB.setRequestInterception(true);
  const mockB = setupApiMock(pageB);

  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await clearStorage(pageB);
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // 插入碎屑
  await seedRawLog(pageB);

  // 先进入设置页，配置自定义 1 名称为「知识」并填入内容
  await pageB.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));

  // 点击「提示词配置」tab
  const promptTab = await pageB.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent && b.textContent.includes('提示词配置'));
  });
  if (promptTab) {
    await (promptTab as any).click();
    await new Promise((r) => setTimeout(r, 500));
  }

  // 点击「自定义 1」tab（第 3 个 tab 按钮，index=2）
  const customTabs = await pageB.$$eval('button', (btns) =>
    btns
      .map((b, i) => ({ text: b.textContent || '', index: i }))
      .filter((b) => b.text.includes('自定义 1'))
  );
  if (customTabs.length > 0) {
    const allBtns = await pageB.$$('button');
    if (allBtns[customTabs[0].index]) {
      await allBtns[customTabs[0].index].click();
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // 填入自定义 1 名称「知识」
  const nameInput = await pageB.evaluateHandle(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="text"]'));
    return inputs.find((i) => (i as HTMLInputElement).placeholder && (i as HTMLInputElement).placeholder.includes('知识'));
  });
  if (nameInput) {
    await (nameInput as any).click({ clickCount: 3 });
    await (nameInput as any).type('知识');
    await new Promise((r) => setTimeout(r, 200));
  }

  // 填入自定义 1 prompt 内容
  const textareas = await pageB.$$('textarea');
  // 找到非只读的 textarea（自定义槽位可编辑）
  for (const ta of textareas) {
    const isReadOnly = await ta.evaluate((el: any) => el.readOnly);
    if (!isReadOnly) {
      await ta.click({ clickCount: 3 });
      await ta.type('你是一个知识整理助手。');
      break;
    }
  }

  // 点击「保存并返回」
  const saveBtn = await pageB.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent && b.textContent.includes('保存并返回'));
  });
  if (saveBtn) {
    await (saveBtn as any).click();
    await new Promise((r) => setTimeout(r, 1000));
  }

  // 导航到回顾页
  await pageB.goto(`${BASE_URL}/review?date=${dateStr}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // 打开生成浮层
  const generateBtnB = await pageB.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent && b.textContent.includes('AI 智能整理'));
  });
  if (generateBtnB) {
    await (generateBtnB as any).click();
    await new Promise((r) => setTimeout(r, 500));
  }

  // 选中「知识」（slot 2）- 日记和回顾已默认选中
  const slot2 = await pageB.$('[data-testid="prompt-slot-2"]');
  if (slot2) {
    await slot2.click();
    await new Promise((r) => setTimeout(r, 300));
  }

  // 验证浮层显示「生成 3 篇回顾」
  const popoverTextB = await pageB.evaluate(() => document.body.textContent || '');
  assert(
    'B1 选中日记+回顾+知识（生成 3 篇）',
    popoverTextB.includes('生成 3 篇回顾'),
    `文本包含「生成 3 篇回顾」=${popoverTextB.includes('生成 3 篇回顾')}`
  );

  // 取消回顾，只保留日记+知识
  const slot1B = await pageB.$('[data-testid="prompt-slot-1"]');
  if (slot1B) {
    await slot1B.click();
    await new Promise((r) => setTimeout(r, 300));
  }

  // 验证浮层显示「生成 2 篇回顾」
  const popoverTextB2 = await pageB.evaluate(() => document.body.textContent || '');
  assert(
    'B2 选中日记+知识（生成 2 篇）',
    popoverTextB2.includes('生成 2 篇回顾'),
    `文本包含「生成 2 篇回顾」=${popoverTextB2.includes('生成 2 篇回顾')}`
  );

  // 点击「生成 2 篇回顾」按钮
  const genBtn = await pageB.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find((b) => b.textContent && b.textContent.includes('生成 2 篇回顾'));
  });
  if (genBtn) {
    await (genBtn as any).click();
    // generateSelected 有 3000ms API_RATE_LIMIT_DELAY_MS 延迟，2 槽需 ~6s+
    await new Promise((r) => setTimeout(r, 8000));
  }

  // 验证 daily_reviews 中有 2 条记录
  const reviews = await readStore(pageB, 'daily_reviews');
  const testReviews = reviews?.filter((r) => r.id !== 'd1' && r.id !== 'r1') || [];

  assert(
    'B3 生成了 2 篇独立卡片',
    testReviews.length === 2,
    `daily_reviews 中有 ${testReviews.length} 条新生成的记录`
  );

  // 验证一篇是日记（entry_type='diary'），一篇是回顾（entry_type='review'）
  const diaryEntry = testReviews.find((r) => r.entry_type === 'diary');
  const reviewEntry = testReviews.find((r) => r.entry_type === 'review');

  assert(
    'B4 包含日记类型卡片',
    !!diaryEntry && !!diaryEntry.ai_editorial,
    diaryEntry ? `entry_type=${diaryEntry.entry_type}, prompt_name=${diaryEntry.prompt_name}` : '未找到日记卡片'
  );
  assert(
    'B5 包含回顾类型卡片',
    !!reviewEntry && !!reviewEntry.ai_review,
    reviewEntry ? `entry_type=${reviewEntry.entry_type}, prompt_name=${reviewEntry.prompt_name}` : '未找到回顾卡片'
  );

  // 验证卡片 sub-header 显示正确的 prompt_name
  const pageText = await pageB.evaluate(() => document.body.textContent || '');
  assert(
    'B6 卡片 sub-header 显示日记名称',
    pageText.includes('日记'),
    `页面文本包含「日记」=${pageText.includes('日记')}`
  );
  assert(
    'B7 卡片 sub-header 显示知识名称',
    pageText.includes('知识'),
    `页面文本包含「知识」=${pageText.includes('知识')}`
  );

  await pageB.close();
  await ctxB.close();

  // ---------- 旅程 C：自动队列仅补选中索引 ----------
  const ctxC = await browser.createBrowserContext();
  const pageC = await ctxC.newPage();
  await pageC.setRequestInterception(true);
  const mockC = setupApiMock(pageC);

  await pageC.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await clearStorage(pageC);
  await pageC.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // 插入昨天的碎屑
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayMs = yesterday.getTime();
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  await pageC.evaluate(
    (args: { name: string; ts: number }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('raw_logs')) {
            idb.close();
            return resolve();
          }
          const tx = idb.transaction('raw_logs', 'readwrite');
          tx.objectStore('raw_logs').put({
            id: 'test-log-yesterday',
            content: '昨天的碎屑',
            created_at: args.ts,
            audioBlob: undefined,
          });
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { name: DB_NAME, ts: yesterdayMs }
  );

  // 修改设置：只选中「日记」（slot 0），取消回顾
  // Zustand v5 persist 仅在 state change 时写 localStorage，clearStorage 后
  // 首次加载可能尚未持久化。故需兼容 settings 不存在的情况，手动写入完整对象。
  await pageC.evaluate(() => {
    const stored = localStorage.getItem('whitewash-settings');
    if (stored) {
      const settings = JSON.parse(stored);
      settings.state.reviewSelectedIndices = [0];
      localStorage.setItem('whitewash-settings', JSON.stringify(settings));
    } else {
      // settings 尚未持久化，手动创建最小配置
      localStorage.setItem('whitewash-settings', JSON.stringify({
        state: { reviewSelectedIndices: [0] },
        version: 8
      }));
    }
  });

  // 重新加载让设置生效，触发 checkAndGenerateHistoryTasks
  mockC.reset();
  await pageC.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  // 等待队列执行
  await new Promise((r) => setTimeout(r, 5000));

  // 验证只调用了 timeline API（日记），没有调用 review API（回顾）
  assert(
    'C1 自动队列仅调用日记 API',
    mockC.getTimelineCount() >= 1,
    `timeline API 调用次数=${mockC.getTimelineCount()}`
  );
  assert(
    'C2 自动队列未调用回顾 API',
    mockC.getReviewCount() === 0,
    `review API 调用次数=${mockC.getReviewCount()}`
  );

  // 验证 daily_reviews 中只有日记条目
  const reviewsC = await readStore(pageC, 'daily_reviews');
  const yesterdayReviews = reviewsC?.filter((r) => r.review_date === yesterdayStr) || [];
  const hasDiary = yesterdayReviews.some((r) => r.entry_type === 'diary');
  const hasReview = yesterdayReviews.some((r) => r.entry_type === 'review');

  assert(
    'C3 自动队列补了日记条目',
    hasDiary,
    `昨天有日记条目=${hasDiary}`
  );
  assert(
    'C4 自动队列未补回顾条目',
    !hasReview,
    `昨天有回顾条目=${hasReview}`
  );

  await pageC.close();
  await ctxC.close();
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
