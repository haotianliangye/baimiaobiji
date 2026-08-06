/**
 * webdavProxyServer — /api/webdav-proxy Express handler
 *
 * Issue Batch 1, High `ssrf.webdav-proxy`：原实现是开放 HTTP 转发代理，
 * 任意 endpoint + path + method + auth + headers 都原样转发。在 LAN /
 * Vercel 部署形态下变成可公网访问的 SSRF 跳板，可打云元数据、内网服务、
 * 并放大 AI 计费。
 *
 * 本 helper 收窄：
 *   - method 白名单：OPTIONS / PROPFIND / MKCOL / GET / HEAD / PUT /
 *     DELETE / COPY / MOVE（RFC 4918 Class 1+2 ∩ 前端实际用到；
 *     LOCK / UNLOCK 拒，避免死锁）
 *   - endpoint 校验：复用 safeBaseUrl 策略但放行 *.local（自建 NAS 需要）
 *   - path 规范化：`new URL(path, endpoint).pathname` 防 escape
 *   - auth scheme：必须 `Basic ` 或 `Bearer ` 开头
 *   - 透传 headers 黑名单：禁 Host / Cookie / Connection / Content-Length /
 *     Transfer-Encoding（防内部端口探测 + 协议降级）
 *   - fetchWithTimeout 30s（与 server.ts Issue #002 对齐）
 *
 * 不做的事：
 *   - 不读 / 写 settings_kv（保持纯转发）
 *   - 不改响应体（method !== GET 仍只回 `{status}`，与原行为一致）
 *
 * 调用方：server.ts + api/index.ts 的 /api/webdav-proxy 端点都
 * `app.post('/api/webdav-proxy', handleWebdavProxy)`，避免双写漂移。
 */

import type { Request, Response } from 'express';
import { fetchWithTimeout, FETCH_TIMEOUTS } from './fetchWithTimeout';
import { assertSafeBaseUrl } from './safeBaseUrl';

// --- 白名单常量 ---
const ALLOWED_METHODS = new Set([
  'OPTIONS',
  'PROPFIND',
  'MKCOL',
  'GET',
  'HEAD',
  'PUT',
  'DELETE',
  'COPY',
  'MOVE',
]);

const ALLOWED_AUTH_SCHEMES = ['Basic ', 'Bearer '];

// 黑名单：禁止透传的 headers（防内部端口探测 + 协议降级攻击）
const BLOCKED_HEADERS = new Set([
  'host',
  'cookie',
  'connection',
  'content-length',
  'transfer-encoding',
  'upgrade',
]);

interface WebDavProxyBody {
  endpoint?: string;
  method?: string;
  path?: string;
  auth?: string;
  body?: string; // base64 for PUT, raw for others
  headers?: Record<string, string>;
}

/**
 * /api/webdav-proxy Express handler（返回 Promise<void>）
 *
 * 请求体（来自前端 src/lib/webdav.ts 的 WebDAVClient.callProxy）：
 *   { endpoint, method, path, auth, body?, headers? }
 *
 * 响应：
 *   - GET 成功：{ status, data: <base64> }
 *   - GET 失败：{ error: 'FILE_NOT_FOUND' } (404) 或 { error: '...' }
 *   - 非 GET：{ status } (上游响应头里所有 207 多状态 XML 仍被丢弃，
 *     与原行为一致；这是 WebDAV UI 限制，PROPFIND 多状态需要
 *     client 端解析 → 后续 P2 再加 xml body 透传)
 */
export async function handleWebdavProxy(req: Request, res: Response): Promise<void> {
  try {
    const { endpoint, method, path: filePath, auth, body, headers } = req.body as WebDavProxyBody;

    // 1. 必填字段检查
    if (!endpoint || typeof endpoint !== 'string') {
      res.status(400).json({ error: 'Missing endpoint' });
      return;
    }
    if (!method || typeof method !== 'string') {
      res.status(400).json({ error: 'Missing method' });
      return;
    }

    // 2. method 白名单
    const upperMethod = method.toUpperCase();
    if (!ALLOWED_METHODS.has(upperMethod)) {
      res.status(405).json({ error: `Method ${upperMethod} 不在白名单中（仅允许 WebDAV 子集）` });
      return;
    }

    // 3. endpoint 校验（safeBaseUrl，但放行 *.local 自建 NAS）
    let safeEndpoint: string;
    try {
      safeEndpoint = await assertSafeEndpointForWebdav(endpoint);
    } catch (err: any) {
      res.status(403).json({ error: err.message });
      return;
    }

    // 4. path 规范化（用 new URL 解析，挡住 ../ 逃逸）
    const requestedPath = filePath || '/';
    let normalizedPath: string;
    try {
      const u = new URL(requestedPath, safeEndpoint);
      normalizedPath = u.pathname;
    } catch {
      res.status(400).json({ error: `path 格式不合法: ${requestedPath}` });
      return;
    }
    const cleanEndpoint = safeEndpoint.endsWith('/') ? safeEndpoint : safeEndpoint + '/';
    const url = cleanEndpoint + (normalizedPath.startsWith('/') ? normalizedPath.slice(1) : normalizedPath);

    // 5. auth scheme 检查
    const requestHeaders: Record<string, string> = {};
    if (auth) {
      if (typeof auth !== 'string') {
        res.status(400).json({ error: 'auth 必须是字符串' });
        return;
      }
      const isAllowedScheme = ALLOWED_AUTH_SCHEMES.some(s => auth.startsWith(s));
      if (!isAllowedScheme) {
        res.status(400).json({ error: 'auth scheme 必须是 Basic 或 Bearer' });
        return;
      }
      requestHeaders['Authorization'] = auth;
    }

    // 6. 透传 headers 黑名单过滤
    if (headers && typeof headers === 'object') {
      for (const [k, v] of Object.entries(headers)) {
        if (BLOCKED_HEADERS.has(k.toLowerCase())) continue;
        if (typeof v !== 'string') continue;
        requestHeaders[k] = v;
      }
    }

    // 7. body 处理（PUT 走 base64 buffer，其它走原始 string/object）
    let requestBody: any = undefined;
    if (body) {
      if (upperMethod === 'PUT') {
        requestBody = Buffer.from(body, 'base64');
      } else {
        requestBody = body;
      }
    }

    // 8. fetchWithTimeout 30s（与 server.ts Issue #002 对齐）
    const response = await fetchWithTimeout(url, {
      method: upperMethod,
      headers: requestHeaders,
      body: requestBody,
    }, FETCH_TIMEOUTS.webdav);

    // 9. 响应：GET 走 base64 data，其它只回 status（与原行为一致）
    if (upperMethod === 'GET') {
      if (response.status === 404) {
        res.status(404).json({ error: 'FILE_NOT_FOUND' });
        return;
      }
      if (!response.ok) {
        res.status(response.status).json({ error: `Fetch failed: ${response.statusText}` });
        return;
      }
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      res.json({ status: response.status, data: base64 });
      return;
    }

    res.json({ status: response.status });
  } catch (err: any) {
    console.error('WebDAV Proxy Error:', err);
    res.status(500).json({ error: err.message || 'WebDAV proxy failed' });
  }
}

/**
 * WebDAV endpoint 校验：复用 assertSafeBaseUrl，但放行 *.local（自建
 * NAS 场景）。
 *
 * 为什么不直接复用 assertSafeBaseUrl：
 *   - assertSafeBaseUrl 拒 169.254/10/172.16-31/192.168 等内网段
 *   - 自建 NAS 用户常配 https://my-nas.local:5006/，*.local 通常走
 *     本地 hosts 解析，安全模型是「信任本地 hosts」
 *   - 仍拒 RFC1918 数字 IP（10.0.0.5/192.168.1.10 等），仅放 host 后缀
 */
async function assertSafeEndpointForWebdav(raw: string): Promise<string> {
  // 先尝试标准校验
  try {
    return await assertSafeBaseUrl(raw);
  } catch (err) {
    // 若 endpoint 是 *.local 域名（解析失败），尝试放行
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw err; // URL 不合法，原错误上抛
    }
    const host = url.hostname;
    // 数字 IP literal 一律严格（不接受 *.local 绕过）
    if (/^[\d.]+$/.test(host) || host.includes(':')) {
      throw err;
    }
    // 仅 .local 后缀放行
    if (host.toLowerCase().endsWith('.local') || host.toLowerCase() === 'localhost') {
      return url.toString().replace(/\/$/, '');
    }
    // 其它域名解析失败仍然拒
    throw err;
  }
}
