export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export const THEME_STORAGE_KEY = 'dream-chaser-theme';
export const PREFERS_DARK_QUERY = '(prefers-color-scheme: dark)';

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>;
type ThemeMatchMedia = (query: string) => MediaQueryList;

const isThemePreference = (value: unknown): value is ThemePreference => (
  value === 'system' || value === 'light' || value === 'dark'
);

const browserStorage = (): ThemeStorage | undefined => {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
};

const browserMatchMedia = (): ThemeMatchMedia | undefined => (
  typeof window === 'undefined' || typeof window.matchMedia !== 'function'
    ? undefined
    : window.matchMedia.bind(window)
);

export function readThemePreference(storage: ThemeStorage | null = browserStorage() ?? null): ThemePreference {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return isThemePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = browserStorage() ?? null,
): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // A blocked or unavailable localStorage must not stop theme switching.
  }
}

export function resolveTheme(
  preference: ThemePreference,
  matchMedia: ThemeMatchMedia | undefined = browserMatchMedia(),
): ResolvedTheme {
  if (preference !== 'system') return preference;
  return matchMedia?.(PREFERS_DARK_QUERY).matches ? 'dark' : 'light';
}

export function applyResolvedTheme(
  theme: ResolvedTheme,
  documentRef: Pick<Document, 'documentElement'> | null = typeof document === 'undefined' ? null : document,
): void {
  const root = documentRef?.documentElement;
  if (!root) return;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function applyThemePreference(
  preference: ThemePreference,
  options: { matchMedia?: ThemeMatchMedia; document?: Pick<Document, 'documentElement'> | null } = {},
): ResolvedTheme {
  const resolved = resolveTheme(preference, options.matchMedia);
  applyResolvedTheme(resolved, options.document ?? (typeof document === 'undefined' ? null : document));
  return resolved;
}

export function subscribeToSystemTheme(
  onChange: (theme: ResolvedTheme) => void,
  matchMedia: ThemeMatchMedia | undefined = browserMatchMedia(),
): () => void {
  const media = matchMedia?.(PREFERS_DARK_QUERY);
  if (!media) return () => undefined;

  const handleChange = () => onChange(media.matches ? 'dark' : 'light');
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }

  media.addListener?.(handleChange);
  return () => media.removeListener?.(handleChange);
}
