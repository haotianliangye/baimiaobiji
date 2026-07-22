/**
 * storagePressure — 存储压力检测
 *
 * Issue #007 引入。原因：浏览器在存储压力下会 evict IndexedDB，
 * 应用需要感知并提醒用户备份。这是可预期的失败模式（iOS 隐私模式、
 * 存储压力、用户清缓存都可能丢数据）。
 *
 * 与 src/lib/storage.ts 的关系：
 *   - storage.ts 已有 checkStorageStatus / requestStoragePersistence
 *   - 本模块聚焦"压力百分比 + 多档告警"（前者是简单持久化/估算）
 *   - 故意不复用 storage.ts 的 StorageEstimateInfo（不同维度）
 *     避免互相耦合
 *
 * 阈值设计（4 档）：
 *   - ok       ratio < 0.7   正常
 *   - warning  0.7 ≤ ratio < 0.85  提示（黄）
 *   - critical 0.85 ≤ ratio < 0.95 建议备份（橙）
 *   - danger   ratio ≥ 0.95  立即备份（红）
 *
 * 性能：
 *   - 每次调用 ~1-2ms（estimate 是异步的）
 *   - 5 分钟轮询足够（spec 定）
 *   - 单测可 mock navigator.storage.estimate
 */

export interface StorageStatus {
  usage: number;
  quota: number;
  ratio: number;
  critical: boolean;
  /** 4 档之一 */
  level: PressureLevel;
}

export type PressureLevel = 'ok' | 'warning' | 'critical' | 'danger';

const DEFAULT_CRITICAL_THRESHOLD = 0.85;
const DEFAULT_WARNING_THRESHOLD = 0.7;
const DEFAULT_DANGER_THRESHOLD = 0.95;

/**
 * 核心：检查存储压力。
 *
 * - 缺 navigator.storage.estimate → 返回零值（不抛）
 * - usage 或 quota 为 0 → ratio=0（防止除零）
 * - criticalThreshold 可自定义（默认 0.85）
 */
export async function checkStoragePressure(
  criticalThreshold: number = DEFAULT_CRITICAL_THRESHOLD
): Promise<StorageStatus> {
  const zero = { usage: 0, quota: 0, ratio: 0, critical: false, level: 'ok' as const };

  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return zero;
  }

  try {
    const est = await navigator.storage.estimate();
    const usage = est.usage || 0;
    const quota = est.quota || 0;
    if (quota === 0) {
      return { ...zero, usage };
    }
    const ratio = usage / quota;
    return {
      usage,
      quota,
      ratio,
      critical: ratio > criticalThreshold,
      level: getPressureLevel(ratio),
    };
  } catch (err) {
    // 不抛错：存储查询失败不应该崩 app
    return zero;
  }
}

/**
 * 4 档判定。供 UI 颜色 / 文案。
 */
export function getPressureLevel(ratio: number): PressureLevel {
  if (ratio >= DEFAULT_DANGER_THRESHOLD) return 'danger';
  if (ratio >= DEFAULT_CRITICAL_THRESHOLD) return 'critical';
  if (ratio >= DEFAULT_WARNING_THRESHOLD) return 'warning';
  return 'ok';
}

/**
 * 格式化 ratio 为百分比（整数）。
 *  0.5 → '50%', 0.856 → '86%', 0 → '0%'
 */
export function formatPressure(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * 容量上限（用于 UI 占位），不引用其他内部常量以防循环依赖
 */
export const PRESSURE_THRESHOLDS = {
  warning: DEFAULT_WARNING_THRESHOLD,
  critical: DEFAULT_CRITICAL_THRESHOLD,
  danger: DEFAULT_DANGER_THRESHOLD,
} as const;