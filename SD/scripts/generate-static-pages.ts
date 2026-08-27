import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATEGORIES, TOOLS, type ToolDef } from '../tools/registry';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';
import { buildCategoryMetadata, buildToolMetadata, HOME_METADATA, TOOLBOX_METADATA } from '../seo/pageMetadata';
import { CATEGORY_CONTENT } from '../seo/categoryContent';
import { escapeHtml, injectPageHtml } from '../seo/html';

type StaticCategory = {
  id: string;
  name: string;
  description?: string;
};

export type GenerateStaticSiteOptions = {
  distDir: string;
  tools?: readonly ToolDef[];
  categories?: readonly StaticCategory[];
  publicDir?: string;
};

function toolHref(id: string): string {
  return `/tool/${encodeURIComponent(id)}`;
}

function categoryHref(id: string): string {
  return `/category/${encodeURIComponent(id)}`;
}

function renderHomeBody(tools: readonly ToolDef[], categories: readonly StaticCategory[]): string {
  return `<main><h1>${escapeHtml(SITE.name)}</h1><p>${escapeHtml(HOME_METADATA.description)}</p><nav aria-label="工具分类">${categories
    .map(category => `<a href="${categoryHref(category.id)}">${escapeHtml(category.name)}</a>`)
    .join('')}</nav><ul>${tools.slice(0, 24)
    .map(tool => `<li><a href="${toolHref(tool.id)}">${escapeHtml(tool.name)}</a></li>`)
    .join('')}</ul></main>`;
}

function renderDirectoryBody(tools: readonly ToolDef[], categories: readonly StaticCategory[]): string {
  return `<main><h1>工具目录</h1><p>${escapeHtml(TOOLBOX_METADATA.description)}</p><nav aria-label="工具分类">${categories
    .map(category => `<a href="${categoryHref(category.id)}">${escapeHtml(category.name)}</a>`)
    .join('')}</nav><ul>${tools
    .map(tool => `<li><a href="${toolHref(tool.id)}">${escapeHtml(tool.name)}</a></li>`)
    .join('')}</ul></main>`;
}

function renderCategoryBody(category: StaticCategory, tools: readonly ToolDef[]): string {
  const content = CATEGORY_CONTENT[category.id];
  const description = content?.description ?? category.description ?? `浏览${category.name}中的实用工具。`;
  return `<main><nav aria-label="面包屑"><a href="/">首页</a><span>/</span><a href="/gj">工具目录</a><span>/</span><span>${escapeHtml(category.name)}</span></nav><h1>${escapeHtml(category.name)}大全</h1><p>${escapeHtml(description)}</p><ul>${tools
    .map(tool => `<li><a href="${toolHref(tool.id)}">${escapeHtml(tool.name)}</a><span>${escapeHtml(tool.description)}</span></li>`)
    .join('')}</ul></main>`;
}

function renderToolBody(tool: ToolDef, category: StaticCategory | undefined, relatedTools: readonly ToolDef[]): string {
  const categoryName = category?.name ?? tool.category;
  const related = relatedTools.slice(0, 3).map(relatedTool => `<li><a href="${toolHref(relatedTool.id)}">${escapeHtml(relatedTool.name)}</a></li>`).join('');
  return `<main><nav aria-label="面包屑"><a href="/">首页</a><span>/</span><a href="${categoryHref(tool.category)}">${escapeHtml(categoryName)}</a><span>/</span><span>${escapeHtml(tool.name)}</span></nav><h1>${escapeHtml(tool.name)}</h1><p>${escapeHtml(tool.description)}</p><p>在浏览器中打开即可使用，无需安装软件。</p><p><a href="${toolHref(tool.id)}">打开${escapeHtml(tool.name)}</a></p><ol><li>准备输入内容或文件</li><li>按页面提示调整参数</li><li>查看结果并下载或复制</li></ol><h2>相关工具</h2><ul>${related}</ul></main>`;
}

function sitemapXml(paths: string[]): string {
  const urls = paths.map(path => `  <url><loc>${escapeHtml(absoluteSiteUrl(path))}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export async function generateStaticSite({ distDir, tools = TOOLS, categories = CATEGORIES, publicDir = join(dirname(distDir), 'public') }: GenerateStaticSiteOptions): Promise<void> {
  const template = await readFile(join(distDir, 'index.html'), 'utf8');
  const toolList = tools as readonly ToolDef[];
  const categoryList = categories as readonly StaticCategory[];
  const categoryById = new Map(categoryList.map(category => [category.id, category]));

  const pages: Array<{ path: string; metadata: ReturnType<typeof buildToolMetadata> | typeof HOME_METADATA | typeof TOOLBOX_METADATA; body: string }> = [
    { path: '/', metadata: HOME_METADATA, body: renderHomeBody(toolList, categoryList) },
    { path: '/gj', metadata: TOOLBOX_METADATA, body: renderDirectoryBody(toolList, categoryList) },
  ];

  categoryList.forEach(category => {
    pages.push({
      path: categoryHref(category.id),
      metadata: buildCategoryMetadata(category as (typeof CATEGORIES)[number]),
      body: renderCategoryBody(category, toolList.filter(tool => tool.category === category.id)),
    });
  });

  toolList.forEach(tool => {
    pages.push({
      path: toolHref(tool.id),
      metadata: buildToolMetadata(tool),
      body: renderToolBody(tool, categoryById.get(tool.category), toolList.filter(candidate => candidate.category === tool.category && candidate.id !== tool.id)),
    });
  });

  for (const page of pages) {
    const html = injectPageHtml(template, page.metadata, page.body);
    if (page.path === '/') {
      await writeFile(join(distDir, 'index.html'), html, 'utf8');
      continue;
    }
    const routeDir = join(distDir, ...page.path.replace(/^\//, '').split('/'));
    await mkdir(routeDir, { recursive: true });
    await writeFile(join(routeDir, 'index.html'), html, 'utf8');
  }

  const sitemap = sitemapXml(pages.map(page => page.path));
  await writeFile(join(distDir, 'sitemap.xml'), sitemap, 'utf8');
  await mkdir(publicDir, { recursive: true });
  await writeFile(join(publicDir, 'sitemap.xml'), sitemap, 'utf8');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  await generateStaticSite({ distDir: resolve('dist') });
}
