import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, TOOLS } from './registry';
import { absoluteSiteUrl } from '../lib/siteConfig';
import { GAME_CATALOG } from '../games/catalog';

const sitemap = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');

describe('generated toolbox sitemap', () => {
  it('contains exactly the public root, directory, category, tool, and game routes', () => {
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    const expected = [
      absoluteSiteUrl('/'),
      absoluteSiteUrl('/gj'),
      absoluteSiteUrl('/games'),
      ...GAME_CATALOG.map(game => absoluteSiteUrl(`/games/${game.id}`)),
      ...CATEGORIES.map(category => absoluteSiteUrl(`/category/${category.id}`)),
      ...TOOLS.map(tool => absoluteSiteUrl(`/tool/${tool.id}`)),
    ];

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(expected.sort());
  });
});
