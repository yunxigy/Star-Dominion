import { describe, expect, test } from 'vitest';

import { getToolCardLayoutClass } from './toolCardLayout';

describe('tool card layout', () => {
  test('keeps assessment cards tall enough for their badges', () => {
    const className = getToolCardLayoutClass('test');

    expect(className).toContain('min-h-[260px]');
    expect(className).toContain('h-full');
  });

  test('keeps ordinary tools at their natural compact height', () => {
    const className = getToolCardLayoutClass('image');

    expect(className).toContain('content-visibility-auto');
    expect(className).toContain('min-h-[154px]');
    expect(className).toContain('h-full');
  });
});
