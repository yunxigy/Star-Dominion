import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import CompressImage from '../image/CompressImage';
import CropImage from '../image/CropImage';
import ResizeImage from '../image/ResizeImage';
import WatermarkImage from '../image/WatermarkImage';

const TOOL_CASES = [
  {
    name: '图片压缩',
    Component: CompressImage,
    file: '../image/CompressImage.tsx',
    controls: ['压缩质量', '输出格式'],
  },
  {
    name: '图片尺寸调整',
    Component: ResizeImage,
    file: '../image/ResizeImage.tsx',
    controls: ['宽度', '高度', '保持比例'],
  },
  {
    name: '图片裁剪',
    Component: CropImage,
    file: '../image/CropImage.tsx',
    controls: ['裁剪比例', 'X 坐标', 'Y 坐标'],
  },
  {
    name: '图片水印',
    Component: WatermarkImage,
    file: '../image/WatermarkImage.tsx',
    controls: ['水印内容', '位置', '透明度'],
  },
] as const;

describe('core image tools workbench migration', () => {
  for (const tool of TOOL_CASES) {
    it(`${tool.name} uses the shared batch workbench`, () => {
      const html = renderToStaticMarkup(<tool.Component onClose={() => undefined} />);
      const source = fs.readFileSync(path.resolve(__dirname, tool.file), 'utf8');

      expect(html).toContain('image-workbench');
      expect(html).toContain('type="file"');
      expect(html).toContain('multiple=""');
      for (const control of tool.controls) {
        expect(html).toContain(control);
      }
      expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
    });
  }

  it('does not render a second page title inside the tool window', () => {
    for (const tool of TOOL_CASES) {
      const html = renderToStaticMarkup(<tool.Component onClose={() => undefined} />);
      expect(html).not.toMatch(/<h1(?:\s|>)/);
    }
  });
});
