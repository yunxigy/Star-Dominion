import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import IdPhotoBgColor, { calculateInferenceSize, parseHexColor } from './IdPhotoBgColor';

describe('IdPhotoBgColor', () => {
  it('parses custom six-digit background colors', () => {
    expect(parseHexColor('#438edb')).toEqual([67, 142, 219]);
    expect(() => parseHexColor('#fff')).toThrow('six-digit');
  });

  it('bounds AI inference while preserving the source aspect ratio', () => {
    expect(calculateInferenceSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(calculateInferenceSize(4000, 3000)).toEqual({ width: 1024, height: 768 });
    expect(calculateInferenceSize(3000, 4000)).toEqual({ width: 768, height: 1024 });
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
