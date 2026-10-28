import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const miniRoot = resolve(fileURLToPath(new URL('../xiaochengxu/miniprogram/', import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(ts|wxml|wxss|json)$/.test(entry.name) ? [path] : [];
  });
}

describe('native mini program shell', () => {
  it('declares native home, category, and tool pages', () => {
    const app = JSON.parse(readFileSync(resolve(miniRoot, 'app.json'), 'utf8')) as { pages: string[] };
    expect(app.pages).toEqual(['pages/home/index', 'pages/category/index', 'pages/tool/index']);
  });

  it('contains no WebView entry or mini-mode website URL', () => {
    const source = sourceFiles(miniRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toContain('<web-view');
    expect(source).not.toContain('WEB_ENTRY_URL');
    expect(source).not.toContain('?mini=1');
    expect(source).not.toContain('new URL(');
    expect(source).not.toContain('URLSearchParams');
    expect(source).not.toMatch(/\b(document|navigator)\s*(?:\.|\[)/u);
    expect(source).not.toMatch(/\b(?:new\s+)?Blob\s*\(/u);
    expect(source).not.toMatch(/(?:^|[^\w])window(?:\.|\[|\()/u);
  });

  it('shows all categories on the native home page instead of featured tools', () => {
    const homePage = readFileSync(resolve(miniRoot, 'pages/home/index.ts'), 'utf8');
    const homeMarkup = readFileSync(resolve(miniRoot, 'pages/home/index.wxml'), 'utf8');

    expect(homePage).not.toContain('featuredTools');
    expect(homePage).not.toContain('slice(0, 8)');
    expect(homeMarkup).toContain('全部分类');
    expect(homeMarkup).toContain('{{item.description}}');
    expect(homeMarkup).not.toContain('<text class="section-title">常用工具</text>');
  });
});
