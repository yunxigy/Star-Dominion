import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appLayoutSource = readFileSync(new URL('./AppLayout.tsx', import.meta.url), 'utf8');
const entrySource = readFileSync(new URL('../index.tsx', import.meta.url), 'utf8');

describe('theme layout integration', () => {
  it('bootstraps the resolved theme before creating the React tree', () => {
    expect(entrySource).toContain('applyThemePreference(readThemePreference());');
    expect(entrySource).toContain('<ThemeProvider>');
  });

  it('mounts one shared control in desktop and mobile surfaces', () => {
    expect(appLayoutSource).toContain("import { ThemeControl } from '../components/ThemeControl';");
    expect(appLayoutSource).toContain('<ThemeControl compact />');
    expect(appLayoutSource).toContain('<ThemeControl />');
    expect(appLayoutSource.match(/<ThemeControl(?: compact)? \/>/g)?.length).toBe(2);
  });
});
