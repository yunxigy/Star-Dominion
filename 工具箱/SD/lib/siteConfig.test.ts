import { describe, expect, it } from 'vitest';
import { SITE, absoluteSiteUrl } from './siteConfig';

describe('siteConfig', () => {
  it('builds canonical URLs without duplicate slashes', () => {
    expect(SITE.origin).toBe('https://zhumenggy.top');
    expect(absoluteSiteUrl('/tool/merge-pdf')).toBe('https://zhumenggy.top/tool/merge-pdf');
    expect(absoluteSiteUrl('category/pdf')).toBe('https://zhumenggy.top/category/pdf');
  });
});
