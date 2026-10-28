import { describe, expect, it } from 'vitest';
import {
  NATIVE_CATEGORIES,
  NATIVE_TOOLS,
  getNativeCategorySummaries,
  getNativeToolById,
  searchNativeTools,
} from '../xiaochengxu/miniprogram/data/toolRegistry';

describe('native tool registry', () => {
  it('has unique tool ids and valid category references', () => {
    const ids = NATIVE_TOOLS.map((tool) => tool.id);
    const categoryIds = new Set(NATIVE_CATEGORIES.map((category) => category.id));

    expect(new Set(ids).size).toBe(ids.length);
    expect(NATIVE_TOOLS.every((tool) => categoryIds.has(tool.category))).toBe(true);
    expect(NATIVE_TOOLS.every((tool) => (
      tool.name.trim()
      && (
        tool.route.startsWith('/pages/tool/')
        || tool.route.startsWith('/packages/media/')
        || tool.route.startsWith('/packages/document/')
        || tool.route.startsWith('/packages/pdf/')
        || tool.route.startsWith('/packages/office/')
        || tool.route.startsWith('/packages/academic/')
        || tool.route.startsWith('/packages/video/')
      )
    ))).toBe(true);
  });

  it('contains the first native tools without exposing stock or mouse-only tools', () => {
    expect(getNativeToolById('json-format')?.status).toBe('ready');
    expect(getNativeToolById('bmi-calculator')?.status).toBe('ready');
    expect(getNativeToolById('stock')).toBeUndefined();
    expect(NATIVE_TOOLS.filter((tool) => tool.category === 'mouse')).toHaveLength(0);
    expect(getNativeToolById('video-parser-downloader')?.workbench).toBe('video');
    expect(getNativeToolById('http-status-checker')?.capability).toBe('request');
  });

  it('searches names, descriptions, and tags case-insensitively', () => {
    expect(searchNativeTools('JSON').map((tool) => tool.id)).toContain('json-format');
    expect(searchNativeTools('密码').map((tool) => tool.id)).toContain('password-gen');
    expect(searchNativeTools('not-a-tool')).toHaveLength(0);
  });

  it('counts every registered tool in every category regardless of migration status', () => {
    const summaries = getNativeCategorySummaries();

    expect(summaries).toHaveLength(NATIVE_CATEGORIES.length);
    expect(summaries.find((category) => category.id === 'pdf')?.count).toBeGreaterThan(0);
    expect(summaries.find((category) => category.id === 'audio')?.count).toBeGreaterThan(0);
    expect(summaries.find((category) => category.id === 'pdf')?.count).toBe(
      NATIVE_TOOLS.filter((tool) => tool.category === 'pdf').length,
    );
  });
});
