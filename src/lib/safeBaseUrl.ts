/**
 * safeBaseUrl — SSRF 防线（Issue Batch 1, High `ssrf.ai-proxy.base-url`）
 *
 * 用法：在 server.ts / api/index.ts 中所有 `fetch(baseUrl + ...)` 之前
 * 调 `await assertSafeBaseUrl(baseUrl)` 校验 baseUrl 是否安全。
 *
 * 策略（见 docs/handoff/CURRENT_STATE.md）：
 *   1. scheme 必须是 http: 或 https:（拒 file: / data: / javascript: / ftp: 等）
 *   2. host 非空、非 ASCII（防 IDN homograph）
 *   3. dns.lookup 解析 host；literal IP / localhost 短路
 *   4. 拒内网 IP：
 *      - 127.0.0.0/8 loopback：**放行 127.0.0.1**（Ollama 默认 fallback），
 *        其他 127.x.x.x 拒
 *      - 10.0.0.0/8 RFC1918
 *      - 172.16.0.0/12 RFC1918
 *      - 192.168.0.0/16 RFC1918
 *      - 169.254.0.0/16 link-local（含 AWS/GCP metadata 默认 169.254.169.254）
 *      - 100.64.0.0/10 CGNAT
 *      - ::1/128 IPv6 loopback
 *      - fc00::/7 IPv6 unique-local
 *      - fe80::/10 IPv6 link-local
 *      - ::ffff: 内网 IPv4 映射 IPv6
 *   5. 端口黑名单（拒 22, 25, 135, 139, 445, 3389, 5432, 6379, 9200, 27017）
 *   6. 5 分钟 LRU DNS 缓存（同 baseUrl 复用 dns.lookup 结果，Vercel 冷启动省 10ms）
 *
 * 部署形态：
 *   - server.ts: dev / 自建单容器
 *   - api/index.ts: Vercel Functions 镜像
 *   - 这两个文件都 import 本 helper（共享同一份校验逻辑，避免漂移）
 *
 * 范围：服务端（Node）使用。`dns` 模块仅在 Node 上下文；
 * 前端不直接调本模块，所有 baseUrl 校验在后端做。
 */

import { promises as dns } from 'node:dns';

// --- 类型 ---
export type ValidationResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

// --- 端口黑名单（常见内部/admin/DB 端口）---
const BLOCKED_PORTS = new Set<number>([
  22,    // SSH
  25,    // SMTP
  135,   // Windows RPC
  139,   // NetBIOS
  445,   // SMB
  3389,  // RDP
  5432,  // PostgreSQL
  6379,  // Redis
  9200,  // Elasticsearch
  27017, // MongoDB
]);

// --- DNS LRU 缓存（5 分钟 TTL，最多 200 项）---
const DNS_CACHE = new Map<string, { ips: string[]; ts: number }>();
const DNS_CACHE_TTL_MS = 5 * 60 * 1000;
const DNS_CACHE_MAX = 200;

async function cachedLookup(host: string): Promise<string[]> {
  const cached = DNS_CACHE.get(host);
  if (cached && Date.now() - cached.ts < DNS_CACHE_TTL_MS) {
    return cached.ips;
  }
  const result = await dns.lookup(host, { all: true, verbatim: true });
  const ips = result.map((r) => r.address);
  if (DNS_CACHE.size >= DNS_CACHE_MAX) {
    // LRU: Map 按插入顺序，删最老
    const firstKey = DNS_CACHE.keys().next().value;
    if (firstKey !== undefined) DNS_CACHE.delete(firstKey);
  }
  DNS_CACHE.set(host, { ips, ts: Date.now() });
  return ips;
}

// --- IPv4 内网判定（127.0.0.1 显式放行）---
function isPrivateIPv4(ip: string): boolean {
  // 127.0.0.0/8 — 只放行 127.0.0.1
  if (ip === '127.0.0.1') return false;
  if (ip.startsWith('127.')) return true;

  // 10.0.0.0/8
  if (ip.startsWith('10.')) return true;

  // 172.16.0.0/12
  const m172 = ip.match(/^172\.(\d+)\./);
  if (m172) {
    const octet = parseInt(m172[1], 10);
    if (octet >= 16 && octet <= 31) return true;
  }

  // 192.168.0.0/16
  if (ip.startsWith('192.168.')) return true;

  // 169.254.0.0/16 link-local（含 169.254.169.254 cloud metadata）
  if (ip.startsWith('169.254.')) return true;

  // 100.64.0.0/10 CGNAT
  const m100 = ip.match(/^100\.(\d+)\./);
  if (m100) {
    const octet = parseInt(m100[1], 10);
    if (octet >= 64 && octet <= 127) return true;
  }

  // 0.0.0.0/8 — 视为内网（防本机回环绕过）
  if (ip.startsWith('0.')) return true;

  return false;
}

// --- IPv6 内网判定 ---
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  // ::1 loopback
  if (lower === '::1') return true;

  // fc00::/7 unique-local (fc / fd 开头)
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;

  // fe80::/10 link-local
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true;

  // IPv4-mapped IPv6 (::ffff:x.x.x.x 或 ::ffff:HEX 压缩形式)
  // Node URL 构造器可能把 ::ffff:10.0.0.1 归一成 ::ffff:a00:1，
  // 因此放宽匹配：所有以 ::ffff: 开头的视为 IPv4-mapped，解析最后 32 bit。
  if (lower.startsWith('::ffff:')) {
    const tail = lower.slice(7);
    // 形式 1：dotted decimal
    if (/^[\d.]+$/.test(tail)) {
      return isPrivateIPv4(tail);
    }
    // 形式 2：HEX:HEX（Node 压缩格式，如 a00:1 表示 10.0.0.1）
    // 把后两段 hex 转回 IPv4 dotted；不识别的格式直接保守拒
    const m = tail.match(/^([0-9a-f]+):([0-9a-f]+)$/);
    if (m) {
      const high = parseInt(m[1], 16);
      const low = parseInt(m[2], 16);
      const dotted = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
      return isPrivateIPv4(dotted);
    }
    // 未识别的 IPv4-mapped 形式 — 保守拒
    return true;
  }

  // 其它 IPv6 视为公网（Vercel Functions / Cloud Run 等都暴露 IPv6）

  return false;
}

// --- IDN homograph 防护：host 含非 ASCII 字符直接拒 ---
function isNonAsciiHost(host: string): boolean {
  for (let i = 0; i < host.length; i++) {
    if (host.charCodeAt(i) > 127) return true;
  }
  return false;
}

// --- 主校验函数 ---
export async function validateBaseUrl(raw: string): Promise<ValidationResult> {
  if (!raw || typeof raw !== 'string') {
    return { ok: false, reason: 'baseUrl 不能为空' };
  }

  // 非 ASCII 检查必须在 URL parse 之前（Node URL 构造器可能 IDN-encode
  // 成 xn-- punycode，绕过 hostname 层的字符判断）
  if (isNonAsciiHost(raw)) {
    return { ok: false, reason: `baseUrl 含非 ASCII 字符（防 IDN homograph 攻击）` };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `URL 格式不合法: ${raw}` };
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `scheme 必须是 http: 或 https:（收到 ${url.protocol}）` };
  }

  // URL.hostname 对 IPv6 literal URL 可能带方括号（例如 '[::1]'），
  // 解析前手动剥掉，否则下游 isPrivateIPv6 匹配不到
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (!host) {
    return { ok: false, reason: 'URL 缺少 host' };
  }

  // 解析为 IP 列表
  let ips: string[];
  if (host === 'localhost') {
    // localhost 显式映射到 127.0.0.1（放行）
    ips = ['127.0.0.1'];
  } else if (/^[\d.]+$/.test(host)) {
    // IPv4 literal（不需要 DNS）
    ips = [host];
  } else if (host.includes(':')) {
    // IPv6 literal（已剥方括号）
    ips = [host];
  } else {
    // 域名 → dns.lookup
    try {
      ips = await cachedLookup(host);
    } catch (err: any) {
      return { ok: false, reason: `DNS 解析失败 (${host}): ${err.code || err.message || err}` };
    }
  }

  if (ips.length === 0) {
    return { ok: false, reason: `DNS 解析无结果: ${host}` };
  }

  for (const ip of ips) {
    const isPrivate = ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
    if (isPrivate) {
      return { ok: false, reason: `host "${host}" 解析到内网 IP ${ip}（loopback / RFC1918 / link-local / CGNAT / metadata 全部拒）` };
    }
  }

  // 端口黑名单
  const port = url.port
    ? parseInt(url.port, 10)
    : url.protocol === 'https:' ? 443 : 80;
  if (BLOCKED_PORTS.has(port)) {
    return { ok: false, reason: `端口 ${port} 在黑名单中（常见内部端口）` };
  }

  return { ok: true, url };
}

/**
 * 校验失败 throw 标准化错误（前端会显示原始 reason）。
 * 校验成功返回归一化 URL（trim + 去尾 /）。
 */
export async function assertSafeBaseUrl(raw: string): Promise<string> {
  const result = await validateBaseUrl(raw);
  if (!result.ok) {
    throw new Error(`Invalid baseUrl: ${result.reason}`);
  }
  // 归一化：去尾 /（避免与下游路径拼接产生 //）
  return result.url.toString().replace(/\/$/, '');
}

/**
 * 纯字符串归一化（trim + 去尾 /）。不做安全校验，**只用于本地缓存/比较**。
 * 任何要发到上游的 baseUrl 必须先走 assertSafeBaseUrl。
 */
export function normalizeBaseUrl(raw: string): string {
  return (raw || '').trim().replace(/\/$/, '');
}
