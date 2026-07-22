import { describe, expect, it } from 'vitest';

import { safeNextPath } from './siteAuth';


describe('safeNextPath', () => {
  it('keeps an internal path including its query string', () => {
    expect(safeNextPath('/stock/analysis/abc?tab=report')).toBe(
      '/stock/analysis/abc?tab=report',
    );
  });

  it.each([
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    '',
    undefined,
    null,
  ])('falls back to the homepage for %s', (value) => {
    expect(safeNextPath(value)).toBe('/');
  });
});
