import { readFileSync } from 'node:fs';
import type React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import Base64ToImage from './Base64ToImage';
import ColorPicker from './ColorPicker';
import ImageToBase64 from './ImageToBase64';

function render(Component: React.ComponentType<{ onClose: () => void }>) {
  return renderToStaticMarkup(<Component onClose={() => undefined} />);
}

describe('image utility workbenches', () => {
  it('keeps the base64 image conversion workflow in the shared layout', () => {
    const toBase64 = render(ImageToBase64);
    const fromBase64 = render(Base64ToImage);
    const toBase64Source = readFileSync(new URL('./ImageToBase64.tsx', import.meta.url), 'utf8');

    expect(toBase64).toContain('image-workbench');
    expect(toBase64).toContain('Base64 字符串');
    expect(toBase64Source).toContain('复制完整 Base64');
    expect(fromBase64).toContain('image-workbench');
    expect(fromBase64).toContain('输入 Base64 字符串');
    expect(fromBase64).toContain('转换为图片');
  });

  it('keeps the canvas color picker and copy formats accessible', () => {
    const html = render(ColorPicker);

    expect(html).toContain('image-workbench');
    expect(html).toContain('点击图片上的任意位置取色');
    expect(html).toContain('HEX');
    expect(html).toContain('RGB');
    expect(html).toContain('HSL');
  });

  it('does not use blocking alert dialogs in utility tools', () => {
    for (const filename of ['ImageToBase64.tsx', 'Base64ToImage.tsx', 'ColorPicker.tsx']) {
      const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
    }
  });
});
