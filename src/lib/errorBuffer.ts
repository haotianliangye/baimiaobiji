/**
 * errorBuffer — 本地错误环形缓冲
 *
 * Issue #006 引入。目的：用户反馈问题时能导出错误现场（"手机上的错误你永远看不到"）。
 * 设计约束：
 *   - 本地、隐私优先（不接 Sentry/GA 等第三方）
 *   - 100 条环形缓冲（避免内存膨胀）
 *   - 仍然输出到 console（开发调试 + 不破坏现有 console.error 路径）
 *   - 导出 JSON 含 version 字段方便定位 commit
 *
 * 与 src/lib/storage.ts 的差异：
 *   - storage.ts 存 IndexedDB（持久），本模块是内存（快速、易丢）
 *   - storage.ts 是「真数据」，errorBuffer 是「诊断信息」
 *   - 故意不放 settings_kv：诊断信息不应该跨 session 持久化（避免敏感数据泄露）
 *
 * 已知 scope 限制（不做的）：
 *   - 不替换所有 console.error（14 文件 100+ 处）；只换 #006 规格明确列的几个
 *   - 不做 sentry-style 上报（隐私优先）
 *   - 不做跨标签页同步（按需可加 BroadcastChannel）
 */

import pkg from '../../package.json' with { type: 'json' };

export type ErrorLevel = 'error' | 'warn' | 'info';

export interface ErrorEntry {
  ts: number;
  msg: string;
  ctx?: unknown;
  stack?: string;
  level: ErrorLevel;
  /** 简单做 source 标记：'client' / 'server' / 'unknown'，方便按模块过滤 */
  source?: 'client' | 'server' | 'unknown';
}

const MAX_SIZE = 100;
const BUFFER: ErrorEntry[] = [];

/**
 * 记录一条错误/警告/信息。
 *
 * - 仍然调用 console.error / console.warn / console.info（按 level）
 * - 满了自动 FIFO 丢弃最旧
 * - Error 对象自动提取 stack 到顶层（导出时方便查看）
 */
export function logError(
  msg: string,
  ctx?: unknown,
  level: ErrorLevel = 'error',
  source: ErrorEntry['source'] = 'client'
): void {
  const entry: ErrorEntry = {
    ts: Date.now(),
    msg,
    ctx,
    level,
    source,
  };

  if (ctx instanceof Error) {
    entry.stack = ctx.stack;
    // 保留 Error 引用（导出 JSON 时 message/name 还在 ctx 里）
  }

  BUFFER.push(entry);
  if (BUFFER.length > MAX_SIZE) {
    BUFFER.shift();
  }

  // 仍然输出到 console（按 level）
  if (level === 'error') {
    console.error(msg, ctx ?? '');
  } else if (level === 'warn') {
    console.warn(msg, ctx ?? '');
  } else {
    console.info(msg, ctx ?? '');
  }
}

/**
 * 便捷 helper：logInfo / logWarn 减少 import 后还要传 level 的麻烦
 */
export const logWarn = (msg: string, ctx?: unknown, source?: ErrorEntry['source']) =>
  logError(msg, ctx, 'warn', source);

export const logInfo = (msg: string, ctx?: unknown, source?: ErrorEntry['source']) =>
  logError(msg, ctx, 'info', source);

export function getErrorCount(): number {
  return BUFFER.length;
}

export function getAllErrors(): readonly ErrorEntry[] {
  return BUFFER;
}

export function clearErrorLog(): void {
  BUFFER.length = 0;
}

export function exportErrorLog(): string {
  // 自定义 replacer：把 Error 对象的 name/message 展平到 ctx 上
  // （Error 默认 toJSON 会变空 {}，导出时丢失 message）
  return JSON.stringify(
    {
      exported_at: Date.now(),
      version: pkg.version,
      app_name: pkg.name,
      max_size: MAX_SIZE,
      errors: BUFFER,
    },
    (key, value) => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          ...(value.stack ? { stack: value.stack } : {}),
        };
      }
      return value;
    },
    2
  );
}

/**
 * 触发一个测试错误（用于"导出的 JSON 立即有内容"的演示/自测）
 */
export function triggerTestError(): void {
  logError('这是 test error，用于演示导出功能', { foo: 'bar' }, 'info');
}

/**
 * 容量上限，导出到 UI 也用这个做提示文案
 */
export const ERROR_BUFFER_MAX_SIZE = MAX_SIZE;