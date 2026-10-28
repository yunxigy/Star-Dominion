import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
const pageLayout = readFileSync(new URL('../layouts/PageLayout.tsx', import.meta.url), 'utf8');
const homePage = readFileSync(new URL('./HomePage.tsx', import.meta.url), 'utf8');
const projectGallery = readFileSync(new URL('../components/ProjectGallery.tsx', import.meta.url), 'utf8');

describe('theme style contract', () => {
  it('defines a dark token block and theme-aware shared surfaces', () => {
    expect(css).toContain('[data-theme="dark"]');
    expect(css).toContain('--app-bg: #1d1712');
    expect(css).toContain('background: var(--surface-glass)');
    expect(css).toContain('background: var(--mesh-background)');
    expect(css).toContain('[data-theme="dark"] .tool-window-bg');
    expect(css).toContain('--preview-surface: #211a15');
    expect(css).toContain('[data-theme="dark"] .image-workbench__preview');
    expect(css).toContain('[data-theme="dark"] .image-workbench__preview-empty');
  });

  it('does not leave the standalone page shell pinned to the light text color', () => {
    expect(pageLayout).not.toContain('text-[#2f241b]');
    expect(pageLayout).toContain('text-[var(--text)]');
  });

  it('gives homepage quick categories and project cards theme-aware surfaces', () => {
    expect(homePage).toContain('home-quick-category-card');
    expect(projectGallery).toContain('project-gallery-card');
    expect(css).toContain('[data-theme="dark"] .home-quick-category-card');
    expect(css).toContain('[data-theme="dark"] .project-gallery-card');
    expect(css).toContain('background-color: var(--surface-muted)');
  });
});
