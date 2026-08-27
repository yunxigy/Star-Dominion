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
