import { buildOutputName } from '../../image-workbench/download';
import {
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
} from '../../image-workbench/processing';
import type { ImageProcessor } from '../../image-workbench/types';

export type MergeDirection = 'horizontal' | 'vertical' | 'grid';
export type MergeAlignment = 'start' | 'center' | 'end';
export type MergeFormat = 'png' | 'jpeg' | 'webp';

export interface ImageSize {
  width: number;
  height: number;
}

export interface MergePlacement extends ImageSize {
  x: number;
  y: number;
}

export interface MergeLayoutOptions {
  layout: MergeDirection;
  columns: number;
  gap: number;
  align: MergeAlignment;
}

export interface MergeLayout {
  width: number;
  height: number;
  placements: MergePlacement[];
}

export interface MergeParams extends MergeLayoutOptions {
  backgroundColor: string;
  format: MergeFormat;
  quality: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
}

function crossOffset(space: number, content: number, align: MergeAlignment): number {
  if (align === 'end') return space - content;
  if (align === 'center') return (space - content) / 2;
  return 0;
}

function assertSizes(sizes: readonly ImageSize[]): void {
  if (sizes.length === 0) throw new Error('请至少添加一张图片');
  if (sizes.some((size) => size.width <= 0 || size.height <= 0)) {
    throw new RangeError('图片尺寸必须大于 0');
  }
}

export function calculateMergeLayout(
  sizes: readonly ImageSize[],
  options: MergeLayoutOptions,
): MergeLayout {
  assertSizes(sizes);
  const gap = Math.max(0, options.gap);

  if (options.layout === 'horizontal') {
    const height = Math.max(...sizes.map((size) => size.height));
    let x = 0;
    return {
      width: sizes.reduce((total, size) => total + size.width, 0) + gap * (sizes.length - 1),
      height,
      placements: sizes.map((size) => {
        const placement = {
          x,
          y: crossOffset(height, size.height, options.align),
          ...size,
        };
        x += size.width + gap;
        return placement;
      }),
    };
  }

  if (options.layout === 'vertical') {
    const width = Math.max(...sizes.map((size) => size.width));
    let y = 0;
    return {
      width,
      height: sizes.reduce((total, size) => total + size.height, 0) + gap * (sizes.length - 1),
      placements: sizes.map((size) => {
        const placement = {
          x: crossOffset(width, size.width, options.align),
          y,
          ...size,
        };
        y += size.height + gap;
        return placement;
      }),
    };
  }

  const columns = Math.max(1, Math.min(sizes.length, Math.floor(options.columns)));
  const rows = Math.ceil(sizes.length / columns);
  const cellWidth = Math.max(...sizes.map((size) => size.width));
  const cellHeight = Math.max(...sizes.map((size) => size.height));
  return {
    width: cellWidth * columns + gap * (columns - 1),
    height: cellHeight * rows + gap * (rows - 1),
    placements: sizes.map((size, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      return {
        x: column * (cellWidth + gap) + crossOffset(cellWidth, size.width, options.align),
        y: row * (cellHeight + gap) + crossOffset(cellHeight, size.height, options.align),
        ...size,
      };
    }),
  };
}

function decodedSize(image: ImageBitmap | HTMLImageElement): ImageSize {
  const naturalWidth = 'naturalWidth' in image ? image.naturalWidth : 0;
  const naturalHeight = 'naturalHeight' in image ? image.naturalHeight : 0;
  return { width: naturalWidth || image.width, height: naturalHeight || image.height };
}

function releaseImage(image: ImageBitmap | HTMLImageElement): void {
  if ('close' in image && typeof image.close === 'function') image.close();
}

function mimeFor(format: MergeFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function extensionFor(format: MergeFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

export const mergeImageProcessor: ImageProcessor<MergeParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'group',
  defaultParams: {
    layout: 'horizontal',
    columns: 2,
    gap: 12,
    align: 'center',
    backgroundColor: '#ffffff',
    format: 'png',
    quality: 0.92,
  },
  maxFiles: 30,
  async process(files, params, context) {
    throwIfAborted(context.signal);
    if (files.length === 0) throw new Error('请至少添加一张图片');
    const images: Array<ImageBitmap | HTMLImageElement> = [];

    try {
      for (const file of files) {
        throwIfAborted(context.signal);
        images.push(await decodeImage(file, context.signal));
      }
      const layout = calculateMergeLayout(images.map(decodedSize), params);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.ceil(layout.width));
      canvas.height = Math.max(1, Math.ceil(layout.height));
      assertCanvasDimensions(canvas.width, canvas.height);
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) throw new Error('当前浏览器不支持 Canvas 2D');
      if (params.format === 'jpeg') {
        canvasContext.fillStyle = '#ffffff';
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      }
      if (params.backgroundColor && params.backgroundColor !== 'transparent') {
        canvasContext.fillStyle = params.backgroundColor;
        canvasContext.fillRect(0, 0, canvas.width, canvas.height);
      }

      layout.placements.forEach((placement, index) => {
        throwIfAborted(context.signal);
        canvasContext.drawImage(
          images[index],
          placement.x,
          placement.y,
          placement.width,
          placement.height,
        );
      });
      const output = await canvasToProcessedAsset(
        canvas,
        buildOutputName(files[0].name, '-merged', extensionFor(params.format)),
        mimeFor(params.format),
        Math.min(1, Math.max(0, params.quality)),
      );
      throwIfAborted(context.signal);
      return [output];
    } finally {
      images.forEach(releaseImage);
    }
  },
};
