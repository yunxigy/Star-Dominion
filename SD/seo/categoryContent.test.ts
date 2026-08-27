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
