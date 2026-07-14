/**
 * #7 沉思（Thoughts）模块 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 点击底部快速输入框 -> 展开 Blinko 风格富文本编辑器，输入带 #标签 的 Markdown，
 *      保存 -> 瀑布流展示卡片 + 标签 chip。
 *   2. 切换「时间线」视图 -> 按 created_at 分组展示。
 *   3. 双击卡片进入编辑弹窗 -> 修改 content 与 created_at -> 保存。
 *   4. 验证修改 created_at 后时间线分组日期变化，且 original_created_at 保留首次值（溯源）。
 *   5. 双击进入编辑弹窗 -> 删除 -> 卡片消失。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/thoughts.test.ts`。
 * 通过退出码 0/1 反映结果。E2E 由验证代理统一串行执行（避免 vite 端口冲突）。
 *
 * 参考 tests/foundation-migration.test.ts：独立 browser.createBrowserContext 隔离存储、
 * 请求拦截同源加载、data-testid 定位元素、直接读 IndexedDB 校验数据。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

// 用 4174 端口，与 foundation-migration.test.ts 的 4173 区分，避免串行执行时的端口占用。
const BASE_URL = 'http://localhost:4174';
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

/** 把毫秒时间戳格式化成 datetime-local input 所需的 yyyy-MM-ddTHH:mm（本地时区）。 */
function tsToDatetimeLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 把毫秒时间戳格式化成 yyyy-MM-dd（用于校验时间线分组 data-date）。 */
function tsToDateStr(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // 用独立浏览器上下文（全新存储），与其它测试隔离，确保 thoughts 表初始为空。
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 390, height: 844 });

  // 自动接受原生 confirm() 对话框（删除笔记时弹出）
  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  // 导航到沉思页，等待快速输入框就绪
  await page.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('[data-testid="thought-quick-input"]', { timeout: 15000 });

  // ---------- 1. 创建带 #标签 的 Markdown 笔记 ----------
  await page.click('[data-testid="thought-quick-input"]');
  await page.waitForSelector('[data-testid="thought-create-textarea"]', { timeout: 5000 });

  const noteContent = '## 沉思标题\n\n这是一条**沉思**笔记 #灵感';
  await page.click('[data-testid="thought-create-textarea"]');
  await page.type('[data-testid="thought-create-textarea"]', noteContent);

  // 记录创建时刻窗口，用于后续校验 original_created_at
  const createT0 = Date.now();
  await page.click('[data-testid="thought-create-save"]');
  await page.waitForSelector('[data-testid="thought-card"]', { timeout: 5000 });
  const createT1 = Date.now();

  const cardText = await page.$eval('[data-testid="thought-card"]', (el) => el.textContent || '');
  assert(
    '1a 瀑布流显示新建卡片',
    cardText.includes('沉思标题') && cardText.includes('沉思笔记'),
    `cardText含沉思标题=${cardText.includes('沉思标题')}`
  );

  // 标签 chip 应出现（#灵感 -> 标签「灵感」）
  const hasTagChip = await page.$('[data-testid="thought-tag-灵感"]');
  assert('1b 标签 chip 解析展示', !!hasTagChip, hasTagChip ? '灵感标签存在' : '未找到灵感标签');

  // ---------- 2. 切换时间线视图 ----------
  await page.click('[data-testid="view-timeline"]');
  await page.waitForSelector('[data-testid="timeline-group"]', { timeout: 5000 });
  const initialGroupDate = await page.$eval(
    '[data-testid="timeline-group"]',
    (el) => el.getAttribute('data-date') || ''
  );
  const todayDateStr = tsToDateStr(Date.now());
  assert(
    '2 时间线按 created_at 分组（初始为今天）',
    initialGroupDate === todayDateStr,
    `groupDate=${initialGroupDate}, today=${todayDateStr}`
  );

  // ---------- 3. 双击编辑 content 与 created_at ----------
  // 先滚动卡片到可见再双击
  await page.$eval('[data-testid="thought-card"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-testid="thought-card"]', { count: 2 });
  await page.waitForSelector('[data-testid="thought-edit-textarea"]', { timeout: 5000 });

  // 修改 content：用原生 setter 完全替换值（三击全选对多行 textarea 不可靠，会残留旧内容）
  const editedContent = '## 已编辑标题\n\n编辑后的沉思内容 #灵感 #复盘';
  await page.$eval(
    '[data-testid="thought-edit-textarea"]',
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
    editedContent
  );

  // 修改 created_at 为 10 天前（用原生 setter + input 事件，兼容 React 受控 input）
  const targetMs = Date.now() - 10 * 86400000;
  const targetDatetimeLocal = tsToDatetimeLocal(targetMs);
  const expectedDateStr = tsToDateStr(targetMs);
  await page.$eval(
    '[data-testid="thought-edit-created-at"]',
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
    targetDatetimeLocal
  );

  await page.click('[data-testid="thought-edit-save"]');

  // ---------- 4. 验证时间线分组变化 + original_created_at 保留 ----------
  // 等待时间线分组日期变为目标日期
  await page.waitForFunction(
    (expected: string) => {
      const el = document.querySelector('[data-testid="timeline-group"]');
      return !!el && el.getAttribute('data-date') === expected;
    },
    { timeout: 5000 },
    expectedDateStr
  );
  const newGroupDate = await page.$eval(
    '[data-testid="timeline-group"]',
    (el) => el.getAttribute('data-date') || ''
  );
  assert(
    '4a 修改 created_at 后时间线分组日期变化',
    newGroupDate === expectedDateStr && newGroupDate !== initialGroupDate,
    `newGroupDate=${newGroupDate}, expected=${expectedDateStr}`
  );

  // 编辑后卡片内容应已更新
  const editedCardText = await page.$eval('[data-testid="thought-card"]', (el) => el.textContent || '');
  assert(
    '4b 卡片内容已更新',
    editedCardText.includes('已编辑标题') && !editedCardText.includes('沉思标题'),
    `含已编辑标题=${editedCardText.includes('已编辑标题')}`
  );

  // 直接读 IndexedDB 校验 original_created_at 保留（未被新 created_at 覆盖）
  const thoughtsRows = await readStore(page, 'thoughts');
  const thought = thoughtsRows && thoughtsRows[0];
  const origKept =
    !!thought &&
    thought.original_created_at !== thought.created_at &&
    thought.original_created_at >= createT0 &&
    thought.original_created_at <= createT1 &&
    Math.abs(thought.created_at - targetMs) < 60000; // 分钟精度
  assert(
    '4c original_created_at 保留首值（溯源未丢）',
    !!origKept,
    thought
      ? `orig=${thought.original_created_at}, created=${thought.created_at}, targetMs=${targetMs}`
      : '未读到 thought 记录'
  );

  // ---------- 5. 删除 ----------
  await page.$eval('[data-testid="thought-card"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.click('[data-testid="thought-card"]', { count: 2 });
  await page.waitForSelector('[data-testid="thought-edit-delete"]', { timeout: 5000 });
  await page.click('[data-testid="thought-edit-delete"]');

  // 等待卡片消失（confirm 已被自动接受，删除后弹窗关闭、卡片移除）
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="thought-card"]'),
    { timeout: 5000 }
  );
  const cardGone = await page.$('[data-testid="thought-card"]');
  assert('5 删除后卡片消失', !cardGone, cardGone ? '卡片仍存在' : '卡片已移除');

  await page.close();
  await ctx.close();

  // ---------- 6. 沉思工具栏按钮测试（upload/hyperlink/mic/tag/more） ----------
  const ctx2 = await browser.createBrowserContext();
  const page2 = await ctx2.newPage();
  await page2.setViewport({ width: 390, height: 844 });

  // mic 按钮在无麦克风时弹 alert，自动接受
  const dialogMessages: string[] = [];
  page2.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  await page2.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  await page2.waitForSelector('[data-testid="thought-quick-input"]', { timeout: 15000 });

  // 展开富文本编辑器
  await page2.click('[data-testid="thought-quick-input"]');
  await page2.waitForSelector('[data-testid="thought-create-textarea"]', { timeout: 5000 });

  // 6a. upload 按钮触发文件选择器，accept 含 image/audio/video
  const [uploadChooser] = await Promise.all([
    page2.waitForFileChooser({ timeout: 5000 }),
    page2.click('[data-testid="editor-upload"]'),
  ]);
  const uploadAccept = await page2.$eval(
    '[data-testid="editor-file-input"]',
    (el: any) => el.getAttribute('accept') || ''
  );
  assert(
    '6a upload 按钮触发文件选择器，accept=image/*,audio/*,video/*',
    uploadAccept.includes('image/*') &&
      uploadAccept.includes('audio/*') &&
      uploadAccept.includes('video/*'),
    `accept=${uploadAccept}`
  );
  // 关闭文件选择器（不接受任何文件）
  await uploadChooser.accept([]);
  await new Promise((r) => setTimeout(r, 300));

  // 6d. tag 按钮在光标处插入 #
  await page2.click('[data-testid="thought-create-textarea"]');
  await page2.click('[data-testid="editor-tag"]');
  await new Promise((r) => setTimeout(r, 300));
  const afterTag = await page2.$eval(
    '[data-testid="thought-create-textarea"]',
    (el: any) => (el as HTMLTextAreaElement).value
  );
  assert('6d tag 按钮插入 # 到文本', afterTag.includes('#'), `textarea=${afterTag}`);

  // 6e. more 按钮展开更多菜单
  await page2.click('[data-testid="editor-more"]');
  const moreMenu = await page2.waitForSelector('[data-testid="editor-more-menu"]', {
    timeout: 5000,
  });
  assert('6e more 按钮展开更多菜单', !!moreMenu, moreMenu ? '菜单可见' : '菜单未出现');
  // 再次点击 more 关闭菜单
  await page2.click('[data-testid="editor-more"]');
  await new Promise((r) => setTimeout(r, 300));

  // 6b. hyperlink 按钮打开链接弹框
  await page2.click('[data-testid="editor-hyperlink"]');
  const linkDialog = await page2.waitForSelector('[data-testid="editor-link-dialog"]', {
    timeout: 5000,
  });
  assert('6b hyperlink 按钮打开链接弹框', !!linkDialog, linkDialog ? '弹框可见' : '弹框未出现');
  // 点击遮罩区域关闭弹框（通过 evaluate 直接触发 overlay click，避免坐标命中内部内容）
  await page2.evaluate(() => {
    const overlay = document.querySelector('[data-testid="editor-link-dialog"]');
    if (overlay) (overlay as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 500));
  // 确认弹框已关闭，避免遮罩拦截后续 mic 按钮点击
  const dialogStillOpen = await page2.$('[data-testid="editor-link-dialog"]');
  if (dialogStillOpen) {
    // 备用：按 Escape 关闭
    await page2.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 300));
  }

  // 6c. mic 按钮触发麦克风访问（getUserMedia 被调用即验证按钮接线正确）
  // 覆盖 navigator.mediaDevices.getUserMedia 使其确定性 reject
  await page2.evaluate(`
    window.__gumCalled = false;
    window.__micClicked = false;
    var micBtn = document.querySelector('[data-testid="editor-mic"]');
    if (micBtn) {
      micBtn.addEventListener('click', function() { window.__micClicked = true; }, true);
    }
    try {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: function() {
          window.__gumCalled = true;
          return Promise.reject(new Error('test: no microphone'));
        },
        configurable: true,
        writable: true
      });
    } catch (e) {
      window.__gumOverrideError = String(e);
    }
  `);
  dialogMessages.length = 0;
  await page2.click('[data-testid="editor-mic"]');
  // 等待 getUserMedia reject -> alert 弹出（异步流程）
  await new Promise((r) => setTimeout(r, 2000));
  const micDiag = await page2.evaluate(
    'JSON.stringify({ gumCalled: window.__gumCalled, micClicked: window.__micClicked, overrideError: window.__gumOverrideError || "none" })'
  );
  const diagObj = JSON.parse(micDiag);
  assert(
    '6c mic 按钮触发录音行为（click + getUserMedia/alert）',
    diagObj.micClicked && (diagObj.gumCalled || dialogMessages.length > 0),
    `micDiag=${micDiag}, dialogMsgs=${dialogMessages.length}`
  );

  await page2.close();
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
