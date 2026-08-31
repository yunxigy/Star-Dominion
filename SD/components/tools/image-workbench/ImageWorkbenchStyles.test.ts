import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImageWorkbench } from './ImageWorkbench';

const stylesheet = readFileSync(new URL('../../../index.css', import.meta.url), 'utf8');
const marker = '/* ===== Image workbench ===== */';
const markerIndex = stylesheet.indexOf(marker);
const nextSectionIndex = stylesheet.indexOf('/* ===== 本地趣味游戏 ===== */', markerIndex + marker.length);
const workbenchCss = stylesheet.slice(markerIndex, nextSectionIndex >= 0 ? nextSectionIndex : undefined);

const html = renderToStaticMarkup(createElement(ImageWorkbench, {
  upload: createElement('span', null, 'upload'),
  controls: createElement('span', null, 'controls'),
  queue: createElement('span', null, 'queue'),
  preview: createElement('span', null, 'preview'),
  actions: createElement('span', null, 'actions'),
  notice: createElement('span', null, 'notice'),
}));

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = workbenchCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'));
  expect(match, `Missing standalone CSS rule for ${selector}`).not.toBeNull();
  return match?.[1] ?? '';
}

describe('ImageWorkbench styles', () => {
  it('uses the rendered root as a real two-column grid with named areas', () => {
    expect(markerIndex).toBeGreaterThanOrEqual(0);
    expect(html).toContain('class="image-workbench"');

    const rootRule = ruleFor('.image-workbench');
    expect(rootRule).toMatch(/display:\s*grid/);
    expect(rootRule).toMatch(
      /grid-template-columns:\s*minmax\(\s*33[6-9]px\s*,\s*360px\s*\)\s+minmax\(\s*0\s*,\s*1fr\s*\)/,
    );
    expect(rootRule).toMatch(
      /grid-template-areas:\s*"notice notice"\s*"sidebar preview"\s*"actions actions"/,
    );
  });

  it.each([
    ['notice', 'notice'],
    ['sidebar', 'sidebar'],
    ['preview', 'preview'],
    ['actions', 'actions'],
  ])('assigns the rendered %s slot to its grid area', (slot, area) => {
    const className = `image-workbench__${slot}`;
    expect(html).toContain(className);
    expect(ruleFor(`.${className}`)).toMatch(new RegExp(`grid-area:\\s*${area}`));
  });

  it.each([
    'dropzone',
    'queue-item',
    'queue-thumbnail',
    'preview-comparison',
    'preview-image',
    'parameter-header',
    'range-fields',
    'toggle-track',
    'action-bar',
  ])('styles the real %s class', (name) => {
    expect(workbenchCss).toMatch(new RegExp(`\\.image-workbench__${name}(?![a-z-])`));
  });

  it('collapses to one column at 920px and respects reduced motion', () => {
    expect(workbenchCss).toMatch(
      /@media\s*\(max-width:\s*920px\)[\s\S]*?\.image-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(\s*0\s*,\s*1fr\s*\)/,
    );
    expect(workbenchCss).toMatch(
      /@media\s*\(max-width:\s*920px\)[\s\S]*?grid-template-areas:\s*"notice"\s*"sidebar"\s*"preview"\s*"actions"/,
    );
    expect(workbenchCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(workbenchCss).toMatch(/transition:\s*none\s*!important/);
  });

  it('keeps the preview and tool footer compact on smaller screens', () => {
    const previewRule = ruleFor('.image-workbench__preview');
    expect(previewRule).toMatch(/min-height:\s*clamp\(\s*280px\s*,\s*42vh\s*,\s*560px\s*\)/);
    expect(workbenchCss).toMatch(
      /@media\s*\(max-width:\s*920px\)[\s\S]*?\.image-workbench__preview\s*\{[^}]*min-height:\s*220px/,
    );
    expect(workbenchCss).toMatch(
      /@media\s*\(max-width:\s*920px\)[\s\S]*?\.tool-window-footer\s*\{[^}]*position:\s*static/,
    );
  });

  it('does not regress to the duplicated 688-line workbench stylesheet', () => {
    expect(workbenchCss.trimEnd().split(/\r?\n/).length).toBeLessThanOrEqual(600);
  });
});
