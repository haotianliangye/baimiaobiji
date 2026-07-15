/**
 * #14 统一分块与向量化 pipeline E2E 测试（Puppeteer）
 *
 * 覆盖旅程：
 *   A. 统一 pipeline 产出分块：文本经 清洗->分块->Embedding->存储 后，chunks 表出现分块，
 *      每条分块元数据含 source_type / source_id / field / created_at / tags。
 *   B. 长文本按原文分块：回顾（ai_review）/ 明悟（content）长文本被切成多个 chunk（chunk_index 连续）。
 *   C. 多媒体摘要可被向量化：raw_logs.attachment_summary 产出 field='attachment_summary' 的分块，
 *      带非空 embedding，证明多媒体摘要已进入可检索的分块存储。
 *   D. 向后兼容：inline embedding 字段（.embedding / .attachment_embedding）仍被写入，
 *      现有检索读 .embedding 的逻辑不受影响。
 *
 * 触发方式：在 localStorage 预置 embedEnabled=true + 预填 embedding 队列，应用加载后
 * initEmbeddingQueueListener 的 3s 定时器自动消费队列（mock /api/generate-embedding）。
 *
 * 运行：先 `npm run build`，再 `npx tsx tests/chunking.test.ts`。
 * 通过退出码 0/1 反映结果，便于 CI。
 *
 * 端口 4177，与既有测试端口（4173-4176）隔离，便于串行运行。
 */
import puppeteer, { type Browser, type Page } from 'puppeteer';
import { spawn, type ChildProcess } from 'child_process';
import http from 'http';

const BASE_URL = 'http://localhost:4177';
const DB_NAME = 'whitewash_diary';
// 预置队列：record / multimedia / review / insight 四类任务，对应四条种子数据。
const QUEUE_KEY = 'baimiao_pending_embeddings';
const SETTINGS_KEY = 'whitewash-settings';

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

/** 构造一段足够长的中文文本（多个句子），确保被切成多个分块。 */
function longReviewText(): string {
  const sentences = [
    '这一周过得充实而忙碌，每天都有些值得记录的小事。',
    '周一开始整理上周的笔记，把零散的碎屑归类到不同的标签下，发现很多想法其实是同一条线索的延伸。',
    '周二读了《深度工作》的前三章，作者强调专注力是现代社会最稀缺的资源，碎片化正在侵蚀我们的思考深度。',
    '周三尝试了番茄工作法，每二十五分钟专注做一件事，然后休息五分钟，效率确实有所提升。',
    '周四回顾了本月的支出明细，发现餐饮和交通占比偏高，下个月需要更有意识地控制预算。',
    '周五和团队开了一个很长的会议，讨论下季度的产品目标和优先级排序，争论很激烈但最终达成共识。',
    '周六去公园散步，沿着湖边走了很久，思考工作与生活之间究竟应该怎样平衡才算合适。',
    '周日整理了本周的明悟，意识到自己在时间分配上还有很大的改进空间，尤其是深度思考的时间太少。',
    '本周还试了一种新的晨间仪式，起床后先写三页意识流，把脑子里杂乱的念头倒出来，再去开始正式工作。',
    '这个习惯让我的注意力更加集中，也让我更清楚地看到自己真正在意的事情是什么。',
    '另外我开始记录每天的情绪曲线，用一到十分标注能量值，观察哪些活动在消耗我，哪些在滋养我。',
    '数据积累了几周后，我发现自己周三周四的能量总是最低，可能是周中疲劳累积的结果。',
    '于是我调整了日程，把最需要创造力的工作放在周一周二，把机械性的事务挪到周中。',
    '这个小小的调整带来了意想不到的效果，整体产出质量有了明显提升。',
    '我还重新审视了自己订阅的各种信息源，退订了十几个不再带来价值的邮件列表和公众号。',
    '信息摄入的减少反而让我对真正重要的内容更加敏感，注意力不再被无效信息稀释。',
    '下周计划继续深化这套时间与能量管理的实验，并把观察到的方法论沉淀成一篇完整的复盘。',
  ];
  // 重复一遍以确保文本足够长（约 1700 字 -> 估算 >2500 tokens -> 多个分块）
  return [...sentences, ...sentences].join('');
}

function longMingwuText(): string {
  const sentences = [
    '这段时间反复在想一个问题：什么是真正属于自己的节奏。',
    '外部的评价体系总是催促我们更快更多，但人的精力是有上限的。',
    '我逐渐明白，与其追求在所有维度上都领先，不如在少数几件重要的事上做到极致。',
    '这周的一次失败给了我很深的教训，我试图同时推进五个项目，结果每一个都做得不够好。',
    '后来我痛下决心砍掉了三个，只保留两个最核心的方向，立刻感觉到了专注带来的复利。',
    '我开始相信，减法比加法更难，也更有价值。',
    '每一次说不，都是在为真正重要的事情腾出空间。',
    '这种思维方式不只适用于工作，也适用于人际关系和信息消费。',
    '我希望自己能持续地、诚实地审视：哪些是我真正选择的，哪些只是惯性的延续。',
    '把这个问题想清楚，也许比任何具体的方法论都重要。',
  ];
  return [...sentences, ...sentences].join('');
}

/**
 * 构造 v11（IDB version 110）的 whitewash_diary 库并播种测试数据：
 *   - raw_logs: 一条带 content + attachment_summary + tags 的拾微（record + multimedia 两类任务）
 *   - daily_reviews: 一条 entry_type='review'、ai_review 长文本的回顾（多个分块）
 *   - mingwu: 一条 content 长文本的洞察（多个分块）
 * 同时预置 localStorage：开启 embedding（embedEnabled=true）+ 预填 embedding 队列。
 * Dexie 打开时识别 IDB 110 -> v11，升级到 v12（新增 chunks 表），种子数据原样保留。
 */
async function seedDb(page: Page) {
  await page.evaluate(
    (args: { dbName: string; queueKey: string; settingsKey: string; review: string; mingwu: string }) =>
      new Promise<void>((resolve, reject) => {
        // 1. 预置 localStorage：embedding 开启 + 队列
        const settings = {
          state: {
            embedEnabled: true,
            embedProvider: 'gemini',
            embedApiKey: 'test-key',
            embedBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
            embedModel: 'gemini-embedding-2',
          },
          version: 10,
        };
        localStorage.setItem(args.settingsKey, JSON.stringify(settings));
        const queue = [
          { id: 'log-1', type: 'record', retryCount: 0 },
          { id: 'log-1', type: 'multimedia', retryCount: 0 },
          { id: 'review-1', type: 'review', retryCount: 0 },
          { id: 'mingwu-1', type: 'insight', retryCount: 0 },
        ];
        localStorage.setItem(args.queueKey, JSON.stringify(queue));

        // 2. 播种 IDB v11（IDB version 110）
        const req = indexedDB.open(args.dbName, 110);
        req.onupgradeneeded = (e: any) => {
          const idb = e.target.result;
          const stores = [
            { name: 'raw_logs', keyPath: 'id' },
            { name: 'daily_reviews', keyPath: 'id' },
            { name: 'mingwu', keyPath: 'id' },
          ];
          for (const s of stores) {
            if (!idb.objectStoreNames.contains(s.name)) {
              idb.createObjectStore(s.name, { keyPath: s.keyPath });
            }
          }
        };
        req.onsuccess = async (e: any) => {
          const idb = e.target.result;
          const tx = idb.transaction(['raw_logs', 'daily_reviews', 'mingwu'], 'readwrite');

          // raw_logs：短 content（1 分块）+ attachment_summary（多媒体摘要 1 分块）+ tags
          tx.objectStore('raw_logs').put({
            id: 'log-1',
            content: '今天读了一本关于时间管理的书，很有启发，决定从明天开始尝试新的工作节奏。',
            created_at: Date.UTC(2026, 6, 10, 10, 0, 0),
            timezone: 'Asia/Shanghai',
            tags: ['工作/阅读'],
            attachments: [{ kind: 'image', ref: 'att-1', summary: '一张风景照片，远处有山峦和湖泊。' }],
            attachment_summary: '一张风景照片，远处有山峦和湖泊，近处有大片绿色草地，天空晴朗。',
          });

          // daily_reviews：长 ai_review（多个分块）
          tx.objectStore('daily_reviews').put({
            id: 'review-1',
            review_date: '2026-07-10',
            entry_type: 'review',
            ai_review: args.review,
            ai_summary: '本周回顾摘要',
            raw_log_ids: [],
            updated_at: Date.UTC(2026, 6, 10, 20, 0, 0),
            tags: ['生活/周记'],
          });

          // mingwu：长 content（多个分块）
          tx.objectStore('mingwu').put({
            id: 'mingwu-1',
            range_type: 'week',
            range_label: '本周',
            start_date: '2026-07-06',
            end_date: '2026-07-12',
            content: args.mingwu,
            ai_summary: '洞察摘要',
            created_at: Date.UTC(2026, 6, 11, 10, 0, 0),
            mingwu_type: 'insight',
            tags: ['成长/反思'],
          });

          tx.oncomplete = () => {
            idb.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { dbName: DB_NAME, queueKey: QUEUE_KEY, settingsKey: SETTINGS_KEY, review: longReviewText(), mingwu: longMingwuText() }
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

/** 等待 chunks 表中分块数达到预期（轮询，因 pipeline 异步）。 */
async function waitForChunkCount(page: Page, minCount: number, timeoutMs = 20000): Promise<any[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const chunks = (await readStore(page, 'chunks')) || [];
    if (chunks.length >= minCount) return chunks;
    await new Promise((r) => setTimeout(r, 500));
  }
  return (await readStore(page, 'chunks')) || [];
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

  // 独立浏览器上下文隔离 IndexedDB / localStorage
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();

  // processEmbeddingQueue 检查 navigator.onLine；headless Chrome 默认为 true，
  // 这里显式锁定以防环境差异导致 3s 定时器不触发 pipeline。
  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
  });

  // 请求拦截：首次加载阻止脚本 -> 播种 IDB + localStorage -> 解除拦截并 mock embedding -> 重新加载
  await page.setRequestInterception(true);
  let blockScripts = true;
  page.on('request', (req) => {
    if (blockScripts && req.resourceType() === 'script') {
      req.abort();
    } else if (req.url().includes('/api/generate-embedding')) {
      // mock embedding 端点：返回固定向量（pipeline 对每块调用一次）
      req.respond({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ embedding: [0.12, 0.34, 0.56, 0.78] }),
      });
    } else {
      req.continue();
    }
  });

  // 首次加载：HTML 可加载但脚本被拦截 -> 应用未运行 -> 无 DB 连接 -> 安全播种
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await seedDb(page);

  // 解除拦截（脚本放行，embedding 端点继续 mock）-> 重新加载 -> 应用 JS 运行
  blockScripts = false;
  await page.goto(`${BASE_URL}/`, { waitUntil: 'networkidle2' });

  // 等待 pipeline 消费队列：4 条任务，长文本各产出多个分块，预期 >= 6 条分块
  // （record 1 + multimedia 1 + review N>=2 + mingwu N>=2 = 至少 6）
  const chunks = await waitForChunkCount(page, 6, 25000);

  // ---------- 旅程 A：统一 pipeline 产出分块 + 元数据 ----------
  assert('A1 chunks 表已创建且有分块', chunks.length > 0, `chunks=${chunks.length}`);

  const hasMeta = chunks.every(
    (c) =>
      typeof c.source_type === 'string' &&
      typeof c.source_id === 'string' &&
      typeof c.field === 'string' &&
      typeof c.created_at === 'number' &&
      Array.isArray(c.tags) &&
      typeof c.chunk_index === 'number' &&
      typeof c.text === 'string' &&
      Array.isArray(c.embedding) &&
      typeof c.embedding_version === 'string'
  );
  assert(
    'A2 每条分块元数据完整（source_type/source_id/field/created_at/tags/chunk_index/text/embedding/embedding_version）',
    hasMeta,
    hasMeta ? '元数据齐全' : `缺失: ${JSON.stringify(Object.keys(chunks[0] || {}))}`
  );

  // record 分块
  const recordChunks = chunks.filter((c) => c.source_type === 'raw_logs' && c.field === 'content');
  assert(
    'A3 拾微 content 产出分块',
    recordChunks.length === 1 && recordChunks[0].source_id === 'log-1' && recordChunks[0].chunk_index === 0,
    `recordChunks=${recordChunks.length}`
  );
  assert(
    'A4 拾微分块携带 tags',
    recordChunks.length > 0 && Array.isArray(recordChunks[0].tags) && recordChunks[0].tags.includes('工作/阅读'),
    `tags=${JSON.stringify(recordChunks[0]?.tags)}`
  );

  // ---------- 旅程 B：长文本按原文分块（多个 chunk） ----------
  const reviewChunks = chunks
    .filter((c) => c.source_type === 'daily_reviews' && c.source_id === 'review-1' && c.field === 'ai_review')
    .sort((a, b) => a.chunk_index - b.chunk_index);
  assert(
    'B1 回顾长文本按原文分块为多个 chunk',
    reviewChunks.length >= 2,
    `reviewChunks=${reviewChunks.length}`
  );
  assert(
    'B2 回顾分块 chunk_index 连续（0..N-1）',
    reviewChunks.length >= 2 &&
      reviewChunks.every((c, i) => c.chunk_index === i),
    `indices=${reviewChunks.map((c) => c.chunk_index).join(',')}`
  );
  // 分块文本拼接应覆盖原文（按原文分块，而非只索引摘要）
  const reviewReconstructed = reviewChunks.map((c) => c.text).join('');
  const reviewCoversFull = reviewReconstructed.includes('深度工作') && reviewReconstructed.includes('番茄工作法');
  assert(
    'B3 回顾分块覆盖原文全文（非仅摘要）',
    reviewCoversFull,
    `len=${reviewReconstructed.length}, 含深度工作=${reviewReconstructed.includes('深度工作')}`
  );
  assert(
    'B4 回顾分块携带 created_at + tags',
    reviewChunks.length > 0 &&
      typeof reviewChunks[0].created_at === 'number' &&
      reviewChunks[0].tags.includes('生活/周记'),
    `created_at=${reviewChunks[0]?.created_at}, tags=${JSON.stringify(reviewChunks[0]?.tags)}`
  );

  // 明悟长文本
  const mingwuChunks = chunks
    .filter((c) => c.source_type === 'mingwu' && c.source_id === 'mingwu-1' && c.field === 'content')
    .sort((a, b) => a.chunk_index - b.chunk_index);
  assert(
    'B5 明悟长文本按原文分块为多个 chunk',
    mingwuChunks.length >= 2,
    `mingwuChunks=${mingwuChunks.length}`
  );
  assert(
    'B6 明悟分块 chunk_index 连续',
    mingwuChunks.length >= 2 && mingwuChunks.every((c, i) => c.chunk_index === i),
    `indices=${mingwuChunks.map((c) => c.chunk_index).join(',')}`
  );

  // ---------- 旅程 C：多媒体摘要可被向量化（语义检索可命中） ----------
  const mmChunks = chunks.filter(
    (c) => c.source_type === 'raw_logs' && c.source_id === 'log-1' && c.field === 'attachment_summary'
  );
  assert(
    'C1 多媒体摘要产出分块（field=attachment_summary）',
    mmChunks.length === 1,
    `mmChunks=${mmChunks.length}`
  );
  assert(
    'C2 多媒体摘要分块带非空 embedding（可被语义检索命中）',
    mmChunks.length > 0 && Array.isArray(mmChunks[0].embedding) && mmChunks[0].embedding.length > 0,
    `embeddingLen=${mmChunks[0]?.embedding?.length}`
  );
  // record 与 multimedia 同属 raw_logs/log-1，靠 field 区分，互不覆盖
  assert(
    'C3 record(content) 与 multimedia(attachment_summary) 分块共存且不互相覆盖',
    recordChunks.length === 1 && mmChunks.length === 1,
    `record=${recordChunks.length}, multimedia=${mmChunks.length}`
  );

  // ---------- 旅程 D：向后兼容 -- inline embedding 字段仍被写入 ----------
  const rawLogs = (await readStore(page, 'raw_logs')) || [];
  const log1 = rawLogs.find((l) => l.id === 'log-1');
  assert(
    'D1 raw_logs.embedding（content 首块）仍被写入',
    !!log1 && Array.isArray(log1.embedding) && log1.embedding.length > 0 && !!log1.embedding_version,
    `embedding=${!!log1?.embedding}, version=${log1?.embedding_version}`
  );
  assert(
    'D2 raw_logs.attachment_embedding（多媒体首块）仍被写入',
    !!log1 && Array.isArray(log1.attachment_embedding) && log1.attachment_embedding.length > 0,
    `attachment_embedding=${!!log1?.attachment_embedding}`
  );
  const reviews = (await readStore(page, 'daily_reviews')) || [];
  const review1 = reviews.find((r) => r.id === 'review-1');
  assert(
    'D3 daily_reviews.embedding（回顾首块）仍被写入',
    !!review1 && Array.isArray(review1.embedding) && review1.embedding.length > 0,
    `embedding=${!!review1?.embedding}`
  );
  const mingwuRows = (await readStore(page, 'mingwu')) || [];
  const mingwu1 = mingwuRows.find((m) => m.id === 'mingwu-1');
  assert(
    'D4 mingwu.embedding（明悟首块）仍被写入',
    !!mingwu1 && Array.isArray(mingwu1.embedding) && mingwu1.embedding.length > 0,
    `embedding=${!!mingwu1?.embedding}`
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
