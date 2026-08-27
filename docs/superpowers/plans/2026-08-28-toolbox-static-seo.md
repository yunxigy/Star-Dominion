# Toolbox Static SEO Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate crawlable HTML, canonical metadata, structured data, and sitemap entries for every homepage, directory, category, and tool route without adding a runtime SSR service.

**Architecture:** Centralize site origin and page metadata in pure TypeScript modules, then run a deterministic post-build generator that derives route HTML and sitemap content from the tool registry. Client pages use the same metadata builders so browser navigation and generated HTML cannot drift. Canonical duplicate tools are removed from the registry and supported through explicit redirect mappings.

**Tech Stack:** TypeScript, Vite 5, React 18, Node.js file APIs, Vitest, JSON-LD

---

## File map

- Create `SD/lib/siteConfig.ts`: one authoritative site origin and name.
- Create `SD/lib/siteConfig.test.ts`: origin and URL construction tests.
- Create `SD/seo/categoryContent.ts`: complete category copy and FAQs.
- Create `SD/seo/categoryContent.test.ts`: coverage for every category.
- Create `SD/seo/pageMetadata.ts`: home, directory, category, and tool metadata builders.
- Create `SD/seo/pageMetadata.test.ts`: uniqueness, length, canonical, and schema tests.
- Create `SD/seo/html.ts`: escaping and head/body injection helpers.
- Create `SD/seo/html.test.ts`: XSS-safe HTML generation tests.
- Create `SD/scripts/generate-static-pages.ts`: build output and sitemap generator.
- Create `SD/scripts/generate-static-pages.test.ts`: temporary-directory integration test.
- Create `SD/components/PageSeo.tsx`: client navigation metadata synchronization.
- Create `SD/components/PageSeo.test.tsx`: browser head update test.
- Create `SD/tools/redirects.ts`: legacy tool ID redirects.
- Create `SD/tools/redirects.test.ts`: redirect integrity tests.
- Modify `SD/tools/registry.tsx`: remove four canonical duplicates.
- Modify `SD/components/ToolWindow.tsx`: shared metadata and legacy redirects.
- Modify `SD/pages/CategoryPage.tsx`: shared category content and metadata.
- Modify `SD/pages/HomePage.tsx`: home metadata component.
- Modify `SD/pages/ToolboxPage.tsx`: directory metadata component.
- Modify `SD/index.html`: generic build template only; remove hard-coded mutable counts.
- Modify `SD/package.json`: static generation in build lifecycle.
- Modify `SD/package-lock.json`: add explicit `tsx` development dependency.
- Modify `SD/tools/siteMetadata.test.ts`: validate source template and generated page metadata separately.
- Modify `SD/tools/sitemap.test.ts`: validate generated sitemap for tools and categories.
- Modify `SD/tools/registryMetadata.test.ts`: remove fixed registry total.

### Task 1: Centralize site configuration

**Files:**
- Create: `SD/lib/siteConfig.ts`
- Create: `SD/lib/siteConfig.test.ts`
- Modify: `SD/lib/toolSeo.ts`
- Modify: `SD/lib/toolSeo.test.ts`

- [ ] **Step 1: Write the failing site configuration test**

```ts
import { describe, expect, it } from 'vitest';
import { SITE, absoluteSiteUrl } from './siteConfig';

describe('siteConfig', () => {
  it('builds canonical URLs without duplicate slashes', () => {
    expect(SITE.origin).toBe('https://zhumenggy.top');
    expect(absoluteSiteUrl('/tool/merge-pdf')).toBe('https://zhumenggy.top/tool/merge-pdf');
    expect(absoluteSiteUrl('category/pdf')).toBe('https://zhumenggy.top/category/pdf');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- lib/siteConfig.test.ts`

Expected: FAIL because `siteConfig` does not exist.

- [ ] **Step 3: Implement the site configuration**

```ts
export const SITE = {
  name: '逐梦工具箱',
  origin: 'https://zhumenggy.top',
  locale: 'zh_CN',
  language: 'zh-CN',
} as const;

export function absoluteSiteUrl(pathname: string): string {
  const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return new URL(path, `${SITE.origin}/`).toString().replace(/\/$/, pathname === '/' ? '/' : '');
}
```

- [ ] **Step 4: Replace `TOOL_SITE_ORIGIN` usage**

Import `SITE` and `absoluteSiteUrl` in `toolSeo.ts`, remove the hard-coded origin export, and implement `buildToolSeoUrl(toolId)` as `absoluteSiteUrl(`/tool/${encodeURIComponent(toolId)}`)`.

- [ ] **Step 5: Run focused tests**

Run: `cd SD && npm test -- lib/siteConfig.test.ts lib/toolSeo.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/lib/siteConfig.ts SD/lib/siteConfig.test.ts SD/lib/toolSeo.ts SD/lib/toolSeo.test.ts
git commit -m "refactor: centralize toolbox site URLs"
```

### Task 2: Complete category content coverage

**Files:**
- Create: `SD/seo/categoryContent.ts`
- Create: `SD/seo/categoryContent.test.ts`
- Modify: `SD/pages/CategoryPage.tsx`

- [ ] **Step 1: Write the failing coverage test**

```ts
import { describe, expect, it } from 'vitest';
import { CATEGORIES } from '../tools/registry';
import { CATEGORY_CONTENT } from './categoryContent';

describe('CATEGORY_CONTENT', () => {
  it('provides unique useful copy for every registered category', () => {
    expect(Object.keys(CATEGORY_CONTENT).sort()).toEqual(CATEGORIES.map(item => item.id).sort());
    const descriptions = CATEGORIES.map(item => CATEGORY_CONTENT[item.id].description);
    expect(descriptions.every(value => value.length >= 60 && value.length <= 180)).toBe(true);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    expect(CATEGORIES.every(item => CATEGORY_CONTENT[item.id].features.length >= 3)).toBe(true);
    expect(CATEGORIES.every(item => CATEGORY_CONTENT[item.id].faq.length >= 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- seo/categoryContent.test.ts`

Expected: FAIL because the content module does not exist.

- [ ] **Step 3: Create the category content type and complete data**

```ts
export type CategoryContent = {
  description: string;
  features: [string, string, string, ...string[]];
  faq: Array<{ question: string; answer: string }>;
};

export const CATEGORY_CONTENT: Record<string, CategoryContent> = {
  pdf: {
    description: '在浏览器中完成 PDF 合并、拆分、压缩、页面调整、格式转换与内容提取。多数操作本地执行，适合办公文档、学习资料和个人文件的快速整理。',
    features: ['页面与文件整理', '常见格式转换', '本地隐私优先'],
    faq: [
      { question: 'PDF 文件会上传吗？', answer: '标记为本地处理的 PDF 工具不会上传文件；需要服务器转换的工具会在操作前明确提示。' },
      { question: '处理失败怎么办？', answer: '先确认文件没有损坏或密码保护，再尝试减小文件体积并关闭占用内存较高的页面。' },
    ],
  },
  image: {
    description: '提供图片压缩、裁剪、尺寸调整、拼接、切图、取色和 Base64 转换。图片处理优先在浏览器本地完成，适合网页素材、社交图片和日常照片整理。',
    features: ['批量图片处理', '实时效果预览', '常见格式支持'],
    faq: [
      { question: '图片会上传吗？', answer: '标记为本地处理的图片工具只在当前浏览器读取和导出文件。' },
      { question: '支持哪些格式？', answer: '具体格式以工具页说明为准，常见 JPG、PNG、WebP 和 BMP 均有对应处理入口。' },
    ],
  },
  'image-enhance': {
    description: '针对图片清晰度、亮度、锐化、水印、文字、马赛克和社交封面进行增强创作。共享工作台支持队列、参数预览和批量导出，减少重复操作。',
    features: ['统一增强工作台', '参数实时预览', '批量队列导出'],
    faq: [
      { question: '增强会覆盖原图吗？', answer: '不会，工具会生成新的结果文件，原始图片保持不变。' },
      { question: '可以一次处理多张图片吗？', answer: '支持批量的工具会显示任务队列，并在处理完成后提供逐个或打包下载。' },
    ],
  },
  converter: {
    description: '覆盖 JPG、PNG、WebP、SVG、BMP、HEIC 和 ICO 等图片格式转换。每种转换拥有独立入口与明确输出格式，便于快速定位和批量处理。',
    features: ['独立格式入口', '质量参数控制', '透明通道提示'],
    faq: [
      { question: '格式转换会损失质量吗？', answer: '转为 JPG 等有损格式时可能损失细节，工具页会提供可用的质量参数。' },
      { question: 'HEIC 为什么处理较慢？', answer: 'HEIC 需要在浏览器加载额外解码模块，首次使用会比普通图片格式稍慢。' },
    ],
  },
  dev: {
    description: '汇集 JSON、XML、HTML、CSS、JavaScript、SQL 格式化，以及正则、时间戳、编码、哈希、JWT、二维码和网络诊断等开发者日常能力。',
    features: ['结构化数据处理', '编码与哈希工具', '开发调试辅助'],
    faq: [
      { question: '格式化会修改数据吗？', answer: '格式化工具只调整结构和缩进；具有转换行为的工具会在页面中单独说明。' },
      { question: '可以处理敏感数据吗？', answer: '请先查看工具的隐私标签，本地工具不会上传，API 工具则不应输入密钥和敏感凭据。' },
    ],
  },
  calc: {
    description: '提供日期、工作日、年龄、百分比、折扣、贷款、房贷、复利和常见单位换算。输入后即时计算并展示关键结果，适合学习和日常估算。',
    features: ['即时计算结果', '常用单位换算', '清晰参数说明'],
    faq: [
      { question: '计算结果可以用于专业决策吗？', answer: '结果适合快速估算，金融、健康等重要决策仍应以专业机构或正式规则为准。' },
      { question: '输入数据会保存吗？', answer: '计算器默认在当前页面完成计算，不会自动上传或长期保存输入。' },
    ],
  },
  fun: {
    description: '提供随机数、抽奖、随机密码、昵称、点餐选择和随机挑选等轻量工具。无需注册即可快速生成结果，适合活动、课堂和日常选择。',
    features: ['一键随机生成', '适合活动互动', '无需注册使用'],
    faq: [
      { question: '随机结果可以复现吗？', answer: '大部分趣味工具每次运行都会生成新结果，不保证再次得到相同内容。' },
      { question: '抽奖结果是否适合正式公证？', answer: '工具适合普通活动；涉及奖金或法律效力的抽奖应使用具备审计和公证能力的平台。' },
    ],
  },
  test: {
    description: '提供 MBTI、大五人格、九型人格、DISC、依恋类型、职业兴趣和生活倾向等自我探索测评，展示题量、预计时间与结果解释。',
    features: ['题量时间提示', '结构化结果解读', '本地答题优先'],
    faq: [
      { question: '测评结果准确吗？', answer: '结果反映答题时的倾向，仅供自我了解，不替代心理咨询、医学诊断或职业决策。' },
      { question: '答题记录会上传吗？', answer: '标记为本地处理的测评在浏览器中计分，不会上传逐题答案。' },
    ],
  },
  tarot: {
    description: '包含每日塔罗、牌阵、星座配对、运势、生命灵数和梦境词典等娱乐与自我反思工具，提供清晰说明和适度结果提示。',
    features: ['多种牌阵与主题', '每日内容入口', '娱乐用途提示'],
    faq: [
      { question: '结果可以预测未来吗？', answer: '不能，塔罗和星座内容用于娱乐与自我反思，不应作为医疗、法律或财务决策依据。' },
      { question: '为什么每天结果不同？', answer: '不同工具会根据日期、选择或随机过程生成对应的娱乐性内容。' },
    ],
  },
  mouse: {
    description: '提供点击速度、双击、按键、回报率、DPI、抖动、拖拽、反应速度、滚轮和轨迹测试，帮助快速检查鼠标输入与使用状态。',
    features: ['多维输入测试', '实时数据反馈', '无需安装驱动'],
    faq: [
      { question: '浏览器测得的回报率准确吗？', answer: '浏览器结果会受系统调度、屏幕刷新率和后台任务影响，适合对比而非实验室校准。' },
      { question: '测试会改变鼠标设置吗？', answer: '不会，页面只监听输入事件，不会修改系统驱动、DPI 或按键设置。' },
    ],
  },
  document: {
    description: '覆盖 OCR、翻译、文本摘要、语法检查、查重、文档差异、字数统计和真实格式转换。每个工具明确标示本地、第三方 API 或服务器上传边界。',
    features: ['文字识别与转换', '内容检查与对比', '清晰隐私分级'],
    faq: [
      { question: '文档是否会上传？', answer: '取决于具体工具；上传型工具会在选择文件前显示服务器处理说明。' },
      { question: '转换后的文字一定可编辑吗？', answer: '图片版 PDF 转 Word 主要保持版式，OCR 或结构化转换才会生成可编辑文字。' },
    ],
  },
  audio: {
    description: '提供音频格式转换、NCM 文件转换和基础变声处理。工具页会说明支持的输入格式、浏览器能力和本地处理范围。',
    features: ['常见音频转换', '明确格式限制', '本地处理优先'],
    faq: [
      { question: '为什么部分音频无法转换？', answer: '浏览器对编码器和容器格式的支持不同，工具会在不支持时给出明确提示。' },
      { question: '可以处理受版权保护的内容吗？', answer: '仅应处理你拥有或获授权的文件，工具不用于绕过付费或访问控制。' },
    ],
  },
  video: {
    description: '提供受限的公开视频解析与临时下载入口，明确支持的平台、任务状态和隐私边界，仅用于用户拥有或已经获得授权的公开内容。',
    features: ['单个公开视频解析', '格式与任务状态展示', '受控临时下载'],
    faq: [
      { question: '支持会员或私密视频吗？', answer: '不支持，服务不接受登录凭据，也不绕过会员、付费、私密或访问控制。' },
      { question: '下载任务会永久保存吗？', answer: '不会，结果只在短期任务窗口内提供，并按服务策略自动清理。' },
    ],
  },
  data: {
    description: '提供 Excel 与 CSV 清洗、差异比较、批量文件处理、隐私清理和文件校验能力，适合整理表格、核对结果与准备后续分析数据。',
    features: ['表格清洗转换', '批量文件操作', '校验与隐私处理'],
    faq: [
      { question: '会修改原始文件吗？', answer: '不会，工具读取输入并生成新的结果文件，原文件保持不变。' },
      { question: '大表格为什么响应较慢？', answer: '解析和重写工作会占用浏览器内存，建议先拆分超大文件并关闭其他高负载页面。' },
    ],
  },
  office: {
    description: '面向日常办公的发票整理、附件分类、表格对比、格式转换、合同审阅、日历和文档检查工具，帮助减少重复整理工作。',
    features: ['文件批量整理', '办公内容检查', '结果导出复用'],
    faq: [
      { question: '合同审阅可以替代律师吗？', answer: '不能，工具只能提示常见条款和结构风险，重要合同应由专业人士复核。' },
      { question: '发票整理会识别所有字段吗？', answer: '结果取决于文件质量和可读取内容，导出前应人工核对金额、日期和抬头。' },
    ],
  },
  academic: {
    description: '提供论文格式检查、参考文献整理、公式编辑、术语一致性、题目扫描、表格识别和文献笔记，辅助学习与研究资料整理。',
    features: ['论文规范检查', '公式与引用整理', '研究资料提取'],
    faq: [
      { question: '格式检查适用于所有学校吗？', answer: '不同学校和期刊要求不同，应将工具结果与目标模板和最新规范一起核对。' },
      { question: '识别结果需要校对吗？', answer: '需要，图片、公式和复杂表格的识别可能存在误差，提交前应检查原文。' },
    ],
  },
  general: {
    description: '集合证件照、条码二维码、压缩包查看、字幕、颜色、Markdown、密码、文本对比和单位换算等跨场景生活与效率工具。',
    features: ['多场景快捷入口', '本地处理优先', '结果复制与下载'],
    faq: [
      { question: '为什么这些工具放在生活工具？', answer: '这里收纳不属于单一专业分类、但在日常工作和生活中高频使用的通用能力。' },
      { question: '如何更快找到具体工具？', answer: '可以使用侧栏全局搜索或工具目录搜索，支持名称、拼音和常见别名。' },
    ],
  },
};
```

The completed object contains literal entries for all current categories and does not generate generic text at runtime. The text and webmaster plans add their own literal entries when those categories are registered.

- [ ] **Step 4: Run the coverage test and verify GREEN**

Run: `cd SD && npm test -- seo/categoryContent.test.ts`

Expected: PASS, 1 test.

- [ ] **Step 5: Replace the local CategoryPage content map**

Delete `CATEGORY_DESCRIPTIONS` from `CategoryPage.tsx`, import `CATEGORY_CONTENT`, and map `description`, `features`, and FAQ `{ question, answer }` fields. Do not keep an empty fallback; the coverage test guarantees content exists.

- [ ] **Step 6: Run the category tests**

Run: `cd SD && npm test -- seo/categoryContent.test.ts tools/registryMetadata.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SD/seo/categoryContent.ts SD/seo/categoryContent.test.ts SD/pages/CategoryPage.tsx
git commit -m "content: cover every toolbox category for search"
```

### Task 3: Build one metadata model for every route

**Files:**
- Create: `SD/seo/pageMetadata.ts`
- Create: `SD/seo/pageMetadata.test.ts`

- [ ] **Step 1: Write the failing metadata tests**

```ts
import { describe, expect, it } from 'vitest';
import { CATEGORIES, TOOLS } from '../tools/registry';
import { buildCategoryMetadata, buildToolMetadata, type PageMetadata } from './pageMetadata';

const expectValid = (metadata: PageMetadata) => {
  expect(metadata.title.length).toBeGreaterThan(8);
  expect(metadata.description.length).toBeGreaterThanOrEqual(70);
  expect(metadata.description.length).toBeLessThanOrEqual(170);
  expect(metadata.canonical).toMatch(/^https:\/\/zhumenggy\.top\//);
  expect(metadata.jsonLd.length).toBeGreaterThan(0);
};

describe('pageMetadata', () => {
  it('builds unique metadata for every tool and category', () => {
    const tools = TOOLS.map(buildToolMetadata);
    const categories = CATEGORIES.map(buildCategoryMetadata);
    [...tools, ...categories].forEach(expectValid);
    expect(new Set(tools.map(item => item.title)).size).toBe(tools.length);
    expect(new Set(categories.map(item => item.description)).size).toBe(categories.length);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- seo/pageMetadata.test.ts`

Expected: FAIL because `pageMetadata` does not exist.

- [ ] **Step 3: Implement the metadata types and builders**

```ts
import { CATEGORIES, getToolsByCategory, type ToolDef } from '../tools/registry';
import { absoluteSiteUrl, SITE } from '../lib/siteConfig';
import { buildToolSeoDescription } from '../lib/toolSeo';
import { CATEGORY_CONTENT } from './categoryContent';

export type PageMetadata = {
  title: string;
  description: string;
  canonical: string;
  type: 'website' | 'article';
  jsonLd: Record<string, unknown>[];
};

export function buildToolMetadata(tool: ToolDef): PageMetadata {
  const category = CATEGORIES.find(item => item.id === tool.category)!;
  const canonical = absoluteSiteUrl(`/tool/${encodeURIComponent(tool.id)}`);
  const description = buildToolSeoDescription({ tool, categoryName: category.name });
  return {
    title: `${tool.name}在线使用 - ${SITE.name}`,
    description,
    canonical,
    type: 'website',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebApplication', name: tool.name, description, url: canonical, applicationCategory: category.name, offers: { '@type': 'Offer', price: '0', priceCurrency: 'CNY' } }],
  };
}

export function buildCategoryMetadata(category: (typeof CATEGORIES)[number]): PageMetadata {
  const content = CATEGORY_CONTENT[category.id];
  const canonical = absoluteSiteUrl(`/category/${category.id}`);
  const tools = getToolsByCategory(category.id);
  return {
    title: `${category.name}大全 - ${tools.length}个免费在线工具 | ${SITE.name}`,
    description: content.description,
    canonical,
    type: 'website',
    jsonLd: [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: category.name, description: content.description, url: canonical }],
  };
}
```

Also export `HOME_METADATA` with `WebSite` and `SearchAction`, and `TOOLBOX_METADATA` with `CollectionPage` and the `/gj` canonical.

- [ ] **Step 4: Run metadata tests and verify GREEN**

Run: `cd SD && npm test -- seo/pageMetadata.test.ts lib/toolSeo.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/seo/pageMetadata.ts SD/seo/pageMetadata.test.ts
git commit -m "feat: model canonical metadata for every toolbox route"
```

### Task 4: Synchronize client-side document head

**Files:**
- Create: `SD/components/PageSeo.tsx`
- Create: `SD/components/PageSeo.test.tsx`
- Modify: `SD/pages/HomePage.tsx`
- Modify: `SD/pages/ToolboxPage.tsx`
- Modify: `SD/pages/CategoryPage.tsx`
- Modify: `SD/components/ToolWindow.tsx`

- [ ] **Step 1: Write the failing head update test**

```tsx
// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageSeo } from './PageSeo';

describe('PageSeo', () => {
  afterEach(() => { document.head.innerHTML = ''; });
  it('updates title, descriptions, canonical, Open Graph and JSON-LD', () => {
    render(<PageSeo metadata={{ title: '页面标题', description: '足够长的页面摘要', canonical: 'https://zhumenggy.top/test', type: 'website', jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage' }] }} />);
    expect(document.title).toBe('页面标题');
    expect(document.querySelector('link[rel="canonical"]')).toHaveAttribute('href', 'https://zhumenggy.top/test');
    expect(document.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://zhumenggy.top/test');
    expect(document.querySelector('script[data-page-json-ld]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- components/PageSeo.test.tsx`

Expected: FAIL because `PageSeo` does not exist.

- [ ] **Step 3: Implement `PageSeo`**

Use a `useEffect` that upserts `meta[name="description"]`, `meta[property="og:title"]`, `meta[property="og:description"]`, `meta[property="og:url"]`, `meta[name="twitter:title"]`, `meta[name="twitter:description"]`, `link[rel="canonical"]`, and one `script[type="application/ld+json"][data-page-json-ld]`. Set JSON-LD with `textContent = JSON.stringify(metadata.jsonLd)`; never use `innerHTML`.

- [ ] **Step 4: Run the head update test and verify GREEN**

Run: `cd SD && npm test -- components/PageSeo.test.tsx`

Expected: PASS.

- [ ] **Step 5: Mount shared metadata in each page**

Use `<PageSeo metadata={HOME_METADATA} />` in HomePage, `<PageSeo metadata={TOOLBOX_METADATA} />` in ToolboxPage, `<PageSeo metadata={buildCategoryMetadata(category)} />` in CategoryPage, and `<PageSeo metadata={buildToolMetadata(tool)} />` in ToolWindow. Delete ToolWindow's local effect and previous head restoration code.

- [ ] **Step 6: Run SEO component tests**

Run: `cd SD && npm test -- components/PageSeo.test.tsx seo/pageMetadata.test.ts lib/toolSeo.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SD/components/PageSeo.tsx SD/components/PageSeo.test.tsx SD/pages/HomePage.tsx SD/pages/ToolboxPage.tsx SD/pages/CategoryPage.tsx SD/components/ToolWindow.tsx
git commit -m "feat: synchronize client page metadata"
```

### Task 5: Generate static HTML and sitemap after Vite build

**Files:**
- Create: `SD/seo/html.ts`
- Create: `SD/seo/html.test.ts`
- Create: `SD/scripts/generate-static-pages.ts`
- Create: `SD/scripts/generate-static-pages.test.ts`
- Modify: `SD/package.json`
- Modify: `SD/package-lock.json`
- Modify: `SD/index.html`

- [ ] **Step 1: Write the failing HTML helper test**

```ts
import { describe, expect, it } from 'vitest';
import { escapeHtml, injectPageHtml } from './html';

describe('SEO HTML helpers', () => {
  it('escapes user-visible values and injects canonical page content', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    const output = injectPageHtml('<html><head><title>x</title></head><body><div id="root"></div></body></html>', {
      title: 'PDF & 合并',
      description: '安全 < 快速',
      canonical: 'https://zhumenggy.top/tool/merge-pdf',
      type: 'website',
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebApplication' }],
    }, '<main><h1>PDF 合并</h1></main>');
    expect(output).toContain('PDF &amp; 合并');
    expect(output).toContain('rel="canonical" href="https://zhumenggy.top/tool/merge-pdf"');
    expect(output).toContain('<div id="root"><main>');
  });
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `cd SD && npm test -- seo/html.test.ts`

Expected: FAIL because the helpers do not exist.

- [ ] **Step 3: Implement safe HTML injection**

Implement `escapeHtml` for `& < > " '` and `injectPageHtml(template, metadata, body)` using exact replacements for the template title, description/canonical/OG/Twitter tags, a JSON-LD script whose `<` characters are encoded as `\u003c`, and `<div id="root"></div>`. Throw descriptive errors when the template lacks `<head>` or the root marker.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `cd SD && npm test -- seo/html.test.ts`

Expected: PASS.

- [ ] **Step 5: Write the failing generator integration test**

Create a temporary directory with a minimal Vite template, call exported `generateStaticSite({ distDir, tools, categories })`, then assert files exist at `tool/merge-pdf/index.html`, `category/pdf/index.html`, `gj/index.html`, and `sitemap.xml`; assert every page contains its own canonical and a real tool/category link.

- [ ] **Step 6: Run the integration test and verify RED**

Run: `cd SD && npm test -- scripts/generate-static-pages.test.ts`

Expected: FAIL because the generator does not exist.

- [ ] **Step 7: Implement the post-build generator**

Export `generateStaticSite`. Read `dist/index.html` once. Build route records for `/`, `/gj`, every category, and every tool. Render crawlable fallback bodies with escaped headings, descriptions, three-step usage text, FAQs, breadcrumb links, and related real links. Write each non-root route to `<dist>/<route>/index.html`. Generate XML with escaped absolute URLs and write it to both `dist/sitemap.xml` and `public/sitemap.xml`.

At module bottom, run the generator only when `import.meta.url === pathToFileURL(process.argv[1]).href`.

- [ ] **Step 8: Run the integration test and verify GREEN**

Run: `cd SD && npm test -- scripts/generate-static-pages.test.ts seo/html.test.ts`

Expected: PASS.

- [ ] **Step 9: Wire the build lifecycle**

Run: `cd SD && npm install --save-dev tsx@^4.8.1`

Set scripts to:

```json
{
  "build:app": "tsc && vite build",
  "generate:static": "tsx scripts/generate-static-pages.ts",
  "build": "npm run build:app && npm run generate:static"
}
```

Keep `prebuild` so MediaPipe assets are copied before `build`.

- [ ] **Step 10: Make `index.html` a count-independent template**

Replace `185+` in the template description with `免费在线工具`, keep only root fallback metadata, and remove external Google Fonts links only after the navigation plan has supplied self-hosted/system font styles.

- [ ] **Step 11: Build and inspect generated routes**

Run: `cd SD && npm run build`

Expected: exit 0; `dist/tool/merge-pdf/index.html`, `dist/category/pdf/index.html`, and `dist/sitemap.xml` exist and contain route-specific canonicals.

- [ ] **Step 12: Commit**

```bash
git add SD/seo/html.ts SD/seo/html.test.ts SD/scripts/generate-static-pages.ts SD/scripts/generate-static-pages.test.ts SD/package.json SD/package-lock.json SD/index.html SD/public/sitemap.xml
git commit -m "feat: generate static search pages and sitemap"
```

### Task 6: Canonicalize duplicate tool entries

**Files:**
- Create: `SD/tools/redirects.ts`
- Create: `SD/tools/redirects.test.ts`
- Modify: `SD/tools/registry.tsx`
- Modify: `SD/components/ToolWindow.tsx`
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Write the failing redirect integrity test**

```ts
import { describe, expect, it } from 'vitest';
import { TOOLS } from './registry';
import { TOOL_REDIRECTS } from './redirects';

describe('tool canonical redirects', () => {
  it('points removed IDs to unique existing canonical tools', () => {
    const ids = new Set(TOOLS.map(tool => tool.id));
    expect(TOOL_REDIRECTS).toEqual({
      'watermark-image': 'image-enhance-watermark',
      'password-generator': 'password-gen',
      'text-diff': 'text-diff-advanced',
      'unit-converter': 'unit-converter-full',
    });
    expect(Object.keys(TOOL_REDIRECTS).every(id => !ids.has(id))).toBe(true);
    expect(Object.values(TOOL_REDIRECTS).every(id => ids.has(id))).toBe(true);
    expect(new Set(TOOLS.map(tool => tool.name)).size).toBe(TOOLS.length);
  });
});
```

- [ ] **Step 2: Run the redirect test and verify RED**

Run: `cd SD && npm test -- tools/redirects.test.ts`

Expected: FAIL because redirects do not exist and duplicate entries remain.

- [ ] **Step 3: Implement redirects and remove duplicate registry rows**

Export the exact mapping from the test as `Readonly<Record<string, string>>`. Remove only the four legacy tool definitions and their now-unused lazy component imports. Keep the more complete canonical implementations.

- [ ] **Step 4: Resolve legacy IDs in ToolWindow**

Before rendering a missing tool, check `TOOL_REDIRECTS[toolId]` and render `<Navigate replace to={`/tool/${canonicalId}`} />`. Do not render a noindex duplicate page.

- [ ] **Step 5: Remove fixed-count assertions**

In `registryMetadata.test.ts`, replace `expect(TOOLS).toHaveLength(186)` with `expect(TOOLS.length).toBeGreaterThan(180)` and keep the privacy/status completeness assertions.

- [ ] **Step 6: Run redirect, registry, sitemap, and build tests**

Run: `cd SD && npm test -- tools/redirects.test.ts tools/registryMetadata.test.ts tools/sitemap.test.ts scripts/generate-static-pages.test.ts`

Expected: PASS.

Run: `cd SD && npm run build`

Expected: exit 0; canonical pages exist, legacy pages are not included in sitemap.

- [ ] **Step 7: Commit**

```bash
git add SD/tools/redirects.ts SD/tools/redirects.test.ts SD/tools/registry.tsx SD/components/ToolWindow.tsx SD/tools/registryMetadata.test.ts SD/public/sitemap.xml
git commit -m "refactor: canonicalize duplicate tool routes"
```

### Task 7: Replace legacy SEO tests with generated-output contracts

**Files:**
- Modify: `SD/tools/siteMetadata.test.ts`
- Modify: `SD/tools/sitemap.test.ts`
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Write the final generated-output assertions**

Assert the source template contains the root canonical but no numeric tool count. Assert `dist/tool/<id>/index.html` exists for every `TOOLS` entry and includes that tool's canonical/title/description. Assert `dist/category/<id>/index.html` exists for every category. Parse sitemap `<loc>` values, compare them with the exact expected set, and reject duplicate URLs.

- [ ] **Step 2: Run the updated tests**

Run: `cd SD && npm run build && npm test -- tools/siteMetadata.test.ts tools/sitemap.test.ts tools/registryMetadata.test.ts seo/pageMetadata.test.ts`

Expected: PASS.

- [ ] **Step 3: Run complete frontend verification**

Run: `cd SD && npm test && npm run lint && npm run validate && npm run build`

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 4: Verify production HTTPS without changing certificate configuration**

Run: `curl.exe -I --max-time 15 https://zhumenggy.top/`

Expected: successful TLS negotiation and an HTTP response. Do not edit certificate paths or renewal configuration in response to this read-only check.

- [ ] **Step 5: Commit**

```bash
git add SD/tools/siteMetadata.test.ts SD/tools/sitemap.test.ts SD/tools/registryMetadata.test.ts SD/public/sitemap.xml
git commit -m "test: enforce generated toolbox search pages"
```
