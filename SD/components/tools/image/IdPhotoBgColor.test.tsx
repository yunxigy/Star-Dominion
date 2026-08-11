import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import IdPhotoBgColor, { parseHexColor } from './IdPhotoBgColor';

describe('IdPhotoBgColor', () => {
  it('parses custom six-digit background colors', () => {
    expect(parseHexColor('#438edb')).toEqual([67, 142, 219]);
    expect(() => parseHexColor('#fff')).toThrow('six-digit');
  });

  it('renders a private, accessible AI workflow before upload', () => {
    const html = renderToStaticMarkup(<IdPhotoBgColor onClose={() => undefined} />);
    expect(html).toContain('照片仅在当前浏览器处理');
    expect(html).toContain('上传证件照');
    expect(html).toContain('AI 人像分割');
    expect(html).toContain('aria-live="polite"');
  });

  it('does not retain the broken output-color detector', () => {
    const source = readFileSync(new URL('./IdPhotoBgColor.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('rgbToHsl');
    expect(source).not.toContain('isBackground');
    expect(source).not.toContain('灵敏度');
    expect(source).toContain('threshold');
    expect(source).toContain('feather');
  });
});
