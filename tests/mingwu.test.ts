/**
 * #8 明悟（Mingwu）模块 E2E 测试（Puppeteer）
 *
 * 旅程：
 *   A. 生成：mock /api/generate-mingwu -> 选时间范围生成明悟 -> 卡片含碎屑与沉思内容。
 *   B. 双卡片：同时存在「明悟」与「洞察」两类卡片（data-mingwu-type 区分）。
 *   C. 自动打标签：AI 产出文本中的 #标签 被解析、落库到全局 tags 表、存入 mingwu.tags。
 *
 * 运行：先 `npm run build`，再 `tsx tests/mingwu.test.ts`。
 * 通过退出码 0/1 反映结果，便于 CI。
 *
 * 注：使用独立浏览器上下文 + 请求拦截（同源加载、mock API），避免与其它 E2E 的
 * IndexedDB / vite 端口冲突。端口 4174 与 foundation-migration.test.ts（4173）错开。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

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

/** mock /api/generate-mingwu 的固定响应。报告文本内含碎屑/沉思内容与 #标签。 */
const MOCK_MINGWU_RESPONSE = {
  mingwu_report:
    '# 本周明悟\n\n从「碎屑测试内容」中，我看到了坚持的力量——每日跑步与阅读，是用户重建掌控感的微习惯。而「沉思测试内容」让我感受到孤独背后的自由渴望。\\n\n明悟之语：孤独不是缺憾，而是自由的代价。\n\n#孤独 #自由',
  mingwu_summary: '碎屑与沉思交织出孤独与自由的脉络',
  insight_report:
    '# 本周洞察\n\n「碎屑测试内容」显示规律运动的习惯回路正在形成。「沉思测试内容」揭示了情绪与独处的关系。\n\n建议：保持当前运动频率，尝试在独处时记录感受。\n\n#习惯 #运动',
  insight_summary: '碎屑与沉思揭示规律运动与情绪模式',
};

/**
 * 向已存在的 whitewash_diary 库插入 raw_logs + thoughts 样本数据。
 * 时间戳设为一天前，落在默认「本周」范围内。
 */
async function seedRecords(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          const now = Date.now();
          const oneDayAgo = now - 24 * 60 * 60 * 1000;
          const tx = idb.transaction(['raw_logs', 'thoughts'], 'readwrite');
          tx.objectStore('raw_logs').put({
            id: 'test-log-1',
            content: '碎屑测试内容：今天跑步五公里，读了半小时书',
            created_at: oneDayAgo,
            timezone: 'Asia/Shanghai',
            tags: [],
          });
          tx.objectStore('thoughts').put({
            id: 'test-thought-1',
            content: '沉思测试内容：关于孤独与自由的思考',
            tags: [],
            created_at: oneDayAgo,
            original_created_at: oneDayAgo,
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

/** 读取某 object store 的全部记录；表不存在返回空数组。 */
async function readStore(page: Page, store: string): Promise<any[]> {
  return page.evaluate(
    (args: { name: string; store: string }) =>
      new Promise<any[]>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains(args.store)) {
            idb.close();
            return resolve([]);
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
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4174', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // 独立浏览器上下文（隔离的存储），避免其它 E2E 的库干扰
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // 请求拦截：mock /api/generate-mingwu，其余同源放行
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/generate-mingwu')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_MINGWU_RESPONSE),
      });
    } else {
      req.continue();
    }
  });

  // ---------- 旅程 A：生成 ----------
  // 首次加载 -> 应用创建 DB -> 插入样本数据 -> 重新加载使 useLiveQuery 生效
  await page.goto(`${BASE_URL}/mingwu`, { waitUntil: 'networkidle2' });
  await seedRecords(page);
  await page.goto(`${BASE_URL}/mingwu`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // 确认生成按钮存在并点击
  await page.waitForSelector('[data-testid="mingwu-generate-btn"]', { timeout: 10000 });
  await page.click('[data-testid="mingwu-generate-btn"]');

  // 等待卡片渲染（mock 即时返回，store 创建两条记录后 useLiveQuery 更新）
  await page.waitForSelector('[data-testid="mingwu-card"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1000));

  // ---------- 断言 A：卡片含碎屑与沉思内容 ----------
  const mingwuRecords = await readStore(page, 'mingwu');
  const allContent = mingwuRecords.map((m) => m.content || '').join('\n');
  assert(
    'A1 卡片内容含碎屑内容',
    allContent.includes('碎屑测试内容'),
    `content含碎屑测试内容=${allContent.includes('碎屑测试内容')}`
  );
  assert(
    'A2 卡片内容含沉思内容',
    allContent.includes('沉思测试内容'),
    `content含沉思测试内容=${allContent.includes('沉思测试内容')}`
  );

  // ---------- 断言 B：同时存在明悟与洞察两类卡片 ----------
  const mingwuTypeCards = await page.$$eval('[data-testid="mingwu-card"]', (els) =>
    els.map((e) => e.getAttribute('data-mingwu-type') || '')
  );
  const hasMingwu = mingwuTypeCards.includes('mingwu');
  const hasInsight = mingwuTypeCards.includes('insight');
  assert(
    'B1 同时存在明悟与洞察两类卡片',
    hasMingwu && hasInsight,
    `mingwu=${hasMingwu}, insight=${hasInsight}, types=${mingwuTypeCards.join(',')}`
  );

  // 验证类型徽标存在
  const mingwuBadge = await page.$('[data-testid="mingwu-type-badge-mingwu"]');
  const insightBadge = await page.$('[data-testid="mingwu-type-badge-insight"]');
  assert('B2 明悟类型徽标存在', !!mingwuBadge, mingwuBadge ? '有徽标' : '无徽标');
  assert('B3 洞察类型徽标存在', !!insightBadge, insightBadge ? '有徽标' : '无徽标');

  // ---------- 断言 C：AI 产出自动打标签 ----------
  // mingwu 记录的 tags 字段应非空
  const mingwuWithTags = mingwuRecords.filter((m) => m.tags && m.tags.length > 0);
  assert(
    'C1 mingwu 记录含 tags 字段',
    mingwuWithTags.length >= 2,
    `有tags的记录数=${mingwuWithTags.length}/${mingwuRecords.length}`
  );

  // 全局 tags 表应含 AI 产出的标签定义
  const tagDefs = await readStore(page, 'tags');
  const tagPaths = tagDefs.map((t) => t.path || t.name || '');
  const expectedTags = ['孤独', '自由', '习惯', '运动'];
  const foundTags = expectedTags.filter((t) => tagPaths.includes(t));
  assert(
    'C2 全局 tags 表含 AI 产出标签',
    foundTags.length >= 3,
    `找到标签=${foundTags.join(',')} (期望至少3个)`
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
