// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PREFERS_DARK_QUERY,
  THEME_STORAGE_KEY,
  applyResolvedTheme,
  readThemePreference,
  resolveTheme,
  subscribeToSystemTheme,
  writeThemePreference,
} from './theme';

describe('theme core', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.colorScheme = '';
    localStorage.clear();
  });

  it('defaults to system and rejects invalid stored values', () => {
    expect(readThemePreference(localStorage)).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');
    expect(readThemePreference(localStorage)).toBe('system');
  });

  it('round-trips valid preferences', () => {
    writeThemePreference('dark', localStorage);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference(localStorage)).toBe('dark');
  });

  it('resolves system preference from matchMedia', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    expect(resolveTheme('system', matchMedia)).toBe('dark');
    expect(matchMedia).toHaveBeenCalledWith(PREFERS_DARK_QUERY);
    expect(resolveTheme('light', matchMedia)).toBe('light');
    expect(resolveTheme('dark', matchMedia)).toBe('dark');
  });

  it('applies the resolved theme to the document root', () => {
    applyResolvedTheme('dark', document);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('subscribes and cleans up system theme changes', () => {
    let listener: ((event: MediaQueryListEvent) => void) | undefined;
    let matches = false;
    const addEventListener = vi.fn((_type: string, next: (event: MediaQueryListEvent) => void) => {
      listener = next;
    });
    const removeEventListener = vi.fn();
    const matchMedia = vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener,
      removeEventListener,
    }) as unknown as MediaQueryList);
    const onChange = vi.fn();

    const unsubscribe = subscribeToSystemTheme(onChange, matchMedia);
    matches = true;
    listener?.({ matches: true } as MediaQueryListEvent);
    unsubscribe();

    expect(onChange).toHaveBeenCalledWith('dark');
    expect(removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
