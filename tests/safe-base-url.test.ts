/**
 * safeBaseUrl 单元测试（Issue Batch 1）
 *
 * 覆盖：
 *   - 合法 baseUrl（literal IP 127.0.0.1 / localhost / https public / http 自定义代理）
 *   - 拒内网 IP（127.x.x.x / 10.x / 172.16-31 / 192.168.x / 169.254.x / 100.64-127 / 0.x）
 *   - 拒 IPv6 loopback / fc00:: / fe80::
 *   - 拒非 scheme（file: / data: / javascript: / ftp:）
 *   - 拒端口黑名单（22, 25, 135, 139, 445, 3389, 5432, 6379, 9200, 27017）
 *   - 拒空 / 拒格式错误 / 拒非 ASCII host
 *   - assertSafeBaseUrl throw / 归一化去尾 /
 *   - normalizeBaseUrl 纯字符串处理
 *
 * 真实 DNS 解析测试用 httpbin.org / example.com 等公网域；
 * CI 环境无外网时跳过（graceful degradation）。
 *
 * 运行：`npx tsx tests/safe-base-url.test.ts`
 */

import {
  validateBaseUrl,
  assertSafeBaseUrl,
  normalizeBaseUrl,
} from '../src/lib/safeBaseUrl';

const results: { name: string; pass: boolean; detail: string }[] = [];
function record(name: string, cond: boolean, detail: string) {
  results.push({ name, pass: cond, detail });
  console.log(`${cond ? '✅' : '❌'} ${name} - ${detail}`);
}

async function expectOk(name: string, raw: string, detail = '') {
  const r = await validateBaseUrl(raw);
  if (r.ok) {
    record(name, true, `${detail || raw} ok`);
  } else {
    record(name, false, `${detail || raw} unexpectedly rejected: ${r.reason}`);
  }
}

async function expectReject(name: string, raw: string, expectReason?: RegExp) {
  const r = await validateBaseUrl(raw);
  if (!r.ok) {
    const matched = expectReason ? expectReason.test(r.reason) : true;
    record(name, matched, `${raw} → ${r.reason}${matched ? '' : ` (expected ${expectReason})`}`);
  } else {
    record(name, false, `${raw} unexpectedly accepted`);
  }
}

async function run() {
  // ===== 合法 baseUrl（literal IP，无需 DNS）=====
  await expectOk('A1 127.0.0.1 放行（Ollama 默认）', 'http://127.0.0.1:11434/v1');
  await expectOk('A2 localhost 放行', 'http://localhost:8080/v1');
  await expectOk('A3 合法公网 IP', 'https://8.8.8.8/'); // Google DNS
  await expectOk('A4 合法公网 IP + 端口', 'https://1.1.1.1:443/'); // Cloudflare DNS

  // ===== 拒内网 IP（literal）=====
  await expectReject('B1 拒 10.0.0.0/8', 'http://10.0.0.1/', /内网 IP|loopback|RFC1918|link-local|CGNAT/);
  await expectReject('B2 拒 172.16.0.0/12', 'http://172.16.0.1/', /内网 IP/);
  await expectReject('B3 拒 172.31.255.255', 'http://172.31.255.255/', /内网 IP/);
  await expectReject('B4 拒 192.168.0.0/16', 'http://192.168.1.1/', /内网 IP/);
  await expectReject('B5 拒 169.254.169.254（云 metadata）', 'http://169.254.169.254/latest/meta-data/', /内网 IP.*169\.254/);
  await expectReject('B6 拒 127.0.0.2（其他 loopback）', 'http://127.0.0.2/', /内网 IP/);
  await expectReject('B7 拒 0.0.0.0', 'http://0.0.0.0/', /内网 IP/);
  await expectReject('B8 拒 CGNAT 100.64.0.1', 'http://100.64.0.1/', /内网 IP/);

  // ===== 拒 IPv6 内网 =====
  await expectReject('C1 拒 IPv6 ::1 loopback', 'http://[::1]/', /内网 IP/);
  await expectReject('C2 拒 IPv6 fc00::/7', 'http://[fc00::1]/', /内网 IP/);
  await expectReject('C3 拒 IPv6 fe80:: link-local', 'http://[fe80::1]/', /内网 IP/);
  await expectReject('C4 拒 IPv4-mapped IPv6 (::ffff:10.0.0.1)', 'http://[::ffff:10.0.0.1]/', /内网 IP/);

  // ===== 拒非 http(s) scheme =====
  await expectReject('D1 拒 file:', 'file:///etc/passwd', /scheme/);
  await expectReject('D2 拒 javascript:', 'javascript:alert(1)', /scheme/);
  await expectReject('D3 拒 data:', 'data:text/html,xxx', /scheme/);
  await expectReject('D4 拒 ftp:', 'ftp://example.com/', /scheme/);

  // ===== 拒端口黑名单 =====
  await expectReject('E1 拒 22 SSH', 'http://8.8.8.8:22/', /端口 22/);
  await expectReject('E2 拒 6379 Redis', 'http://8.8.8.8:6379/', /端口 6379/);
  await expectReject('E3 拒 27017 MongoDB', 'http://8.8.8.8:27017/', /端口 27017/);

  // ===== 拒空 / 拒格式错误 =====
  await expectReject('F1 拒空字符串', '', /不能为空/);
  await expectReject('F2 拒非法格式', 'not a url', /URL 格式不合法/);
  await expectReject('F3 拒只有 scheme', 'https://', /URL 格式不合法/);

  // ===== 拒非 ASCII host =====
  await expectReject('G1 拒中文 host', 'http://例え.例え/', /非 ASCII|IDN/);
  await expectReject('G2 拒 emoji host', 'http://🚀.com/', /非 ASCII|IDN/);

  // ===== assertSafeBaseUrl throw 行为 =====
  try {
    await assertSafeBaseUrl('http://169.254.169.254/');
    record('H1 assertSafeBaseUrl throw on 拒绝', false, '应 throw');
  } catch (e: any) {
    record('H1 assertSafeBaseUrl throw on 拒绝', /Invalid baseUrl/.test(e.message), `throw: ${e.message}`);
  }

  // ===== assertSafeBaseUrl 成功路径：归一化去尾 / =====
  try {
    const normalized = await assertSafeBaseUrl('http://127.0.0.1:11434/v1/');
    record('H2 assertSafeBaseUrl 归一化去尾/', normalized === 'http://127.0.0.1:11434/v1', `got: ${normalized}`);
  } catch (e: any) {
    record('H2 assertSafeBaseUrl 归一化去尾/', false, `unexpected throw: ${e.message}`);
  }

  // ===== normalizeBaseUrl 纯字符串 =====
  record('I1 normalizeBaseUrl 去尾 /', normalizeBaseUrl('https://api.openai.com/v1/') === 'https://api.openai.com/v1', '');
  record('I2 normalizeBaseUrl 去空格', normalizeBaseUrl('  https://x.com  ') === 'https://x.com', '');
  record('I3 normalizeBaseUrl 空串', normalizeBaseUrl('') === '', '');

  // ===== 真实 DNS 解析（公网域名；CI 无外网时优雅失败）=====
  try {
    await expectOk('J1 公网域名 api.openai.com', 'https://api.openai.com/v1', 'public DNS');
    await expectOk('J2 公网域名 generativelanguage.googleapis.com', 'https://generativelanguage.googleapis.com/', 'public DNS');
  } catch (e: any) {
    record('J 公网 DNS', false, `unexpected: ${e.message}`);
  }

  // ===== 汇总 =====
  const failed = results.filter(r => !r.pass);
  console.log(`\n=== 汇总 ===`);
  console.log(`通过: ${results.length - failed.length}/${results.length}`);
  if (failed.length > 0) {
    console.log('失败:');
    failed.forEach(f => console.log(`  - ${f.name}: ${f.detail}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch(err => {
  console.error('测试异常:', err);
  process.exit(1);
});
