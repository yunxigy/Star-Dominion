import { describe, expect, it } from 'vitest';
import {
  buildMetaTags,
  buildRobotsTxt,
  buildSitemapXml,
  buildUtmUrl,
  buildWebmasterRequest,
  parseUrl,
  parseUserAgent,
  slugify,
} from '../xiaochengxu/miniprogram/services/webmaster';

describe('native webmaster tools', () => {
  it('keeps local SEO generators deterministic and escaped', () => {
    expect(buildMetaTags({ title: '<标题>', description: '描述 & 摘要', url: 'https://example.com/' })).toContain('&lt;标题&gt;');
    expect(buildRobotsTxt({ sitemap: 'https://example.com/sitemap.xml', disallow: ['/private'] })).toContain('Disallow: /private');
    expect(buildSitemapXml([{ url: 'https://example.com/a?x=1&y=2', priority: 0.8 }])).toContain('x=1&amp;y=2');
    expect(parseUrl('https://example.com:8443/path?tag=a&tag=b#part').query).toEqual({ tag: ['a', 'b'] });
    expect(buildUtmUrl('https://example.com/?ref=home', { source: 'wechat', medium: 'social', campaign: 'summer' })).toContain('utm_campaign=summer');
    expect(slugify(' 你好，World 2026 ')).toBe('你好-world-2026');
    expect(parseUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari/604.1')).toEqual({ browser: 'Safari', os: 'iOS', device: 'Mobile' });
  });

  it('builds only relative public service requests for webmaster inspections', () => {
    expect(buildWebmasterRequest('http', 'https://example.com/')).toEqual({
      path: '/webmaster-api/api/v1/http',
      data: { url: 'https://example.com/' },
    });
    expect(buildWebmasterRequest('dns', 'example.com')).toEqual({
      path: '/webmaster-api/api/v1/dns',
      data: { hostname: 'example.com' },
    });
    expect(buildWebmasterRequest('websocket', 'wss://example.com/socket')).toEqual({
      path: '/webmaster-api/api/v1/websocket',
      data: { url: 'wss://example.com/socket' },
    });
    expect(() => buildWebmasterRequest('ssl', '192.168.1.2')).toThrow('不允许检测本机或内网地址');
  });
});
