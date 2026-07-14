/**
 * #6 多媒体附件输入 E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   A. 图片附件上传：点击附件按钮 -> 选图片 -> 预览出现 -> 提交 -> 原始 Blob 存入 IDB attachments store。
 *   B. 摘要生成：mock /api/multimedia-summarize 返回摘要 -> 提交图片附件 -> raw_logs 出现 attachment_summary。
 *   C. 开关：设置页 submitMultimedia 开关默认开启且可切换。
 *   D. 链接附件：添加链接 -> 提交 -> raw_logs.attachments 含 link 条目。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/multimedia.test.ts`。
 * 通过退出码 0/1 反映结果，便于 CI。
 *
 * 端口 4174，与 foundation-migration.test.ts（4173）隔离，便于串行运行。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';

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

/** 读取 raw_logs 全部记录。 */
async function readRawLogs(page: Page): Promise<any[]> {
  const logs = await readStore(page, 'raw_logs');
  return logs || [];
}

/** 在 ActionSheet 中点击指定文案的选项。 */
async function clickActionSheetOption(page: Page, label: string) {
  await new Promise((r) => setTimeout(r, 400));
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.textContent || '', btn);
    if (text.includes(label)) {
      await btn.click();
      return true;
    }
  }
  return false;
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

  // ---------- 旅程 A & B：图片附件上传 + 摘要生成 ----------
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    if (req.url().includes('/api/multimedia-summarize')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: '一张风景照片，远处有山峦和湖泊' }),
      });
    } else if (req.url().includes('/api/transcribe')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: '语音转写文本' }),
      });
    } else if (req.url().includes('/api/generate-embedding')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ embedding: [0.1, 0.2, 0.3] }),
      });
    } else {
      req.continue();
    }
  });

  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 点击附件按钮 -> ActionSheet 出现
  await page.waitForSelector('[data-testid="attachment-button"]', { timeout: 5000 });
  await page.click('[data-testid="attachment-button"]');

  // 点击"相册" -> 触发文件选择器
  const [fileChooser] = await Promise.all([
    page.waitForFileChooser({ timeout: 5000 }),
    clickActionSheetOption(page, '相册'),
  ]);

  // 创建 1x1 PNG 测试图片（写入临时文件，Puppeteer fileChooser.accept 需文件路径）
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const tempFilePath = path.join(os.tmpdir(), `baimiao-test-${Date.now()}.png`);
  fs.writeFileSync(tempFilePath, Buffer.from(pngBase64, 'base64'));
  await fileChooser.accept([tempFilePath]);

  // 等待预览出现
  await page.waitForSelector('[data-testid="attachment-preview"]', { timeout: 5000 });
  const previewVisible = await page.$('[data-testid="attachment-preview"]');
  assert('A1 附件预览出现', !!previewVisible, previewVisible ? '预览可见' : '预览未出现');

  // 提交
  await page.waitForSelector('[data-testid="submit-button"]', { timeout: 5000 });
  await page.click('[data-testid="submit-button"]');

  // 等待提交完成 + 摘要生成（异步）
  await new Promise((r) => setTimeout(r, 3000));

  // 验证 attachments store 有 Blob
  const attachments = await readStore(page, 'attachments');
  assert(
    'A2 原始文件存入 IDB attachments store',
    !!attachments && attachments.length > 0 && !!attachments[0].blob,
    attachments ? `${attachments.length} 个附件, type=${attachments[0]?.type}` : 'attachments store 为空'
  );

  // 验证 raw_logs 有 attachments 和 attachment_summary
  const logs = await readRawLogs(page);
  const logWithAttachment = logs.find((l) => l.attachments && l.attachments.length > 0);
  assert(
    'B1 raw_logs 含 attachments 元数据',
    !!logWithAttachment && logWithAttachment.attachments.length > 0,
    logWithAttachment ? `attachments=${logWithAttachment.attachments.length}` : '无附件记录'
  );
  assert(
    'B2 raw_logs 含 attachment_summary',
    !!logWithAttachment && !!logWithAttachment.attachment_summary,
    logWithAttachment ? `summary=${(logWithAttachment.attachment_summary || '').slice(0, 20)}` : '无摘要'
  );

  await page.close();
  await ctx.close();

  // ---------- 旅程 C：submitMultimedia 开关 ----------
  const ctx2 = await browser.createBrowserContext();
  const page2 = await ctx2.newPage();
  await page2.setRequestInterception(true);
  page2.on('request', (req) => req.continue());
  await page2.goto(`${BASE_URL}/settings`, { waitUntil: 'networkidle2' });

  await page2.waitForSelector('[data-testid="submit-multimedia-toggle"]', { timeout: 5000 });
  const toggleBefore = await page2.$eval(
    '[data-testid="submit-multimedia-toggle"]',
    (el) => (el as HTMLInputElement).checked
  );
  assert('C1 开关默认开启', toggleBefore === true, `checked=${toggleBefore}`);

  // 关闭开关
  await page2.click('[data-testid="submit-multimedia-toggle"]');
  await new Promise((r) => setTimeout(r, 500));
  const toggleAfter = await page2.$eval(
    '[data-testid="submit-multimedia-toggle"]',
    (el) => (el as HTMLInputElement).checked
  );
  assert('C2 开关可关闭', toggleAfter === false, `checked=${toggleAfter}`);

  await page2.close();
  await ctx2.close();

  // ---------- 旅程 D：链接附件 ----------
  const ctx3 = await browser.createBrowserContext();
  const page3 = await ctx3.newPage();
  await page3.setRequestInterception(true);
  page3.on('request', (req) => {
    if (req.url().includes('/api/')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: '', text: '', embedding: [] }),
      });
    } else {
      req.continue();
    }
  });
  await page3.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 点击附件按钮 -> 选"链接"
  await page3.waitForSelector('[data-testid="attachment-button"]', { timeout: 5000 });
  await page3.click('[data-testid="attachment-button"]');
  await clickActionSheetOption(page3, '链接');

  // 等待链接输入弹窗
  await page3.waitForSelector('[data-testid="link-input"]', { timeout: 5000 });
  await page3.type('[data-testid="link-input"]', 'https://example.com');
  await page3.click('[data-testid="link-add-confirm"]');

  // 等待预览出现
  await page3.waitForSelector('[data-testid="attachment-preview"]', { timeout: 5000 });

  // 提交
  await page3.waitForSelector('[data-testid="submit-button"]', { timeout: 5000 });
  await page3.click('[data-testid="submit-button"]');
  await new Promise((r) => setTimeout(r, 1500));

  // 验证 raw_logs 含 link 附件
  const logs3 = await readRawLogs(page3);
  const linkLog = logs3.find(
    (l) => l.attachments && l.attachments.some((a: any) => a.kind === 'link')
  );
  assert(
    'D1 链接附件存入 raw_logs',
    !!linkLog,
    linkLog
      ? `link ref=${linkLog.attachments.find((a: any) => a.kind === 'link')?.ref}`
      : '无链接附件'
  );

  await page3.close();
  await ctx3.close();

  // ---------- 旅程 E/F/G/J：附件面板布局、遮罩关闭、取消关闭、移动端视口 ----------
  const ctx4 = await browser.createBrowserContext();
  const page4 = await ctx4.newPage();
  // J: 移动端视口（验证移动端弹出）
  await page4.setViewport({ width: 390, height: 844 });
  await page4.setRequestInterception(true);
  page4.on('request', (req) => req.continue());
  await page4.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 打开附件面板
  await page4.waitForSelector('[data-testid="attachment-button"]', { timeout: 5000 });
  await page4.click('[data-testid="attachment-button"]');
  await page4.waitForSelector('[data-testid="attachment-sheet"]', { timeout: 5000 });

  // E: 6 选项布局完整
  const optionIds = [
    'attachment-option-image',
    'attachment-option-audio',
    'attachment-option-video',
    'attachment-option-link',
    'attachment-option-file',
    'attachment-option-cancel',
  ];
  let allOptionsPresent = true;
  for (const id of optionIds) {
    const el = await page4.$(`[data-testid="${id}"]`);
    if (!el) allOptionsPresent = false;
  }
  assert('E 附件面板 6 选项布局完整', allOptionsPresent, allOptionsPresent ? '6 选项全在' : '有选项缺失');

  // J: 移动端视口弹出（面板可见且贴底）
  await new Promise((r) => setTimeout(r, 400)); // 等待 slide-in 动画完成
  const sheetBox = await page4.$eval('[data-testid="attachment-sheet"]', (el: any) => {
    const rect = el.getBoundingClientRect();
    return { bottom: rect.bottom, height: rect.height, viewportHeight: window.innerHeight };
  });
  assert(
    'J 移动端视口弹出底部面板',
    !!sheetBox && Math.abs(sheetBox.bottom - sheetBox.viewportHeight) < 5 && sheetBox.height > 0,
    `bottom=${sheetBox?.bottom}, height=${sheetBox?.height}, vh=${sheetBox?.viewportHeight}`
  );

  // F: 点击遮罩关闭
  await page4.click('[data-testid="attachment-sheet-mask"]');
  await new Promise((r) => setTimeout(r, 500));
  const sheetGoneAfterMask = await page4.$('[data-testid="attachment-sheet"]');
  assert('F 点击遮罩关闭附件面板', !sheetGoneAfterMask, sheetGoneAfterMask ? '面板仍存在' : '面板已关闭');

  // G: 点击取消关闭
  await page4.click('[data-testid="attachment-button"]');
  await page4.waitForSelector('[data-testid="attachment-sheet"]', { timeout: 5000 });
  await page4.click('[data-testid="attachment-option-cancel"]');
  await new Promise((r) => setTimeout(r, 500));
  const sheetGoneAfterCancel = await page4.$('[data-testid="attachment-sheet"]');
  assert('G 点击取消关闭附件面板', !sheetGoneAfterCancel, sheetGoneAfterCancel ? '面板仍存在' : '面板已关闭');

  await page4.close();
  await ctx4.close();

  // ---------- 旅程 H：accept 属性断言（image/*, audio/*, video/*） ----------
  const ctx5 = await browser.createBrowserContext();
  const page5 = await ctx5.newPage();
  await page5.setViewport({ width: 390, height: 844 });
  await page5.setRequestInterception(true);
  page5.on('request', (req) => req.continue());
  await page5.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 阻止文件选择器弹出，便于连续测试 accept 属性
  await page5.evaluate(`
    var orig = HTMLInputElement.prototype.click;
    window.__origClick = orig;
    HTMLInputElement.prototype.click = function() {
      if (this.type === 'file') return;
      return orig.call(this);
    };
  `);

  const acceptTests = [
    { option: 'attachment-option-image', expected: 'image/*', label: 'image' },
    { option: 'attachment-option-audio', expected: 'audio/*', label: 'audio' },
    { option: 'attachment-option-video', expected: 'video/*', label: 'video' },
  ];
  for (const at of acceptTests) {
    await page5.waitForSelector('[data-testid="attachment-button"]', { timeout: 5000 });
    await page5.click('[data-testid="attachment-button"]');
    await page5.waitForSelector('[data-testid="attachment-sheet"]', { timeout: 5000 });
    // 点击选项 -> 设置 accept，但不弹文件选择器（click 已被拦截）
    await page5.click(`[data-testid="${at.option}"]`);
    await new Promise((r) => setTimeout(r, 500));
    const acceptVal = await page5.$eval(
      '[data-testid="attachment-file-input"]',
      (el: any) => el.getAttribute('accept') || ''
    );
    assert(
      `H ${at.label} accept=${at.expected}`,
      acceptVal === at.expected,
      `accept=${acceptVal}, expected=${at.expected}`
    );
  }

  await page5.close();
  await ctx5.close();

  // ---------- 旅程 I：多选场景 ----------
  const ctx6 = await browser.createBrowserContext();
  const page6 = await ctx6.newPage();
  await page6.setViewport({ width: 390, height: 844 });
  await page6.setRequestInterception(true);
  page6.on('request', (req) => {
    if (req.url().includes('/api/')) {
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ summary: '', text: '', embedding: [] }),
      });
    } else {
      req.continue();
    }
  });
  await page6.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 创建两张测试图片
  const pngBase64Multi =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const tempFile1 = path.join(os.tmpdir(), `baimiao-multi-1-${Date.now()}.png`);
  const tempFile2 = path.join(os.tmpdir(), `baimiao-multi-2-${Date.now()}.png`);
  fs.writeFileSync(tempFile1, Buffer.from(pngBase64Multi, 'base64'));
  fs.writeFileSync(tempFile2, Buffer.from(pngBase64Multi, 'base64'));

  // 打开附件面板，选择多张图片
  await page6.waitForSelector('[data-testid="attachment-button"]', { timeout: 5000 });
  await page6.click('[data-testid="attachment-button"]');
  await page6.waitForSelector('[data-testid="attachment-sheet"]', { timeout: 5000 });
  const [multiChooser] = await Promise.all([
    page6.waitForFileChooser({ timeout: 5000 }),
    page6.click('[data-testid="attachment-option-image"]'),
  ]);
  await multiChooser.accept([tempFile1, tempFile2]);

  // 等待预览出现
  await page6.waitForSelector('[data-testid="attachment-preview"]', { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 500));
  const thumbCount = await page6.$$eval(
    '[data-testid^="attachment-thumb-"]',
    (els: any[]) => els.length
  );
  assert('I 多选场景出现多个预览缩略图', thumbCount >= 2, `thumbCount=${thumbCount}`);

  await page6.close();
  await ctx6.close();
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
