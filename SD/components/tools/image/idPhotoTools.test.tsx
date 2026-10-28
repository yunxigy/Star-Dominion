import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import IdPhotoResize from './IdPhotoResize';

describe('ID photo resize workbench', () => {
  it('uses the shared workbench and exposes standard size presets', () => {
    const html = renderToStaticMarkup(<IdPhotoResize onClose={() => undefined} />);
    const source = readFileSync(new URL('./IdPhotoResize.tsx', import.meta.url), 'utf8');

    expect(html).toContain('image-workbench');
    for (const label of ['一寸', '二寸', '小一寸', '小二寸', '护照', '美国签证', '日本签证', '身份证']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('打印尺寸');
    expect(html).toContain('DPI');
    expect(html).toContain('应用到全部');
    expect(source).toContain('idPhotoImageProcessor');
    expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
  });
});
