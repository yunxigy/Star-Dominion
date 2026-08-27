export type MetaTagInput = { title: string; description: string; url: string; image?: string };
export type SitemapEntry = { url: string; lastmod?: string; changefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never'; priority?: number };

export const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const escapeXml = (value: string) => escapeHtml(value);
const assertHttpUrl = (value: string) => {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('请输入有效的 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('仅支持 HTTP(S) 地址');
  return parsed;
};

export function buildMetaTags(input: MetaTagInput): string {
  if (!input.title.trim() || !input.description.trim()) throw new Error('标题和描述不能为空');
  const url = assertHttpUrl(input.url).toString();
  const image = input.image ? assertHttpUrl(input.image).toString() : '';
  return [
    `<title>${escapeHtml(input.title.trim())}</title>`,
    `<meta name="description" content="${escapeHtml(input.description.trim())}" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escapeHtml(input.title.trim())}" />`,
    `<meta property="og:description" content="${escapeHtml(input.description.trim())}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    ...(image ? [`<meta property="og:image" content="${escapeHtml(image)}" />`] : []),
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(input.title.trim())}" />`,
    `<meta name="twitter:description" content="${escapeHtml(input.description.trim())}" />`,
    ...(image ? [`<meta name="twitter:image" content="${escapeHtml(image)}" />`] : []),
  ].join('\n');
}

export function buildRobotsTxt(input: { sitemap: string; disallow?: string[]; allow?: string[] }): string {
  const sitemap = assertHttpUrl(input.sitemap).toString();
  const paths = [...(input.disallow ?? []).map((path) => ['Disallow', path] as const), ...(input.allow ?? []).map((path) => ['Allow', path] as const)];
  paths.forEach(([, path]) => { if (/\r|\n/u.test(path)) throw new Error('robots 路径不能包含换行'); });
  return ['User-agent: *', ...paths.map(([key, path]) => `${key}: ${path}`), `Sitemap: ${sitemap}`, ''].join('\n');
}

export function buildSitemapXml(entries: SitemapEntry[]): string {
  const allowed = new Set(['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']);
  const body = entries.map((entry) => {
    const url = assertHttpUrl(entry.url).toString();
    if (entry.changefreq && !allowed.has(entry.changefreq)) throw new Error('changefreq 无效');
    const priority = entry.priority == null ? undefined : Math.min(1, Math.max(0, entry.priority));
    return ['  <url>', `    <loc>${escapeXml(url)}</loc>`, entry.lastmod ? `    <lastmod>${escapeXml(entry.lastmod)}</lastmod>` : '', entry.changefreq ? `    <changefreq>${entry.changefreq}</changefreq>` : '', priority == null ? '' : `    <priority>${priority.toFixed(1)}</priority>`, '  </url>'].filter(Boolean).join('\n');
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

export type ParsedUrl = { protocol: string; hostname: string; port: string; host: string; pathname: string; hash: string; origin: string; query: Record<string, string[]>; hasCredentials: boolean };

export function parseUrl(value: string): ParsedUrl {
  const parsed = new URL(value);
  const query: Record<string, string[]> = {};
  parsed.searchParams.forEach((item, key) => { (query[key] ??= []).push(item); });
  return { protocol: parsed.protocol, hostname: parsed.hostname, port: parsed.port, host: parsed.host, pathname: parsed.pathname, hash: parsed.hash, origin: parsed.origin, query, hasCredentials: Boolean(parsed.username || parsed.password) };
}

export function buildUtmUrl(value: string, input: { source: string; medium: string; campaign: string; term?: string; content?: string }): string {
  const parsed = assertHttpUrl(value);
  if (!input.source.trim() || !input.medium.trim() || !input.campaign.trim()) throw new Error('source、medium 和 campaign 不能为空');
  parsed.searchParams.set('utm_source', input.source.trim());
  parsed.searchParams.set('utm_medium', input.medium.trim());
  parsed.searchParams.set('utm_campaign', input.campaign.trim());
  if (input.term?.trim()) parsed.searchParams.set('utm_term', input.term.trim());
  if (input.content?.trim()) parsed.searchParams.set('utm_content', input.content.trim());
  return parsed.toString();
}

export function slugify(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

export type UserAgentInfo = { browser: string; os: string; device: 'Mobile' | 'Tablet' | 'Desktop' };
export function parseUserAgent(value: string): UserAgentInfo {
  const browser = /Edg\//i.test(value) ? 'Edge' : /Chrome\//i.test(value) ? 'Chrome' : /Firefox\//i.test(value) ? 'Firefox' : /Safari\//i.test(value) ? 'Safari' : 'Other';
  const os = /Windows/i.test(value) ? 'Windows' : /Android/i.test(value) ? 'Android' : /(iPhone|iPad|iPod)/i.test(value) ? 'iOS' : /Mac OS X|Macintosh/i.test(value) ? 'macOS' : /Linux/i.test(value) ? 'Linux' : 'Other';
  const device = /iPad|Tablet/i.test(value) ? 'Tablet' : /Mobile|Android|iPhone|iPod/i.test(value) ? 'Mobile' : 'Desktop';
  return { browser, os, device };
}
