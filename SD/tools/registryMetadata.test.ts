import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CATEGORIES, TOOLS } from './registry';

const source = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('toolbox production metadata', () => {
  it('exposes privacy and stability metadata for every tool', () => {
    expect(TOOLS.length).toBeGreaterThan(180);
    expect(TOOLS.every((tool) => Boolean(tool.privacy))).toBe(true);
    expect(TOOLS.every((tool) => Boolean(tool.status))).toBe(true);
  });

  it('derives homepage totals from the registries', () => {
    const homePage = source('../pages/HomePage.tsx');

    expect(homePage).toContain('TOOLS.length');
    expect(homePage).toContain('CATEGORIES.length');
    expect(homePage).not.toContain("value: '128+'");
    expect(TOOLS.length).toBeGreaterThan(0);
    expect(CATEGORIES.length).toBeGreaterThan(0);
  });

  it('does not publish the placeholder canonical domain', () => {
    expect(source('../components/ToolWindow.tsx')).not.toContain('tools.example.com');
  });

  it('does not request a missing title font', () => {
    expect(source('../index.css')).not.toContain('STXINWEI.TTF');
  });

  it('does not nest the favorite button inside the tool launch button', () => {
    const toolboxPage = source('../pages/ToolboxPage.tsx');
    expect(toolboxPage).not.toMatch(/<motion\.button[\s\S]*?<button[\s\S]*?<\/motion\.button>/);
  });

  it('registers the public video downloader with an explicit remote privacy boundary', () => {
    const tool = TOOLS.find((item) => item.id === 'video-parser-downloader');
    expect(tool).toMatchObject({
      name: '视频解析下载',
      category: 'video',
      icon: 'Video',
      privacy: 'third-party-api',
      status: 'beta',
    });
    expect(CATEGORIES.some((category) => category.id === 'video')).toBe(true);
  });

  it('registers the local text efficiency suite with searchable intent tags', () => {
    const expected = ['remove-blank-lines', 'dedupe-lines', 'sort-lines', 'batch-text-replace', 'line-number-tool', 'character-frequency', 'entity-extractor', 'text-file-batch', 'markup-converter'];
    const textTools = TOOLS.filter((tool) => tool.category === 'text');
    expect(textTools.map((tool) => tool.id)).toEqual(expected);
    expect(textTools.every((tool) => tool.privacy === 'local' && tool.status === 'stable' && (tool.tags?.length ?? 0) >= 4)).toBe(true);
    expect(CATEGORIES.some((category) => category.id === 'text')).toBe(true);
  });
});
