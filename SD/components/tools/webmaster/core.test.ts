import { describe, expect, it } from 'vitest';
import { buildMetaTags, buildRobotsTxt, buildSitemapXml, buildUtmUrl, parseUrl, parseUserAgent, slugify } from './core';

describe('webmaster generators', () => {
  it('escapes metadata and emits canonical/Open Graph tags', () => {
    const html = buildMetaTags({ title: 'A & B', description: '描述 "安全"', url: 'https://example.com/page', image: 'https://example.com/cover.png' });
    expect(html).toContain('<title>A &amp; B</title>');
    expect(html).toContain('content="描述 &quot;安全&quot;"');
    expect(html).toContain('property="og:url" content="https://example.com/page"');
  });
  it('builds robots rules and an escaped sitemap', () => {
    expect(buildRobotsTxt({ sitemap: 'https://example.com/sitemap.xml', disallow: ['/private', '/tmp'] })).toBe('User-agent: *\nDisallow: /private\nDisallow: /tmp\nSitemap: https://example.com/sitemap.xml\n');
    expect(buildSitemapXml([{ url: 'https://example.com/a?x=1&y=2', changefreq: 'weekly', priority: 0.8 }])).toContain('https://example.com/a?x=1&amp;y=2');
  });
  it('rejects newline injection in robots paths', () => { expect(() => buildRobotsTxt({ sitemap: 'https://example.com/sitemap.xml', disallow: ['/ok\nX: bad'] })).toThrow(); });
});

describe('webmaster parsers', () => {
  it('parses URLs and preserves repeated query values', () => {
    expect(parseUrl('https://user:pass@example.com:8443/a?x=1&x=2#part')).toMatchObject({ protocol: 'https:', host: 'example.com:8443', pathname: '/a', hash: '#part', query: { x: ['1', '2'] }, hasCredentials: true });
  });
  it('builds UTM URLs without deleting existing parameters', () => {
    expect(buildUtmUrl('https://example.com/?ref=home', { source: 'wechat', medium: 'social', campaign: 'summer' })).toBe('https://example.com/?ref=home&utm_source=wechat&utm_medium=social&utm_campaign=summer');
  });
  it('creates Unicode-safe slugs and identifies common clients', () => {
    expect(slugify(' 你好，World 2026 ')).toBe('你好-world-2026');
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toMatchObject({ browser: 'Safari', os: 'iOS', device: 'Mobile' });
  });
});
