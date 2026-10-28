export const MINI_MODE_STORAGE_KEY = 'sd-mini-mode';

export interface MiniModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readMiniMode(search: string, storage: MiniModeStorage | null = null): boolean {
  const requestedMode = new URLSearchParams(search).get('mini');

  if (requestedMode === '1') {
    storage?.setItem(MINI_MODE_STORAGE_KEY, '1');
    return true;
  }

  if (requestedMode === '0') {
    storage?.removeItem(MINI_MODE_STORAGE_KEY);
    return false;
  }

  return storage?.getItem(MINI_MODE_STORAGE_KEY) === '1';
}

export function getMiniMode(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return readMiniMode(window.location.search, window.sessionStorage);
  } catch {
    return readMiniMode(window.location.search);
  }
}
