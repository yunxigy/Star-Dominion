import { DEFAULT_KEYWORDS, DEFAULT_THEME_COLOR } from './pageMetadata';
import { SITE } from '../lib/siteConfig';
import type { PageMetadata } from './pageMetadata';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function replaceOrInsert(source: string, pattern: RegExp, replacement: string, anchor: string): string {
  return pattern.test(source)
    ? source.replace(pattern, replacement)
    : source.replace(anchor, `${replacement}\n${anchor}`);
}

export function injectPageHtml(template: string, metadata: PageMetadata, body: string): string {
  if (!/<head\b[^>]*>/i.test(template)) {
    throw new Error('Static page template must include a <head> element');
  }
  if (!template.includes('<div id="root"></div>')) {
    throw new Error('Static page template must include the <div id="root"></div> marker');
  }

  let output = template.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(metadata.title)}</title>`);
  const description = `<meta name="description" content="${escapeHtml(metadata.description)}" />`;
  const keywords = `<meta name="keywords" content="${escapeHtml(metadata.keywords ?? DEFAULT_KEYWORDS)}" />`;
  const themeColor = `<meta name="theme-color" content="${escapeHtml(metadata.themeColor ?? DEFAULT_THEME_COLOR)}" />`;
  const applicationName = `<meta name="application-name" content="${escapeHtml(SITE.name)}" />`;
  const appleTitle = `<meta name="apple-mobile-web-app-title" content="${escapeHtml(SITE.name)}" />`;
  const ogType = `<meta property="og:type" content="${escapeHtml(metadata.type)}" />`;
  const ogTitle = `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`;
  const ogDescription = `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`;
  const ogUrl = `<meta property="og:url" content="${escapeHtml(metadata.canonical)}" />`;
  const ogSiteName = `<meta property="og:site_name" content="${escapeHtml(SITE.name)}" />`;
  const ogLocale = `<meta property="og:locale" content="${escapeHtml(SITE.locale)}" />`;
  const twitterCard = '<meta name="twitter:card" content="summary_large_image" />';
  const twitterTitle = `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`;
  const twitterDescription = `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`;

  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']description["'][^>]*>/i, description, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']keywords["'][^>]*>/i, keywords, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']theme-color["'][^>]*>/i, themeColor, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']application-name["'][^>]*>/i, applicationName, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']apple-mobile-web-app-title["'][^>]*>/i, appleTitle, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:type["'][^>]*>/i, ogType, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:title["'][^>]*>/i, ogTitle, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:description["'][^>]*>/i, ogDescription, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:url["'][^>]*>/i, ogUrl, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:site_name["'][^>]*>/i, ogSiteName, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*property=["']og:locale["'][^>]*>/i, ogLocale, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']twitter:card["'][^>]*>/i, twitterCard, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']twitter:title["'][^>]*>/i, twitterTitle, '</head>');
  output = replaceOrInsert(output, /<meta\s+[^>]*name=["']twitter:description["'][^>]*>/i, twitterDescription, '</head>');
  output = replaceOrInsert(output, /<link\s+[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${escapeHtml(metadata.canonical)}" />`, '</head>');

  const jsonLd = JSON.stringify(metadata.jsonLd).replace(/</g, '\\u003c');
  output = replaceOrInsert(
    output,
    /<script\s+[^>]*data-page-json-ld[^>]*>[\s\S]*?<\/script>/i,
    `<script type="application/ld+json" data-page-json-ld>${jsonLd}</script>`,
    '</head>',
  );

  return output.replace('<div id="root"></div>', `<div id="root">${body}</div>`);
}
