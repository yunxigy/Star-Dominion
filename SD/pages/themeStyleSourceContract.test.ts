import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const pageLayout = readFileSync(new URL('../layouts/PageLayout.tsx', import.meta.url), 'utf8');

describe('theme style contract', () => {
  it('defines a dark token block and theme-aware shared surfaces', () => {
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('--app-bg: #1d1712');
    expect(css).toContain('background: var(--surface-glass)');
    expect(css).toContain('background: var(--mesh-background)');
    expect(css).toContain('[data-theme="dark"] .tool-window-bg');
  });

  it('does not leave the standalone page shell pinned to the light text color', () => {
    expect(pageLayout).not.toContain('text-[#2f241b]');
    expect(pageLayout).toContain('text-[var(--text)]');
  });
});
