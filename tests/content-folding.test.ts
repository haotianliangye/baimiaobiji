/**
 * #113 内容卡片折叠与交互 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   R.  记录页（Record）卡片：纯文本超 12 行进入折叠态、单击展开/收起、双击进编辑弹窗、
 *       右键弹复制/编辑/多选/删除菜单、折叠态多媒体仅一行缩略（2 个 + "+N"）。
 *   RV. 回顾页（Review）卡片：折叠态显示摘要、单击展开正文、双击 inline 编辑、
 *       右键弹复制/编辑/重新生成/删除菜单（验证 #104 现有折叠/交互不被 #113 破坏）。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/content-folding.test.ts`。
 * 通过退出码 0/1 反映结果。端口 4177 与 foundation-migration(4173)/thoughts(4174) 区分。
 *
 * 参考 tests/foundation-migration.test.ts：独立 browser.createBrowserContext 隔离存储、
 * 直接写当前 schema 的 IndexedDB 表、重载让 Dexie liveQuery 读取、data-testid 定位。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4177';
const DB_NAME = 'whitewash_diary';
const TEST_DATE = '2026-07-16';
// 2026-07-16 12:00 当地时间戳（JS Date 月份 0-based，6 = 7 月）
const TEST_DATE_MS = new Date(2026, 6, 16, 12, 0, 0).getTime();

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

/** 直接写当前 schema 的某 object store 一条记录（put）。应用已建库后调用。 */
async function putRecord(page: Page, store: string, record: any) {
  await page.evaluate(
    (args: { name: string; store: string; record: any }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains(args.store)) {
            idb.close();
            return reject(new Error(`store ${args.store} 不存在`));
          }
          const tx = idb.transaction(args.store, 'readwrite');
          tx.objectStore(args.store).put(args.record);
          tx.oncomplete = () => { idb.close(); resolve(); };
          tx.onerror = () => { idb.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      }),
    { name: DB_NAME, store, record }
  );
}

/** 点击最上层 fixed inset-0 遮罩以关闭浮层（右键菜单/弹窗）。 */
async function dismissOverlay(page: Page) {
  await page.evaluate(() => {
    const overlays = document.querySelectorAll('div.fixed.inset-0');
    if (overlays.length) (overlays[overlays.length - 1] as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 300));
}

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4177', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ===========================================================================
  // 旅程 R：记录页（Record）卡片折叠与交互（issue #113）
  // ===========================================================================
  const ctx = await browser.createBrowserContext();
  const pageR = await ctx.newPage();
  // 首次加载让应用建库（Dexie 创建当前 schema）
  await pageR.goto(`${BASE_URL}/?date=${TEST_DATE}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  // 注入一条 15 行纯文本 + 4 个图片附件的 log（多媒体不计入 12 行，但折叠态需一行缩略）
  const longContent = Array.from(
    { length: 15 },
    (_, i) => `第${i + 1}行测试内容，用于验证记录卡片折叠功能。`
  ).join('\n');
  await putRecord(pageR, 'raw_logs', {
    id: 'fold-log-1',
    content: longContent,
    created_at: TEST_DATE_MS,
    timezone: 'Asia/Shanghai',
    attachments: [
      { kind: 'image', ref: 'fold-att-1' },
      { kind: 'image', ref: 'fold-att-2' },
      { kind: 'image', ref: 'fold-att-3' },
      { kind: 'image', ref: 'fold-att-4' },
    ],
  });
  // 重载让 Dexie liveQuery 读取注入的 log
  await pageR.goto(`${BASE_URL}/?date=${TEST_DATE}`, { waitUntil: 'networkidle2' });
  await pageR.waitForSelector('[data-testid="log-card"]', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));

  // R1：折叠态 - 展开按钮存在且显示「展开」，正文 p 带 line-clamp
  const r1 = await pageR.evaluate(() => {
    const card = document.querySelector('[data-testid="log-card"]');
    const toggle = document.querySelector('[data-testid="log-fold-toggle-fold-log-1"]');
    const p = card?.querySelector('p');
    return {
      hasToggle: !!toggle,
      toggleText: toggle ? (toggle.textContent || '').trim() : '',
      pHasLineClamp: p ? (p.className || '').includes('line-clamp') : false,
    };
  });
  assert(
    'R1 折叠态显示展开按钮且正文 line-clamp',
    r1.hasToggle && r1.toggleText.includes('展开') && r1.pHasLineClamp,
    `按钮="${r1.toggleText}", clamp=${r1.pHasLineClamp}`
  );

  // R6：折叠态多媒体仅一行缩略（2 个 MediaThumb + "+N"）
  const r6 = await pageR.evaluate(() => {
    const region = document.querySelector('[data-attachment-region]');
    if (!region) return { thumbs: 0, overflow: '' };
    const thumbs = region.querySelectorAll('.aspect-video').length;
    const overflowBtn = Array.from(region.querySelectorAll('button')).find((b) =>
      /^\+\d/.test((b.textContent || '').trim())
    );
    return { thumbs, overflow: overflowBtn ? (overflowBtn.textContent || '').trim() : '' };
  });
  assert(
    'R6 折叠态多媒体仅一行缩略（2 个 + "+N"）',
    r6.thumbs === 2 && r6.overflow.includes('+'),
    `缩略=${r6.thumbs}, overflow="${r6.overflow}"`
  );

  // R2：点 toggle 展开态 - 按钮变「收起」，正文无 line-clamp
  await pageR.click('[data-testid="log-fold-toggle-fold-log-1"]');
  await new Promise((r) => setTimeout(r, 300));
  const r2 = await pageR.evaluate(() => {
    const toggle = document.querySelector('[data-testid="log-fold-toggle-fold-log-1"]');
    const p = document.querySelector('[data-testid="log-card"] p');
    return {
      toggleText: toggle ? (toggle.textContent || '').trim() : '',
      pHasLineClamp: p ? (p.className || '').includes('line-clamp') : false,
    };
  });
  assert(
    'R2 点击展开 - 按钮变收起且正文无 line-clamp',
    r2.toggleText.includes('收起') && !r2.pHasLineClamp,
    `按钮="${r2.toggleText}", clamp=${r2.pHasLineClamp}`
  );

  // R3：再点 toggle 收起 - 正文恢复 line-clamp
  await pageR.click('[data-testid="log-fold-toggle-fold-log-1"]');
  await new Promise((r) => setTimeout(r, 300));
  const r3 = await pageR.evaluate(() => {
    const p = document.querySelector('[data-testid="log-card"] p');
    return { pHasLineClamp: p ? (p.className || '').includes('line-clamp') : false };
  });
  assert('R3 再次点击收起 - 正文恢复 line-clamp', r3.pHasLineClamp, `clamp=${r3.pHasLineClamp}`);

  // R5：右键卡片 - 弹复制/编辑/多选/删除菜单（先于 R4，避免编辑弹窗遮挡）
  await pageR.click('[data-testid="log-card"]', { button: 'right' });
  await new Promise((r) => setTimeout(r, 400));
  const r5 = await pageR.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasCopy: text.includes('复制'),
      hasEdit: text.includes('编辑'),
      hasMulti: text.includes('多选'),
      hasDelete: text.includes('删除'),
    };
  });
  assert(
    'R5 右键弹复制/编辑/多选/删除菜单',
    r5.hasCopy && r5.hasEdit && r5.hasMulti && r5.hasDelete,
    `复制=${r5.hasCopy},编辑=${r5.hasEdit},多选=${r5.hasMulti},删除=${r5.hasDelete}`
  );
  await dismissOverlay(pageR);

  // R4：双击正文区 - 进入编辑弹窗（双击附件区不触发，故 dblclick p）
  // 用 dispatchEvent dblclick 避免 puppeteer clickCount:2 偶发不触发 dblclick
  await pageR.evaluate(() => {
    const p = document.querySelector('[data-testid="log-card"] p') as HTMLElement | null;
    if (p) p.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
  const r4 = (await pageR.$('[data-testid="record-edit-modal"]')) !== null;
  assert('R4 双击正文进入编辑弹窗', r4, `弹窗=${r4}`);

  await pageR.close();
  await ctx.close();

  // ===========================================================================
  // 旅程 RV：回顾页（Review）现有折叠/交互回归（#104 行为不被 #113 破坏）
  // ===========================================================================
  const ctx2 = await browser.createBrowserContext();
  const pageV = await ctx2.newPage();
  await pageV.goto(`${BASE_URL}/review?date=${TEST_DATE}`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  // 注入一条长回顾（ai_review 20 段 + 摘要）
  const longReview = Array.from(
    { length: 20 },
    (_, i) => `回顾第${i + 1}段内容，用于验证回顾页正文渲染与折叠。`
  ).join('\n\n');
  await putRecord(pageV, 'daily_reviews', {
    id: 'fold-review-1',
    review_date: TEST_DATE,
    raw_log_ids: [],
    entry_type: 'review',
    ai_review: longReview,
    ai_summary: '这是一条回顾摘要内容',
    updated_at: TEST_DATE_MS,
    prompt_index: 1,
    prompt_name: '默认',
    tags: [],
  });
  await pageV.goto(`${BASE_URL}/review?date=${TEST_DATE}`, { waitUntil: 'networkidle2' });
  await pageV.waitForSelector('[data-testid="review-card"]', { timeout: 10000 });
  await new Promise((r) => setTimeout(r, 500));

  // RV1：单击 header 收起 -> 只显示摘要（line-clamp-2），正文区隐藏
  // Review 默认自动展开首个，故先单击收起再验证折叠态
  await pageV.evaluate(() => {
    const h = document.querySelector('[data-testid="review-card-header"]') as HTMLElement | null;
    if (h) h.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const rv1 = await pageV.evaluate(() => {
    const card = document.querySelector('[data-testid="review-card"]');
    const body = card?.querySelector('.baimiao-editorial-body');
    const summary = card?.querySelector('[data-testid="review-card-header"] span:last-child');
    const meta = card?.querySelector('[data-testid="review-card-meta"]');
    const tagAddBtn = card?.querySelector('[data-testid="tag-add-btn"]');
    const text = document.body.textContent || '';
    return {
      hasBody: !!body,
      summaryHasLineClamp: summary ? (summary.className || '').includes('line-clamp-2') : false,
      hasSummary: text.includes('这是一条回顾摘要内容'),
      hasMeta: !!meta,
      hasTagAddBtn: !!tagAddBtn,
    };
  });
  assert(
    'RV1 折叠态显示摘要、元信息与标签添加按钮，正文隐藏',
    rv1.summaryHasLineClamp && !rv1.hasBody && rv1.hasSummary && rv1.hasMeta && rv1.hasTagAddBtn,
    `正文区=${rv1.hasBody}, 摘要clamp=${rv1.summaryHasLineClamp}, 摘要=${rv1.hasSummary}, 元信息=${rv1.hasMeta}, 标签加号=${rv1.hasTagAddBtn}`
  );

  // RV2：单击 header 展开 -> 摘要去 clamp，正文仍完整
  await pageV.evaluate(() => {
    const h = document.querySelector('[data-testid="review-card-header"]') as HTMLElement | null;
    if (h) h.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  const rv2 = await pageV.evaluate(() => {
    const card = document.querySelector('[data-testid="review-card"]');
    const body = card?.querySelector('.baimiao-editorial-body');
    const summary = card?.querySelector('[data-testid="review-card-header"] span:last-child');
    return {
      bodyHasLineClamp: body ? (body.className || '').includes('line-clamp-12') : false,
      summaryHasLineClamp: summary ? (summary.className || '').includes('line-clamp-2') : false,
    };
  });
  assert(
    'RV2 展开态摘要去 clamp + 正文无折叠',
    !rv2.summaryHasLineClamp && !rv2.bodyHasLineClamp,
    `正文clamp=${rv2.bodyHasLineClamp}, 摘要clamp=${rv2.summaryHasLineClamp}`
  );

  // RV3：双击 header - 进入 inline 编辑（textarea 出现）
  await pageV.evaluate(() => {
    const h = document.querySelector('[data-testid="review-card-header"]') as HTMLElement | null;
    if (h) h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 500));
  const rv3 = (await pageV.$('[data-testid="review-card"] textarea')) !== null;
  assert('RV3 双击进入 inline 编辑', rv3, `textarea=${rv3}`);
  // 退出 inline 编辑（点取消按钮），避免阻塞 RV4 右键
  await pageV.evaluate(() => {
    const card = document.querySelector('[data-testid="review-card"]');
    if (!card) return;
    const cancel = Array.from(card.querySelectorAll('button')).find(
      (b) => (b.textContent || '').trim() === '取消'
    );
    if (cancel) (cancel as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // RV4：右键卡片 - 弹复制/编辑/重新生成/删除菜单
  await pageV.click('[data-testid="review-card"]', { button: 'right' });
  await new Promise((r) => setTimeout(r, 400));
  const rv4 = await pageV.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasCopy: text.includes('复制'),
      hasEdit: text.includes('编辑'),
      hasRegen: text.includes('重新生成'),
      hasDelete: text.includes('删除'),
    };
  });
  assert(
    'RV4 右键弹复制/编辑/重新生成/删除菜单',
    rv4.hasCopy && rv4.hasEdit && rv4.hasRegen && rv4.hasDelete,
    `复制=${rv4.hasCopy},编辑=${rv4.hasEdit},重新生成=${rv4.hasRegen},删除=${rv4.hasDelete}`
  );

  await pageV.close();
  await ctx2.close();
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
