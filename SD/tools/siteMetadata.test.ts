import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readHtml = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), 'utf8');

const descriptionFrom = (html: string, tag: string) => {
  const match = html.match(new RegExp(`<meta ${tag} content="([^"]+)"`));
  return match?.[1] ?? '';
};

describe('tool site SEO description', () => {
  it('keeps the source and uploadable dist descriptions complete and in sync', () => {
    const source = readHtml('../index.html');
    const dist = readHtml('../dist/index.html');
    const sourceDescription = descriptionFrom(source, 'name="description"');
    const distDescription = descriptionFrom(dist, 'name="description"');

    expect(sourceDescription.length).toBeGreaterThanOrEqual(120);
    expect(sourceDescription.length).toBeLessThanOrEqual(170);
    expect(sourceDescription).toContain('185+');
    expect(sourceDescription).not.toContain('175+');
    expect(distDescription).toBe(sourceDescription);
    expect(descriptionFrom(source, 'property="og:description"')).toBe(sourceDescription);
    expect(descriptionFrom(source, 'name="twitter:description"')).toBe(sourceDescription);
  });
});
