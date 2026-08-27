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
});
