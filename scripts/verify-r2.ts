/**
 * verify-r2.ts — 端到端 R2 备份链路验证（Issue #009）
 *
 * 用法：
 *   npx tsx scripts/verify-r2.ts                      # 默认 http://localhost:3000
 *   npx tsx scripts/verify-r2.ts --port 3001
 *   npx tsx scripts/verify-r2.ts --base-url https://my-app.vercel.app
 *
 * 流程：
 *   1) POST /api/r2-presign (kind=put) → 拿签名 URL
 *   2) PUT 一个测试 blob 到 R2
 *   3) POST /api/r2-list → 看到刚 put 的对象
 *   4) POST /api/r2-presign (kind=get) → 拿签名 GET URL
 *   5) GET 拿回内容 → 比对一致
 *
 * 自动从 .env.local 加载环境变量（不强制）。也可以验证生产部署。
 */

import 'dotenv/config';

// ─── CLI args ─────────────────────────────────────────────────────────
function parseArgs(): { port: number; baseUrl: string } {
  const args = process.argv.slice(2);
  let port = 3000;
  let baseUrl = '';
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--port' && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (a === '--base-url' && args[i + 1]) {
      baseUrl = args[i + 1].replace(/\/+$/, '');
      i++;
    } else if (a === '--help' || a === '-h') {
      console.log('Usage: npx tsx scripts/verify-r2.ts [--port N] [--base-url URL]');
      process.exit(0);
    }
  }
  return { port, baseUrl };
}

const { port, baseUrl: argBaseUrl } = parseArgs();
const BASE = argBaseUrl || `http://localhost:${port}`;
const KEY_PREFIX = (process.env.R2_KEY_PREFIX || 'baimiaobiji').replace(/\/+$/, '');

// ─── 输出 helper ──────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m', bright: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const OK = `${c.green}✅${c.reset}`;
const FAIL = `${c.red}❌${c.reset}`;
const INFO = `${c.cyan}🔍${c.reset}`;
const EMOJI_BOX = `${c.cyan}━━━${c.reset}`;

function header(msg: string) { console.log(`\n${EMOJI_BOX} ${c.bright}${msg}${c.reset} ${EMOJI_BOX}`); }
function step(msg: string) { console.log(`${INFO} ${msg}...`); }
function pass(msg: string) { console.log(`   ${OK} ${msg}`); }
function fail(msg: string) { console.log(`   ${FAIL} ${msg}`); }
function tip(msg: string) { console.log(`   ${c.yellow}💡 ${msg}${c.reset}`); }

// ─── 主流程 ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bright}🔍 R2 备份链路验证 (Issue #009)${c.reset}`);
  console.log(`${c.dim}   Target: ${BASE}${c.reset}`);
  console.log(`${c.dim}   .env.local 已加载: ${process.env.R2_BUCKET ? '是' : '否（R2_BUCKET 未设，服务端会返回 503）'}${c.reset}`);

  let failed = 0;

  // 检查服务端是否存活
  step('探测服务端健康');
  try {
    const res = await fetch(`${BASE}/api/health`);
    if (!res.ok) {
      fail(`/api/health 返回 ${res.status}`);
      tip(`服务端可能没启动。本地：npm run dev；远程：检查 Vercel 部署状态`);
      process.exit(1);
    }
    pass(`/api/health 200 OK`);
  } catch (err: any) {
    fail(`无法连接 ${BASE}/api/health：${err.message}`);
    tip(`本地 dev：先开一个终端跑 npm run dev；远程：确认部署 URL 正确`);
    process.exit(1);
  }

  // ─── 步骤 1：presign PUT ────────────────────────────────────────────
  header('步骤 1：POST /api/r2-presign (kind=put)');
  const testKey = `${KEY_PREFIX}/__verify__/${Date.now()}.bin`;
  const testContent = `baimiaobiji verify @ ${new Date().toISOString()}`;
  const testBytes = new TextEncoder().encode(testContent);

  let putUrl = '';
  step(`请求签名 URL（key=${testKey}, contentLength=${testBytes.byteLength}）`);
  try {
    const res = await fetch(`${BASE}/api/r2-presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.R2_OWNER_TOKEN || ''}` },
      body: JSON.stringify({
        kind: 'put',
        key: testKey,
        contentType: 'application/octet-stream',
        contentLength: testBytes.byteLength,
        bucket: process.env.R2_BUCKET,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      failed++;
      fail(`HTTP ${res.status} ${errText.slice(0, 200)}`);
      if (res.status === 503) {
        tip('R2 服务端未配置。回 docs/setup/r2-cloud-backup.md 第 3/5 步检查 Vercel / .env.local');
      } else if (res.status === 400) {
        tip('输入参数问题。本脚本自动构造的参数应该合法；如持续报错请贴 console');
      }
    } else {
      const data = await res.json();
      putUrl = data.url;
      pass(`拿到签名 URL（5min TTL，bucket=${data.bucket}）`);
    }
  } catch (err: any) {
    failed++;
    fail(`请求失败：${err.message}`);
  }

  if (!putUrl) {
    console.log(`\n${c.red}━━━ 验证中止：步骤 1 失败，后续步骤跳过 ━━━${c.reset}\n`);
    process.exit(1);
  }

  // ─── 步骤 2：PUT 到 R2 ─────────────────────────────────────────────
  header('步骤 2：PUT 测试 blob 到签名 URL');
  step('上传中...');
  try {
    const res = await fetch(putUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: testBytes,
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      failed++;
      fail(`HTTP ${res.status} ${errText.slice(0, 200)}`);
      if (res.status === 403) {
        tip('SignatureDoesNotMatch：R2_ACCESS_KEY_ID 或 R2_SECRET_ACCESS_KEY 不对');
      } else if (res.status === 404) {
        tip('NoSuchBucket：R2_BUCKET 名错或 bucket 不存在');
      }
    } else {
      const etag = res.headers.get('ETag');
      pass(`PUT 成功（HTTP 200，ETag=${etag || 'n/a'}）`);
    }
  } catch (err: any) {
    failed++;
    fail(`PUT 请求失败：${err.message}`);
  }

  // ─── 步骤 3：list 看到 ─────────────────────────────────────────────
  header('步骤 3：POST /api/r2-list 看到刚 put 的对象');
  let listOk = false;
  step(`列出 ${KEY_PREFIX}/ prefix 下的对象`);
  try {
    const res = await fetch(`${BASE}/api/r2-list`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.R2_OWNER_TOKEN || ''}` },
      body: JSON.stringify({ prefix: `${KEY_PREFIX}/` }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      failed++;
      fail(`HTTP ${res.status} ${errText.slice(0, 200)}`);
    } else {
      const data = await res.json();
      const found = (data.objects || []).find((o: any) => o.key === testKey);
      if (found) {
        listOk = true;
        pass(`找到测试对象（size=${found.size}, lastModified=${new Date(found.lastModified).toISOString()}）`);
      } else {
        failed++;
        fail(`未找到 key=${testKey}。当前 prefix 共有 ${(data.objects || []).length} 个对象`);
        tip('可能有强一致性延迟，等几秒再重跑一次');
      }
    }
  } catch (err: any) {
    failed++;
    fail(`list 请求失败：${err.message}`);
  }

  // ─── 步骤 4：presign GET ───────────────────────────────────────────
  header('步骤 4：POST /api/r2-presign (kind=get)');
  let getUrl = '';
  step('请求 GET 签名 URL');
  try {
    const res = await fetch(`${BASE}/api/r2-presign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.R2_OWNER_TOKEN || ''}` },
      body: JSON.stringify({
        kind: 'get',
        key: testKey,
        bucket: process.env.R2_BUCKET,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      failed++;
      fail(`HTTP ${res.status} ${errText.slice(0, 200)}`);
    } else {
      const data = await res.json();
      getUrl = data.url;
      pass(`拿到 GET 签名 URL`);
    }
  } catch (err: any) {
    failed++;
    fail(`请求失败：${err.message}`);
  }

  // ─── 步骤 5：GET 比对 ──────────────────────────────────────────────
  header('步骤 5：GET 拿回内容并比对');
  if (!getUrl || !listOk) {
    fail(`跳过（前置步骤失败）`);
    failed++;
  } else {
    step('下载中...');
    try {
      const res = await fetch(getUrl);
      if (!res.ok) {
        failed++;
        fail(`HTTP ${res.status}`);
      } else {
        const downloaded = new TextDecoder().decode(await res.arrayBuffer());
        if (downloaded === testContent) {
          pass(`内容一致（${downloaded.length} 字节）`);
        } else {
          failed++;
          fail(`内容不一致！上传：${testContent.slice(0, 50)}...；下载：${downloaded.slice(0, 50)}...`);
        }
      }
    } catch (err: any) {
      failed++;
      fail(`GET 请求失败：${err.message}`);
    }
  }

  // ─── 汇总 ──────────────────────────────────────────────────────────
  console.log('');
  if (failed === 0) {
    console.log(`${c.green}${c.bright}🎉 整条链路通！可以打开 app 启用云备份了。${c.reset}`);
    console.log(`${c.dim}   下一步：docs/setup/r2-cloud-backup.md 第 7-8 步${c.reset}`);
    process.exit(0);
  } else {
    console.log(`${c.red}${c.bright}💥 ${failed} 步失败${c.reset}`);
    console.log(`${c.yellow}   完整排错：docs/setup/r2-cloud-backup.md 「排错快速参考」${c.reset}`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('脚本异常:', err);
  process.exit(1);
});