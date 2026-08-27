// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { PageSeo } from './PageSeo';

describe('PageSeo', () => {
  afterEach(() => {
    cleanup();
    document.head.innerHTML = '';
    document.title = '';
  });

  it('updates title, descriptions, canonical, Open Graph and JSON-LD', () => {
    render(
      <PageSeo
        metadata={{
          title: '页面标题',
          description: '足够长的页面摘要',
          canonical: 'https://zhumenggy.top/test',
          type: 'website',
          jsonLd: [{ '@context': 'https://schema.org', '@type': 'WebPage' }],
        }}
      />,
    );

    expect(document.title).toBe('页面标题');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://zhumenggy.top/test');
    expect(document.querySelector('meta[property="og:url"]')?.getAttribute('content')).toBe('https://zhumenggy.top/test');
    expect(document.querySelector('script[data-page-json-ld]')).not.toBeNull();
  });
});
