import { useEffect } from 'react';
import { DEFAULT_KEYWORDS, DEFAULT_THEME_COLOR } from '../seo/pageMetadata';
import { SITE } from '../lib/siteConfig';
import type { PageMetadata } from '../seo/pageMetadata';

type PageSeoProps = {
  metadata: PageMetadata;
};

function upsertMeta(selector: string, attributes: Record<string, string>): void {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!element) {
    element = document.createElement('meta');
    document.head.appendChild(element);
  }
  Object.entries(attributes).forEach(([name, value]) => element?.setAttribute(name, value));
}

export function PageSeo({ metadata }: PageSeoProps) {
  useEffect(() => {
    document.title = metadata.title;
    upsertMeta('meta[name="description"]', { name: 'description', content: metadata.description });
    upsertMeta('meta[name="keywords"]', { name: 'keywords', content: metadata.keywords ?? DEFAULT_KEYWORDS });
    upsertMeta('meta[name="theme-color"]', { name: 'theme-color', content: metadata.themeColor ?? DEFAULT_THEME_COLOR });
    upsertMeta('meta[name="application-name"]', { name: 'application-name', content: SITE.name });
    upsertMeta('meta[name="apple-mobile-web-app-title"]', { name: 'apple-mobile-web-app-title', content: SITE.name });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: metadata.type });
    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: metadata.title });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: metadata.description });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: metadata.canonical });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE.name });
    upsertMeta('meta[property="og:locale"]', { property: 'og:locale', content: SITE.locale });
    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: metadata.title });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: metadata.description });

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement('link');
      canonical.setAttribute('rel', 'canonical');
      document.head.appendChild(canonical);
    }
    canonical.setAttribute('href', metadata.canonical);

    let jsonLd = document.head.querySelector<HTMLScriptElement>('script[type="application/ld+json"][data-page-json-ld]');
    if (!jsonLd) {
      jsonLd = document.createElement('script');
      jsonLd.type = 'application/ld+json';
      jsonLd.dataset.pageJsonLd = 'true';
      document.head.appendChild(jsonLd);
    }
    jsonLd.textContent = JSON.stringify(metadata.jsonLd);

    return () => {
      jsonLd?.remove();
    };
  }, [metadata]);

  return null;
}

export default PageSeo;
