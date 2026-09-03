import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, TOOLS } from './registry';
import { escapeHtml } from '../seo/html';
import { buildCategoryMetadata, buildToolMetadata } from '../seo/pageMetadata';

const readHtml = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('generated toolbox search pages', () => {
  it('keeps the source template count-independent', () => {
    const source = readHtml('../index.html');
    expect(source).toContain('rel="canonical"');
    expect(source).toContain('rel="icon"');
    expect(source).toContain('site.webmanifest');
    expect(source).not.toMatch(/\d+\+\s*免费在线工具/);
  });

  it('ships a branded favicon and install metadata for browser tabs', () => {
    expect(readHtml('../public/favicon.svg')).toContain('viewBox="0 0 64 64"');
    const manifest = JSON.parse(readHtml('../public/site.webmanifest')) as { name?: string; icons?: Array<{ src?: string }> };
    expect(manifest.name).toBe('逐梦工具箱');
    expect(manifest.icons?.some((icon) => icon.src === '/favicon.svg')).toBe(true);
  });

  it('generates a canonical page for every tool and category', () => {
    for (const tool of TOOLS) {
      const html = readHtml(`../dist/tool/${tool.id}/index.html`);
      const metadata = buildToolMetadata(tool);
      expect(html).toContain(metadata.canonical);
      expect(html).toContain(escapeHtml(metadata.title));
      expect(html).toContain(escapeHtml(metadata.description));
    }

    for (const category of CATEGORIES) {
      const html = readHtml(`../dist/category/${category.id}/index.html`);
      const metadata = buildCategoryMetadata(category);
      expect(html).toContain(metadata.canonical);
      expect(html).toContain(escapeHtml(metadata.title));
      expect(html).toContain(escapeHtml(metadata.description));
    }
  });
});
