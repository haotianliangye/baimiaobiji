/**
 * #3 Foundation E2E 测试（Puppeteer）
 *
 * 覆盖五个旅程：
 *   A. 导航：底部 4 Tab 为「记录/回顾/沉淀/洞察」；/diary 重定向到 /review、/insights 重定向到 /insight。
 *   B. 迁移：构造旧版 v7 IndexedDB（daily_diaries + insights + daily_reviews），启动应用触发 v8/v14 升级，
 *      验证数据迁移到 daily_reviews(entry_type) / insights、旧表删除、migration_backups 写入。
 *   C. 回顾合并：迁移后 /review 同列展示「日记」与「回顾」卡片。
 *   D. 洞察图标：TabBar 洞察 tab / 洞察卡片 header / 生成按钮均渲染为 Phosphor Sun 图标（需求 5）。
 *   E. 设置页：点 ≡ 滑出抽屉（菜单 + 所有标签区块）、点项跳全页、横向导航切换 + 胶囊高亮、
 *      标签区块独立滚动/展开收起、抽屉「管理标签」图标入口、毛玻璃遮罩可关闭、
 *      语言入口平铺到对话模型上方、全页直接关闭、桌面端同模式（需求 9 / task-111）。
 *
 * 运行：先 `npm run build`，再 `npm run test:e2e`。
 * 通过退出码 0/1 反映结果，便于 CI。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = 'http://localhost:4173';
const DB_NAME = 'whitewash_diary';
/** Phosphor Sun 图标 path d 起始前缀（regular/fill 等 weight 共享此前缀，用于 E2E 识别 Sun 图标）。 */
const SUN_PATH_PREFIX = 'M120,40V16a8,8,0,0,1,16,0V40';

let serverProc: ChildProcess | null = null;
let browser: Browser | null = null;

const results: { name: string; pass: boolean; detail: string }[] = [];

function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} — ${detail}`);
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
 * 构造一个「旧版 v7」的 whitewash_diary 库。Dexie v4 把 schema 版本 × 10 作为原生 IDB 版本
 * （见 dexie 源码 `Math.round(db.verno * 10)`），所以 schema 7 对应 IDB version 70。
 * 在 version 70 上创建 v7 累积 schema 的五张表（含索引），并写入样本数据。
 * Dexie 打开时读取 IDB version=70 -> 识别为 schema 7 -> 触发 v8 升级。
 */
async function seedV7Db(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, 70);
        req.onupgradeneeded = (e: any) => {
          const idb = e.target.result;
          // 只建表（keyPath=id）。Dexie 靠 IDB 版本号识别 schema 版本，索引非必需。
          for (const store of ['raw_logs', 'daily_diaries', 'daily_reviews', 'insights', 'copilot_conversations']) {
            if (!idb.objectStoreNames.contains(store)) idb.createObjectStore(store, { keyPath: 'id' });
          }
        };
        req.onsuccess = async (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(['daily_diaries', 'insights', 'daily_reviews'], 'readwrite');
          tx.objectStore('daily_diaries').put({
            id: 'd1',
            diary_date: '2026-07-10',
            raw_log_ids: [],
            timeline_json: '[]',
            ai_editorial: '# 日记正文内容',
            ai_summary: '日记摘要',
            ai_review: '',
            updated_at: 1739000000000,
            prompt_index: 0,
            prompt_name: '默认',
          });
          tx.objectStore('insights').put({
            id: 'i1',
            range_type: 'week',
            range_label: '本周',
            start_date: '2026-07-06',
            end_date: '2026-07-12',
            content: '洞察正文内容',
            ai_summary: '洞察摘要',
            created_at: 1739000000000,
          });
          tx.objectStore('daily_reviews').put({
            id: 'r1',
            review_date: '2026-07-10',
            raw_log_ids: [],
            ai_review: '回顾正文内容',
            ai_summary: '回顾摘要',
            review_prompt_index: 0,
            review_prompt_name: '默认',
            updated_at: 1739000000000,
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

async function run() {
  // 1. 启动 vite preview（服务已构建的 dist）
  serverProc = spawn('npx', ['vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // ---------- 旅程 A：导航 ----------
  const pageA = await browser.newPage();
  await pageA.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  // 底部主导航 Tab 文案
  const tabLabels = await pageA.$$eval('nav button, nav a', (els) =>
    els.map((e) => (e.textContent || '').trim()).filter(Boolean)
  );
  const navText = tabLabels.join('|');
  assert(
    'A1 底部导航 4 Tab',
    ['记录', '回顾', '沉淀', '洞察'].every((t) => navText.includes(t)) && !navText.includes('日记'),
    `nav=${navText}`
  );
  // /diary -> /review 重定向
  await pageA.goto(`${BASE_URL}/diary`, { waitUntil: 'networkidle2' });
  assert('A2 /diary 重定向到 /review', pageA.url().includes('/review'), `url=${pageA.url()}`);
  // /insights -> /insight 重定向
  await pageA.goto(`${BASE_URL}/insights`, { waitUntil: 'networkidle2' });
  assert('A3 /insights 重定向到 /insight', pageA.url().includes('/insight'), `url=${pageA.url()}`);
  // 沉淀占位页可达
  await pageA.goto(`${BASE_URL}/thoughts`, { waitUntil: 'networkidle2' });
  const thoughtsText = await pageA.evaluate(() => document.body.textContent || '');
  assert('A4 沉淀占位页可达', thoughtsText.includes('沉淀'), `body含沉淀=${thoughtsText.includes('沉淀')}`);
  await pageA.close();

  // ---------- 旅程 B：迁移 ----------
  // 用独立的浏览器上下文（与导航测试隔离的全新存储），避免旧 v8 库/SW 干扰。
  // 用请求拦截阻止应用脚本执行，从而不打开 Dexie 连接；在同源页面上播种 v7 旧库。
  const ctx = await browser.createBrowserContext();
  const pageB = await ctx.newPage();
  await pageB.setRequestInterception(true);
  let blockScripts = true;
  pageB.on('request', (req) => {
    if (blockScripts && req.resourceType() === 'script') {
      req.abort();
    } else {
      req.continue();
    }
  });
  // 首次加载：HTML 可加载但脚本被拦截 -> 应用未运行 -> 无 DB 连接
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await seedV7Db(pageB);
  // 解除拦截并重新加载 -> 应用 JS 运行，Dexie 识别 v7 旧库触发 v8 升级
  blockScripts = false;
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  const reviews = await readStore(pageB, 'daily_reviews');
  const insights = await readStore(pageB, 'insights');
  const backup = await readStore(pageB, 'migration_backups');
  const oldDiaries = await readStore(pageB, 'daily_diaries');
  const oldMingwu = await readStore(pageB, 'mingwu');

  // daily_reviews 应含迁移后的日记（entry_type='diary', ai_editorial）与回顾（entry_type='review'）
  const migratedDiary = reviews?.find((r) => r.id === 'd1');
  const migratedReview = reviews?.find((r) => r.id === 'r1');
  assert(
    'B1 日记迁移到 daily_reviews(entry_type=diary)',
    !!migratedDiary && migratedDiary.entry_type === 'diary' && migratedDiary.ai_editorial === '# 日记正文内容' && migratedDiary.review_date === '2026-07-10',
    migratedDiary ? `entry_type=${migratedDiary.entry_type}` : '未找到 d1'
  );
  assert(
    'B2 旧回顾补 entry_type=review',
    !!migratedReview && migratedReview.entry_type === 'review',
    migratedReview ? `entry_type=${migratedReview.entry_type}` : '未找到 r1'
  );
  // insights -> insights (v7 -> v8 -> v14)
  const migratedInsight = insights?.find((m) => m.id === 'i1');
  assert(
    'B3 insights 迁移到 insights',
    !!migratedInsight && migratedInsight.insight_type === 'insight' && migratedInsight.content === '洞察正文内容',
    migratedInsight ? `type=${migratedInsight.insight_type}` : '未找到 i1'
  );
  // 旧表删除
  assert('B4 旧 daily_diaries 表已删除', oldDiaries === null, `daily_diaries=${oldDiaries}`);
  assert('B5 旧 mingwu 表已删除', oldMingwu === null, `mingwu=${oldMingwu}`);
  // 迁移备份写入
  const v8Backup = backup?.find((b) => b.key === 'v8');
  assert('B6 migration_backups 写入 v8 快照', !!v8Backup && !!v8Backup.payload, v8Backup ? '有 payload' : '无备份');

  // ---------- 旅程 C：回顾合并 ----------
  await pageB.goto(`${BASE_URL}/review?date=2026-07-10`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));
  const reviewPageText = await pageB.evaluate(() => document.body.textContent || '');
  // 日记卡片与回顾卡片同列展示。折叠卡片只在 header 显示 ai_summary，
  // 故用摘要（日记摘要 / 回顾摘要）与 entryType 标签判断两卡共存。
  assert(
    'C1 回顾页同时展示日记与回顾卡片',
    reviewPageText.includes('日记') &&
      reviewPageText.includes('回顾') &&
      reviewPageText.includes('日记摘要') &&
      reviewPageText.includes('回顾摘要'),
    `含日记摘要=${reviewPageText.includes('日记摘要')}, 含回顾摘要=${reviewPageText.includes('回顾摘要')}`
  );

  // ---------- 旅程 D：洞察 Sun 图标（需求 5 / issue 105） ----------
  // PRD 测试重点：底部 TabBar 洞察 tab 渲染为 Sun、洞察页 header 渲染为 Sun、
  // 全局旧洞察图标处（生成按钮等）均替换为 Sun 无遗漏。
  // pageB 已含迁移后的 insights 记录（i1），可直接验证卡片 header 图标。
  await pageB.goto(`${BASE_URL}/insight`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 800));

  // D1：底部 TabBar 洞察 tab 渲染为 Phosphor Sun 图标
  const d1TabSun = await pageB.evaluate((prefix) => {
    for (const link of document.querySelectorAll('nav a')) {
      if ((link.textContent || '').includes('洞察')) {
        for (const svg of link.querySelectorAll('svg')) {
          for (const p of svg.querySelectorAll('path')) {
            if ((p.getAttribute('d') || '').startsWith(prefix)) return true;
          }
        }
      }
    }
    return false;
  }, SUN_PATH_PREFIX);
  assert(
    'D1 TabBar 洞察 tab 渲染为 Sun 图标',
    d1TabSun,
    d1TabSun ? 'nav 洞察 tab 含 Sun SVG' : 'nav 洞察 tab 未找到 Sun SVG'
  );

  // D2：洞察页卡片 header 渲染为 Phosphor Sun 图标（洞察页内部 header）
  let d2CardSun = false;
  try {
    await pageB.waitForSelector('[data-testid="insight-card"]', { timeout: 10000 });
    d2CardSun = await pageB.evaluate((prefix) => {
      const card = document.querySelector('[data-testid="insight-card"]');
      if (!card) return false;
      const headerBtn = card.querySelector('button');
      if (!headerBtn) return false;
      for (const svg of headerBtn.querySelectorAll('svg')) {
        for (const p of svg.querySelectorAll('path')) {
          if ((p.getAttribute('d') || '').startsWith(prefix)) return true;
        }
      }
      return false;
    }, SUN_PATH_PREFIX);
  } catch {
    d2CardSun = false;
  }
  assert(
    'D2 洞察卡片 header 渲染为 Sun 图标',
    d2CardSun,
    d2CardSun ? '卡片 header 含 Sun SVG' : '卡片 header 未找到 Sun SVG'
  );

  // D3：洞察生成按钮渲染为 Phosphor Sun 图标（全局旧洞察图标处无遗漏）
  const d3GenSun = await pageB.evaluate((prefix) => {
    const btn = document.querySelector('[data-testid="mingwu-generate-btn"]');
    if (!btn) return false;
    for (const svg of btn.querySelectorAll('svg')) {
      for (const p of svg.querySelectorAll('path')) {
        if ((p.getAttribute('d') || '').startsWith(prefix)) return true;
      }
    }
    return false;
  }, SUN_PATH_PREFIX);
  assert(
    'D3 洞察生成按钮渲染为 Sun 图标',
    d3GenSun,
    d3GenSun ? '生成按钮含 Sun SVG' : '生成按钮未找到 Sun SVG'
  );

  // ===========================================================================
  // F: Copilot RAG 选择器文案对齐 + 历史页日期筛选（issue #115）
  // ===========================================================================

  // F-1/2/3: 静态验证 i18n 改文案（不需要打开 Copilot 面板）。
  // 注：项目为 ESM（package.json "type":"module"），__dirname 不可用，用 process.cwd()
  // （与上方 spawn vite preview 的 cwd 一致，E2E 约定从项目根目录运行）。
  const zhI18n = fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', 'zh.ts'), 'utf-8');
  const enI18n = fs.readFileSync(path.join(process.cwd(), 'src', 'i18n', 'en.ts'), 'utf-8');
  assert(
    'F-1 copilot.moduleRecord 文案改为「识微」',
    /copilot\.moduleRecord':\s*'识微'/.test(zhI18n),
    '已改'
  );
  assert(
    'F-2 copilot.moduleThoughts 新增「沉淀」',
    /copilot\.moduleThoughts':\s*'沉淀'/.test(zhI18n) && /copilot\.moduleThoughts':\s*'Thoughts'/.test(enI18n),
    '已加（zh+en 同步）'
  );
  assert(
    'F-3 copilot.moduleDiary 已移除（合并到 review）',
    !/copilot\.moduleDiary/.test(zhI18n) && !/copilot\.moduleDiary/.test(enI18n),
    '已删'
  );

  // F-4: 进入 Copilot 切到历史视图，验证顶部日期选择器存在。
  await pageB.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await pageB.waitForSelector('button[title="白描 Copilot"]', { timeout: 5000 });
  await pageB.click('button[title="白描 Copilot"]');
  await pageB.waitForSelector('button[title="新对话"]', { timeout: 5000 });
  // Puppeteer 不支持 Playwright 的 :has-text() 伪类，改用 evaluate 遍历点击
  // （与 E 旅程点「语音朗读/对话模型」等按钮的写法一致）。
  await pageB.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll('button'))) {
      if ((b.textContent || '').includes('历史')) { (b as HTMLElement).click(); return; }
    }
  });
  await pageB.waitForSelector('[data-testid="history-date-picker"]', { timeout: 3000 });
  const dateBtnText = await pageB.$eval('[data-testid="history-date-picker"]', (el) => (el.textContent || '').trim());
  assert(
    'F-4 历史页顶部日期选择器默认显示「全部日期」',
    dateBtnText.includes('全部'),
    `buttonText="${dateBtnText}"`
  );

  // F-5: 点日期选择器弹出 RagDatePopover 下拉（含全部/本周/本月/本季度/自定义时间）
  await pageB.click('[data-testid="history-date-picker"]');
  await new Promise((r) => setTimeout(r, 300));
  const dropdownOpened = await pageB.evaluate(() => {
    const text = document.body.textContent || '';
    const hasAllDates = text.includes('全部日期') || text.includes('All dates');
    const hasThisWeek = text.includes('本周') || text.includes('This week');
    const hasThisMonth = text.includes('本月') || text.includes('This month');
    const hasThisQuarter = text.includes('本季度') || text.includes('This quarter');
    const hasCustom = text.includes('自定义时间') || text.includes('Custom time');
    return hasAllDates && hasThisWeek && hasThisMonth && hasThisQuarter && hasCustom;
  });
  assert(
    'F-5 点日期选择器弹出预设下拉',
    dropdownOpened,
    dropdownOpened ? '下拉已显示' : '下拉未出现'
  );

  // F-6: 点外部关闭下拉后日期选择器仍可见
  await pageB.evaluate(() => {
    const backdrop = document.querySelector('[data-testid="settings-drawer-backdrop"]')
      || document.querySelector('div.fixed.inset-0');
    if (backdrop) (backdrop as HTMLElement).click();
    else {
      // 无遮罩时点击选择器外部任意空白处
      const picker = document.querySelector('[data-testid="history-date-picker"]');
      if (picker) {
        const rect = picker.getBoundingClientRect();
        const evt = new MouseEvent('mousedown', { bubbles: true, clientX: rect.left - 10, clientY: rect.top - 10 });
        document.body.dispatchEvent(evt);
      }
    }
  });
  await new Promise((r) => setTimeout(r, 200));
  const datePickerStillThere = await pageB.$('[data-testid="history-date-picker"]');
  assert(
    'F-6 关闭下拉后日期选择器仍存在',
    !!datePickerStillThere,
    datePickerStillThere ? '选择器存在' : '选择器丢失'
  );

  await pageB.close();
  await ctx.close();

  // ---------- 旅程 E：设置页（需求 9 / issue 109） ----------
  // PRD 测试重点：抽屉滑出、菜单+标签区块、点项跳全页、横向导航切换+胶囊高亮、桌面同模式、标签滚动、双入口。
  const ctxE = await browser.createBrowserContext();
  const pageE = await ctxE.newPage();
  await pageE.setViewport({ width: 390, height: 844 });

  // 辅助：点 ≡ 进设置抽屉（不抛错，返回是否成功打开）
  const openDrawer = async (p: Page): Promise<boolean> => {
    await p.waitForSelector('button[aria-label="系统设置"]', { timeout: 5000 }).catch(() => {});
    await p.evaluate(() => {
      const btn = document.querySelector('button[aria-label="系统设置"]') as HTMLElement | null;
      if (btn) btn.click();
    });
    try {
      await p.waitForSelector('[data-testid="settings-drawer"]', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };
  // 辅助：点详情页返回按钮（aria-label=返回）退出设置
  const clickDetailBack = (p: Page) =>
    p.evaluate(() => {
      const back = document.querySelector('button[aria-label="返回"]') as HTMLElement | null;
      if (back) back.click();
    });

  // 加载首页，等 app 初始化建库后注入 40 个标签（用于「所有标签」区块滚动测试）
  await pageE.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  await pageE.evaluate(
    (args: { name: string; tags: { path: string; name: string; created_at: number }[] }) =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(args.name);
        req.onsuccess = (e: any) => {
          const idb = e.target.result;
          if (!idb.objectStoreNames.contains('tags')) { idb.close(); return resolve(); }
          const tx = idb.transaction('tags', 'readwrite');
          const store = tx.objectStore('tags');
          for (const t of args.tags) store.put(t);
          tx.oncomplete = () => { idb.close(); resolve(); };
          tx.onerror = () => { idb.close(); reject(tx.error); };
        };
        req.onerror = () => reject(req.error);
      }),
    {
      name: DB_NAME,
      tags: Array.from({ length: 40 }, (_, i) => ({
        path: `测试分类/标签${String(i).padStart(2, '0')}`,
        name: `标签${i}`,
        created_at: Date.now() + i,
      })),
    }
  );
  // 重载让 Dexie liveQuery 读取新标签
  await pageE.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));

  // E1：点击 ≡ 从左侧滑出抽屉
  const e1Ok = await openDrawer(pageE);
  // 等待 framer-motion 滑入动画（duration 0.3s）完成，否则 getBoundingClientRect 读到动画中途 left<0
  if (e1Ok) {
    await pageE
      .waitForFunction(
        () => {
          const d = document.querySelector('[data-testid="settings-drawer"]');
          return !d || d.getBoundingClientRect().left >= -1;
        },
        { timeout: 5000 }
      )
      .catch(() => {});
  }
  const e1Rect = await pageE.evaluate(() => {
    const d = document.querySelector('[data-testid="settings-drawer"]') as HTMLElement | null;
    if (!d) return null;
    const r = d.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  assert(
    'E1 点 ≡ 从左侧滑出抽屉',
    e1Ok && e1Rect !== null && Math.abs(e1Rect.left) < 1 && e1Rect.top === 0,
    e1Rect ? `left=${e1Rect.left}, top=${e1Rect.top}` : 'settings-drawer 未出现'
  );

  // E2：抽屉含设置菜单项 + 「所有标签」区块
  const e2 = await pageE.evaluate(() => {
    const d = document.querySelector('[data-testid="settings-drawer"]');
    const text = d ? (d.textContent || '') : '';
    return {
      hasModel: text.includes('对话模型'),
      hasAllTags: text.includes('所有标签'),
      hasAllTagsBox: !!document.querySelector('[data-testid="drawer-all-tags"]'),
    };
  });
  assert(
    'E2 抽屉含菜单项 + 所有标签区块',
    e2.hasModel && e2.hasAllTags && e2.hasAllTagsBox,
    `对话模型=${e2.hasModel}, 所有标签=${e2.hasAllTags}, 区块=${e2.hasAllTagsBox}`
  );

  // task-111 E2.1：抽屉遮罩为毛玻璃透底效果（非纯黑/灰色实底）
  const e21BackdropClasses = await pageE.evaluate(() => {
    const el = document.querySelector('[data-testid="settings-drawer-backdrop"]');
    return el ? el.className : '';
  });
  assert(
    'E2.1 抽屉遮罩为毛玻璃透底',
    e21BackdropClasses.includes('backdrop-blur') && !e21BackdropClasses.includes('bg-black') && e21BackdropClasses.includes('bg-white/30'),
    `classes=${e21BackdropClasses}`
  );

  // task-111 E2.2：点击遮罩可关闭抽屉
  await pageE.evaluate(() => {
    const backdrop = document.querySelector('[data-testid="settings-drawer-backdrop"]') as HTMLElement | null;
    if (backdrop) backdrop.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  const e22DrawerClosed = await pageE.$('[data-testid="settings-drawer"]') === null;
  assert('E2.2 点击遮罩关闭抽屉', e22DrawerClosed, `抽屉存在=${!e22DrawerClosed}`);

  // 重新打开抽屉，继续测标签区交互
  const e22ReopenOk = await openDrawer(pageE);
  if (e22ReopenOk) {
    await pageE
      .waitForFunction(
        () => {
          const d = document.querySelector('[data-testid="settings-drawer"]');
          return !d || d.getBoundingClientRect().left >= -1;
        },
        { timeout: 5000 }
      )
      .catch(() => {});
  }

  // 等待标签数据渲染（liveQuery 异步读取 40 个标签）
  await pageE
    .waitForFunction(() => document.querySelectorAll('[data-testid="drawer-all-tags"] button').length > 10, { timeout: 5000 })
    .catch(() => {});

  // E6：标签数量多时仅「所有标签」区块内部滚动（抽屉菜单项不滚动）
  const e6 = await pageE.evaluate(() => {
    const tagsBox = document.querySelector('[data-testid="drawer-all-tags"]') as HTMLElement | null;
    const nav = document.querySelector('[data-testid="settings-drawer"] nav') as HTMLElement | null;
    return {
      tagsScrollable: tagsBox ? tagsBox.scrollHeight > tagsBox.clientHeight : false,
      navScrollable: nav ? nav.scrollHeight > nav.clientHeight : false,
      tagsCount: tagsBox ? tagsBox.querySelectorAll('button').length : 0,
    };
  });
  assert(
    'E6 标签多时仅所有标签区块滚动',
    e6.tagsScrollable && !e6.navScrollable,
    `标签区可滚=${e6.tagsScrollable}(共${e6.tagsCount}标签), 菜单区可滚=${e6.navScrollable}`
  );

  // task-111 E6.1：点击标题行可收起/展开所有标签
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-all-tags-toggle"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const e61Collapsed = await pageE.evaluate(() => document.querySelector('[data-testid="drawer-all-tags"]') === null);
  assert('E6.1 点击标题行收起所有标签', e61Collapsed, `收起后标签列表存在=${!e61Collapsed}`);

  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-all-tags-toggle"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const e61Expanded = await pageE.evaluate(() => document.querySelector('[data-testid="drawer-all-tags"]') !== null);
  assert('E6.2 再次点击标题行展开所有标签', e61Expanded, `展开后标签列表存在=${e61Expanded}`);

  // task-112: 标签快捷操作菜单
  // 等待标签节点渲染（注入的 40 个标签构成一个根「测试分类」+ 40 个子标签）
  await pageE
    .waitForFunction(() => document.querySelector('[data-testid^="drawer-tag-node-"]') !== null, { timeout: 5000 })
    .catch(() => {});

  // E9：每个标签节点右侧有展开/收起按钮与三个点「更多」菜单图标
  const e9 = await pageE.evaluate(() => {
    const rootExpand = document.querySelector('[data-testid="drawer-tag-expand-测试分类"]') !== null;
    const rootMore = document.querySelector('[data-testid="drawer-tag-more-测试分类"]') !== null;
    const childMore = document.querySelector('[data-testid="drawer-tag-more-测试分类/标签00"]') !== null;
    return { rootExpand, rootMore, childMore };
  });
  assert(
    'E9 标签节点有展开/更多按钮',
    e9.rootExpand && e9.rootMore && e9.childMore,
    `根展开=${e9.rootExpand}, 根更多=${e9.rootMore}, 子更多=${e9.childMore}`
  );

  // E10：点击「更多」弹出菜单，含置顶、编辑、仅移除标签、删除标签和笔记四项
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-tag-more-测试分类"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await pageE.waitForSelector('[data-testid="drawer-tag-action-menu"]', { timeout: 5000 }).catch(() => {});
  const e10 = await pageE.evaluate(() => {
    const menu = document.querySelector('[data-testid="drawer-tag-action-menu"]');
    if (!menu) return { hasMenu: false, items: {} as Record<string, boolean> };
    return {
      hasMenu: true,
      items: {
        pin: !!menu.querySelector('[data-testid="tag-menu-pin"]'),
        edit: !!menu.querySelector('[data-testid="tag-menu-edit"]'),
        remove: !!menu.querySelector('[data-testid="tag-menu-remove"]'),
        delete: !!menu.querySelector('[data-testid="tag-menu-delete"]'),
      },
    };
  });
  assert(
    'E10 更多菜单含四项',
    e10.hasMenu && e10.items.pin && e10.items.edit && e10.items.remove && e10.items.delete,
    `菜单=${e10.hasMenu}, 四项=${JSON.stringify(e10.items)}`
  );

  // E11：危险操作项在菜单中以警示色区分（class 含 text-rose-600）
  const e11 = await pageE.evaluate(() => {
    const menu = document.querySelector('[data-testid="drawer-tag-action-menu"]');
    if (!menu) return { removeDanger: false, deleteDanger: false };
    const removeBtn = menu.querySelector('[data-testid="tag-menu-remove"]');
    const deleteBtn = menu.querySelector('[data-testid="tag-menu-delete"]');
    return {
      removeDanger: removeBtn?.className.includes('text-rose-600') ?? false,
      deleteDanger: deleteBtn?.className.includes('text-rose-600') ?? false,
    };
  });
  assert(
    'E11 危险操作项有红色警示',
    e11.removeDanger && e11.deleteDanger,
    `移除红=${e11.removeDanger}, 删除红=${e11.deleteDanger}`
  );

  // E12：置顶后标签显示置顶图标
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="tag-menu-pin"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const e12Pinned = await pageE.evaluate(() => document.querySelector('[data-testid="drawer-tag-pinned-测试分类"]') !== null);
  assert('E12 置顶后显示置顶图标', e12Pinned, `置顶图标存在=${e12Pinned}`);

  // E13：点击菜单外部关闭菜单
  await pageE.evaluate(() => {
    const backdrop = document.querySelector('[data-testid="settings-drawer-backdrop"]') as HTMLElement | null;
    if (backdrop) backdrop.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const e13MenuClosed = await pageE.evaluate(() => document.querySelector('[data-testid="drawer-tag-action-menu"]') === null);
  assert('E13 点击菜单外部关闭菜单', e13MenuClosed, `菜单关闭=${e13MenuClosed}`);

  // 重新打开菜单以测试「仅移除标签」确认
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-tag-more-测试分类"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await pageE.waitForSelector('[data-testid="drawer-tag-action-menu"]', { timeout: 5000 }).catch(() => {});
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="tag-menu-remove"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await pageE.waitForSelector('[data-testid="tag-modal-overlay"]', { timeout: 5000 }).catch(() => {});
  const e14 = await pageE.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tag-modal-overlay"]');
    return {
      hasOverlay: overlay !== null,
      text: overlay ? (overlay.textContent || '') : '',
    };
  });
  assert(
    'E14 仅移除标签弹出确认弹窗',
    e14.hasOverlay && e14.text.includes('仅移除标签'),
    `弹窗=${e14.hasOverlay}, 文案=${e14.text.slice(0, 40)}`
  );

  // 取消移除
  await pageE.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tag-modal-overlay"]') as HTMLElement | null;
    if (!overlay) return;
    for (const b of Array.from(overlay.querySelectorAll('button'))) {
      const text = b.textContent || '';
      if (text.includes('取消') || text.includes('Cancel')) { (b as HTMLElement).click(); return; }
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  // 测试「删除标签和笔记」二次确认
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-tag-more-测试分类"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await pageE.waitForSelector('[data-testid="drawer-tag-action-menu"]', { timeout: 5000 }).catch(() => {});
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="tag-menu-delete"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await pageE.waitForSelector('[data-testid="tag-modal-overlay"]', { timeout: 5000 }).catch(() => {});
  const e15a = await pageE.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tag-modal-overlay"]');
    return {
      hasOverlay: overlay !== null,
      text: overlay ? (overlay.textContent || '') : '',
      hasNextBtn: !!overlay?.querySelector('[data-testid="tag-delete-next-btn"]'),
    };
  });
  assert(
    'E15.1 删除标签和笔记弹出首次确认',
    e15a.hasOverlay && e15a.text.includes('删除标签和笔记') && e15a.hasNextBtn,
    `弹窗=${e15a.hasOverlay}, 文案=${e15a.text.slice(0, 40)}, 下一步按钮=${e15a.hasNextBtn}`
  );
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="tag-delete-next-btn"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const e15b = await pageE.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tag-modal-overlay"]');
    return {
      hasOverlay: overlay !== null,
      text: overlay ? (overlay.textContent || '') : '',
      hasFinalBtn: !!overlay?.querySelector('[data-testid="tag-delete-final-btn"]'),
    };
  });
  assert(
    'E15.2 删除标签和笔记进入二次确认',
    e15b.hasOverlay && (e15b.text.includes('无法恢复') || e15b.text.includes('cannot be undone')) && e15b.hasFinalBtn,
    `弹窗=${e15b.hasOverlay}, 文案=${e15b.text.slice(0, 60)}, 最终按钮=${e15b.hasFinalBtn}`
  );
  // 取消删除
  await pageE.evaluate(() => {
    const overlay = document.querySelector('[data-testid="tag-modal-overlay"]') as HTMLElement | null;
    if (!overlay) return;
    for (const b of Array.from(overlay.querySelectorAll('button'))) {
      const text = b.textContent || '';
      if (text.includes('取消') || text.includes('Cancel')) { (b as HTMLElement).click(); return; }
    }
  });
  await new Promise((r) => setTimeout(r, 300));

  // task-111 E8：抽屉「所有标签」快捷入口改为设置图标 -> 全页标签设置
  const e8ManageIcon = await pageE.evaluate(() => document.querySelector('[data-testid="drawer-manage-tags"]') !== null);
  assert('E8.1 管理标签入口为图标', e8ManageIcon, `图标入口存在=${e8ManageIcon}`);
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="drawer-manage-tags"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  try {
    await pageE.waitForSelector('[data-testid="settings-horizontal-nav"]', { timeout: 5000 });
  } catch {}
  await pageE
    .waitForFunction(() => document.querySelector('[data-testid^="tag-node-"]') !== null, { timeout: 5000 })
    .catch(() => {});
  const e8 = await pageE.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-horizontal-nav"]');
    let tagsHi = false;
    if (nav) {
      for (const b of Array.from(nav.querySelectorAll('button'))) {
        const cs = window.getComputedStyle(b);
        if ((b.textContent || '').includes('标签设置') && cs.color === 'rgb(255, 255, 255)') tagsHi = true;
      }
    }
    return { hasTagsContent: !!document.querySelector('[data-testid^="tag-node-"]'), tagsHi };
  });
  assert(
    'E8.2 抽屉管理标签图标入口达标签设置全页',
    e8.hasTagsContent && e8.tagsHi,
    `标签内容=${e8.hasTagsContent}, 标签设置高亮=${e8.tagsHi}`
  );

  // 退出设置回首页，再进抽屉测点菜单项跳全页
  await clickDetailBack(pageE);
  await new Promise((r) => setTimeout(r, 600));

  // E3：点击抽屉菜单项跳转全屏设置详情页（不再右侧展开）
  await openDrawer(pageE);

  // Issue 003 E3.0：语言选择模块位于抽屉 header 下方
  const e30 = await pageE.evaluate(() => {
    const drawer = document.querySelector('[data-testid="settings-drawer"]');
    const switcher = document.querySelector('[data-testid="drawer-language-switcher"]');
    const section = document.querySelector('[data-testid="language-section"]');
    return {
      hasSwitcher: !!switcher,
      hasSection: !!section,
      insideDrawer: drawer && switcher ? drawer.contains(switcher) : false,
    };
  });
  assert(
    'E3.0 语言选择模块在抽屉 header 下方',
    e30.hasSwitcher && !e30.hasSection && e30.insideDrawer,
    `switcher=${e30.hasSwitcher}, section=${e30.hasSection}, 在抽屉内=${e30.insideDrawer}`
  );

  // Issue 003 E3.1：切换语言立即生效（中文 -> English）
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="language-en"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const e31 = await pageE.evaluate(() => {
    const text = document.body.textContent || '';
    return {
      hasEnglish: text.includes('Chat Model') || text.includes('Read Aloud'),
      noZhModel: !text.includes('对话模型'),
    };
  });
  assert('E3.1 切换语言立即生效', e31.hasEnglish && e31.noZhModel, `含英文=${e31.hasEnglish}, 无中文对话模型=${e31.noZhModel}`);

  // 切回中文，避免影响后续断言
  await pageE.evaluate(() => {
    const btn = document.querySelector('[data-testid="language-zh"]') as HTMLElement | null;
    if (btn) btn.click();
  });
  await new Promise((r) => setTimeout(r, 400));

  await pageE.evaluate(() => {
    const drawer = document.querySelector('[data-testid="settings-drawer"]');
    if (!drawer) return;
    for (const b of Array.from(drawer.querySelectorAll('button'))) {
      if ((b.textContent || '').includes('语音朗读')) { (b as HTMLElement).click(); return; }
    }
  });
  let e3Detail = false;
  try {
    await pageE.waitForSelector('[data-testid="settings-horizontal-nav"]', { timeout: 5000 });
    e3Detail = true;
  } catch {}
  const e3DrawerGone = await pageE.$('[data-testid="settings-drawer"]') === null;
  assert(
    'E3 点菜单项跳全屏详情页',
    e3Detail && e3DrawerGone,
    `横向导航=${e3Detail}, 抽屉已隐藏=${e3DrawerGone}`
  );

  // E4：横向导航栏点击切换设置项 + 胶囊高亮当前
  // 点「标签设置」tab
  await pageE.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-horizontal-nav"]');
    if (!nav) return;
    for (const b of Array.from(nav.querySelectorAll('button'))) {
      if ((b.textContent || '').includes('标签设置')) { (b as HTMLElement).click(); return; }
    }
  });
  await pageE
    .waitForFunction(() => document.querySelector('[data-testid^="tag-node-"]') !== null, { timeout: 5000 })
    .catch(() => {});
  const e4a = await pageE.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-horizontal-nav"]');
    let whiteCount = 0;
    let tagsHi = false;
    if (nav) {
      for (const b of Array.from(nav.querySelectorAll('button'))) {
        const cs = window.getComputedStyle(b);
        if (cs.color === 'rgb(255, 255, 255)') {
          whiteCount++;
          if ((b.textContent || '').includes('标签设置')) tagsHi = true;
        }
      }
    }
    return { hasTagsContent: !!document.querySelector('[data-testid^="tag-node-"]'), whiteCount, tagsHi };
  });
  // 点回「对话模型」tab
  await pageE.evaluate(() => {
    const nav = document.querySelector('[data-testid="settings-horizontal-nav"]');
    if (!nav) return;
    for (const b of Array.from(nav.querySelectorAll('button'))) {
      if ((b.textContent || '').includes('对话模型')) { (b as HTMLElement).click(); return; }
    }
  });
  await new Promise((r) => setTimeout(r, 500));
  const e4b = await pageE.evaluate(() => {
    const text = document.body.textContent || '';
    const nav = document.querySelector('[data-testid="settings-horizontal-nav"]');
    let modelHi = false;
    if (nav) {
      for (const b of Array.from(nav.querySelectorAll('button'))) {
        const cs = window.getComputedStyle(b);
        if ((b.textContent || '').includes('对话模型') && cs.color === 'rgb(255, 255, 255)') modelHi = true;
      }
    }
    return { hasModelContent: /Gemini|OpenAI/.test(text), modelHi };
  });
  assert(
    'E4 横向导航切换 + 胶囊高亮',
    e4a.hasTagsContent && e4a.whiteCount === 1 && e4a.tagsHi && e4b.hasModelContent && e4b.modelHi,
    `标签内容=${e4a.hasTagsContent}, 高亮数=${e4a.whiteCount}, 标签高亮=${e4a.tagsHi}; 模型内容=${e4b.hasModelContent}, 模型高亮=${e4b.modelHi}`
  );

  // E7：全屏详情页直接关闭设置（不返回抽屉）
  await clickDetailBack(pageE);
  await new Promise((r) => setTimeout(r, 600));
  const e7Url = pageE.url();
  const e7NavGone = await pageE.$('[data-testid="settings-horizontal-nav"]') === null;
  const e7DrawerGone = await pageE.$('[data-testid="settings-drawer"]') === null;
  assert(
    'E7 全屏详情页直接关闭设置',
    !e7Url.includes('/settings') && e7NavGone && e7DrawerGone,
    `url=${e7Url}, 横向导航已消失=${e7NavGone}, 抽屉已消失=${e7DrawerGone}`
  );

  // E5：桌面端宽屏同样用抽屉 + 全页模式（不保留左右分栏）
  await pageE.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 400));
  const e5DrawerOk = await openDrawer(pageE);
  // 桌面进全页详情，确认横向导航（非左右分栏）
  await pageE.evaluate(() => {
    const drawer = document.querySelector('[data-testid="settings-drawer"]');
    if (!drawer) return;
    for (const b of Array.from(drawer.querySelectorAll('button'))) {
      if ((b.textContent || '').includes('关于')) { (b as HTMLElement).click(); return; }
    }
  });
  let e5Detail = false;
  try {
    await pageE.waitForSelector('[data-testid="settings-horizontal-nav"]', { timeout: 5000 });
    e5Detail = true;
  } catch {}
  assert(
    'E5 桌面端用抽屉 + 全页模式',
    e5DrawerOk && e5Detail,
    `桌面抽屉=${e5DrawerOk}, 桌面横向导航=${e5Detail}`
  );

  await pageE.close();
  await ctxE.close();
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
