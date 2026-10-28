import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const miniRoot = resolve(fileURLToPath(new URL('../xiaochengxu/miniprogram/', import.meta.url)));
const read = (relativePath: string) => readFileSync(resolve(miniRoot, relativePath), 'utf8');

describe('native wechat mini program shell', () => {
  it('uses native home, category, and tool pages', () => {
    const app = JSON.parse(read('app.json')) as { pages: string[] };
    expect(app.pages).toEqual(['pages/home/index', 'pages/category/index', 'pages/tool/index']);
  });

  it('does not load the website through a webview', () => {
    expect(read('pages/home/index.wxml')).not.toContain('<web-view');
    expect(read('pages/category/index.wxml')).not.toContain('<web-view');
    expect(read('pages/tool/index.wxml')).not.toContain('<web-view');
  });
});
