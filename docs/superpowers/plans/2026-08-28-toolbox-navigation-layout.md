# Toolbox Navigation and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every tool entry a real same-tab link, move project works into the homepage Hero, dedicate the sidebar body to the tool catalog, and improve desktop/mobile layout efficiency without changing the existing visual language.

**Architecture:** Introduce focused `ToolLink`, `ProjectGallery`, and `SidebarCatalog` components so navigation, analytics, authentication, and filtering remain independently testable. Existing pages consume these components and keep the current registry as the single source of truth. Layout changes remain in current Tailwind classes and the existing image-workbench stylesheet.

**Tech Stack:** React 18, React Router 7, TypeScript, Tailwind CSS, Vitest, Testing Library, Framer Motion

---

## File map

- Create `SD/components/ToolLink.tsx`: canonical internal tool link with recent-use recording.
- Create `SD/components/ToolLink.test.tsx`: link semantics and recording tests.
- Create `SD/layouts/sidebarCatalog.ts`: pure sidebar search matcher.
- Create `SD/layouts/sidebarCatalog.test.ts`: pinyin/tag/category search tests.
- Create `SD/layouts/SidebarCatalog.tsx`: search UI and category/tool links.
- Create `SD/layouts/SidebarCatalog.test.tsx`: accessible sidebar behavior tests.
- Create `SD/components/ProjectGallery.tsx`: reusable Hero project gallery.
- Create `SD/components/ProjectGallery.test.tsx`: project link and authentication behavior tests.
- Modify `SD/layouts/AppLayout.tsx`: remove project links from the sidebar and mount the catalog.
- Modify `SD/pages/HomePage.tsx`: place project gallery inside Hero and remove the duplicate lower section.
- Modify `SD/pages/ToolboxPage.tsx`: real links, compact filters, three-column maximum.
- Modify `SD/pages/CategoryPage.tsx`: real category tool links.
- Modify `SD/components/ToolWindow.tsx`: breadcrumb/back navigation and non-covering footer.
- Modify `SD/pages/toolUiLayout.ts`: non-truncating card typography and layout constants.
- Modify `SD/pages/toolUiLayout.test.ts`: assert new typography and image layout contract.
- Modify `SD/pages/toolCardLayout.ts`: link-compatible card shells.
- Modify `SD/pages/toolCardLayout.test.ts`: card shell regression tests.
- Modify `SD/index.css`: smaller empty image preview, small-screen footer flow, focus and reduced-motion rules.
- Modify `SD/App.tsx`: lazy-load non-home page routes.
- Create `SD/pages/navigationSourceContract.test.ts`: prevent regression to button/new-window navigation.

### Task 1: Add the canonical tool link

**Files:**
- Create: `SD/components/ToolLink.tsx`
- Create: `SD/components/ToolLink.test.tsx`

- [ ] **Step 1: Write the failing link-semantics test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolLink } from './ToolLink';

const { recordToolUse } = vi.hoisted(() => ({ recordToolUse: vi.fn() }));
vi.mock('../lib/userTools', () => ({ recordToolUse }));

describe('ToolLink', () => {
  beforeEach(() => recordToolUse.mockClear());

  it('renders a crawlable same-tab href and records ordinary clicks', () => {
    render(
      <MemoryRouter>
        <ToolLink toolId="merge-pdf">PDF 合并</ToolLink>
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: 'PDF 合并' });
    expect(link).toHaveAttribute('href', '/tool/merge-pdf');
    expect(link).not.toHaveAttribute('target');
    fireEvent.click(link);
    expect(recordToolUse).toHaveBeenCalledWith('merge-pdf');
  });

  it('does not prevent modified clicks', () => {
    render(
      <MemoryRouter>
        <ToolLink toolId="merge-pdf">PDF 合并</ToolLink>
      </MemoryRouter>,
    );
    const event = new MouseEvent('click', { bubbles: true, ctrlKey: true });
    screen.getByRole('link').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- components/ToolLink.test.tsx`

Expected: FAIL because `./ToolLink` does not exist.

- [ ] **Step 3: Implement the link component**

```tsx
import React from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { recordToolUse } from '../lib/userTools';

type ToolLinkProps = Omit<LinkProps, 'to'> & { toolId: string };

export const ToolLink: React.FC<ToolLinkProps> = ({ toolId, onClick, children, ...props }) => (
  <Link
    {...props}
    to={`/tool/${encodeURIComponent(toolId)}`}
    onClick={(event) => {
      recordToolUse(toolId);
      onClick?.(event);
    }}
  >
    {children}
  </Link>
);
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `cd SD && npm test -- components/ToolLink.test.tsx`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add SD/components/ToolLink.tsx SD/components/ToolLink.test.tsx
git commit -m "feat: add crawlable tool links"
```

### Task 2: Build the searchable sidebar catalog

**Files:**
- Create: `SD/layouts/sidebarCatalog.ts`
- Create: `SD/layouts/sidebarCatalog.test.ts`
- Create: `SD/layouts/SidebarCatalog.tsx`
- Create: `SD/layouts/SidebarCatalog.test.tsx`
- Modify: `SD/layouts/AppLayout.tsx`

- [ ] **Step 1: Write the failing matcher tests**

```ts
import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/registry';
import { filterSidebarTools } from './sidebarCatalog';

const tool = (id: string, name: string, tags: string[] = []): ToolDef => ({
  id,
  name,
  description: `${name}描述`,
  icon: 'Wrench',
  category: 'dev',
  color: 'amber',
  gradient: 'from-amber-600 to-orange-600',
  glow: 'none',
  component: null as unknown as ToolDef['component'],
  privacy: 'local',
  status: 'stable',
  tags,
});

describe('filterSidebarTools', () => {
  const tools = [tool('json-format', 'JSON 格式化', ['json', 'geshihua']), tool('merge-pdf', 'PDF 合并', ['hebing'])];

  it('matches names, descriptions and pinyin aliases case-insensitively', () => {
    expect(filterSidebarTools(tools, 'JSON').map(item => item.id)).toEqual(['json-format']);
    expect(filterSidebarTools(tools, 'hebing').map(item => item.id)).toEqual(['merge-pdf']);
  });

  it('returns no search results for a blank query', () => {
    expect(filterSidebarTools(tools, '  ')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the matcher test and verify RED**

Run: `cd SD && npm test -- layouts/sidebarCatalog.test.ts`

Expected: FAIL because `filterSidebarTools` does not exist.

- [ ] **Step 3: Implement the pure matcher**

```ts
import type { ToolDef } from '../tools/registry';

const normalize = (value: string) => value.trim().toLocaleLowerCase('zh-CN');

export function filterSidebarTools(tools: ToolDef[], query: string, limit = 20): ToolDef[] {
  const needle = normalize(query);
  if (!needle) return [];
  return tools.filter((tool) => normalize([
    tool.name,
    tool.description,
    ...(tool.tags ?? []),
  ].join(' ')).includes(needle)).slice(0, limit);
}
```

- [ ] **Step 4: Run the matcher test and verify GREEN**

Run: `cd SD && npm test -- layouts/sidebarCatalog.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Write the failing sidebar component test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SidebarCatalog } from './SidebarCatalog';

describe('SidebarCatalog', () => {
  it('shows category links by default and tool links while searching', () => {
    render(<MemoryRouter><SidebarCatalog onNavigate={vi.fn()} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /PDF 工具/ })).toHaveAttribute('href', '/category/pdf');
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索工具' }), { target: { value: 'JSON 格式化' } });
    expect(screen.getByRole('link', { name: /JSON 格式化/ })).toHaveAttribute('href', '/tool/json-format');
  });
});
```

- [ ] **Step 6: Run the sidebar component test and verify RED**

Run: `cd SD && npm test -- layouts/SidebarCatalog.test.tsx`

Expected: FAIL because `SidebarCatalog` does not exist.

- [ ] **Step 7: Implement `SidebarCatalog`**

Create a component that owns the query state, renders an accessible `<input type="search" aria-label="搜索工具">`, shows `filterSidebarTools(TOOLS, query)` as `ToolLink` rows when non-empty, and otherwise maps `CATEGORIES` to `<Link to={\`/category/${category.id}\`}>`. Each category row must use `getIcon(category.icon)`, `getToolsByCategory(category.id).length`, and `aria-current="page"` when the current pathname or current tool category matches.

```tsx
export const SidebarCatalog: React.FC<{ onNavigate: () => void }> = ({ onNavigate }) => {
  const [query, setQuery] = useState('');
  const location = useLocation();
  const currentToolId = location.pathname.match(/^\/tool\/([^/]+)$/)?.[1];
  const currentTool = TOOLS.find(tool => tool.id === currentToolId);
  const matches = filterSidebarTools(TOOLS, query);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <label className="px-3 pb-2 pt-3">
        <span className="sr-only">搜索工具</span>
        <input
          type="search"
          aria-label="搜索工具"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="搜索工具、拼音或别名"
          className="w-full rounded-xl border border-[#d8b58e] bg-[#fff4e6] px-3 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#9a5a28]"
        />
      </label>
      <nav aria-label="工具目录" className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {query.trim() ? matches.map(tool => (
          <ToolLink key={tool.id} toolId={tool.id} onClick={onNavigate} className="sidebar-item">
            <span className="min-w-0 flex-1 truncate">{tool.name}</span>
          </ToolLink>
        )) : CATEGORIES.map(category => (
          <Link
            key={category.id}
            to={`/category/${category.id}`}
            onClick={onNavigate}
            aria-current={currentTool?.category === category.id || location.pathname === `/category/${category.id}` ? 'page' : undefined}
            className="sidebar-item"
          >
            <span className="min-w-0 flex-1">{category.name}</span>
            <span>{getToolsByCategory(category.id).length}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
};
```

- [ ] **Step 8: Run the sidebar component test and verify GREEN**

Run: `cd SD && npm test -- layouts/SidebarCatalog.test.tsx`

Expected: PASS, 1 test.

- [ ] **Step 9: Replace the old AppLayout search/categories/projects blocks**

Remove `PROJECT_LINKS`, `ArrowRight`, `useAuth`, `searchQuery`, `filteredCategories`, and `handleCategoryClick` from `AppLayout.tsx`. Mount `<SidebarCatalog onNavigate={() => setSidebarOpen(false)} />` after the Home link. Keep the logo, `AccountMenu`, and compact footer. Add `aria-label="打开工具目录"`, `aria-expanded={sidebarOpen}`, and `aria-controls="tool-sidebar"` to the mobile menu button, and set `id="tool-sidebar"` on the `<aside>`.

- [ ] **Step 10: Run focused layout tests**

Run: `cd SD && npm test -- layouts/sidebarCatalog.test.ts layouts/SidebarCatalog.test.tsx`

Expected: PASS, 3 tests.

- [ ] **Step 11: Commit**

```bash
git add SD/layouts/sidebarCatalog.ts SD/layouts/sidebarCatalog.test.ts SD/layouts/SidebarCatalog.tsx SD/layouts/SidebarCatalog.test.tsx SD/layouts/AppLayout.tsx
git commit -m "feat: dedicate sidebar to searchable tool catalog"
```

### Task 3: Move project works into the Hero

**Files:**
- Create: `SD/components/ProjectGallery.tsx`
- Create: `SD/components/ProjectGallery.test.tsx`
- Modify: `SD/pages/HomePage.tsx`

- [ ] **Step 1: Write the failing project gallery test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PROJECT_LINKS } from '../lib/projectLinks';
import { ProjectGallery } from './ProjectGallery';

describe('ProjectGallery', () => {
  it('renders every project once and requests login for protected projects', () => {
    const onAuthRequired = vi.fn();
    render(<MemoryRouter><ProjectGallery authenticated={false} authLoading={false} onAuthRequired={onAuthRequired} /></MemoryRouter>);
    expect(screen.getAllByRole('link')).toHaveLength(PROJECT_LINKS.length);
    fireEvent.click(screen.getByRole('link', { name: /股票研究/ }));
    expect(onAuthRequired).toHaveBeenCalledWith('/stock/');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- components/ProjectGallery.test.tsx`

Expected: FAIL because `ProjectGallery` does not exist.

- [ ] **Step 3: Implement the gallery**

Implement a labelled `<section aria-labelledby="project-gallery-title">` using `PROJECT_LINKS`. Internal entries use `Link`; external entries use `<a target="_blank" rel="noopener noreferrer">`. On protected external entries, prevent navigation only when `!authLoading && !authenticated`, then call `onAuthRequired(project.path)`. Use `grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-5` on desktop and `max-md:flex max-md:snap-x max-md:overflow-x-auto`; each mobile card uses `max-md:min-w-[78%] max-md:snap-start`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `cd SD && npm test -- components/ProjectGallery.test.tsx`

Expected: PASS, 1 test.

- [ ] **Step 5: Integrate the gallery in `HomePage`**

Place this block immediately after the Hero stat badges and before the closing tag of the left Hero card:

```tsx
<ProjectGallery
  authenticated={Boolean(user)}
  authLoading={authLoading}
  onAuthRequired={(path) => navigate(`/auth/login?next=${encodeURIComponent(path)}`)}
/>
```

Delete the lower `项目作品` section that maps `PROJECT_LINKS`; remove now-unused `Globe`, `PROJECT_LINKS`, and related authentication rendering code from that lower section only.

- [ ] **Step 6: Run the gallery and project-link tests**

Run: `cd SD && npm test -- components/ProjectGallery.test.tsx lib/projectLinks.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SD/components/ProjectGallery.tsx SD/components/ProjectGallery.test.tsx SD/pages/HomePage.tsx
git commit -m "feat: place project gallery inside homepage hero"
```

### Task 4: Convert every tool card to a real link

**Files:**
- Modify: `SD/pages/HomePage.tsx`
- Modify: `SD/pages/ToolboxPage.tsx`
- Modify: `SD/pages/CategoryPage.tsx`
- Modify: `SD/components/ToolWindow.tsx`
- Create: `SD/pages/navigationSourceContract.test.ts`

- [ ] **Step 1: Write the failing source contract**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('tool navigation source contract', () => {
  it.each(['./HomePage.tsx', './ToolboxPage.tsx', './CategoryPage.tsx'])('%s uses ToolLink instead of openTool', path => {
    const text = source(path);
    expect(text).toContain('ToolLink');
    expect(text).not.toContain('openTool(');
  });

  it('does not use scripted new-window navigation', () => {
    expect(source('../components/ToolRunner.tsx')).not.toContain('window.open');
  });
});
```

- [ ] **Step 2: Run the source contract and verify RED**

Run: `cd SD && npm test -- pages/navigationSourceContract.test.ts`

Expected: FAIL because pages still call `openTool` and `ToolRunner` still calls `window.open`.

- [ ] **Step 3: Replace page launch buttons**

In each page, remove `useToolRunner`, import `ToolLink`, and replace only the launch control:

```tsx
<ToolLink toolId={tool.id} className={getToolCardActionClass(tool.category)} aria-label={`打开${tool.name}`}>
  {/* preserve the existing icon, title, badges and description */}
</ToolLink>
```

Keep the Toolbox favorite button as a sibling, never nested inside `ToolLink`. Replace recent/favorite quick buttons with compact `ToolLink` elements.

- [ ] **Step 4: Remove scripted new-window behavior**

Keep `ToolRunnerProvider` temporarily API-compatible, but implement `openTool` with React Router navigation for any unconverted caller:

```tsx
const navigate = useNavigate();
const openTool = (id: string) => {
  recordToolUse(id);
  navigate(`/tool/${encodeURIComponent(id)}`);
};
```

Update the provider imports to include `useNavigate` and remove the obsolete new-tab comment.

- [ ] **Step 5: Run the source and registry tests**

Run: `cd SD && npm test -- pages/navigationSourceContract.test.ts tools/registryMetadata.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/pages/HomePage.tsx SD/pages/ToolboxPage.tsx SD/pages/CategoryPage.tsx SD/components/ToolWindow.tsx SD/components/ToolRunner.tsx SD/pages/navigationSourceContract.test.ts
git commit -m "refactor: use same-tab links for tool navigation"
```

### Task 5: Compact the directory and mobile filters

**Files:**
- Modify: `SD/pages/toolUiLayout.ts`
- Modify: `SD/pages/toolUiLayout.test.ts`
- Modify: `SD/pages/toolCardLayout.ts`
- Modify: `SD/pages/toolCardLayout.test.ts`
- Modify: `SD/pages/ToolboxPage.tsx`

- [ ] **Step 1: Update failing class-contract tests**

Change expectations so `TOOLBOX_CARD_TITLE_CLASS` contains `text-xl`, `leading-snug`, and no `truncate`; assert `TOOLBOX_CARD_DESCRIPTION_CLASS` contains `line-clamp-2`. Add a card test asserting the base shell contains `content-visibility-auto` and does not force a 260px minimum except assessments.

- [ ] **Step 2: Run the class tests and verify RED**

Run: `cd SD && npm test -- pages/toolUiLayout.test.ts pages/toolCardLayout.test.ts`

Expected: FAIL on the old title and card classes.

- [ ] **Step 3: Implement the class contracts**

```ts
export const TOOLBOX_CARD_TITLE_CLASS = 'text-xl font-bold leading-snug text-[#2f241b]';
export const TOOLBOX_CARD_DESCRIPTION_CLASS = 'mt-2 line-clamp-2 text-base leading-6 text-[#6d5a47]';

const BASE_TOOL_CARD_CLASS = 'content-visibility-auto w-full text-left group tool-card-enhanced glass-card rounded-2xl p-5';
```

- [ ] **Step 4: Run the class tests and verify GREEN**

Run: `cd SD && npm test -- pages/toolUiLayout.test.ts pages/toolCardLayout.test.ts`

Expected: PASS.

- [ ] **Step 5: Change the Toolbox grid and mobile filter presentation**

Use `grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3`. Wrap category chips in a desktop-only `hidden md:flex` container. Add a mobile `<details className="md:hidden">` with summary text `筛选工具` and the same category actions inside. Display the selected category or `全部工具` beside the summary. Keep URL parameter synchronization unchanged.

- [ ] **Step 6: Limit list animations without hiding links**

Set card animation to `initial={index < 18 ? { opacity: 0, y: 12 } : false}` and `animate={index < 18 ? { opacity: 1, y: 0 } : undefined}`. Do not paginate or remove links from the DOM.

- [ ] **Step 7: Add a compact zero-result recovery state**

When `filteredTools.length === 0`, render `<div role="status">` containing the active query, a `清除搜索和筛选` button that clears both URL parameters, and up to six suggestions ranked by shared characters/tags from `TOOLS`. Each suggestion is a `ToolLink`; do not render the large advertising slot inside this empty state.

- [ ] **Step 8: Run directory tests**

Run: `cd SD && npm test -- pages/toolCardLayout.test.ts pages/toolUiLayout.test.ts pages/assessmentToolbox.test.ts pages/assessmentBadges.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add SD/pages/toolUiLayout.ts SD/pages/toolUiLayout.test.ts SD/pages/toolCardLayout.ts SD/pages/toolCardLayout.test.ts SD/pages/ToolboxPage.tsx
git commit -m "feat: compact tool directory and mobile filters"
```

### Task 6: Fix tool-page return flow and image-workbench height

**Files:**
- Modify: `SD/components/ToolWindow.tsx`
- Modify: `SD/index.css`
- Modify: `SD/components/tools/image-workbench/ImageWorkbenchStyles.test.ts`

- [ ] **Step 1: Add failing CSS assertions**

In `ImageWorkbenchStyles.test.ts`, assert the preview rule uses `min-height` no greater than 360px and the mobile media query uses no greater than 240px. Assert the stylesheet contains `.tool-window-footer` with a mobile `position: static` rule.

- [ ] **Step 2: Run the style test and verify RED**

Run: `cd SD && npm test -- components/tools/image-workbench/ImageWorkbenchStyles.test.ts`

Expected: FAIL because the preview minimum is 480px and no mobile footer override exists.

- [ ] **Step 3: Implement the workbench and footer styles**

```css
.image-workbench__preview {
  grid-area: preview;
  min-height: clamp(280px, 42vh, 560px);
}

.content-visibility-auto {
  content-visibility: auto;
  contain-intrinsic-size: 190px;
}

@media (max-width: 920px) {
  .image-workbench__preview { min-height: 220px; }
  .tool-window-footer { position: static; }
}

@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 4: Replace close-only header navigation**

In `ToolWindow.tsx`, render a breadcrumb with links to `/`, `/category/${tool.category}`, and the current tool name. Replace the X/`window.close()` action with `<Link to={`/category/${tool.category}`} aria-label={`返回${category?.name ?? '工具'}分类`}>`. Apply `tool-window-footer` to the existing footer and remove sticky positioning from its class string.

- [ ] **Step 5: Run focused tests**

Run: `cd SD && npm test -- components/tools/image-workbench/ImageWorkbenchStyles.test.ts pages/navigationSourceContract.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/components/ToolWindow.tsx SD/index.css SD/components/tools/image-workbench/ImageWorkbenchStyles.test.ts
git commit -m "fix: shorten tool-page path and image empty state"
```

### Task 7: Lazy-load non-home routes and complete accessibility basics

**Files:**
- Modify: `SD/App.tsx`
- Modify: `SD/layouts/AppLayout.tsx`
- Modify: `SD/pages/HomePage.tsx`
- Modify: `SD/pages/ToolboxPage.tsx`
- Modify: `SD/index.css`
- Create: `SD/pages/accessibilitySourceContract.test.ts`

- [ ] **Step 1: Write the failing source contract**

Assert `App.tsx` imports `lazy` and `Suspense`, does not statically import `ReportsPage`, `GitHubReportsPage`, `AIReportsPage`, `NewsEventsPage`, `AIBriefingPage`, `TranslationPage`, `Stm32Page`, `AIAgentPage`, or `ShouAnRenPage`, and that `AppLayout.tsx` contains `跳到主要内容` and `id="main-content"`.

- [ ] **Step 2: Run the source contract and verify RED**

Run: `cd SD && npm test -- pages/accessibilitySourceContract.test.ts`

Expected: FAIL on eager imports and missing skip link.

- [ ] **Step 3: Lazy-load routes**

```tsx
import { lazy, Suspense } from 'react';

const ToolboxPage = lazy(() => import('./pages/ToolboxPage').then(module => ({ default: module.ToolboxPage })));
const TranslationPage = lazy(() => import('./pages/TranslationPage').then(module => ({ default: module.TranslationPage })));
const Stm32Page = lazy(() => import('./pages/Stm32Page').then(module => ({ default: module.Stm32Page })));
const Stm32Window = lazy(() => import('./pages/Stm32Window'));
const AIAgentPage = lazy(() => import('./pages/AIAgentPage').then(module => ({ default: module.AIAgentPage })));
const ShouAnRenPage = lazy(() => import('./pages/ShouAnRenPage').then(module => ({ default: module.ShouAnRenPage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then(module => ({ default: module.LoginPage })));
const CategoryPage = lazy(() => import('./pages/CategoryPage').then(module => ({ default: module.CategoryPage })));
const ReportsPage = lazy(() => import('./pages/ReportsPage').then(module => ({ default: module.ReportsPage })));
const GitHubReportsPage = lazy(() => import('./pages/GitHubReportsPage').then(module => ({ default: module.GitHubReportsPage })));
const AIReportsPage = lazy(() => import('./pages/AIReportsPage').then(module => ({ default: module.AIReportsPage })));
const NewsEventsPage = lazy(() => import('./pages/NewsEventsPage').then(module => ({ default: module.NewsEventsPage })));
const AIBriefingPage = lazy(() => import('./pages/AIBriefingPage').then(module => ({ default: module.AIBriefingPage })));
```

Wrap `<Routes>` in `<Suspense fallback={<div role="status" className="p-8 text-center">页面加载中…</div>}>`.

- [ ] **Step 4: Add the skip link and visible focus rules**

Add `<a href="#main-content" className="skip-link">跳到主要内容</a>` before the mobile header and set `id="main-content"` on `<main>`. Add `.skip-link` off-screen/focus-visible rules and `:focus-visible` outline rules in `index.css`. Give the homepage and toolbox search inputs visible `<label className="sr-only">` elements.

- [ ] **Step 5: Replace touched `transition-all` and focus suppression**

In files changed by this plan, replace `transition-all` with the specific `transition-colors`, `transition-transform`, or `transition-shadow`. Remove `focus:outline-none` unless the same element has an explicit `focus-visible:outline-*` replacement.

- [ ] **Step 6: Remove remote font blocking**

Delete the `fonts.googleapis.com` and `fonts.gstatic.com` links from `index.html`. Use the existing Chinese system stack in `index.css` and set the body to:

```css
body {
  font-family: Inter, "Noto Sans SC", "Microsoft YaHei", "PingFang SC", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
```

Do not add new font binaries in this phase.

- [ ] **Step 7: Run focused and full frontend verification**

Run: `cd SD && npm test -- pages/accessibilitySourceContract.test.ts pages/navigationSourceContract.test.ts layouts/SidebarCatalog.test.tsx components/ProjectGallery.test.tsx`

Expected: PASS.

Run: `cd SD && npm run lint && npm run build`

Expected: both commands exit 0.

- [ ] **Step 8: Commit**

```bash
git add SD/App.tsx SD/layouts/AppLayout.tsx SD/pages/HomePage.tsx SD/pages/ToolboxPage.tsx SD/index.css SD/index.html SD/pages/accessibilitySourceContract.test.ts
git commit -m "perf: lazy load routes and improve keyboard access"
```

### Task 8: Full-screen and mobile visual verification

**Files:**
- Create: `.runtime/audits/2026-08-28-navigation-layout/` screenshots only; directory remains ignored.

- [ ] **Step 1: Start the frontend**

Run: `cd SD && npm run dev -- --host 127.0.0.1`

Expected: Vite reports a local URL and remains running.

- [ ] **Step 2: Verify the 1920×1080 desktop homepage**

Using the in-app Browser, capture the homepage at 1920×1080. Confirm project cards appear inside the Hero, the lower duplicate project section is absent, and the sidebar body contains only search plus the full category catalog.

- [ ] **Step 3: Verify the 1366×768 directory**

Capture `/gj` at 1366×768. Confirm category navigation scrolls, cards use no more than three columns, names remain readable, and at least one row of tools is visible.

- [ ] **Step 4: Verify mobile flows**

Capture `/`, `/gj`, and `/tool/compress-image` at 390×844. Confirm the menu reports expanded state, filters are collapsed, project cards scroll horizontally, tool results appear in the first viewport, and the tool footer does not cover controls.

- [ ] **Step 5: Run final automated checks for this plan**

Run: `cd SD && npm test && npm run lint && npm run validate && npm run build`

Expected: all commands exit 0 with no failed tests.

- [ ] **Step 6: Commit any verification-driven fixes**

```bash
git add SD
git commit -m "fix: resolve navigation layout verification findings"
```

Do not create an empty commit when no fixes were required.
