import { validatePublicUrl } from './http';
import { parseWebUrl, queryRecord, serializeWebUrl, setQueryParameter } from '../utils/web-url';

export type MetaTagInput = { title: string; description: string; url: string; image?: string };
export type SitemapEntry = {
  url: string;
  lastmod?: string;
  changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
};

export type WebmasterRequestKind = 'http' | 'dns' | 'ssl' | 'websocket';
export interface WebmasterRequest {
  path: string;
  data: { url: string } | { hostname: string };
}

const escapeHtml = (value: string): string => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const assertHttpUrl = (value: string): string => {
  const result = validatePublicUrl(value);
  if (!result.ok || !/^https?:/iu.test(result.value)) throw new Error(result.ok ? '仅支持 HTTP(S) 地址' : result.error);
  return result.value;
};

const assertWebSocketUrl = (value: string): string => {
  const result = validatePublicUrl(value);
  if (!result.ok || !/^wss?:/iu.test(result.value)) throw new Error(result.ok ? '仅支持 WS(S) 地址' : result.error);
  return result.value;
};

const assertHostname = (value: string): string => {
  const input = value.trim();
  const candidate = /^[a-z][a-z\d+.-]*:\/\//iu.test(input) ? input : `https://${input}`;
  const result = validatePublicUrl(candidate);
  if (!result.ok) throw new Error(result.error);
  const parsed = parseWebUrl(result.value);
  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('请输入纯域名，不要包含路径或查询参数');
  }
  return parsed.hostname;
};

export function buildMetaTags(input: MetaTagInput): string {
  if (!input.title.trim() || !input.description.trim()) throw new Error('标题和描述不能为空');
  const url = assertHttpUrl(input.url);
  const image = input.image ? assertHttpUrl(input.image) : '';
  return [
    `<title>${escapeHtml(input.title.trim())}</title>`,
    `<meta name="description" content="${escapeHtml(input.description.trim())}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${escapeHtml(input.title.trim())}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description.trim())}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}" />`] : []),
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${escapeHtml(input.title.trim())}" />`,
    `<meta name="twitter:description" content="${escapeHtml(input.description.trim())}" />`,
    ...(image ? [`<meta name="twitter:image" content="${escapeHtml(image)}" />`] : []),
  ].join('\n');
}

export function buildRobotsTxt(input: { sitemap: string; disallow?: string[]; allow?: string[] }): string {
  const sitemap = assertHttpUrl(input.sitemap);
  const paths = [
    ...(input.disallow ?? []).map((path) => ['Disallow', path] as const),
    ...(input.allow ?? []).map((path) => ['Allow', path] as const),
  ];
  paths.forEach(([, path]) => {
    if (/\r|\n/u.test(path)) throw new Error('robots 路径不能包含换行');
  });
  return ['User-agent: *', ...paths.map(([key, path]) => `${key}: ${path}`), `Sitemap: ${sitemap}`, ''].join('\n');
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const allowed = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
  const body = entries.map((entry) => {
    const url = assertHttpUrl(entry.url);
    if (entry.changefreq && !allowed.has(entry.changefreq)) throw new Error('changefreq 无效');
    const priority = entry.priority == null ? undefined : Math.min(1, Math.max(0, entry.priority));
    return [
      '  <url>',
      `    <loc>${escapeHtml(url)}</loc>`,
      entry.lastmod ? `    <lastmod>${escapeHtml(entry.lastmod)}</lastmod>` : '',
      entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : '',
      priority == null ? '' : `    <priority>${priority.toFixed(1)}</priority>`,
      '  </url>',
    ].filter(Boolean).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export type ParsedUrl = {
  protocol: string;
  hostname: string;
  port: string;
  host: string;
  pathname: string;
  hash: string;
  origin: string;
  query: Record<string, string[]>;
  hasCredentials: boolean;
};

export function parseUrl(value: string): ParsedUrl {
  const parsed = parseWebUrl(assertHttpUrl(value));
  return {
    protocol: parsed.protocol,
    hostname: parsed.hostname,
    port: parsed.port,
    host: parsed.host,
    pathname: parsed.pathname,
    hash: parsed.hash,
    origin: parsed.origin,
    query: queryRecord(parsed.search),
    hasCredentials: Boolean(parsed.username || parsed.password),
  };
}

export function buildUtmUrl(value: string, input: { source: string; medium: string; campaign: string; term?: string; content?: string }): string {
  const parsed = parseWebUrl(assertHttpUrl(value));
  if (!input.source.trim() || !input.medium.trim() || !input.campaign.trim()) throw new Error('source、medium 和 campaign 不能为空');
  let query = parsed.search;
  query = setQueryParameter(query, 'utm_source', input.source.trim());
  query = setQueryParameter(query, 'utm_medium', input.medium.trim());
  query = setQueryParameter(query, 'utm_campaign', input.campaign.trim());
  if (input.term?.trim()) query = setQueryParameter(query, 'utm_term', input.term.trim());
  if (input.content?.trim()) query = setQueryParameter(query, 'utm_content', input.content.trim());
  return serializeWebUrl(parsed, query);
}

export function slugify(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export type UserAgentInfo = { browser: string; os: string; device: 'Mobile' | 'Tablet' | 'Desktop' };
export function parseUserAgent(value: string): UserAgentInfo {
  const browser = /Edg\//iu.test(value) ? 'Edge' : /Chrome\//iu.test(value) ? 'Chrome' : /Firefox\//iu.test(value) ? 'Firefox' : /Safari\//iu.test(value) ? 'Safari' : 'Other';
  const os = /Windows/iu.test(value) ? 'Windows' : /Android/iu.test(value) ? 'Android' : /(iPhone|iPad|iPod)/iu.test(value) ? 'iOS' : /Mac OS X|Macintosh/iu.test(value) ? 'macOS' : /Linux/iu.test(value) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/iu.test(value) ? 'Tablet' : /Mobile|Android|iPhone|iPod/iu.test(value) ? 'Mobile' : 'Desktop';
  return { browser, os, device };
}

export function buildWebmasterRequest(kind: WebmasterRequestKind, value: string): WebmasterRequest {
  const path = `/webmaster-api/api/v1/${kind}`;
  if (kind === 'dns' || kind === 'ssl') return { path, data: { hostname: assertHostname(value) } };
  const url = kind === 'websocket' ? assertWebSocketUrl(value) : assertHttpUrl(value);
  return { path, data: { url } };
}
