import { buildOutputName } from '../../image-workbench/download';
import {
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
  yieldToBrowser,
} from '../../image-workbench/processing';
import type { ImageProcessor, ProcessedAsset } from '../../image-workbench/types';
import { calculateDrawRect, splitGridRects } from './basic';

export interface FaviconParams {
  sizes: readonly number[];
}

export interface IdPhotoParams {
  widthMm: number;
  heightMm: number;
  dpi: number;
  quality: number;
}

export interface SplitGridParams {
  rows: number;
  columns: number;
  format: 'png' | 'jpeg' | 'webp';
  quality: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
}

function decodedSize(image: ImageBitmap | HTMLImageElement) {
  const naturalWidth = 'naturalWidth' in image ? image.naturalWidth : 0;
  const naturalHeight = 'naturalHeight' in image ? image.naturalHeight : 0;
  return { width: naturalWidth || image.width, height: naturalHeight || image.height };
}

function releaseImage(image: ImageBitmap | HTMLImageElement): void {
  if ('close' in image && typeof image.close === 'function') image.close();
}

function createCanvas(width: number, height: number) {
  assertCanvasDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D');
  return { canvas, context };
}

async function bytesToBase64(bytes: Uint8Array, signal?: AbortSignal): Promise<string> {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    if (offset % (chunkSize * 32) === 0) await yieldToBrowser(signal);
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export async function blobToDataUrl(blob: Blob, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  if (typeof FileReader !== 'undefined') {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      const cleanup = () => signal?.removeEventListener('abort', handleAbort);
      const handleAbort = () => {
        reader.abort();
        cleanup();
        reject(new DOMException('操作已取消', 'AbortError'));
      };
      reader.onload = () => {
        cleanup();
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Blob 转 Data URL 失败'));
      };
      reader.onerror = () => {
        cleanup();
        reject(reader.error ?? new Error('Blob 读取失败'));
      };
      signal?.addEventListener('abort', handleAbort, { once: true });
      reader.readAsDataURL(blob);
    });
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  throwIfAborted(signal);
  return `data:${blob.type || 'application/octet-stream'};base64,${await bytesToBase64(bytes, signal)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^,]*),(.*)$/s.exec(dataUrl.trim());
  if (!match) throw new Error('无效的 Data URL');

  const metadata = match[1];
  const encoded = match[2];
  const base64 = /(?:^|;)base64(?:;|$)/i.test(metadata);
  const mime = metadata
    .split(';')
    .filter((part) => part.toLowerCase() !== 'base64')
    .join(';') || 'text/plain;charset=US-ASCII';

  try {
    if (base64) {
      const binary = atob(encoded.replace(/\s+/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(encoded)], { type: mime });
  } catch {
    throw new Error('无效的 Data URL');
  }
}

export function millimetersToPixels(millimeters: number, dpi: number): number {
  if (!Number.isFinite(millimeters) || millimeters <= 0 || !Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('毫米和 DPI 必须大于 0');
  }
  return Math.max(1, Math.round((millimeters / 25.4) * dpi));
}

export function pixelsToMillimeters(pixels: number, dpi: number): number {
  if (!Number.isFinite(pixels) || pixels < 0 || !Number.isFinite(dpi) || dpi <= 0) {
    throw new RangeError('像素不能为负数，DPI 必须大于 0');
  }
  return (pixels / dpi) * 25.4;
}

export const faviconImageProcessor: ImageProcessor<FaviconParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: { sizes: [16, 32, 48, 64, 128, 180, 192, 512] },
  maxFiles: 20,
  concurrency: 2,
  async process(files, params, context) {
    throwIfAborted(context.signal);
    const outputs: ProcessedAsset[] = [];
    const sizes = [...new Set(params.sizes)]
      .filter((size) => Number.isInteger(size) && size > 0)
      .sort((left, right) => left - right);
    if (sizes.length === 0) throw new Error('请至少选择一个图标尺寸');

    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = decodedSize(image);
        for (const size of sizes) {
          throwIfAborted(context.signal);
          const { canvas, context: canvasContext } = createCanvas(size, size);
          const rect = calculateDrawRect(source.width, source.height, size, size, 'contain');
          canvasContext.drawImage(
            image,
            rect.sx,
            rect.sy,
            rect.sWidth,
            rect.sHeight,
            rect.dx,
            rect.dy,
            rect.dWidth,
            rect.dHeight,
          );
          outputs.push(await canvasToProcessedAsset(
            canvas,
            buildOutputName(file.name, `-favicon-${size}x${size}`, 'png'),
            'image/png',
          ));
          throwIfAborted(context.signal);
        }
      } finally {
        releaseImage(image);
      }
    }
    return outputs;
  },
};

export const idPhotoImageProcessor: ImageProcessor<IdPhotoParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: { widthMm: 25, heightMm: 35, dpi: 300, quality: 0.9 },
  concurrency: 2,
  async process(files, params, context) {
    throwIfAborted(context.signal);
    const outputs: ProcessedAsset[] = [];
    const width = millimetersToPixels(params.widthMm, params.dpi);
    const height = millimetersToPixels(params.heightMm, params.dpi);

    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = decodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(width, height);
        canvasContext.fillStyle = '#ffffff';
        canvasContext.fillRect(0, 0, width, height);
        const rect = calculateDrawRect(source.width, source.height, width, height, 'cover');
        canvasContext.drawImage(
          image,
          rect.sx,
          rect.sy,
          rect.sWidth,
          rect.sHeight,
          rect.dx,
          rect.dy,
          rect.dWidth,
          rect.dHeight,
        );
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-id-photo', 'jpg'),
          'image/jpeg',
          Math.min(1, Math.max(0, params.quality)),
        ));
        throwIfAborted(context.signal);
      } finally {
        releaseImage(image);
      }
    }
    return outputs;
  },
};

function splitMime(format: SplitGridParams['format']): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function splitExtension(format: SplitGridParams['format']): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export const splitGridImageProcessor: ImageProcessor<SplitGridParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: { rows: 3, columns: 3, format: 'png', quality: 0.92 },
  concurrency: 2,
  async process(files, params, context) {
    throwIfAborted(context.signal);
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = decodedSize(image);
        const rects = splitGridRects(source.width, source.height, params.rows, params.columns);
        for (let index = 0; index < rects.length; index += 1) {
          throwIfAborted(context.signal);
          const rect = rects[index];
          const row = Math.floor(index / params.columns) + 1;
          const column = (index % params.columns) + 1;
          const { canvas, context: canvasContext } = createCanvas(rect.width, rect.height);
          if (params.format === 'jpeg') {
            canvasContext.fillStyle = '#ffffff';
            canvasContext.fillRect(0, 0, rect.width, rect.height);
          }
          canvasContext.drawImage(
            image,
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            0,
            0,
            rect.width,
            rect.height,
          );
          outputs.push(await canvasToProcessedAsset(
            canvas,
            buildOutputName(
              file.name,
              `-r${row}-c${column}`,
              splitExtension(params.format),
            ),
            splitMime(params.format),
            Math.min(1, Math.max(0, params.quality)),
          ));
        }
      } finally {
        releaseImage(image);
      }
    }
    return outputs;
  },
};
