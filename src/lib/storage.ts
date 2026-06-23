export interface StorageEstimateInfo {
  supported: boolean;
  persisted: boolean;
  usedBytes: number;
  quotaBytes: number;
}

export async function checkStorageStatus(): Promise<StorageEstimateInfo> {
  const supported = typeof navigator !== 'undefined' && 'storage' in navigator;
  if (!supported) {
    return { supported: false, persisted: false, usedBytes: 0, quotaBytes: 0 };
  }

  try {
    const persisted = await navigator.storage.persisted();
    const estimate = await navigator.storage.estimate();
    return {
      supported: true,
      persisted,
      usedBytes: estimate.usage || 0,
      quotaBytes: estimate.quota || 0
    };
  } catch (err) {
    console.error("Storage estimate error:", err);
    return { supported: true, persisted: false, usedBytes: 0, quotaBytes: 0 };
  }
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) {
    return false;
  }

  try {
    const success = await navigator.storage.persist();
    return success;
  } catch (err) {
    console.error("Request storage persistence error:", err);
    return false;
  }
}
