import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { generateStaticSite } from './generate-static-pages';

const roots: string[] = [];

afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
});

describe('generateStaticSite', () => {
  it('writes crawlable route pages and a sitemap from a Vite template', async () => {
    const root = mkdtempSync(join(tmpdir(), 'toolbox-static-'));
    roots.push(root);
    const distDir = join(root, 'dist');
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, 'index.html'),
      '<html><head><title>template</title><meta name="description" content="template" /></head><body><div id="root"></div></body></html>',
    );

    const tools = [{
      id: 'merge-pdf',
      name: 'PDF 合并',
      description: '合并多个 PDF 文件',
      category: 'pdf',
      tags: ['pdf', '合并'],
    }] as never[];
    const categories = [{ id: 'pdf', name: 'PDF 工具', description: 'PDF 文件处理' }] as never[];

    await generateStaticSite({ distDir, tools, categories });

    const toolPage = readFileSync(join(distDir, 'tool', 'merge-pdf', 'index.html'), 'utf8');
    const categoryPage = readFileSync(join(distDir, 'category', 'pdf', 'index.html'), 'utf8');
    const directoryPage = readFileSync(join(distDir, 'gj', 'index.html'), 'utf8');
    const gamesPage = readFileSync(join(distDir, 'games', 'index.html'), 'utf8');
    const gamePage = readFileSync(join(distDir, 'games', 'connect-four', 'index.html'), 'utf8');
    const sitemap = readFileSync(join(distDir, 'sitemap.xml'), 'utf8');

    expect(existsSync(join(distDir, 'tool', 'merge-pdf', 'index.html'))).toBe(true);
    expect(toolPage).toContain('https://zhumenggy.top/tool/merge-pdf');
    expect(toolPage).toContain('href="/tool/merge-pdf"');
    expect(categoryPage).toContain('https://zhumenggy.top/category/pdf');
    expect(directoryPage).toContain('href="/category/pdf"');
    expect(gamesPage).toContain('趣味游戏');
    expect(gamesPage).toContain('href="/games/connect-four"');
    expect(gamePage).toContain('https://zhumenggy.top/games/connect-four');
    expect(gamePage).toContain('href="/games/connect-four"');
    expect(sitemap).toContain('<loc>https://zhumenggy.top/tool/merge-pdf</loc>');
    expect(sitemap).toContain('<loc>https://zhumenggy.top/category/pdf</loc>');
    expect(sitemap).toContain('<loc>https://zhumenggy.top/games</loc>');
    expect(sitemap).toContain('<loc>https://zhumenggy.top/games/connect-four</loc>');
  });
});
