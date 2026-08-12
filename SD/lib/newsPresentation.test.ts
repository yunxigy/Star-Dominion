import { describe, expect, test } from 'vitest';

import { cleanNewsText, displayNewsSummary, displayNewsTitle } from './newsPresentation';

describe('news presentation', () => {
  test('removes RSS markdown and HTML noise', () => {
    expect(cleanNewsText('**site.com** · <a href="https://example.com">查看原文</a>')).toBe('site.com · 查看原文');
  });

  test('adds a Chinese category lead while preserving the original title', () => {
    expect(displayNewsTitle('The Rogue Model storm: agentic AI', ['ai', 'model'])).toContain('AI 行业动态：');
    expect(displayNewsSummary('', 'The Rogue Model storm', ['ai'])).toContain('AI 行业动态');
  });

  test('does not expose an English-only RSS summary as the primary Chinese summary', () => {
    expect(displayNewsSummary('A long English RSS description', 'A model update', ['ai'])).toContain('请打开原文');
  });
});
