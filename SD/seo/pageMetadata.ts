import { CATEGORIES, getToolsByCategory, type ToolDef } from '../tools/registry';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';
import { buildToolSeoDescription } from '../lib/toolSeo';
import { CATEGORY_CONTENT } from './categoryContent';

export const DEFAULT_THEME_COLOR = '#f6eee2';
export const DEFAULT_KEYWORDS = '在线工具,逐梦工具箱,免费工具';

export type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
  type: 'website' | 'article';
  keywords?: string;
  themeColor?: string;
  jsonLd: Record<string, unknown>[];
};

function joinKeywords(values: string[]): string {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).join(',');
}

export function buildToolMetadata(tool: ToolDef): PageMetadata {
  const category = CATEGORIES.find(item => item.id === tool.category);
  const categoryName = category?.name ?? tool.category;
  const canonical = absoluteSiteUrl(`/tool/${encodeURIComponent(tool.id)}`);
  const description = buildToolSeoDescription({ tool, categoryName });

  return {
    title: `${tool.name}在线使用 - ${categoryName} | ${SITE.name}`,
    description,
    canonical,
    type: 'website',
    keywords: joinKeywords([
      tool.name,
      ...(tool.tags ?? []),
      categoryName,
      '在线工具',
      '逐梦工具箱',
    ]),
    themeColor: DEFAULT_THEME_COLOR,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: tool.name,
      description,
      url: canonical,
      applicationCategory: categoryName,
      operatingSystem: 'Web Browser',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' },
    }],
  };
}

export function buildCategoryMetadata(category: (typeof CATEGORIES)[number]): PageMetadata {
  const content = CATEGORY_CONTENT[category.id];
  const canonical = absoluteSiteUrl(`/category/${category.id}`);
  const description = `${content.description} 支持快速找到合适入口并完成任务。`;
  const tools = getToolsByCategory(category.id);

  return {
    title: `${category.name}大全 - ${tools.length}个免费在线工具 | ${SITE.name}`,
    description,
    canonical,
    type: 'website',
    keywords: joinKeywords([
      category.name,
      ...tools.slice(0, 10).map((tool) => tool.name),
      '在线工具',
      '逐梦工具箱',
    ]),
    themeColor: DEFAULT_THEME_COLOR,
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: category.name,
      description,
      url: canonical,
      numberOfItems: tools.length,
    }],
  };
}

export const HOME_METADATA: PageMetadata = {
  title: `${SITE.name} - 免费在线工具箱`,
  description: '逐梦工具箱提供免费在线工具，覆盖 PDF、图片、开发、办公、学术、计算和日常效率场景。多数工具优先在浏览器本地处理，打开网页即可快速完成任务。',
  canonical: absoluteSiteUrl('/'),
  type: 'website',
  keywords: '在线工具,PDF工具,图片工具,OCR,开发者工具,办公工具,测评,逐梦工具箱',
  themeColor: DEFAULT_THEME_COLOR,
  jsonLd: [{
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: absoluteSiteUrl('/'),
    potentialAction: {
      '@type': 'SearchAction',
      target: `${absoluteSiteUrl('/gj')}?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  }],
};

export const TOOLBOX_METADATA: PageMetadata = {
  title: `工具目录 - ${SITE.name}`,
  description: '浏览逐梦工具箱的免费在线工具目录，支持按分类、名称、拼音和常见别名搜索。多数工具在浏览器本地处理，适合学习、办公、开发和日常创作。',
  canonical: absoluteSiteUrl('/gj'),
  type: 'website',
  keywords: DEFAULT_KEYWORDS,
  themeColor: DEFAULT_THEME_COLOR,
  jsonLd: [{
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: '工具目录',
    description: '按分类和关键词浏览逐梦工具箱的免费在线工具。',
    url: absoluteSiteUrl('/gj'),
  }],
};
