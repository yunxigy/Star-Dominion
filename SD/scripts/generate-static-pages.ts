import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CATEGORIES, TOOLS, type ToolDef } from '../tools/registry';
import { GAME_CATALOG, type GameCatalogItem } from '../games/catalog';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';
import { buildCategoryMetadata, buildToolMetadata, HOME_METADATA, TOOLBOX_METADATA, type PageMetadata } from '../seo/pageMetadata';
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

function gameHref(id: string): string {
  return `/games/${encodeURIComponent(id)}`;
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

function renderGamesBody(games: readonly GameCatalogItem[]): string {
  return `<main><h1>趣味游戏</h1><p>逐梦工具箱趣味游戏中心，提供无需安装、无需联网的单机和双人同屏小游戏。</p><ul>${games
    .map(game => `<li><a href="${gameHref(game.id)}">${escapeHtml(game.name)}</a><span>${escapeHtml(game.description)}</span></li>`)
    .join('')}</ul></main>`;
}

function renderGameBody(game: GameCatalogItem): string {
  const href = gameHref(game.id);
  return `<main><nav aria-label="面包屑"><a href="/">首页</a><span>/</span><a href="/games">趣味游戏</a><span>/</span><span>${escapeHtml(game.name)}</span></nav><h1>${escapeHtml(game.name)}</h1><p>${escapeHtml(game.description)}</p><p>打开浏览器即可游玩，支持人机对战和双人同屏，不需要安装或联网。</p><p><a href="${href}">打开${escapeHtml(game.name)}</a></p><h2>玩法说明</h2><ol><li>选择人机对战或双人同屏。</li><li>按棋盘规则落子，完成目标即可获胜。</li><li>棋局保存在当前浏览器，不会上传。</li></ol></main>`;
}

function buildGameMetadata(game: GameCatalogItem): PageMetadata {
  const canonical = absoluteSiteUrl(gameHref(game.id));
  const description = `${game.description} 无需安装，支持浏览器本地游玩。`;
  return {
    title: `${game.name} - 免费在线小游戏 | ${SITE.name}`,
    description,
    canonical,
    type: 'website',
    jsonLd: [{
      '@context': 'https://schema.org',
      '@type': 'VideoGame',
      name: game.name,
      description,
      url: canonical,
      gamePlatform: 'Web Browser',
      playMode: 'SinglePlayer, MultiPlayer',
    }],
  };
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

  const pages: Array<{ path: string; metadata: PageMetadata; body: string }> = [
    { path: '/', metadata: HOME_METADATA, body: renderHomeBody(toolList, categoryList) },
    { path: '/gj', metadata: TOOLBOX_METADATA, body: renderDirectoryBody(toolList, categoryList) },
    {
      path: '/games',
      metadata: {
        title: `趣味游戏 - 单机与双人在线小游戏 | ${SITE.name}`,
        description: '逐梦工具箱趣味游戏中心，提供无需安装、无需联网的单机和双人同屏小游戏。',
        canonical: absoluteSiteUrl('/games'),
        type: 'website',
        jsonLd: [{
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: '趣味游戏',
          description: '无需联网即可游玩的单机与双人同屏小游戏。',
          url: absoluteSiteUrl('/games'),
          numberOfItems: GAME_CATALOG.length,
        }],
      },
      body: renderGamesBody(GAME_CATALOG),
    },
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

  GAME_CATALOG.forEach(game => {
    pages.push({
      path: gameHref(game.id),
      metadata: buildGameMetadata(game),
      body: renderGameBody(game),
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
