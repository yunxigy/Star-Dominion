import { describe, expect, it, vi } from 'vitest';
import type { ImageProcessor } from '../../image-workbench/types';
import {
  adjustBrightnessPixel,
  adjustContrastPixel,
  adjustSaturationPixel,
  applyColorAdjustments,
  applyColorAdjustmentsCooperatively,
  applySharpenConvolution,
  calculateSharpnessScore,
  createExifReencodeProcessor,
  createFilterProcessor,
  processImageFilters,
  reencodeImageWithoutExif,
  type ExifReencodeParams,
  type FilterParams,
} from './filters';
import {
  calculateNineGridPosition,
  calculateSocialCoverLayout,
  calculateWatermarkPosition,
  drawImageWatermark,
  drawMeme,
  drawMosaic,
  drawScreenshotBeautification,
  drawSocialMediaCover,
  drawTextOverlay,
} from './overlay';

function makePixels(
  width: number,
  height: number,
  pixelAt: (x: number, y: number) => readonly [number, number, number, number],
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      pixels.set(pixelAt(x, y), (y * width + x) * 4);
    }
  }
  return pixels;
}

function expectBytePixel(pixel: readonly number[]): void {
  expect(pixel).toHaveLength(4);
  for (const channel of pixel) {
    expect(Number.isInteger(channel)).toBe(true);
    expect(channel).toBeGreaterThanOrEqual(0);
    expect(channel).toBeLessThanOrEqual(255);
  }
}

describe('pixel colour transforms', () => {
  it('adjusts brightness and clamps every colour channel to a byte', () => {
    const result = adjustBrightnessPixel([250, 5, 128, 77], 20);

    expect(result).toEqual([255, 56, 179, 77]);
    expectBytePixel(result);
  });

  it('adjusts contrast around the midpoint without changing alpha', () => {
    const result = adjustContrastPixel([10, 128, 250, 91], 100);

    expect(result).toEqual([0, 128, 255, 91]);
    expectBytePixel(result);
  });

  it('removes saturation to a neutral luminance and clamps oversaturation', () => {
    const grayscale = adjustSaturationPixel([200, 100, 0, 63], -100);
    const boosted = adjustSaturationPixel([255, 0, 0, 255], 200);

    expect(grayscale[0]).toBe(grayscale[1]);
    expect(grayscale[1]).toBe(grayscale[2]);
    expect(grayscale[3]).toBe(63);
    expectBytePixel(grayscale);
    expectBytePixel(boosted);
  });

  it('applies combined adjustments without mutating source pixels', () => {
    const source = new Uint8ClampedArray([10, 20, 30, 40, 245, 250, 255, 200]);
    const snapshot = new Uint8ClampedArray(source);

    const result = applyColorAdjustments(source, 2, 1, {
      brightness: 25,
      contrast: 20,
      saturation: 40,
    });

    expect(source).toEqual(snapshot);
    expect(result).not.toBe(source);
    for (const channel of result) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(255);
    }
    expect(result[3]).toBe(40);
    expect(result[7]).toBe(200);
  });
});

describe('sharpness calculations', () => {
  it('scores a high-frequency image above a flat image', () => {
    const flat = makePixels(5, 5, () => [120, 120, 120, 255]);
    const detailed = makePixels(5, 5, (x, y) => {
      const value = (x + y) % 2 === 0 ? 0 : 255;
      return [value, value, value, 255];
    });

    expect(calculateSharpnessScore(flat, 5, 5)).toBe(0);
    expect(calculateSharpnessScore(detailed, 5, 5)).toBeGreaterThan(0);
  });

  it('sharpens interior pixels while preserving every edge pixel and alpha', () => {
    const source = makePixels(3, 3, (x, y) => {
      const value = x === 1 && y === 1 ? 120 : 20;
      return [value, value, value, 100 + x + y];
    });

    const result = applySharpenConvolution(source, 3, 3, 1);

    for (const [x, y] of [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]]) {
      const offset = (y * 3 + x) * 4;
      expect(Array.from(result.slice(offset, offset + 4)))
        .toEqual(Array.from(source.slice(offset, offset + 4)));
    }
    expect(Array.from(result.slice(16, 20))).toEqual([255, 255, 255, 102]);
  });

  it('checks AbortSignal before pixel loops begin', () => {
    const controller = new AbortController();
    controller.abort();
    const pixels = makePixels(4, 4, () => [0, 0, 0, 255]);

    expect(() => calculateSharpnessScore(pixels, 4, 4, controller.signal))
      .toThrowError(expect.objectContaining({ name: 'AbortError' }));
    expect(() => applySharpenConvolution(pixels, 4, 4, 1, controller.signal))
      .toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  it('yields during large pixel work so cancellation can be observed', async () => {
    const controller = new AbortController();
    const pixels = makePixels(64, 128, () => [20, 40, 60, 255]);
    const processing = applyColorAdjustmentsCooperatively(
      pixels,
      64,
      128,
      { brightness: 5, contrast: 5, saturation: 5 },
      controller.signal,
    );

    controller.abort();
    await expect(processing).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('ImageProcessor-compatible filter functions', () => {
  it('exposes filter and EXIF re-encode functions with ImageProcessor signatures', () => {
    const filterProcess: ImageProcessor<FilterParams>['process'] = processImageFilters;
    const exifProcess: ImageProcessor<ExifReencodeParams>['process'] = reencodeImageWithoutExif;

    expect(filterProcess).toBe(processImageFilters);
    expect(exifProcess).toBe(reencodeImageWithoutExif);
    expect(createFilterProcessor().mode).toBe('per-file');
    expect(createExifReencodeProcessor().mode).toBe('per-file');
  });

  it('rejects already-aborted work before decoding any image', async () => {
    const controller = new AbortController();
    controller.abort();
    const context = { preview: false, signal: controller.signal };

    await expect(processImageFilters([], {
      brightness: 0,
      contrast: 0,
      saturation: 0,
      sharpen: 0,
      outputMime: 'image/png',
      quality: 0.92,
    }, context)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(reencodeImageWithoutExif([], {
      outputMime: 'image/jpeg',
      quality: 0.92,
    }, context)).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('overlay positioning calculations', () => {
  it('exports local Canvas drawing functions for every overlay tool', () => {
    expect([
      drawTextOverlay,
      drawImageWatermark,
      drawMosaic,
      drawScreenshotBeautification,
      drawMeme,
      drawSocialMediaCover,
    ].every((draw) => typeof draw === 'function')).toBe(true);
  });

  it('places content at all representative nine-grid anchors', () => {
    expect(calculateNineGridPosition(1000, 600, 200, 100, 'top-left', 20))
      .toEqual({ x: 20, y: 20 });
    expect(calculateNineGridPosition(1000, 600, 200, 100, 'center', 20))
      .toEqual({ x: 400, y: 250 });
    expect(calculateNineGridPosition(1000, 600, 200, 100, 'bottom-right', 20))
      .toEqual({ x: 780, y: 480 });
  });

  it('uses the same nine-grid geometry for watermark placement', () => {
    expect(calculateWatermarkPosition({
      canvasWidth: 800,
      canvasHeight: 500,
      watermarkWidth: 120,
      watermarkHeight: 60,
      position: 'bottom-center',
      margin: 24,
    })).toEqual({ x: 340, y: 416 });
  });

  it('restores Canvas state when watermark drawing throws', () => {
    const save = vi.fn();
    const restore = vi.fn();
    const context = {
      save,
      restore,
      translate: vi.fn(),
      rotate: vi.fn(),
      drawImage: vi.fn(() => { throw new Error('draw failed'); }),
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    expect(() => drawImageWatermark(context, {} as CanvasImageSource, {
      canvasWidth: 100,
      canvasHeight: 100,
      watermarkWidth: 20,
      watermarkHeight: 20,
      position: 'center',
    })).toThrow('draw failed');
    expect(save).toHaveBeenCalledTimes(2);
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('calculates centered cover cropping for a square social-media canvas', () => {
    expect(calculateSocialCoverLayout(1600, 900, 1080, 1080, 'cover')).toEqual({
      source: { x: 350, y: 0, width: 900, height: 900 },
      destination: { x: 0, y: 0, width: 1080, height: 1080 },
    });
  });

  it('calculates letterboxed contain drawing without cropping source pixels', () => {
    const layout = calculateSocialCoverLayout(1600, 900, 1080, 1080, 'contain');

    expect(layout.source).toEqual({ x: 0, y: 0, width: 1600, height: 900 });
    expect(layout.destination.x).toBeCloseTo(0);
    expect(layout.destination.y).toBeCloseTo(236.25);
    expect(layout.destination.width).toBeCloseTo(1080);
    expect(layout.destination.height).toBeCloseTo(607.5);
  });
});
