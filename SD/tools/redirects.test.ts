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
