import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATEGORIES, TOOLS } from './registry';
import { absoluteSiteUrl } from '../lib/siteConfig';

const sitemap = readFileSync(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');

describe('generated toolbox sitemap', () => {
  it('contains exactly the public root, directory, category, and tool routes', () => {
    const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    const expected = [
      absoluteSiteUrl('/'),
      absoluteSiteUrl('/gj'),
      ...CATEGORIES.map(category => absoluteSiteUrl(`/category/${category.id}`)),
      ...TOOLS.map(tool => absoluteSiteUrl(`/tool/${tool.id}`)),
    ];

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.sort()).toEqual(expected.sort());
  });
});
