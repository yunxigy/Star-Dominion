import { describe, expect, it } from 'vitest';
import { escapeHtml, injectPageHtml } from './html';

describe('SEO HTML helpers', () => {
  it('escapes user-visible values and injects canonical page content', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    const output = injectPageHtml(
      '<html><head><title>x</title></head><body><div id="root"></div></body></html>',
      {
        title: 'PDF & 合并',
        description: '安全 < 快速',
        canonical: 'https://zhumenggy.top/tool/merge-pdf',
        type: 'website',
        jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebApplication' }],
      },
      '<main><h1>PDF 合并</h1></main>',
    );
    expect(output).toContain('PDF &amp; 合并');
    expect(output).toContain('rel="canonical" href="https://zhumenggy.top/tool/merge-pdf"');
    expect(output).toContain('<div id="root"><main>');
  });
});
