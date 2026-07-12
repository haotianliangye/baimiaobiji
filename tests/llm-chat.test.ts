/**
 * #9 LLM Chat E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   1. 打开 Copilot -> 切到「通用 Chat」-> 发消息 -> 验证收到回复
 *   2. 历史会话列表出现新会话且标题=首条用户消息前 20 字
 *   3. IndexedDB 中会话 mode='chat'（不参与明悟/洞察数据源）
 *   4. 导出按钮存在
 *
 * /api/chat 被 request interception mock，不依赖真实 LLM API key。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/llm-chat.test.ts`。
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

  // 用独立浏览器上下文隔离 IndexedDB / localStorage
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // Mock /api/chat 端点 -- 不依赖真实 LLM API key
  let chatApiCalled = false;
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/chat') && !req.url().includes('copilot') && req.method() === 'POST') {
      chatApiCalled = true;
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reply: '这是测试回复消息。' }),
      });
    } else {
      req.continue();
    }
  });

  // 2. 导航到应用，等待首屏加载
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1000));

  // 3. 打开 Copilot 面板（点击 Header 的 MessageSquare 图标按钮）
  const copilotBtn = await page.$('button[title="白描 Copilot"]');
  assert('D1 Copilot 入口按钮存在', !!copilotBtn, copilotBtn ? '找到' : '未找到');
  if (copilotBtn) {
    await copilotBtn.click();
  }
  // 等待 Copilot 面板出现
  await page.waitForFunction(
    () => document.body.textContent?.includes('白描 Copilot'),
    { timeout: 5000 }
  );
  await new Promise((r) => setTimeout(r, 500));

  // 4. 验证模式切换按钮存在
  const bodyTextAfterOpen = await page.evaluate(() => document.body.textContent || '');
  assert(
    'D2 模式切换按钮存在',
    bodyTextAfterOpen.includes('RAG 问答') && bodyTextAfterOpen.includes('通用 Chat'),
    `RAG问答=${bodyTextAfterOpen.includes('RAG 问答')}, 通用Chat=${bodyTextAfterOpen.includes('通用 Chat')}`
  );

  // 5. 切到「通用 Chat」模式
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent?.trim() === '通用 Chat');
    if (btn) (btn as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 500));

  // 6. 验证通用 Chat 输入框出现（placeholder 包含"聊聊"）
  const textarea = await page.$('textarea[placeholder*="聊聊"]');
  assert('D3 通用 Chat 输入框出现', !!textarea, textarea ? '找到' : '未找到');

  // 7. 发送消息
  const testMessage = '你好，这是一条用于测试通用聊天功能的长消息，用于验证标题生成逻辑是否正确';
  const expectedTitle = testMessage.slice(0, 20) + '…';

  // 用 native setter 设置 textarea 值（React 兼容方式，支持中文）
  await page.evaluate((text) => {
    const ta = document.querySelector('textarea[placeholder*="聊聊"]') as HTMLTextAreaElement;
    if (!ta) throw new Error('textarea not found');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    setter?.call(ta, text);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, testMessage);
  await new Promise((r) => setTimeout(r, 300));

  // 按 Enter 发送（桌面环境，ContextChat 的 Enter 处理器会触发 handleSend）
  await page.focus('textarea[placeholder*="聊聊"]');
  await page.keyboard.press('Enter');

  // 8. 等待 mock 回复出现（验证完整发送-接收周期）
  try {
    await page.waitForFunction(
      () => document.body.textContent?.includes('这是测试回复消息'),
      { timeout: 5000 }
    );
    assert('D4 收到模型回复', true, 'mock 回复已出现');
  } catch {
    assert('D4 收到模型回复', false, '超时未出现 mock 回复');
  }

  // 9. 验证 /api/chat 被调用（而非 /api/copilot-chat）
  assert('D5 调用 /api/chat 端点', chatApiCalled, chatApiCalled ? '已调用' : '未调用');

  await new Promise((r) => setTimeout(r, 500));

  // 10. 验证 IndexedDB 中会话 mode='chat' 且标题正确
  const convs = await readStore(page, 'copilot_conversations');
  const chatConv = convs?.find((c) => c.mode === 'chat');
  assert(
    'D6 会话保存 mode=chat',
    !!chatConv,
    chatConv ? `mode=${chatConv.mode}` : `convs=${convs?.length || 0}`
  );
  assert(
    'D7 标题为首条用户消息前 20 字',
    !!chatConv && chatConv.title === expectedTitle,
    chatConv ? `title="${chatConv.title}" expected="${expectedTitle}"` : '无会话'
  );

  // 11. 切到历史会话 tab，验证列表显示新会话
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find((b) => b.textContent?.trim() === '历史会话');
    if (btn) (btn as HTMLElement).click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const historyText = await page.evaluate(() => document.body.textContent || '');
  assert(
    'D8 历史会话列表显示新会话标题',
    historyText.includes(testMessage.slice(0, 20)),
    `含标题前缀=${historyText.includes(testMessage.slice(0, 20))}`
  );

  // 12. 验证历史列表有导出按钮
  const exportBtn = await page.$('button[title="导出 Markdown"]');
  assert('D9 导出按钮存在', !!exportBtn, exportBtn ? '找到' : '未找到');

  // 13. 验证历史列表有删除按钮
  const deleteBtn = await page.$('button[title="删除会话"]');
  assert('D10 删除按钮存在', !!deleteBtn, deleteBtn ? '找到' : '未找到');

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
