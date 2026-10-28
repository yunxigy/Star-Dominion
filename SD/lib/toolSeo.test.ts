import { describe, expect, it } from 'vitest';

import { CATEGORIES, TOOLS } from '../tools/registry';
import { buildToolSeoDescription, buildToolSeoTitle, buildToolSeoUrl } from './toolSeo';

const categoryName = new Map(CATEGORIES.map((category) => [category.id, category.name]));

describe('tool page SEO metadata', () => {
  it('generates a distinct search description for every registered tool', () => {
    const descriptions = TOOLS.map((tool) => buildToolSeoDescription({
      tool,
      categoryName: categoryName.get(tool.category) ?? tool.category,
    }));

    expect(descriptions).toHaveLength(TOOLS.length);
    expect(new Set(descriptions).size).toBe(TOOLS.length);
    expect(Math.min(...descriptions.map((description) => description.length))).toBeGreaterThanOrEqual(120);
    expect(Math.max(...descriptions.map((description) => description.length))).toBeLessThanOrEqual(160);
    expect(descriptions[0]).toContain(TOOLS[0].name);
    expect(descriptions[0]).toContain(TOOLS[0].description);
  });

  it('builds canonical tool titles and URLs', () => {
    expect(buildToolSeoTitle('PDF 合并')).toBe('PDF 合并 - 逐梦工具箱');
    expect(buildToolSeoUrl('merge-pdf')).toBe('https://zhumenggy.top/tool/merge-pdf');
  });
});
