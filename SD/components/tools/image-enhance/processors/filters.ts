import { buildOutputName } from '../../image-workbench/download';
import {
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
  yieldToBrowser,
} from '../../image-workbench/processing';
import type {
  ImageProcessor,
  ProcessedAsset,
} from '../../image-workbench/types';

export type RgbaPixel = readonly [number, number, number, number];
export type OutputImageMime = 'image/png' | 'image/jpeg' | 'image/webp';

export interface ColorAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

export interface FilterParams extends ColorAdjustments {
  sharpen: number;
  outputMime: OutputImageMime;
  quality: number;
}

export interface ExifReencodeParams {
  outputMime?: OutputImageMime;
  quality: number;
}

export interface SharpnessAnalysisParams {
  outputMime: OutputImageMime;
  quality: number;
}

export const DEFAULT_FILTER_PARAMS: Readonly<FilterParams> = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  sharpen: 0,
  outputMime: 'image/png',
  quality: 0.92,
};

export const DEFAULT_EXIF_REENCODE_PARAMS: Readonly<ExifReencodeParams> = {
  quality: 0.92,
};

export const DEFAULT_SHARPNESS_ANALYSIS_PARAMS: Readonly<SharpnessAnalysisParams> = {
  outputMime: 'image/png',
  quality: 0.92,
};

function createAbortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function assertPixelBuffer(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError('图片尺寸必须是正整数');
  }
  if (pixels.length !== width * height * 4) {
    throw new RangeError('像素数据长度与图片尺寸不匹配');
  }
}

export function clampByte(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function adjustBrightnessPixel(
  pixel: RgbaPixel,
  amount: number,
): [number, number, number, number] {
  const offset = 255 * (amount / 100);
  return [
    clampByte(pixel[0] + offset),
    clampByte(pixel[1] + offset),
    clampByte(pixel[2] + offset),
    clampByte(pixel[3]),
  ];
}

export function adjustContrastPixel(
  pixel: RgbaPixel,
  amount: number,
): [number, number, number, number] {
  const factor = Math.max(0, 1 + amount / 100);
  return [
    clampByte((pixel[0] - 128) * factor + 128),
    clampByte((pixel[1] - 128) * factor + 128),
    clampByte((pixel[2] - 128) * factor + 128),
    clampByte(pixel[3]),
  ];
}

export function adjustSaturationPixel(
  pixel: RgbaPixel,
  amount: number,
): [number, number, number, number] {
  const factor = Math.max(0, 1 + amount / 100);
  const luminance = pixel[0] * 0.2126 + pixel[1] * 0.7152 + pixel[2] * 0.0722;
  return [
    clampByte(luminance + (pixel[0] - luminance) * factor),
    clampByte(luminance + (pixel[1] - luminance) * factor),
    clampByte(luminance + (pixel[2] - luminance) * factor),
    clampByte(pixel[3]),
  ];
}

export function applyColorAdjustments(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: ColorAdjustments,
  signal?: AbortSignal,
): Uint8ClampedArray {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);

  const output = new Uint8ClampedArray(pixels.length);
  for (let y = 0; y < height; y += 1) {
    throwIfAborted(signal);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const source: RgbaPixel = [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
      ];
      const brightened = adjustBrightnessPixel(source, adjustments.brightness);
      const contrasted = adjustContrastPixel(brightened, adjustments.contrast);
      const saturated = adjustSaturationPixel(contrasted, adjustments.saturation);
      output.set(saturated, offset);
    }
  }
  return output;
}

export async function applyColorAdjustmentsCooperatively(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  adjustments: ColorAdjustments,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);
  const output = new Uint8ClampedArray(pixels.length);

  for (let y = 0; y < height; y += 1) {
    if (y % 32 === 0) await yieldToBrowser(signal);
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const source: RgbaPixel = [
        pixels[offset],
        pixels[offset + 1],
        pixels[offset + 2],
        pixels[offset + 3],
      ];
      const brightened = adjustBrightnessPixel(source, adjustments.brightness);
      const contrasted = adjustContrastPixel(brightened, adjustments.contrast);
      output.set(adjustSaturationPixel(contrasted, adjustments.saturation), offset);
    }
  }
  return output;
}

function luminanceAt(pixels: Uint8ClampedArray, offset: number): number {
  return pixels[offset] * 0.2126
    + pixels[offset + 1] * 0.7152
    + pixels[offset + 2] * 0.0722;
}

export function calculateSharpnessScore(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  signal?: AbortSignal,
): number {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);
  if (width < 3 || height < 3) return 0;

  let count = 0;
  let mean = 0;
  let squaredDistance = 0;

  for (let y = 1; y < height - 1; y += 1) {
    throwIfAborted(signal);
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const laplacian = 4 * luminanceAt(pixels, offset)
        - luminanceAt(pixels, offset - 4)
        - luminanceAt(pixels, offset + 4)
        - luminanceAt(pixels, offset - width * 4)
        - luminanceAt(pixels, offset + width * 4);

      count += 1;
      const delta = laplacian - mean;
      mean += delta / count;
      squaredDistance += delta * (laplacian - mean);
    }
  }

  return count > 1 ? squaredDistance / count : 0;
}

export async function calculateSharpnessScoreCooperatively(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  signal?: AbortSignal,
): Promise<number> {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);
  if (width < 3 || height < 3) return 0;
  let count = 0;
  let mean = 0;
  let squaredDistance = 0;

  for (let y = 1; y < height - 1; y += 1) {
    if (y % 32 === 1) await yieldToBrowser(signal);
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      const laplacian = 4 * luminanceAt(pixels, offset)
        - luminanceAt(pixels, offset - 4)
        - luminanceAt(pixels, offset + 4)
        - luminanceAt(pixels, offset - width * 4)
        - luminanceAt(pixels, offset + width * 4);
      count += 1;
      const delta = laplacian - mean;
      mean += delta / count;
      squaredDistance += delta * (laplacian - mean);
    }
  }
  return count > 1 ? squaredDistance / count : 0;
}

export function applySharpenConvolution(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  signal?: AbortSignal,
): Uint8ClampedArray {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);

  const output = new Uint8ClampedArray(pixels);
  if (width < 3 || height < 3 || amount <= 0) return output;

  for (let y = 1; y < height - 1; y += 1) {
    throwIfAborted(signal);
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = pixels[offset + channel];
        const neighbors = pixels[offset - 4 + channel]
          + pixels[offset + 4 + channel]
          + pixels[offset - width * 4 + channel]
          + pixels[offset + width * 4 + channel];
        output[offset + channel] = clampByte(center * (1 + 4 * amount) - neighbors * amount);
      }
    }
  }

  return output;
}

export async function applySharpenConvolutionCooperatively(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray> {
  assertPixelBuffer(pixels, width, height);
  throwIfAborted(signal);
  const output = new Uint8ClampedArray(pixels);
  if (width < 3 || height < 3 || amount <= 0) return output;

  for (let y = 1; y < height - 1; y += 1) {
    if (y % 32 === 1) await yieldToBrowser(signal);
    for (let x = 1; x < width - 1; x += 1) {
      const offset = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        const center = pixels[offset + channel];
        const neighbors = pixels[offset - 4 + channel]
          + pixels[offset + 4 + channel]
          + pixels[offset - width * 4 + channel]
          + pixels[offset + width * 4 + channel];
        output[offset + channel] = clampByte(center * (1 + 4 * amount) - neighbors * amount);
      }
    }
  }
  return output;
}

function getDecodedSize(image: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  const naturalWidth = 'naturalWidth' in image ? image.naturalWidth : 0;
  const naturalHeight = 'naturalHeight' in image ? image.naturalHeight : 0;
  return {
    width: naturalWidth || image.width,
    height: naturalHeight || image.height,
  };
}

function releaseDecodedImage(image: ImageBitmap | HTMLImageElement): void {
  if ('close' in image && typeof image.close === 'function') image.close();
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  assertCanvasDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D');
  return context;
}

function extensionForMime(mime: OutputImageMime): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function supportedSourceMime(file: File): OutputImageMime {
  if (file.type === 'image/jpeg' || file.type === 'image/webp' || file.type === 'image/png') {
    return file.type;
  }
  return 'image/png';
}

async function exportCanvas(
  canvas: HTMLCanvasElement,
  sourceName: string,
  suffix: string,
  mime: OutputImageMime,
  quality: number,
  signal: AbortSignal,
): Promise<ProcessedAsset> {
  throwIfAborted(signal);
  let outputCanvas = canvas;

  if (mime === 'image/jpeg') {
    outputCanvas = createCanvas(canvas.width, canvas.height);
    const context = getCanvasContext(outputCanvas);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(canvas, 0, 0);
  }

  const asset = await canvasToProcessedAsset(
    outputCanvas,
    buildOutputName(sourceName, suffix, extensionForMime(mime)),
    mime,
    Math.min(1, Math.max(0, quality)),
  );
  throwIfAborted(signal);
  return asset;
}

export const processImageFilters: ImageProcessor<FilterParams>['process'] = async (
  files,
  params,
  context,
) => {
  throwIfAborted(context.signal);
  const outputs: ProcessedAsset[] = [];

  for (const file of files) {
    throwIfAborted(context.signal);
    const image = await decodeImage(file, context.signal);

    try {
      const { width, height } = getDecodedSize(image);
      const canvas = createCanvas(width, height);
      const canvasContext = getCanvasContext(canvas);
      canvasContext.drawImage(image, 0, 0);
      throwIfAborted(context.signal);

      const source = canvasContext.getImageData(0, 0, width, height);
      let pixels = await applyColorAdjustmentsCooperatively(
        source.data,
        width,
        height,
        params,
        context.signal,
      );
      if (params.sharpen > 0) {
        pixels = await applySharpenConvolutionCooperatively(
          pixels,
          width,
          height,
          params.sharpen,
          context.signal,
        );
      }
      const adjustedImageData = canvasContext.createImageData(width, height);
      adjustedImageData.data.set(pixels);
      canvasContext.putImageData(adjustedImageData, 0, 0);
      outputs.push(await exportCanvas(
        canvas,
        file.name,
        '-adjusted',
        params.outputMime,
        params.quality,
        context.signal,
      ));
    } finally {
      releaseDecodedImage(image);
    }
  }

  return outputs;
};

export const reencodeImageWithoutExif: ImageProcessor<ExifReencodeParams>['process'] = async (
  files,
  params,
  context,
) => {
  throwIfAborted(context.signal);
  const outputs: ProcessedAsset[] = [];

  for (const file of files) {
    throwIfAborted(context.signal);
    const image = await decodeImage(file, context.signal);

    try {
      const { width, height } = getDecodedSize(image);
      const canvas = createCanvas(width, height);
      getCanvasContext(canvas).drawImage(image, 0, 0);
      const mime = params.outputMime ?? supportedSourceMime(file);
      outputs.push(await exportCanvas(
        canvas,
        file.name,
        '-clean',
        mime,
        params.quality,
        context.signal,
      ));
    } finally {
      releaseDecodedImage(image);
    }
  }

  return outputs;
};

export const analyzeImageSharpness: ImageProcessor<SharpnessAnalysisParams>['process'] = async (
  files,
  params,
  context,
) => {
  throwIfAborted(context.signal);
  const outputs: ProcessedAsset[] = [];
  for (const file of files) {
    throwIfAborted(context.signal);
    const image = await decodeImage(file, context.signal);
    try {
      const { width, height } = getDecodedSize(image);
      const canvas = createCanvas(width, height);
      const canvasContext = getCanvasContext(canvas);
      canvasContext.drawImage(image, 0, 0);
      const imageData = canvasContext.getImageData(0, 0, width, height);
      const score = await calculateSharpnessScoreCooperatively(
        imageData.data,
        width,
        height,
        context.signal,
      );
      const level = score < 100 ? '偏模糊' : score < 500 ? '一般' : '清晰';
      const output = await exportCanvas(
        canvas,
        file.name,
        '-sharpness-analysis',
        params.outputMime,
        params.quality,
        context.signal,
      );
      outputs.push({
        ...output,
        metrics: [
          { label: '清晰度评分', value: score.toFixed(1) },
          { label: '参考等级', value: level },
          { label: '图像尺寸', value: `${width} × ${height}` },
        ],
      });
    } finally {
      releaseDecodedImage(image);
    }
  }
  return outputs;
};

export function createFilterProcessor(
  defaultParams: FilterParams = { ...DEFAULT_FILTER_PARAMS },
): ImageProcessor<FilterParams> {
  return {
    accept: 'image/png,image/jpeg,image/webp',
    mode: 'per-file',
    defaultParams: { ...defaultParams },
    process: processImageFilters,
  };
}

export function createExifReencodeProcessor(
  defaultParams: ExifReencodeParams = { ...DEFAULT_EXIF_REENCODE_PARAMS },
): ImageProcessor<ExifReencodeParams> {
  return {
    accept: 'image/png,image/jpeg,image/webp',
    mode: 'per-file',
    defaultParams: { ...defaultParams },
    process: reencodeImageWithoutExif,
  };
}

export function createSharpnessAnalysisProcessor(
  defaultParams: SharpnessAnalysisParams = { ...DEFAULT_SHARPNESS_ANALYSIS_PARAMS },
): ImageProcessor<SharpnessAnalysisParams> {
  return {
    accept: 'image/png,image/jpeg,image/webp',
    mode: 'per-file',
    defaultParams: { ...defaultParams },
    concurrency: 2,
    process: analyzeImageSharpness,
  };
}
