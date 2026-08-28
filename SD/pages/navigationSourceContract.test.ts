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

  it('keeps related tools and the toolbox return link in the same tab', () => {
    const text = source('../components/ToolWindow.tsx');
    expect(text).toContain('ToolLink');
    expect(text).not.toContain('target="_blank"');
  });

  it('renders tool details inside the shared app layout so the directory remains visible', () => {
    const text = source('../App.tsx');
    const layoutStart = text.indexOf('<Route element={<AppLayout />}>');
    const layoutEnd = text.indexOf('</Route>', layoutStart);
    const toolRoute = text.indexOf('<Route path="/tool/:toolId"', layoutStart);

    expect(layoutStart).toBeGreaterThanOrEqual(0);
    expect(toolRoute).toBeGreaterThan(layoutStart);
    expect(toolRoute).toBeLessThan(layoutEnd);
  });

  it('keeps the toolbox return action pinned in the detail header', () => {
    const text = source('../components/ToolWindow.tsx');
    expect(text).toContain('返回工具箱');
    expect(text).toContain('sticky top-16 lg:top-0');
    expect(text).toContain('aria-label="返回工具箱"');
  });

  it('does not render a second app footer around tool details', () => {
    const text = source('../layouts/AppLayout.tsx');
    expect(text).toContain("const isToolDetail = location.pathname.startsWith('/tool/');");
    expect(text).toContain('{!isToolDetail && (');
  });
});
