import { describe, expect, it } from 'vitest';

import { PROJECT_LINKS } from './projectLinks';

describe('project links', () => {
  it('exposes the stock module from the main site', () => {
    expect(PROJECT_LINKS).toContainEqual(
      expect.objectContaining({
        path: '/stock/',
        name: '股票研究',
        external: true,
        requiresAuth: true,
      }),
    );
  });

  it('keeps project paths unique', () => {
    const paths = PROJECT_LINKS.map((project) => project.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
