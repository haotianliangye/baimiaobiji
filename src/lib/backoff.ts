/**
 * backoff — 指数退避 + 错误重试判断
 *
 * Issue #003 引入。原因：原任务队列固定重试 + 固定延时，
 * 10 个并发失败的 LLM 请求同时重试 → 再次撞 rate limit → 雪崩。
 *
 * 放在 src/lib/ 而非 store 内部：
 *   1. 纯函数无副作用，可独立单元测试（tests/backoff.test.ts）
 *   2. 未来 WebDAV 同步、其他 store 都能复用
 *   3. 不依赖 Zustand / Dexie / settings.store，零运行时依赖
 */

/**
 * 计算下一次重试前等待的毫秒数。
 *
 * 策略：指数退避 + ±30% jitter。
 * - 指数退避让重试间隔拉长，给服务商喘息
 * - jitter 让多个并发失败的请求分散重试，避免再次齐刷刷撞限流
 *
 * @param retryCount 已失败次数（从 0 开始）
 * @param baseMs 第一次重试的基准等待（默认 2000）
 * @param maxMs 退避上限（默认 60000，即 1 分钟）
 * @returns 等待毫秒数（整数，向下取整）
 *
 * @example
 *   getBackoffMs(0)  // → 1400-2600 ms
 *   getBackoffMs(3)  // → 11200-20800 ms
 *   getBackoffMs(10) // → 42000-78000 ms（受 maxMs 封顶）
 */
export function getBackoffMs(
  retryCount: number,
  baseMs: number = 2000,
  maxMs: number = 60000
): number {
  // 防御：负数 retryCount 当 0 处理
  const safeRetry = Math.max(0, retryCount);
  const exp = Math.min(baseMs * 2 ** safeRetry, maxMs);
  // ±30% jitter，jitter 永远 ≥ 0（避免减成负数）
  const jitter = exp * 0.3 * Math.random();
  return Math.floor(exp + jitter);
}

/**
 * 判断错误是否值得重试。
 *
 * 规则：
 * - 4xx（400/401/403/404/429...）：客户端错，不重试
 *   - 401/403：API Key 错，重试也无效
 *   - 429：限流错误，需要特定 backoff 策略，不是简单 retry
 *   - 404：资源不存在，重试无意义
 * - 5xx（500/502/503/504）：服务端错，可以重试
 * - 无 status 字段（网络错误、超时、AbortError）：重试
 * - null/undefined/非对象：保守返回 true，让外层兜底
 *
 * @param err 任意错误对象
 * @returns true = 应重试，false = 立即 fail
 */
export function isRetryableError(err: unknown): boolean {
  // null / undefined / 非对象：保守重试
  if (err === null || err === undefined) return true;
  if (typeof err !== 'object') return true;

  // status 字段读取（兼容 fetch 异常和 HTTPError）
  const status = (err as any).status ?? (err as any).statusCode;

  // 4xx（含 429）一律不重试
  if (typeof status === 'number' && status >= 400 && status < 500) return false;

  // 5xx 或无 status（网络错误）→ 重试
  return true;
}

/**
 * 网络错误重试上限。
 * 区分于 4xx（不重试）和默认 3 次，5xx/网络给 5 次机会。
 */
export const RETRY_LIMITS = {
  /** 5xx / 网络错误 / 超时：5 次 */
  network: 5,
  /** 4xx：直接 fail，不重试 */
  clientError: 0,
  /** 其他 fallback */
  default: 3,
} as const;

/**
 * 根据错误类型决定重试上限。
 */
export function getRetryLimit(err: unknown): number {
  if (err === null || err === undefined) return RETRY_LIMITS.default;
  if (typeof err !== 'object') return RETRY_LIMITS.default;
  const status = (err as any).status ?? (err as any).statusCode;
  if (typeof status === 'number' && status >= 400 && status < 500) return RETRY_LIMITS.clientError;
  return RETRY_LIMITS.network;
}