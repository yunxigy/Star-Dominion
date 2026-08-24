import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOOL_PATHS = [
  '../image/CompressImage.tsx',
  '../image/ResizeImage.tsx',
  '../image/CropImage.tsx',
  '../image/WatermarkImage.tsx',
  '../image/ImageToBase64.tsx',
  '../image/Base64ToImage.tsx',
  '../image/ColorPicker.tsx',
  '../image/MergeImages.tsx',
  '../image/SplitImageGrid.tsx',
  '../image/FaviconGenerator.tsx',
  '../image/IdPhotoResize.tsx',
  '../image/IdPhotoBgColor.tsx',
  '../image-enhance/ImageSharpness.tsx',
  '../image-enhance/ImageBrightness.tsx',
  '../image-enhance/ImageSharpen.tsx',
  '../image-enhance/ImageExifRemover.tsx',
  '../image-enhance/ImageEnhanceWatermark.tsx',
  '../image-enhance/ImageAddText.tsx',
  '../image-enhance/ImageMosaic.tsx',
  '../image-enhance/ScreenshotBeautify.tsx',
  '../image-enhance/MemeGenerator.tsx',
  '../image-enhance/SocialMediaCover.tsx',
] as const;

describe('image toolbox migration contract', () => {
  it('keeps every image tool inside the shared light workbench', () => {
    for (const relativePath of TOOL_PATHS) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source, relativePath).toMatch(/ImageWorkbench|BatchImageTool/);
      expect(source, relativePath).not.toMatch(/(?:window\.)?alert\s*\(/);
    }
  });
});
