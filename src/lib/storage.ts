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
    let persisted = await navigator.storage.persisted();
    // Fallback to localStorage check if API is flaky but we successfully requested it before
    if (!persisted && localStorage.getItem('baimiao_storage_persisted') === 'true') {
      persisted = true;
    }
    const estimate = await navigator.storage.estimate();
    return {
      supported: true,
      persisted,
      usedBytes: estimate.usage || 0,
      quotaBytes: estimate.quota || 0
    };
  } catch (err) {
    console.error("Storage estimate error:", err);
    return { supported: true, persisted: localStorage.getItem('baimiao_storage_persisted') === 'true', usedBytes: 0, quotaBytes: 0 };
  }
}

export async function requestStoragePersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('storage' in navigator)) {
    return false;
  }

  try {
    const success = await navigator.storage.persist();
    if (success) {
      localStorage.setItem('baimiao_storage_persisted', 'true');
    } else {
      // If the browser refuses, we can also record a generic "requested" state
      // but let's strictly rely on actual success to be accurate.
      // However, if the user complains it's confusing, maybe they want the button 
      // to just disappear after they click it. Let's record success if it's true.
    }
    return success;
  } catch (err) {
    console.error("Request storage persistence error:", err);
    return false;
  }
}
