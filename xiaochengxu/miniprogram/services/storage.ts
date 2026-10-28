const STORAGE_PREFIX = 'dream-chaser:';

function storageKey(key: string): string {
  return `${STORAGE_PREFIX}${key}`;
}

export function readStorage<T>(key: string, fallback: T): T {
  const value = wx.getStorageSync(storageKey(key)) as T | undefined;
  return value === undefined || value === null ? fallback : value;
}

export function writeStorage<T>(key: string, value: T): void {
  wx.setStorageSync(storageKey(key), value);
}

export function removeStorage(key: string): void {
  wx.removeStorageSync(storageKey(key));
}
