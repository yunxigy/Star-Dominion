import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import ImageAddText from './ImageAddText';
import ImageEnhanceWatermark from './ImageEnhanceWatermark';
import ImageMosaic from './ImageMosaic';
import MemeGenerator from './MemeGenerator';
import ScreenshotBeautify from './ScreenshotBeautify';
import SocialMediaCover from './SocialMediaCover';

function render(Component: React.ComponentType<{ onClose: () => void }>) {
  return renderToStaticMarkup(<Component onClose={() => undefined} />);
}

describe('creative image workbenches', () => {
  it('migrates text and watermark tools without dropping controls', () => {
    const watermark = render(ImageEnhanceWatermark);
    const addText = render(ImageAddText);

    expect(watermark).toContain('image-workbench');
    expect(watermark).toContain('水印文字');
    expect(watermark).toContain('位置');
    expect(watermark).toContain('平铺');
    expect(addText).toContain('image-workbench');
    expect(addText).toContain('文字内容');
    expect(addText).toContain('文字颜色');
    expect(addText).toContain('X 坐标');
  });

  it('migrates screenshot and meme tools with their visual controls', () => {
    const screenshot = render(ScreenshotBeautify);
    const meme = render(MemeGenerator);

    expect(screenshot).toContain('image-workbench');
    expect(screenshot).toContain('背景样式');
    expect(screenshot).toContain('圆角');
    expect(screenshot).toContain('添加阴影');
    expect(meme).toContain('image-workbench');
    expect(meme).toContain('顶部文字');
    expect(meme).toContain('底部文字');
    expect(meme).toContain('字号');
  });

  it('migrates social cover templates into batch-capable output', () => {
    const html = render(SocialMediaCover);

    expect(html).toContain('image-workbench');
    for (const label of ['Twitter 封面', '微信封面', 'Instagram', '小红书', 'B站封面', 'YouTube']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('标题文字');
    expect(html).toContain('副标题');
  });

  it('keeps mosaic region selection inside the shared workbench', () => {
    const html = render(ImageMosaic);

    expect(html).toContain('image-workbench');
    expect(html).toContain('选择区域');
    expect(html).toContain('马赛克块大小');
    expect(html).toContain('重置选区');
  });

  it('removes blocking alert-based error handling from migrated tools', () => {
    for (const filename of [
      'ImageEnhanceWatermark.tsx',
      'ImageAddText.tsx',
      'ScreenshotBeautify.tsx',
      'MemeGenerator.tsx',
      'SocialMediaCover.tsx',
      'ImageMosaic.tsx',
    ]) {
      const source = readFileSync(new URL(`./${filename}`, import.meta.url), 'utf8');
      expect(source).not.toMatch(/(?:window\.)?alert\s*\(/);
    }
  });
});
