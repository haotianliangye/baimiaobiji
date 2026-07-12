/**
 * #13 统一数据管理 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 导出 JSON：时间范围 + 类型筛选，验证 meta 结构与时间过滤
 *   2. 导出 Markdown：验证分节标题与内容
 *   3. 导入 JSON（overwrite）：先删一条再导入，验证被覆盖恢复
 *   4. 导入 JSON（skip）：导入已存在 id，验证 skipped 计数 + 原数据不变
 *   5. 聊天记录单独导出：验证只含 copilot_conversations
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/data-management.test.ts`。
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

/**
 * 构造 v9 (IDB version 90) 的 whitewash_diary 库并播种测试数据。
 * 时间戳分布：in-range (2026-07-10) / out-of-range (2026-06-01)。
 */
async function seedDb(page: Page) {
  await page.evaluate(
    (dbName) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(dbName, 90);
        req.onupgradeneeded = (e: any) => {
          const idb = e.target.result;
          const stores = [
            { name: 'raw_logs', keyPath: 'id' },
            { name: 'daily_reviews', keyPath: 'id' },
            { name: 'thoughts', keyPath: 'id' },
            { name: 'mingwu', keyPath: 'id' },
            { name: 'copilot_conversations', keyPath: 'id' },
            { name: 'migration_backups', keyPath: 'key' },
          ];
          for (const s of stores) {
            if (!idb.objectStoreNames.contains(s.name)) {
              idb.createObjectStore(s.name, { keyPath: s.keyPath });
            }
          }
        };
        req.onsuccess = async (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(
            ['raw_logs', 'daily_reviews', 'copilot_conversations'],
            'readwrite'
          );

          // raw_logs: one in range, one out of range
          tx.objectStore('raw_logs').put({
            id: 'test-log-in',
            content: '范围内的碎屑内容',
            created_at: Date.UTC(2026, 6, 10, 10, 0, 0),
            timezone: 'Asia/Shanghai',
          });
          tx.objectStore('raw_logs').put({
            id: 'test-log-out',
            content: '范围外的碎屑内容',
            created_at: Date.UTC(2026, 5, 1, 10, 0, 0),
            timezone: 'Asia/Shanghai',
          });

          // daily_reviews: diary + review
          tx.objectStore('daily_reviews').put({
            id: 'test-diary-1',
            review_date: '2026-07-10',
            entry_type: 'diary',
            ai_review: '',
            ai_editorial: '日记正文内容',
            ai_summary: '日记摘要',
            raw_log_ids: [],
            updated_at: Date.UTC(2026, 6, 10, 10, 0, 0),
          });
          tx.objectStore('daily_reviews').put({
            id: 'test-review-1',
            review_date: '2026-07-10',
            entry_type: 'review',
            ai_review: '回顾正文内容',
            ai_summary: '回顾摘要',
            raw_log_ids: [],
            updated_at: Date.UTC(2026, 6, 10, 10, 0, 0),
          });

          // copilot_conversations
          tx.objectStore('copilot_conversations').put({
            id: 'test-conv-1',
            title: '测试对话',
            mode: 'chat',
            messages: [
              { role: 'user', content: '你好', timestamp: Date.UTC(2026, 6, 10, 10, 0, 0) },
              { role: 'assistant', content: '你好！有什么可以帮你的？', timestamp: Date.UTC(2026, 6, 10, 10, 0, 1) },
            ],
            created_at: Date.UTC(2026, 6, 10, 10, 0, 0),
            updated_at: Date.UTC(2026, 6, 10, 10, 0, 1),
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

/** 删除某表中的指定 id 记录 */
async function deleteRecord(page: Page, store: string, id: string): Promise<void> {
  await page.evaluate(
    (args: { name: string; store: string; id: string }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(args.store, 'readwrite');
          tx.objectStore(args.store).delete(args.id);
          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { name: DB_NAME, store, id }
  );
}

/** 导航到 Settings -> 数据管理 tab */
async function navigateToDataTab(page: Page) {
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));
  // 点击「数据管理」tab
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent?.trim() === '数据管理');
    if (btn) (btn as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 500));
}

/** 设置 date input 值（React 兼容方式） */
async function setDateInput(page: Page, testid: string, value: string) {
  await page.evaluate(
    (args: { testid: string; value: string }) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      const input = document.querySelector(`[data-testid="${args.testid}"]`) as HTMLInputElement;
      if (!input) throw new Error(`input ${args.testid} not found`);
      setter?.call(input, args.value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { testid, value }
  );
}

/** 设置 file input 文件内容（DataTransfer 方式） */
async function setFileInput(page: Page, testid: string, content: string, filename: string = 'test.json') {
  await page.evaluate(
    (args: { testid: string; content: string; filename: string }) => {
      const file = new File([args.content], args.filename, { type: 'application/json' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const input = document.querySelector(`[data-testid="${args.testid}"]`) as HTMLInputElement;
      if (!input) throw new Error(`input ${args.testid} not found`);
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    { testid, content, filename }
  );
}

/** 等待 window 钩子被设置 */
async function waitForWindowHook(page: Page, hook: string, timeoutMs = 10000): Promise<any> {
  await page.waitForFunction(
    (h: string) => (window as any)[h] !== null && (window as any)[h] !== undefined,
    { timeout: timeoutMs },
    hook
  );
  return page.evaluate((h: string) => (window as any)[h], hook);
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

  // 独立浏览器上下文隔离 IndexedDB
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // 请求拦截：首次加载时阻止脚本 -> 播种 IDB -> 解除拦截重新加载
  await page.setRequestInterception(true);
  let blockScripts = true;
  page.on('request', (req) => {
    if (blockScripts && req.resourceType() === 'script') {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'domcontentloaded' });
  await seedDb(page);

  // 解除拦截，重新加载 -> 应用 JS 运行，Dexie 识别 v9 库
  blockScripts = false;
  await page.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // 导航到数据管理 tab
  await navigateToDataTab(page);

  // ---------- 旅程 1：导出 JSON（带时间范围 + 类型筛选）----------

  // 确保默认选中 raw_logs + daily_reviews（已在 state 默认值中）
  // 清除 window 钩子
  await page.evaluate(() => { (window as any).__testExportData = null; });

  // 设置时间范围 2026-07-01 ~ 2026-07-12
  await setDateInput(page, 'export-start-date', '2026-07-01');
  await setDateInput(page, 'export-end-date', '2026-07-12');
  await new Promise((r) => setTimeout(r, 300));

  // 确保格式为 JSON（默认）
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="export-format-json"]') as HTMLElement;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // 点击导出
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="export-btn"]') as HTMLElement;
    if (btn) btn.click();
  });

  const jsonContent = await waitForWindowHook(page, '__testExportData');
  let parsed: any;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    parsed = null;
  }

  assert('E1 JSON 含 meta 结构', !!parsed?.meta, parsed ? '有 meta' : '无 meta 或解析失败');
  assert(
    'E2 meta.types 含 raw_logs 与 daily_reviews',
    !!parsed?.meta?.types?.includes('raw_logs') && parsed?.meta?.types?.includes('daily_reviews'),
    `types=${JSON.stringify(parsed?.meta?.types)}`
  );
  const exportedLogs = parsed?.raw_logs || [];
  const logIds = exportedLogs.map((l: any) => l.id);
  assert(
    'E3 时间过滤：raw_logs 含范围内记录 test-log-in',
    logIds.includes('test-log-in'),
    `logIds=${JSON.stringify(logIds)}`
  );
  assert(
    'E4 时间过滤：raw_logs 不含范围外记录 test-log-out',
    !logIds.includes('test-log-out'),
    `logIds=${JSON.stringify(logIds)}`
  );
  const exportedReviews = parsed?.daily_reviews || [];
  const reviewIds = exportedReviews.map((r: any) => r.id);
  assert(
    'E5 daily_reviews 含日记与回顾',
    reviewIds.includes('test-diary-1') && reviewIds.includes('test-review-1'),
    `reviewIds=${JSON.stringify(reviewIds)}`
  );

  // ---------- 旅程 2：导出 Markdown ----------
  await page.evaluate(() => { (window as any).__testExportData = null; });

  // 切换格式为 Markdown
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="export-format-markdown"]') as HTMLElement;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // 点击导出
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="export-btn"]') as HTMLElement;
    if (btn) btn.click();
  });

  const mdContent = await waitForWindowHook(page, '__testExportData');
  assert('E6 Markdown 含碎屑分节', mdContent.includes('## 碎屑'), `含碎屑=${mdContent.includes('## 碎屑')}`);
  assert('E7 Markdown 含回顾分节', mdContent.includes('## 回顾'), `含回顾=${mdContent.includes('## 回顾')}`);
  assert('E8 Markdown 含范围内内容', mdContent.includes('范围内的碎屑内容'), `含范围内内容=${mdContent.includes('范围内的碎屑内容')}`);
  assert('E9 Markdown 不含范围外内容', !mdContent.includes('范围外的碎屑内容'), `含范围外内容=${mdContent.includes('范围外的碎屑内容')}`);

  // ---------- 旅程 3：导入 JSON（overwrite）----------

  // 先删除 test-log-in
  await deleteRecord(page, 'raw_logs', 'test-log-in');
  const logsAfterDelete = await readStore(page, 'raw_logs');
  const deletedLogExists = logsAfterDelete?.some((l) => l.id === 'test-log-in');
  assert('E10 删除 test-log-in 成功', !deletedLogExists, `exists=${deletedLogExists}`);

  // 切回 JSON 格式（仅恢复 UI 状态，不重新导出——使用旅程 1 的 jsonContent，
  // 其中含 test-log-in，因为它在删除前导出）
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="export-format-json"]') as HTMLElement;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // 设置导入文件（使用旅程 1 的导出 JSON，含 test-log-in）
  await page.evaluate(() => { (window as any).__testImportResult = null; });
  await setFileInput(page, 'import-file-input', jsonContent);

  // 等待导入按钮启用
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="import-btn"]') as HTMLButtonElement;
      return btn && !btn.disabled;
    },
    { timeout: 5000 }
  );
  await new Promise((r) => setTimeout(r, 300));

  // 确保策略为 overwrite
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="import-strategy-overwrite"]') as HTMLElement;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // 点击导入
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="import-btn"]') as HTMLElement;
    if (btn) btn.click();
  });

  const overwriteResult = await waitForWindowHook(page, '__testImportResult');
  assert(
    'E11 overwrite 导入 imported > 0',
    overwriteResult?.imported > 0,
    `imported=${overwriteResult?.imported}, skipped=${overwriteResult?.skipped}`
  );

  // 验证 test-log-in 已恢复
  const logsAfterImport = await readStore(page, 'raw_logs');
  const restoredLog = logsAfterImport?.find((l) => l.id === 'test-log-in');
  assert(
    'E12 overwrite 导入后 test-log-in 已恢复',
    !!restoredLog && restoredLog.content === '范围内的碎屑内容',
    restoredLog ? `content=${restoredLog.content}` : '未找到 test-log-in'
  );

  // ---------- 旅程 4：导入 JSON（skip）----------

  // 使用相同的 JSON 导入，策略改为 skip
  await page.evaluate(() => { (window as any).__testImportResult = null; });
  await setFileInput(page, 'import-file-input', jsonContent);

  // 等待导入按钮启用
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="import-btn"]') as HTMLButtonElement;
      return btn && !btn.disabled;
    },
    { timeout: 5000 }
  );
  await new Promise((r) => setTimeout(r, 300));

  // 切换策略为 skip
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="import-strategy-skip"]') as HTMLElement;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // 点击导入
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="import-btn"]') as HTMLElement;
    if (btn) btn.click();
  });

  const skipResult = await waitForWindowHook(page, '__testImportResult');
  assert(
    'E13 skip 导入 skipped > 0',
    skipResult?.skipped > 0,
    `imported=${skipResult?.imported}, skipped=${skipResult?.skipped}`
  );

  // 验证原数据不变
  const logsAfterSkip = await readStore(page, 'raw_logs');
  const unchangedLog = logsAfterSkip?.find((l) => l.id === 'test-log-in');
  assert(
    'E14 skip 导入后原数据不变',
    !!unchangedLog && unchangedLog.content === '范围内的碎屑内容',
    unchangedLog ? `content=${unchangedLog.content}` : '未找到 test-log-in'
  );

  // ---------- 旅程 5：聊天记录单独导出 ----------
  await page.evaluate(() => { (window as any).__testExportData = null; });

  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="conversation-export-json"]') as HTMLElement;
    if (btn) btn.click();
  });

  const convContent = await waitForWindowHook(page, '__testExportData');
  let convParsed: any;
  try {
    convParsed = JSON.parse(convContent);
  } catch {
    convParsed = null;
  }

  // 验证只含 copilot_conversations（不含 raw_logs / daily_reviews 等）
  const hasConvs = !!convParsed?.copilot_conversations && Array.isArray(convParsed.copilot_conversations);
  const noLogs = !convParsed?.raw_logs;
  const noReviews = !convParsed?.daily_reviews;
  assert(
    'E15 聊天导出含 copilot_conversations',
    hasConvs,
    `hasConvs=${hasConvs}`
  );
  assert(
    'E16 聊天导出不含其他类型数据',
    noLogs && noReviews,
    `noLogs=${noLogs}, noReviews=${noReviews}`
  );
  const convIds = (convParsed?.copilot_conversations || []).map((c: any) => c.id);
  assert(
    'E17 聊天导出含测试对话 test-conv-1',
    convIds.includes('test-conv-1'),
    `convIds=${JSON.stringify(convIds)}`
  );
  const convRecord = (convParsed?.copilot_conversations || []).find((c: any) => c.id === 'test-conv-1');
  assert(
    'E18 聊天导出含对话消息',
    !!convRecord?.messages && convRecord.messages.length === 2,
    `messages=${convRecord?.messages?.length}`
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
