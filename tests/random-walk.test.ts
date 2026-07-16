/**
 * #11 随机漫步（RandomWalk）E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 沉淀页右上角灯泡入口 -> 打开随机漫步 -> 展示 3 条卡片。
 *   2. 滑动/下一张浏览卡片堆叠。
 *   3. 去重过滤：换一批后已展示记录被冷却期过滤 -> 空态；重置历史后恢复。
 *   4. 已阅后不再出现：冷却期设为 0 隔离已阅效果 -> 已阅卡片不再出现。
 *   5. 复制：复制当前卡片正文 -> 剪贴板内容一致。
 *   6. 删除：删除当前卡片 -> IndexedDB 对应记录消失。
 *   G3. 编辑弹窗（US10）：编辑按钮 -> RichEditor 弹窗 -> 改内容保存 -> DB 更新 + 卡片刷新。
 *   G4. 容器内非 fixed 渲染 / 灯泡 toggle 退出 / 底部 Tab 退出 / 桌面宽屏占用比例。
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

/** 通过 Swiper 实例切到下一张（EffectCards 扇形堆叠，左右滑动切换）。
 *  Swiper v11 把实例挂在 .swiper 元素的 swiper 属性上。 */
async function slideToNext(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('.swiper') as any;
    if (el && el.swiper && typeof el.swiper.slideNext === 'function') {
      el.swiper.slideNext();
    }
  });
}

/** 通过应用 UI 创建一条沉淀笔记（走 RichEditor + thoughts.store）。 */
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

  // 导航到沉淀页
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="thought-quick-input"]', { timeout: 15000 });

  // ---------- 准备：创建 7 条沉淀笔记（#116 需求 1：单次抽取 3 → 7） ----------
  const NOTE_A = '随机漫步测试内容甲';
  const NOTE_B = '随机漫步测试内容乙';
  const NOTE_C = '随机漫步测试内容丙';
  const NOTE_D = '随机漫步测试内容丁';
  const NOTE_E = '随机漫步测试内容戊';
  const NOTE_F = '随机漫步测试内容己';
  const NOTE_G = '随机漫步测试内容庚';
  await createThought(page, NOTE_A, 1);
  await createThought(page, NOTE_B, 2);
  await createThought(page, NOTE_C, 3);
  await createThought(page, NOTE_D, 4);
  await createThought(page, NOTE_E, 5);
  await createThought(page, NOTE_F, 6);
  await createThought(page, NOTE_G, 7);

  // ---------- 1. 灯泡入口 -> 展示 7 条 ----------
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  // 首次抽取：7 条全部可漫步（无展示历史），等待 7 张卡片
  await waitForCardCount(page, 7);
  const cardCountInitial = await page.$$eval(
    '[data-testid="walk-card"]',
    (els) => els.length
  );
  assert('1 随机漫步展示 7 条卡片', cardCountInitial === 7, `卡片数=${cardCountInitial}`);

  // ---------- 2. 滑动/下一张浏览 ----------
  const firstContent = await getActiveCardContent(page);
  await slideToNext(page);
  await new Promise((r) => setTimeout(r, 350)); // 等待切换动画
  const secondContent = await getActiveCardContent(page);
  assert(
    '2a 下一张切换到不同卡片',
    secondContent.length > 0 && secondContent !== firstContent,
    `首=${firstContent.slice(0, 8)}, 次=${secondContent.slice(0, 8)}`
  );

  // 切到第 3 张后继续往后切到第 7 张（#116 需求 1：验证 7 张都可浏览）
  await slideToNext(page);
  await new Promise((r) => setTimeout(r, 350));
  const thirdContent = await getActiveCardContent(page);
  assert(
    '2b 浏览到第 3 张',
    thirdContent.length > 0 &&
      thirdContent !== firstContent &&
      thirdContent !== secondContent,
    `第3张=${thirdContent.slice(0, 8)}`
  );
  await slideToNext(page);
  await new Promise((r) => setTimeout(r, 350));
  await slideToNext(page);
  await new Promise((r) => setTimeout(r, 350));
  await slideToNext(page);
  await new Promise((r) => setTimeout(r, 350));
  const seventhContent = await getActiveCardContent(page);
  assert(
    '2c 浏览到第 7 张',
    seventhContent.length > 0 &&
      seventhContent !== firstContent &&
      seventhContent !== secondContent &&
      seventhContent !== thirdContent,
    `第7张=${seventhContent.slice(0, 8)}`
  );

  // ---------- 3. 去重过滤：换一批 -> 冷却期内已展示 -> 空态 ----------
  // 默认冷却期 7 天：7 条都已展示 -> 全部被过滤 -> 无可漫步记录
  await page.click('[data-testid="walk-shuffle"]');
  await page.waitForSelector('[data-testid="walk-empty"]', { timeout: 5000 });
  const emptyVisible = await page.$('[data-testid="walk-empty"]');
  assert('3a 换一批后冷却期去重 -> 空态', !!emptyVisible, emptyVisible ? '空态已展示' : '未出现空态');

  // 重置历史 -> 清空展示记录 -> 重新可漫步
  await page.click('[data-testid="walk-reset"]');
  await waitForCardCount(page, 7);
  const afterResetCount = await page.$$eval('[data-testid="walk-card"]', (els) => els.length);
  assert('3b 重置历史后恢复 7 条', afterResetCount === 7, `卡片数=${afterResetCount}`);

  // ---------- 4. 已阅后不再出现（冷却期设 0 隔离已阅效果） ----------
  // #116 需求 7：UI 上已移除「已阅」按钮；改用 localStorage 直接标记模拟已阅。
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

  // 换一批（冷却期 0：7 张已展示记录重新可抽取）
  await page.click('[data-testid="walk-shuffle"]');
  await waitForCardCount(page, 7);

  // 记下当前激活卡片 C1，通过 localStorage 模拟已阅（UI 已移除已阅按钮）
  const c1 = await getActiveCardContent(page);
  assert('4a 已阅前捕获激活卡片内容', c1.length > 0, `C1=${c1.slice(0, 8)}`);
  await page.evaluate(() => {
    const card = document.querySelector('[data-testid="walk-card"][data-active="true"]') as HTMLElement | null;
    const key = card?.getAttribute('data-walk-key');
    if (!key) throw new Error('未找到激活卡片 data-walk-key');
    const raw = localStorage.getItem('random-walk-shown') || '{}';
    const shown = JSON.parse(raw) as Record<string, { shownAt: number; read: boolean }>;
    shown[key] = { shownAt: Date.now(), read: true };
    localStorage.setItem('random-walk-shown', JSON.stringify(shown));
  });

  // 换一批：C1 已阅 -> 永久排除；其余 6 条冷却期 0 仍可抽取 -> 6 张卡片
  await page.click('[data-testid="walk-shuffle"]');
  await waitForCardCount(page, 6);
  const contentsAfterRead = await getAllCardContents(page);
  const c1Absent = !contentsAfterRead.some((c) => c === c1);
  assert(
    '4b 已阅后不再出现',
    c1Absent && contentsAfterRead.length === 6,
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
  // 删除前 DB 中应有 7 条 thoughts
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

  // ===========================================================================
  // G3: 编辑弹窗（RichEditor，US10）E2E 断言
  // issue 102 Testing Decisions「编辑按钮弹 RichEditor 编辑弹窗」测试重点未落实。
  // 此前 walk-edit -> walk-edit-modal/walk-edit-textarea 零断言。
  // 当前状态：C1 已阅排除、C2 已删除，剩 5 张可漫步卡片（第 3-7 条减去已删的 C2）。
  // ===========================================================================
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  await waitForCardCount(page, 5);

  const beforeEdit = await getActiveCardContent(page);
  assert('G3a 编辑前捕获激活卡片内容', beforeEdit.length > 0, `before=${beforeEdit.slice(0, 8)}`);

  // 点击编辑按钮 -> 弹出 RichEditor 编辑弹窗
  await page.click('[data-testid="walk-edit"]');
  await page.waitForSelector('[data-testid="walk-edit-modal"]', { timeout: 3000 });
  const editModalVisible = await page.$('[data-testid="walk-edit-modal"]');
  assert(
    'G3b 编辑按钮弹出 RichEditor 编辑弹窗',
    !!editModalVisible,
    editModalVisible ? '弹窗已展示' : '弹窗未出现'
  );

  // 弹窗内 textarea 存在（RichEditor 透传 textareaTestId="walk-edit-textarea"）
  const editTextarea = await page.$('[data-testid="walk-edit-textarea"]');
  assert('G3c 编辑弹窗含 textarea', !!editTextarea, editTextarea ? 'textarea 存在' : 'textarea 缺失');

  // 等 openEdit 异步读取 DB 回显完成，避免 setEditContent 覆盖下方写入
  await new Promise((r) => setTimeout(r, 300));

  // 修改内容并保存
  const EDIT_SUFFIX = '【已编辑G3】';
  await page.$eval(
    '[data-testid="walk-edit-textarea"]',
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
    beforeEdit + EDIT_SUFFIX
  );
  await page.click('[data-testid="walk-edit-save"]');
  // 等待弹窗关闭（保存成功）
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="walk-edit-modal"]'),
    { timeout: 3000 }
  );
  const modalStillOpen = await page.$('[data-testid="walk-edit-modal"]');
  assert('G3d 保存后编辑弹窗关闭', !modalStillOpen, !modalStillOpen ? '弹窗已关闭' : '弹窗仍在');

  // 校验 IndexedDB 中记录已写入编辑内容
  const thoughtsAfterEdit = await readStore(page, 'thoughts');
  const editedRec = thoughtsAfterEdit
    ? thoughtsAfterEdit.find((rec) => (rec.content || '').includes(EDIT_SUFFIX))
    : null;
  assert(
    'G3e 保存后 IndexedDB 内容已更新',
    !!editedRec,
    editedRec ? '已写入编辑内容' : '未找到编辑内容'
  );

  // 卡片正文同步刷新为新内容
  await new Promise((r) => setTimeout(r, 300));
  const afterEdit = await getActiveCardContent(page);
  assert(
    'G3f 编辑后卡片正文同步刷新',
    afterEdit.includes(EDIT_SUFFIX),
    `after=${afterEdit.slice(0, 16)}`
  );

  // 关闭随机漫步，进入 G4
  await page.click('[data-testid="walk-close"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="random-walk-overlay"]'),
    { timeout: 3000 }
  );

  // ===========================================================================
  // G4: 容器内非 fixed / 灯泡 toggle 退出 / 底部 Tab 退出 / 桌面占用比例
  // issue 102 Testing Decisions「容器内渲染（非 fixed）」「三方式退出」「桌面/手机占用」未落实。
  // ===========================================================================

  // ---------- G4a: 容器内渲染（非 fixed 全屏覆盖） ----------
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  await waitForCardCount(page, 5);
  const overlayPos = await page.$eval('[data-testid="random-walk-overlay"]', (el) =>
    window.getComputedStyle(el as Element).position
  );
  assert(
    'G4a 随机漫步容器内渲染（非 fixed 定位）',
    overlayPos !== 'fixed',
    `position=${overlayPos}`
  );
  // 同时确认 overlay 渲染在 <main> 内（非脱离文档流的覆盖层）
  const inMain = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="random-walk-overlay"]');
    const main = document.querySelector('main');
    return !!(overlay && main && main.contains(overlay));
  });
  assert('G4a-2 overlay 渲染在 main 容器内', inMain, inMain ? '在 main 内' : '不在 main 内');

  // ---------- G4b: 灯泡 toggle 退出（再次点击灯泡关闭随机漫步） ----------
  await page.click('[data-testid="walk-toggle"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="random-walk-overlay"]'),
    { timeout: 3000 }
  );
  const afterToggleExit = await page.$('[data-testid="random-walk-overlay"]');
  assert(
    'G4b 点击灯泡 toggle 退出随机漫步',
    !afterToggleExit,
    !afterToggleExit ? '已退出' : '仍打开'
  );

  // ---------- G4c: 底部 Tab 退出（重新打开后点击 TabBar 任意 Tab） ----------
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  await waitForCardCount(page, 5);
  // 点击底部「回顾」Tab（NavLink 渲染为 a[href="/review"]，onClick 重置 isRandomWalkMode）
  await page.click('nav a[href="/review"]');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="random-walk-overlay"]'),
    { timeout: 3000 }
  );
  const afterTabExit = await page.$('[data-testid="random-walk-overlay"]');
  assert(
    'G4c 点击底部 Tab 退出随机漫步',
    !afterTabExit,
    !afterTabExit ? '已退出' : '仍打开'
  );

  // ---------- G4d: 桌面宽屏占用比例（overlay 受 max-w-md 容器约束，不铺满视口） ----------
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="walk-open"]', { timeout: 5000 });
  await page.click('[data-testid="walk-open"]');
  await page.waitForSelector('[data-testid="random-walk-overlay"]', { timeout: 5000 });
  const overlayDims = await page.$eval('[data-testid="random-walk-overlay"]', (el) => {
    const r = (el as Element).getBoundingClientRect();
    return { width: r.width, vw: window.innerWidth };
  });
  // #116 需求 6 改的是 .walk-swiper 内部宽度（max-w-[23rem] = 368px），
  // G4d 测的是 overlay 容器本身（继承父 max-w-md = 448px）—— 维持 <= 480 阈值。
  assert(
    'G4d 桌面宽屏 overlay 受容器约束（宽度 < 视口且 <= 480）',
    overlayDims.width < overlayDims.vw && overlayDims.width <= 480,
    `overlayWidth=${overlayDims.width.toFixed(0)}, vw=${overlayDims.vw}`
  );

  // ===========================================================================
  // #116 验收断言（UI 精简：1/N 计数 / Lightbulb / 已阅按钮移除 + Settings 位置 + 卡片透明度）
  // ===========================================================================

  // ---------- #116-1: 顶部无 1/N 计数 ----------
  const counterPresent = await page.evaluate(() => {
    // 1/N 计数格式：currentIndex+1}/{items.length}；检查 overlay 顶层是否含 "数字/数字"
    const overlay = document.querySelector('[data-testid="random-walk-overlay"]') as HTMLElement | null;
    if (!overlay) return false;
    const text = (overlay.textContent || '');
    return /\d+\s*\/\s*\d+/.test(text);
  });
  assert('#116-1 顶部无 1/N 计数', !counterPresent, counterPresent ? '仍含 1/N 样式' : '已移除');

  // ---------- #116-2: 顶部细栏无 Lightbulb 装饰图标 ----------
  // 顶部细栏的特征：overlay 内的第一个 .border-b 元素（且高度 ~40px）
  const topLightbulb = await page.evaluate(() => {
    const overlay = document.querySelector('[data-testid="random-walk-overlay"]') as HTMLElement | null;
    if (!overlay) return false;
    const topBar = overlay.querySelector('.border-b') as HTMLElement | null;
    if (!topBar) return false;
    // lucide-react 渲染 SVG 时带 lucide-xxx class
    const svgs = topBar.querySelectorAll('svg');
    for (const svg of Array.from(svgs)) {
      const cls = svg.getAttribute('class') || '';
      if (cls.includes('lucide-lightbulb')) return true;
    }
    return false;
  });
  assert('#116-2 顶部细栏无 Lightbulb 图标', !topLightbulb, topLightbulb ? 'Lightbulb 仍存在' : '已移除');

  // ---------- #116-3: 底部无「已阅」按钮 ----------
  const readButton = await page.$('[data-testid="walk-read"]');
  assert('#116-3 底部无已阅按钮', !readButton, readButton ? '已阅按钮仍存在' : '已移除');

  // ---------- #116-4: Settings2 位于左上角 ----------
  const settingsPos = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="walk-settings"]') as HTMLElement | null;
    const overlay = document.querySelector('[data-testid="random-walk-overlay"]') as HTMLElement | null;
    if (!btn || !overlay) return null;
    const br = btn.getBoundingClientRect();
    const or = overlay.getBoundingClientRect();
    const leftOffset = br.left - or.left;
    const topRatio = (br.top - or.top) / or.height;
    return {
      leftOffset,
      topRatio,
      position: btn.getAttribute('data-walk-settings-position'),
    };
  });
  assert(
    '#116-4 Settings2 位于左上角',
    !!settingsPos && settingsPos.leftOffset < 24 && settingsPos.topRatio < 0.3,
    settingsPos
      ? `leftOffset=${settingsPos.leftOffset.toFixed(0)}, topRatio=${settingsPos.topRatio.toFixed(2)}, pos=${settingsPos.position}`
      : '未找到 settings 按钮'
  );

  // ---------- #116-5: 后方非当前卡片透明度降低 ----------
  const opacityInfo = await page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid="walk-card"]');
    const list: { active: boolean; opacity: string }[] = [];
    cards.forEach((c) => {
      list.push({
        active: c.getAttribute('data-active') === 'true',
        opacity: window.getComputedStyle(c as Element).opacity,
      });
    });
    return list;
  });
  const activeOpacity = parseFloat(opacityInfo.find((o) => o.active)?.opacity || '0');
  const otherOpacities = opacityInfo.filter((o) => !o.active).map((o) => parseFloat(o.opacity));
  const minOther = otherOpacities.length ? Math.min(...otherOpacities) : 1;
  assert(
    '#116-5 后方非当前卡片透明度降低',
    activeOpacity >= 0.9 && otherOpacities.length > 0 && minOther < 0.8,
    `active=${activeOpacity}, otherMin=${minOther}, otherCount=${otherOpacities.length}`
  );

  // ---------- #116-6: 卡片区域宽度缩小（< 400px，反映 1.2x 缩小） ----------
  const swiperWidth = await page.$eval('.walk-swiper', (el) => (el as Element).getBoundingClientRect().width);
  assert(
    '#116-6 卡片区域宽度 < 400px（原 max-w-md=448，缩小 1.2x 后 ~373）',
    swiperWidth < 400,
    `swiperWidth=${swiperWidth.toFixed(0)}`
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
