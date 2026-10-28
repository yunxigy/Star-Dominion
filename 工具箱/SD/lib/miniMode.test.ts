import { describe, expect, it } from 'vitest';
import { MINI_MODE_STORAGE_KEY, readMiniMode } from './miniMode';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    value: (key: string) => values.get(key),
  };
}

describe('mini mode', () => {
  it('enables and remembers mini mode from the entry query', () => {
    const storage = createStorage();

    expect(readMiniMode('?mini=1', storage)).toBe(true);
    expect(storage.value(MINI_MODE_STORAGE_KEY)).toBe('1');
    expect(readMiniMode('', storage)).toBe(true);
  });

  it('does not enable mini mode for an ordinary website visit', () => {
    const storage = createStorage();

    expect(readMiniMode('', storage)).toBe(false);
    expect(readMiniMode('?mini=0', storage)).toBe(false);
  });

  it('clears a previous mini session when mini=0 is explicit', () => {
    const storage = createStorage({ [MINI_MODE_STORAGE_KEY]: '1' });

    expect(readMiniMode('?mini=0', storage)).toBe(false);
    expect(storage.value(MINI_MODE_STORAGE_KEY)).toBeUndefined();
  });
});
