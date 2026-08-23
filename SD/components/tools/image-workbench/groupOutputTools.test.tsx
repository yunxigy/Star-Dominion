import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import FaviconGenerator from '../image/FaviconGenerator';
import MergeImages from '../image/MergeImages';
import SplitImageGrid from '../image/SplitImageGrid';

function render(Component: React.ComponentType<{ onClose: () => void }>) {
  return renderToStaticMarkup(<Component onClose={() => undefined} />);
}

describe('group and multi-output image tools', () => {
  it('uses group processing and exposes queue ordering for image merge', () => {
    const html = render(MergeImages);
    const source = fs.readFileSync(
      path.resolve(__dirname, '../image/MergeImages.tsx'),
      'utf8',
    );

    expect(html).toContain('image-workbench');
    expect(html).toContain('合并布局');
    expect(html).toContain('列数');
    expect(html).toContain('间距');
    expect(source).toContain('mergeImageProcessor');
    expect(source).toContain('allowReorder');
    expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
  });

  it('shows split dimensions, estimated outputs and ZIP download', () => {
    const html = render(SplitImageGrid);

    expect(html).toContain('image-workbench');
    expect(html).toContain('行数');
    expect(html).toContain('列数');
    expect(html).toContain('预计输出');
    expect(html).toContain('打包下载 ZIP');
  });

  it('offers the complete PNG favicon package and ZIP download', () => {
    const html = render(FaviconGenerator);

    expect(html).toContain('image-workbench');
    for (const size of [16, 32, 48, 64, 128, 180, 192, 512]) {
      expect(html).toContain(`${size}×${size}`);
    }
    expect(html).toContain('PNG 图标包');
    expect(html).toContain('打包下载 ZIP');
  });
});
