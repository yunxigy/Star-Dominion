import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ImageBrightness from '../image-enhance/ImageBrightness';
import ImageExifRemover from '../image-enhance/ImageExifRemover';
import ImageSharpen from '../image-enhance/ImageSharpen';
import ImageSharpness from '../image-enhance/ImageSharpness';

const CASES = [
  { Component: ImageBrightness, file: 'ImageBrightness.tsx', labels: ['亮度', '对比度', '饱和度', '调整预设'] },
  { Component: ImageSharpen, file: 'ImageSharpen.tsx', labels: ['锐化强度', '输出质量'] },
  { Component: ImageSharpness, file: 'ImageSharpness.tsx', labels: ['清晰度评分', '辅助参考'] },
  { Component: ImageExifRemover, file: 'ImageExifRemover.tsx', labels: ['清理元数据', '拍摄时间', '定位'] },
] as const;

describe('image filter workbench tools', () => {
  for (const item of CASES) {
    it(`${item.file} uses batch workbench controls without alert`, () => {
      const html = renderToStaticMarkup(<item.Component onClose={() => undefined} />);
      const source = fs.readFileSync(
        path.resolve(__dirname, `../image-enhance/${item.file}`),
        'utf8',
      );
      expect(html).toContain('image-workbench');
      expect(html).toContain('multiple=""');
      for (const label of item.labels) expect(html).toContain(label);
      expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
    });
  }
});
