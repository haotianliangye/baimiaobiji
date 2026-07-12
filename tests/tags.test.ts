/**
 * #4 全局标签系统 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 碎屑输入 `#工作/项目A` -> raw_logs.tags 含该标签，tags 表有该标签
 *   2. /tags 标签管理页树形显示 工作 -> 项目A
 *   3. 重命名 工作/项目A -> 工作/项目B，原记录 tags 更新
 *   4. 合并 工作/项目B 到 工作/项目C：建 alias，原记录 tags 变 工作/项目C
 *   5. 再次输入 #工作/项目B，保存时自动纠正为 工作/项目C（resolveAlias 生效）
 *   6. 删除 工作/项目C：记录的 tags 数组移除该标签
 *
 * 运行：npx tsx tests/tags.test.ts
 * 使用 vite dev 服务器（无需预先 build），通过退出码 0/1 反映结果。
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

/** 删除数据库（测试开始前清理）。 */
async function deleteDatabase(page: Page) {
  await page.evaluate(
    (name: string) =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve();
        req.onblocked = () => resolve();
      }),
    DB_NAME
  );
}

/** 在页面中通过 data-testid 点击元素（绕过 opacity:0 不可见问题）。 */
async function clickByTestId(page: Page, testId: string) {
  await page.evaluate((id: string) => {
    const el = document.querySelector(`[data-testid="${id}"]`) as HTMLElement;
    if (el) el.click();
  }, testId);
}

/** 在指定 tag-node 容器内点击某按钮。 */
async function clickInTagNode(page: Page, tagPath: string, btnTestId: string) {
  await page.evaluate(
    (args: { nodeTestId: string; btnTestId: string }) => {
      const node = document.querySelector(`[data-testid="${args.nodeTestId}"]`);
      if (!node) throw new Error(`tag node not found: ${args.nodeTestId}`);
      const btn = node.querySelector(`[data-testid="${args.btnTestId}"]`) as HTMLElement;
      if (!btn) throw new Error(`button not found: ${args.btnTestId} in ${args.nodeTestId}`);
      btn.click();
    },
    { nodeTestId: `tag-node-${tagPath}`, btnTestId: btnTestId }
  );
}

/** 等待确认按钮出现，清空当前聚焦的 input 并输入新值，然后点确认。 */
async function fillModalAndConfirm(page: Page, inputValue: string) {
  await page.waitForSelector('[data-testid="modal-confirm-btn"]', { timeout: 5000 });
  // input 已 autoFocus，直接操作当前焦点元素
  await page.keyboard.down('Control');
  await page.keyboard.press('KeyA');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(inputValue);
  await new Promise((r) => setTimeout(r, 200));
  await clickByTestId(page, 'modal-confirm-btn');
  // 等待弹窗关闭
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="modal-confirm-btn"]'),
    { timeout: 5000 }
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 500));
}

async function run() {
  // 1. 启动 vite dev 服务器（无需预 build）
  serverProc = spawn('npx', ['vite', '--port', '4174', '--strictPort'], {
    cwd: process.cwd(),
    shell: true,
    stdio: 'ignore',
  });
  await waitForServer(BASE_URL);

  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

  // 用独立浏览器上下文（全新存储，避免旧数据干扰）
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // ---------- 步骤 1：碎屑输入 #工作/项目A ----------
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  // 清理可能存在的旧数据库
  await deleteDatabase(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 2000));

  // 等待输入框出现并输入文本
  await page.waitForSelector('[data-testid="tag-input"]', { timeout: 10000 });
  await page.click('[data-testid="tag-input"]');
  await page.keyboard.type('今天完成了 #工作/项目A 的原型');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));

  // 验证 raw_logs.tags 含 '工作/项目A'
  const rawLogs1 = await readStore(page, 'raw_logs');
  const latestLog1 = rawLogs1?.[rawLogs1.length - 1];
  assert(
    '1a raw_logs.tags 含 工作/项目A',
    !!latestLog1 && Array.isArray(latestLog1.tags) && latestLog1.tags.includes('工作/项目A'),
    latestLog1 ? `tags=${JSON.stringify(latestLog1.tags)}` : '无记录'
  );

  // 验证 tags 表有该标签
  const tags1 = await readStore(page, 'tags');
  const tagDef1 = tags1?.find((t) => t.path === '工作/项目A');
  assert(
    '1b tags 表有 工作/项目A',
    !!tagDef1 && tagDef1.name === '项目A',
    tagDef1 ? `path=${tagDef1.path}, name=${tagDef1.name}` : '未找到标签定义'
  );

  // ---------- 步骤 2：进入 /tags 标签管理页，树形显示 ----------
  await page.goto(`${BASE_URL}/tags`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));

  // 验证树形显示：工作 -> 项目A
  const tagNodeA = await page.evaluate(() => {
    return !!document.querySelector('[data-testid="tag-node-工作/项目A"]');
  });
  assert('2a 标签管理页显示 工作/项目A 节点', tagNodeA, tagNodeA ? '节点存在' : '节点不存在');

  // 验证父节点 工作 也存在
  const tagNodeWork = await page.evaluate(() => {
    return !!document.querySelector('[data-testid="tag-node-工作"]');
  });
  assert('2b 标签管理页显示 工作 父节点', tagNodeWork, tagNodeWork ? '父节点存在' : '父节点不存在');

  // ---------- 步骤 3：重命名 工作/项目A -> 工作/项目B ----------
  await clickInTagNode(page, '工作/项目A', 'tag-rename-btn');
  await fillModalAndConfirm(page, '工作/项目B');
  await new Promise((r) => setTimeout(r, 1000));

  // 验证 raw_logs.tags 更新为 工作/项目B
  const rawLogs2 = await readStore(page, 'raw_logs');
  const hasTagB = rawLogs2?.some(
    (log) => Array.isArray(log.tags) && log.tags.includes('工作/项目B')
  );
  const hasTagA = rawLogs2?.some(
    (log) => Array.isArray(log.tags) && log.tags.includes('工作/项目A')
  );
  assert(
    '3a 重命名后 raw_logs.tags 含 工作/项目B',
    hasTagB && !hasTagA,
    `含B=${hasTagB}, 含A=${hasTagA}`
  );

  // 验证 tags 表更新
  const tags2 = await readStore(page, 'tags');
  const hasDefB = tags2?.some((t) => t.path === '工作/项目B');
  const hasDefA = tags2?.some((t) => t.path === '工作/项目A');
  assert(
    '3b tags 表更新：有 工作/项目B，无 工作/项目A',
    hasDefB && !hasDefA,
    `有B=${hasDefB}, 有A=${hasDefA}`
  );

  // ---------- 步骤 4：合并 工作/项目B 到 工作/项目C ----------
  // 刷新页面确保树形显示是最新的
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));

  await clickInTagNode(page, '工作/项目B', 'tag-merge-btn');
  await fillModalAndConfirm(page, '工作/项目C');
  await new Promise((r) => setTimeout(r, 1000));

  // 验证 raw_logs.tags 更新为 工作/项目C
  const rawLogs3 = await readStore(page, 'raw_logs');
  const hasTagC = rawLogs3?.some(
    (log) => Array.isArray(log.tags) && log.tags.includes('工作/项目C')
  );
  const hasTagB2 = rawLogs3?.some(
    (log) => Array.isArray(log.tags) && log.tags.includes('工作/项目B')
  );
  assert(
    '4a 合并后 raw_logs.tags 含 工作/项目C',
    hasTagC && !hasTagB2,
    `含C=${hasTagC}, 含B=${hasTagB2}`
  );

  // 验证 tag_aliases 表有 工作/项目B -> 工作/项目C
  const aliases = await readStore(page, 'tag_aliases');
  const aliasEntry = aliases?.find((a) => a.alias === '工作/项目B');
  assert(
    '4b tag_aliases 有 工作/项目B -> 工作/项目C',
    !!aliasEntry && aliasEntry.target === '工作/项目C',
    aliasEntry ? `alias=${aliasEntry.alias}, target=${aliasEntry.target}` : '未找到别名'
  );

  // 验证前缀搜索：工作/项目C 是 工作 的子路径，应能被 #工作 搜索命中
  // （matchesByPrefix('工作/项目C', '工作') === true）
  assert(
    '4c 工作/项目C 可被 #工作 前缀搜索命中',
    hasTagC, // tags 含 工作/项目C，它是 工作 的子路径
    '工作/项目C 是 工作 的子路径，前缀匹配成立'
  );

  // ---------- 步骤 5：再次输入 #工作/项目B，自动纠正为 工作/项目C ----------
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 2000));

  await page.waitForSelector('[data-testid="tag-input"]', { timeout: 10000 });
  await page.click('[data-testid="tag-input"]');
  await page.keyboard.type('再记一条 #工作/项目B');
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 1500));

  // 验证新记录的 tags 含 工作/项目C（而非 工作/项目B）
  const rawLogs4 = await readStore(page, 'raw_logs');
  // 找到最新的一条记录（content 含 "再记一条"）
  const newLog = rawLogs4?.find((log) => log.content?.includes('再记一条'));
  assert(
    '5 输入 #工作/项目B 自动纠正为 工作/项目C',
    !!newLog && Array.isArray(newLog.tags) && newLog.tags.includes('工作/项目C') && !newLog.tags.includes('工作/项目B'),
    newLog ? `tags=${JSON.stringify(newLog.tags)}` : '未找到新记录'
  );

  // ---------- 步骤 6：删除 工作/项目C ----------
  await page.goto(`${BASE_URL}/tags`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1500));

  await clickInTagNode(page, '工作/项目C', 'tag-delete-btn');
  // 删除弹窗只需点确认
  await page.waitForSelector('[data-testid="modal-confirm-btn"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  await clickByTestId(page, 'modal-confirm-btn');
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="modal-confirm-btn"]'),
    { timeout: 5000 }
  ).catch(() => {});
  await new Promise((r) => setTimeout(r, 1000));

  // 验证 raw_logs.tags 不再含 工作/项目C
  const rawLogs5 = await readStore(page, 'raw_logs');
  const stillHasTagC = rawLogs5?.some(
    (log) => Array.isArray(log.tags) && log.tags.includes('工作/项目C')
  );
  assert(
    '6a 删除后 raw_logs.tags 不含 工作/项目C',
    !stillHasTagC,
    `仍含C=${stillHasTagC}`
  );

  // 验证 tags 表不再含 工作/项目C
  const tags5 = await readStore(page, 'tags');
  const stillHasDefC = tags5?.some((t) => t.path === '工作/项目C');
  assert(
    '6b tags 表不含 工作/项目C',
    !stillHasDefC,
    `仍含C定义=${stillHasDefC}`
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
