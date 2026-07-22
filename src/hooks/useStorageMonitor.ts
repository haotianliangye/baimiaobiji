/**
 * useStorageMonitor — 周期性检查存储压力
 *
 * Issue #007 引入。轮询 navigator.storage.estimate()，5 分钟一次。
 *
 * 设计权衡：
 *   - 不放 useEffect 内 setInterval 5min（spec 要求）
 *   - 每次重 mount 都重读（避免 React 缓存陈旧数据）
 *   - tab 失焦/隐藏时不暂停（5min 不算频繁）
 *
 * 性能：estimate ~1-2ms，5min 轮询相当于日均 ~288 次调用，无所谓
 */

import { useEffect, useState } from 'react';
import { checkStoragePressure, type StorageStatus } from '../lib/storagePressure';

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 分钟

export function useStorageMonitor(): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const check = async () => {
      const s = await checkStoragePressure();
      if (!cancelled) setStatus(s);
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return status;
}