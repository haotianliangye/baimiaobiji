/**
 * hallucinationPatterns — IndexedDB 持久层
 *
 * Issue #004 引入。本模块是 hallucinationFilter 的「数据层 cousin」：
 *   - hallucinationFilter: 纯函数（match/confidence/decision）
 *   - hallucinationPatterns: 持久层（CRUD + IndexedDB）
 *
 * 存储位置：db.settings_kv 表，key = 'transcription.hallucinationPatterns'。
 * value = HallucinationPattern[]。
 *
 * 设计：
 *   - 首次访问时（ensurePatterns）懒写入默认值，避免 upgrade 阶段长事务
 *   - 自定义修改覆盖默认值（不是合并），用户可以删掉默认 pattern
 *   - 读时 timeout 5s（业务场景：转写时同步读，不能 hang UI）
 *   - 写失败抛错而不是静默吞（用户改了 pattern 应该知道失败）
 */

import { db } from '../db/db';
import {
  getDefaultPatterns,
  type HallucinationPattern,
} from './hallucinationFilter';

const STORAGE_KEY = 'transcription.hallucinationPatterns';
const READ_TIMEOUT_MS = 5000;

interface StoredPatterns {
  patterns: HallucinationPattern[];
  updated_at: number;
}

/**
 * 读当前 patterns。如果没有，自动写默认值并返回。
 *
 * 这是"懒加载"模式：第一次访问时建数据，避免 db upgrade 阶段做太多事。
 */
export async function getPatterns(): Promise<HallucinationPattern[]> {
  const row = await db.settings_kv.get(STORAGE_KEY);
  if (row) {
    const stored = row.value as StoredPatterns;
    if (Array.isArray(stored?.patterns)) {
      return stored.patterns;
    }
  }
  // 没有或格式不对 → 写入默认
  const defaults = ensureCreatedAt(getDefaultPatterns());
  await persist(defaults);
  return defaults;
}

/**
 * 设置 patterns（覆盖整个数组）。
 */
export async function setPatterns(patterns: HallucinationPattern[]): Promise<void> {
  await persist(patterns);
}

/**
 * 加一条。
 */
export async function addPattern(
  p: Omit<HallucinationPattern, 'created_at'>
): Promise<HallucinationPattern> {
  const current = await getPatterns();
  const newPattern: HallucinationPattern = {
    ...p,
    created_at: Date.now(),
  };
  // key 冲突：自动加时间戳后缀
  let finalKey = newPattern.key;
  let suffix = 1;
  while (current.some(c => c.key === finalKey)) {
    finalKey = `${newPattern.key}_${suffix++}`;
  }
  newPattern.key = finalKey;
  const updated = [...current, newPattern];
  await persist(updated);
  return newPattern;
}

/**
 * 按 key 删一条。
 */
export async function removePattern(key: string): Promise<void> {
  const current = await getPatterns();
  const updated = current.filter(p => p.key !== key);
  if (updated.length === current.length) {
    // 没找到，no-op（不抛错，符合「delete idempotent」原则）
    return;
  }
  await persist(updated);
}

/**
 * 恢复默认（清空自定义，写回默认）。
 */
export async function resetPatterns(): Promise<HallucinationPattern[]> {
  const defaults = ensureCreatedAt(getDefaultPatterns());
  await persist(defaults);
  return defaults;
}

/**
 * 加点 created_at 让 default 也"伪装成"真实 pattern（统一类型）。
 */
function ensureCreatedAt(
  defaults: Omit<HallucinationPattern, 'created_at'>[]
): HallucinationPattern[] {
  const now = Date.now();
  return defaults.map((d, i) => ({
    ...d,
    created_at: now + i, // 微妙错开保证稳定排序
  }));
}

async function persist(patterns: HallucinationPattern[]): Promise<void> {
  const payload: StoredPatterns = {
    patterns,
    updated_at: Date.now(),
  };
  await db.settings_kv.put({
    key: STORAGE_KEY,
    value: payload,
    updated_at: Date.now(),
  });
}

/**
 * 拿 patterns 给后端 /api/transcribe 用（带超时保护）。
 *
 * 转写是热路径：如果 IndexedDB hang（罕见但发生过），不能阻塞用户录音 UI。
 */
export async function getPatternsForRequest(): Promise<HallucinationPattern[]> {
  return Promise.race([
    getPatterns(),
    new Promise<HallucinationPattern[]>((_, reject) =>
      setTimeout(() => reject(new Error('读取幻觉过滤配置超时')), READ_TIMEOUT_MS)
    ),
  ]);
}

/**
 * Fallback：拿不到 patterns 时返回默认硬编码，给后端使用。
 * （spec 要求"patterns 为空时行为与改造前完全一致"——这就是兜底。）
 */
export function getFallbackPatterns(): HallucinationPattern[] {
  return ensureCreatedAt(getDefaultPatterns());
}