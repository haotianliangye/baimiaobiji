/**
 * #8 洞察（Insight）模块 E2E 测试（Puppeteer）
 *
 * 旅程：
 *   A. 生成：mock /api/generate-insight -> 5 槽浮层选 [0,1] -> 卡片含记录与沉淀内容。
 *   B. 双卡片：同时存在「明悟」与「洞察」两类卡片（data-insight-type 区分）。
 *   C. 手动打标签：默认无 AI 自动标签；用户手动添加生效。
 *   D. 5 槽浮层：勾选 3 槽生成 3 张卡；自定义槽徽章显示 prompt_name。
 *
 * 运行：先 `npm run build`，再 `tsx tests/insight.test.ts`。
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

/** Legacy schema mock（settings.prompts[] 缺失时填充 mingwu_report/insight_report） */
const LEGACY_MOCK_INSIGHT_RESPONSE = {
  mingwu_report:
    '# 本周明悟\n\n从「记录测试内容」中，我看到了坚持的力量——每日跑步与阅读，是用户重建掌控感的微习惯。而「沉淀测试内容」让我感受到孤独背后的自由渴望。\n\n明悟之语：孤独不是缺憾，而是自由的代价。\n\n#孤独 #自由',
  mingwu_summary: '记录与沉淀交织出孤独与自由的脉络',
  insight_report:
    '# 本周洞察\n\n「记录测试内容」显示规律运动的习惯回路正在形成。「沉淀测试内容」揭示了情绪与独处的关系。\n\n建议：保持当前运动频率，尝试在独处时记录感受。\n\n#习惯 #运动',
  insight_summary: '记录与沉淀揭示规律运动与情绪模式',
};

/** New schema (settings.prompts[]) — 动态按 slot name 返回报告，让 A1/A2 断言能匹配「记录/沉淀」内容 */
const buildSlotReport = (slotName: string) =>
  `# ${slotName}\n\n「记录测试内容」展示了日常坚持的力量；「沉淀测试内容」揭示了思考的深度。\n\n${slotName}视角下，这是一段值得铭记的历程。\n\n#成长 #${slotName}`;
const buildSlotSummary = (slotName: string) => `${slotName}维度的总结：记录与沉淀交织成长`;

/**
 * mock /api/generate-insight：按请求体里的 settings.prompts[] 动态返回 results[]；
 * 缺省走 legacy schema。
 */
function mockInsightHandler(req: any) {
  let body: any = {};
  try {
    body = JSON.parse(req.postData() || '{}');
  } catch {
    /* ignore parse error */
  }
  const prompts = body.settings?.prompts;
  if (Array.isArray(prompts) && prompts.length > 0) {
    const results = prompts.map((p: any) => ({
      index: p.index,
      name: p.name,
      report: buildSlotReport(p.name),
      summary: buildSlotSummary(p.name),
    }));
    return JSON.stringify({ results });
  }
  return JSON.stringify(LEGACY_MOCK_INSIGHT_RESPONSE);
}

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
            content: '记录测试内容：今天跑步五公里，读了半小时书',
            created_at: oneDayAgo,
            timezone: 'Asia/Shanghai',
            tags: [],
          });
          tx.objectStore('thoughts').put({
            id: 'test-thought-1',
            content: '沉淀测试内容：关于孤独与自由的思考',
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

/**
 * 清空 insights 表（不删库，避免破坏 schema/索引）。
 * 旅程 D 之前调用，让 3 槽断言独立计数。
 */
async function clearInsights(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('insights')) {
            idb.close();
            return resolve();
          }
          const tx = idb.transaction('insights', 'readwrite');
          tx.objectStore('insights').clear();
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

  // 请求拦截：mock /api/generate-insight（新/旧 schema 都覆盖），其余同源放行
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('/api/generate-insight')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: mockInsightHandler(req),
      });
    } else {
      req.continue();
    }
  });

  // ---------- 旅程 A：生成（默认 [0,1]） ----------
  // 首次加载 -> 应用创建 DB -> 插入样本数据 -> 重新加载使 useLiveQuery 生效
  await page.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await seedRecords(page);
  await page.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // 点击底部按钮 → 浮层出现 → 浮层内「生成 N 篇」按钮触发生成
  await page.waitForSelector('[data-testid="mingwu-generate-btn"]', { timeout: 10000 });
  await page.click('[data-testid="mingwu-generate-btn"]');
  await page.waitForSelector('[data-testid="insight-slot-0"]', { timeout: 5000 });
  // D1 浮层「生成 N 篇」按钮文案校验：默认 2 槽 → "生成 2 篇洞察"
  const genBtnTextBefore = await page.$eval('[data-testid="insight-generate-n-btn"]', (el) => el.textContent || '');
  assert(
    'A0 浮层「生成 N 篇洞察」按钮显示选中数（默认 2）',
    genBtnTextBefore.includes('2'),
    `text=${genBtnTextBefore.trim()}`
  );
  await page.click('[data-testid="insight-generate-n-btn"]');

  // 等待卡片渲染（mock 即时返回，store 创建两条记录后 useLiveQuery 更新）
  await page.waitForSelector('[data-testid="insight-card"]', { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 1000));

  // ---------- 断言 A：卡片含记录与沉淀内容 ----------
  const insightRecords = await readStore(page, 'insights');
  const allContent = insightRecords.map((m) => m.content || '').join('\n');
  assert(
    'A1 卡片内容含记录内容',
    allContent.includes('记录测试内容'),
    `content含记录测试内容=${allContent.includes('记录测试内容')}`
  );
  assert(
    'A2 卡片内容含沉淀内容',
    allContent.includes('沉淀测试内容'),
    `content含沉淀测试内容=${allContent.includes('沉淀测试内容')}`
  );

  // ---------- 断言 B：同时存在明悟与洞察两类卡片 ----------
  const insightTypeCards = await page.$$eval('[data-testid="insight-card"]', (els) =>
    els.map((e) => e.getAttribute('data-insight-type') || '')
  );
  const hasMingwu = insightTypeCards.includes('mingwu');
  const hasInsight = insightTypeCards.includes('insight');
  assert(
    'B1 同时存在明悟与洞察两类卡片',
    hasMingwu && hasInsight,
    `mingwu=${hasMingwu}, insight=${hasInsight}, types=${insightTypeCards.join(',')}`
  );

  // 验证类型徽标存在（testid 沿用旧值）
  const mingwuBadge = await page.$('[data-testid="insight-type-badge-mingwu"]');
  const insightBadge = await page.$('[data-testid="insight-type-badge-insight"]');
  assert('B2 明悟类型徽标存在', !!mingwuBadge, mingwuBadge ? '有徽标' : '无徽标');
  assert('B3 洞察类型徽标存在', !!insightBadge, insightBadge ? '有徽标' : '无徽标');

  // ---------- 断言 C：手动打标签（默认无 AI 自动标签） ----------
  const insightWithoutTags = insightRecords.filter((m) => !m.tags || m.tags.length === 0);
  assert(
    'C1 新生成的 insights 默认 tags 为空（无 AI 自动标签）',
    insightWithoutTags.length === insightRecords.length && insightRecords.length >= 2,
    `空tags记录数=${insightWithoutTags.length}/${insightRecords.length}`
  );

  // C2 手动添加标签生效
  const firstCard = await page.$('[data-testid="insight-card"]');
  if (firstCard) {
    const addBtn = await firstCard.$('[data-testid="insight-tag-add-btn"]');
    if (addBtn) {
      await addBtn.click();
      const input = await firstCard.$('input[placeholder*="标签"], input[placeholder*="Tag"]');
      if (input) {
        await input.fill('工作');
        await input.press('Enter');
        await page.waitForTimeout(500);
        const afterAdd = await readStore(page, 'insights');
        const tagged = afterAdd.find((m) => (m.tags || []).includes('工作'));
        assert(
          'C2 手动添加标签后，insights 中能找到「工作」',
          !!tagged,
          tagged ? `tags=${JSON.stringify(tagged.tags)}` : '未找到'
        );
      } else {
        assert('C2 手动添加标签', false, '未找到 tag 输入框');
      }
    } else {
      assert('C2 手动添加标签', false, '未找到 + 按钮');
    }
  } else {
    assert('C2 手动添加标签', false, '未找到 insight-card');
  }

  // ---------- 旅程 D：5 槽多选（[0,1,2] 共 3 槽） ----------
  // 清空已有卡，让 3 槽断言独立计数
  await clearInsights(page);
  await page.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 500));

  await page.click('[data-testid="mingwu-generate-btn"]');
  await page.waitForSelector('[data-testid="insight-slot-0"]', { timeout: 5000 });
  // 勾选 slot 2（自定义 1）
  await page.click('[data-testid="insight-slot-2"]');
  await new Promise((r) => setTimeout(r, 200));
  // 浮层按钮文案应变成 "生成 3 篇洞察"
  const genBtnTextAfter = await page.$eval('[data-testid="insight-generate-n-btn"]', (el) => el.textContent || '');
  assert(
    'D1 浮层「生成 N 篇洞察」按钮显示 3 槽',
    genBtnTextAfter.includes('3'),
    `text=${genBtnTextAfter.trim()}`
  );
  await page.click('[data-testid="insight-generate-n-btn"]');

  // 等待 3 张卡片
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="insight-card"]').length >= 3,
    { timeout: 15000 }
  );
  await new Promise((r) => setTimeout(r, 800));

  // ---------- 断言 D：3 槽 → 3 张卡 + custom 徽章 ----------
  const insightRecordsD = await readStore(page, 'insights');
  assert(
    'D2 选中 3 槽时落 3 张 Insight 卡',
    insightRecordsD.length === 3,
    `count=${insightRecordsD.length}`
  );
  const typesD = insightRecordsD.map((m) => m.insight_type).sort();
  assert(
    'D3 3 张卡 insight_type 包含 mingwu/insight/custom',
    typesD.includes('mingwu') && typesD.includes('insight') && typesD.includes('custom'),
    `types=${typesD.join(',')}`
  );
  // custom 卡应有 prompt_index=2 + prompt_name='自定义 1'
  const customCard = insightRecordsD.find((m) => m.insight_type === 'custom');
  assert(
    'D4 custom 卡的 prompt_index=2',
    customCard?.prompt_index === 2,
    `prompt_index=${customCard?.prompt_index}`
  );
  assert(
    'D5 custom 卡的 prompt_name 含"自定义 1"',
    customCard?.prompt_name?.includes('自定义 1') ?? false,
    `prompt_name=${customCard?.prompt_name}`
  );
  // 徽章 testid 沿用 insight-type-badge-custom-{slot} 形式
  const customBadge = await page.$('[data-testid="insight-type-badge-custom-2"]');
  assert('D6 custom 槽徽章存在', !!customBadge, customBadge ? '有徽标' : '无徽标');
  const customBadgeText = customBadge
    ? await customBadge.evaluate((e) => e.textContent || '')
    : '';
  assert(
    'D7 custom 徽章文案含 prompt_name（"自定义 1"）',
    customBadgeText.includes('自定义 1'),
    `badgeText=${customBadgeText.trim()}`
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
