import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TOOLS } from './registry';

const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8');

describe('toolbox sitemap', () => {
  it('lists every registered tool exactly once with its real route ID', () => {
    const sitemapToolIds = [...sitemap.matchAll(
      /<loc>https:\/\/zhumenggy\.top\/tool\/([^<]+)<\/loc>/g,
    )].map((match) => match[1]);
    const registeredToolIds = TOOLS.map((tool) => tool.id);

    expect(sitemapToolIds).toHaveLength(registeredToolIds.length);
    expect(new Set(sitemapToolIds).size).toBe(registeredToolIds.length);
    expect([...sitemapToolIds].sort()).toEqual([...registeredToolIds].sort());
  });
});
