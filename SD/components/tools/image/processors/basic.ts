import { buildOutputName } from '../../image-workbench/download';
import {
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
} from '../../image-workbench/processing';
import type {
  ImageProcessor,
  ProcessedAsset,
  ProcessorContext,
} from '../../image-workbench/types';

export type ImageOutputFormat = 'original' | 'jpeg' | 'png' | 'webp';
export type ImageFit = 'contain' | 'cover';
export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface Dimensions {
  width: number;
  height: number;
}

export interface DrawRect {
  sx: number;
  sy: number;
  sWidth: number;
  sHeight: number;
  dx: number;
  dy: number;
  dWidth: number;
  dHeight: number;
}

export interface GridRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CompressParams {
  quality: number;
  format: ImageOutputFormat;
  stripMetadata?: boolean;
}

export interface ResizeParams extends CompressParams {
  width?: number;
  height?: number;
  keepAspectRatio: boolean;
}

export interface CropParams extends CompressParams, GridRect {}

export interface WatermarkParams extends CompressParams {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  rotation: number;
  margin: number;
  position: WatermarkPosition;
}

const MIME_BY_FORMAT = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
} as const;

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function positiveDimension(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.max(1, Math.round(value as number))
    : fallback;
}

function decodedDimensions(image: ImageBitmap | HTMLImageElement): Dimensions {
  const naturalWidth = 'naturalWidth' in image ? image.naturalWidth : 0;
  const naturalHeight = 'naturalHeight' in image ? image.naturalHeight : 0;
  return {
    width: naturalWidth || image.width,
    height: naturalHeight || image.height,
  };
}

function releaseDecoded(image: ImageBitmap | HTMLImageElement): void {
  if ('close' in image && typeof image.close === 'function') image.close();
}

function createCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
} {
  assertCanvasDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D');
  return { canvas, context };
}

function sourceMime(file: File): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (file.type === 'image/jpeg' || file.type === 'image/webp') return file.type;
  return 'image/png';
}

function outputMime(file: File, format: ImageOutputFormat) {
  return format === 'original' ? sourceMime(file) : MIME_BY_FORMAT[format];
}

function outputExtension(mime: string): string {
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  return 'png';
}

function prepareCanvasBackground(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  mime: string,
): void {
  if (mime !== 'image/jpeg') return;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
}

async function exportCanvas(
  canvas: HTMLCanvasElement,
  file: File,
  suffix: string,
  format: ImageOutputFormat,
  quality: number,
  signal: AbortSignal,
): Promise<ProcessedAsset> {
  throwIfAborted(signal);
  const mime = outputMime(file, format);
  const output = await canvasToProcessedAsset(
    canvas,
    buildOutputName(file.name, suffix, outputExtension(mime)),
    mime,
    Math.min(1, Math.max(0, quality)),
  );
  throwIfAborted(signal);
  return output;
}

export function fitDimensions(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth?: number,
  targetHeight?: number,
  keepAspectRatio = true,
): Dimensions {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new RangeError('原图尺寸必须大于 0');
  }

  if (!keepAspectRatio) {
    return {
      width: positiveDimension(targetWidth, sourceWidth),
      height: positiveDimension(targetHeight, sourceHeight),
    };
  }

  const hasWidth = Number.isFinite(targetWidth) && (targetWidth ?? 0) > 0;
  const hasHeight = Number.isFinite(targetHeight) && (targetHeight ?? 0) > 0;
  if (!hasWidth && !hasHeight) {
    return { width: Math.round(sourceWidth), height: Math.round(sourceHeight) };
  }

  const scale = hasWidth && hasHeight
    ? Math.min((targetWidth as number) / sourceWidth, (targetHeight as number) / sourceHeight)
    : hasWidth
      ? (targetWidth as number) / sourceWidth
      : (targetHeight as number) / sourceHeight;
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

export function calculateDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: ImageFit,
): DrawRect {
  if ([sourceWidth, sourceHeight, targetWidth, targetHeight].some((value) => value <= 0)) {
    throw new RangeError('图片尺寸必须大于 0');
  }

  if (fit === 'contain') {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const dWidth = Math.max(1, Math.round(sourceWidth * scale));
    const dHeight = Math.max(1, Math.round(sourceHeight * scale));
    return {
      sx: 0,
      sy: 0,
      sWidth: sourceWidth,
      sHeight: sourceHeight,
      dx: (targetWidth - dWidth) / 2,
      dy: (targetHeight - dHeight) / 2,
      dWidth,
      dHeight,
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let sx = 0;
  let sy = 0;
  let sWidth = sourceWidth;
  let sHeight = sourceHeight;
  if (sourceRatio > targetRatio) {
    sWidth = sourceHeight * targetRatio;
    sx = (sourceWidth - sWidth) / 2;
  } else if (sourceRatio < targetRatio) {
    sHeight = sourceWidth / targetRatio;
    sy = (sourceHeight - sHeight) / 2;
  }
  return {
    sx,
    sy,
    sWidth,
    sHeight,
    dx: 0,
    dy: 0,
    dWidth: targetWidth,
    dHeight: targetHeight,
  };
}

export function splitGridRects(
  width: number,
  height: number,
  rows: number,
  columns: number,
): GridRect[] {
  if (![width, height, rows, columns].every(Number.isInteger)
    || width <= 0 || height <= 0 || rows <= 0 || columns <= 0) {
    throw new RangeError('图片尺寸和行列数必须是正整数');
  }
  if (columns > width || rows > height) {
    throw new RangeError('切图行列数不能超过图片像素尺寸');
  }

  const rects: GridRect[] = [];
  for (let row = 0; row < rows; row += 1) {
    const y = Math.round((row * height) / rows);
    const bottom = Math.round(((row + 1) * height) / rows);
    for (let column = 0; column < columns; column += 1) {
      const x = Math.round((column * width) / columns);
      const right = Math.round(((column + 1) * width) / columns);
      rects.push({ x, y, width: right - x, height: bottom - y });
    }
  }
  return rects;
}

async function processEach<P>(
  files: readonly File[],
  params: P,
  context: ProcessorContext,
  process: (
    file: File,
    image: ImageBitmap | HTMLImageElement,
    params: P,
    context: ProcessorContext,
  ) => Promise<ProcessedAsset>,
): Promise<ProcessedAsset[]> {
  throwIfAborted(context.signal);
  const outputs: ProcessedAsset[] = [];
  for (const file of files) {
    throwIfAborted(context.signal);
    const image = await decodeImage(file, context.signal);
    try {
      outputs.push(await process(file, image, params, context));
    } finally {
      releaseDecoded(image);
    }
  }
  return outputs;
}

export const compressImageProcessor: ImageProcessor<CompressParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: { quality: 0.8, format: 'original', stripMetadata: true },
  concurrency: 2,
  async process(files, params, context) {
    if (params.stripMetadata === false) {
      throw new Error('浏览器压缩会自动清理元数据，当前无法在重编码后保留 EXIF。');
    }
    return processEach(files, params, context, async (file, image) => {
      const { width, height } = decodedDimensions(image);
      const mime = outputMime(file, params.format);
      const { canvas, context: canvasContext } = createCanvas(width, height);
      prepareCanvasBackground(canvasContext, width, height, mime);
      canvasContext.drawImage(image, 0, 0, width, height);
      return exportCanvas(canvas, file, '-compressed', params.format, params.quality, context.signal);
    });
  },
};

export const resizeImageProcessor: ImageProcessor<ResizeParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    width: undefined,
    height: undefined,
    keepAspectRatio: true,
    quality: 0.92,
    format: 'original',
  },
  concurrency: 2,
  async process(files, params, context) {
    return processEach(files, params, context, async (file, image) => {
      const source = decodedDimensions(image);
      const target = fitDimensions(
        source.width,
        source.height,
        params.width,
        params.height,
        params.keepAspectRatio,
      );
      const mime = outputMime(file, params.format);
      const { canvas, context: canvasContext } = createCanvas(target.width, target.height);
      prepareCanvasBackground(canvasContext, target.width, target.height, mime);
      canvasContext.drawImage(image, 0, 0, target.width, target.height);
      return exportCanvas(canvas, file, '-resized', params.format, params.quality, context.signal);
    });
  },
};

export const cropImageProcessor: ImageProcessor<CropParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    quality: 0.92,
    format: 'png',
  },
  concurrency: 2,
  async process(files, params, context) {
    return processEach(files, params, context, async (file, image) => {
      const source = decodedDimensions(image);
      const x = Math.max(0, Math.min(source.width - 1, Math.round(params.x)));
      const y = Math.max(0, Math.min(source.height - 1, Math.round(params.y)));
      const requestedWidth = params.width > 0 ? Math.round(params.width) : source.width - x;
      const requestedHeight = params.height > 0 ? Math.round(params.height) : source.height - y;
      const width = Math.max(1, Math.min(source.width - x, requestedWidth));
      const height = Math.max(1, Math.min(source.height - y, requestedHeight));
      const mime = outputMime(file, params.format);
      const { canvas, context: canvasContext } = createCanvas(width, height);
      prepareCanvasBackground(canvasContext, width, height, mime);
      canvasContext.drawImage(image, x, y, width, height, 0, 0, width, height);
      return exportCanvas(canvas, file, '-cropped', params.format, params.quality, context.signal);
    });
  },
};

function watermarkPoint(
  canvasWidth: number,
  canvasHeight: number,
  textWidth: number,
  textHeight: number,
  position: WatermarkPosition,
  margin: number,
): { x: number; y: number } {
  const [vertical, horizontal = 'center'] = position === 'center'
    ? ['center', 'center']
    : position.split('-');
  const x = horizontal === 'left'
    ? margin
    : horizontal === 'right'
      ? canvasWidth - textWidth - margin
      : (canvasWidth - textWidth) / 2;
  const top = vertical === 'top'
    ? margin
    : vertical === 'bottom'
      ? canvasHeight - textHeight - margin
      : (canvasHeight - textHeight) / 2;
  return { x, y: top + textHeight };
}

export const watermarkImageProcessor: ImageProcessor<WatermarkParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    text: '水印文字',
    fontSize: 32,
    color: '#ffffff',
    opacity: 0.55,
    rotation: 0,
    margin: 24,
    position: 'bottom-right',
    quality: 0.92,
    format: 'png',
  },
  concurrency: 2,
  async process(files, params, context) {
    return processEach(files, params, context, async (file, image) => {
      const { width, height } = decodedDimensions(image);
      const mime = outputMime(file, params.format);
      const { canvas, context: canvasContext } = createCanvas(width, height);
      prepareCanvasBackground(canvasContext, width, height, mime);
      canvasContext.drawImage(image, 0, 0, width, height);
      throwIfAborted(context.signal);
      if (params.text.trim()) {
        canvasContext.save();
        canvasContext.font = `600 ${Math.max(1, params.fontSize)}px sans-serif`;
        const textWidth = canvasContext.measureText(params.text).width;
        const point = watermarkPoint(
          width,
          height,
          textWidth,
          params.fontSize,
          params.position,
          Math.max(0, params.margin),
        );
        canvasContext.translate(point.x + textWidth / 2, point.y - params.fontSize / 2);
        canvasContext.rotate(params.rotation * Math.PI / 180);
        canvasContext.globalAlpha = Math.min(1, Math.max(0, params.opacity));
        canvasContext.textAlign = 'center';
        canvasContext.textBaseline = 'middle';
        canvasContext.lineWidth = Math.max(1, params.fontSize / 16);
        canvasContext.strokeStyle = '#000000';
        canvasContext.fillStyle = params.color;
        canvasContext.strokeText(params.text, 0, 0);
        canvasContext.fillText(params.text, 0, 0);
        canvasContext.restore();
      }
      return exportCanvas(canvas, file, '-watermark', params.format, params.quality, context.signal);
    });
  },
};
