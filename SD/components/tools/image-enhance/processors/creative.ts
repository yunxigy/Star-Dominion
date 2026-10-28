import { buildOutputName } from '../../image-workbench/download';
import {
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
} from '../../image-workbench/processing';
import type { ImageProcessor, ProcessedAsset } from '../../image-workbench/types';
import {
  calculateWatermarkPosition,
  drawMeme,
  drawMosaicCooperatively,
  drawScreenshotBeautification,
  drawSocialMediaCover,
  drawTextOverlay,
  type NineGridPosition,
  type SocialCoverFit,
} from './overlay';

export type CreativeOutputFormat = 'png' | 'jpeg' | 'webp';

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError');
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

function createCanvas(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  assertCanvasDimensions(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D');
  return { canvas, context };
}

function outputMime(format: CreativeOutputFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}

function outputExtension(format: CreativeOutputFormat): string {
  return format === 'jpeg' ? 'jpg' : format;
}

function outputQuality(quality: number): number {
  return Math.min(1, Math.max(0, quality));
}

function fillJpegBackground(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
}

export interface TextWatermarkParams {
  text: string;
  position: NineGridPosition;
  opacity: number;
  fontSize: number;
  color: string;
  rotation: number;
  tiled: boolean;
  outputFormat: CreativeOutputFormat;
  quality: number;
}

export const textWatermarkImageProcessor: ImageProcessor<TextWatermarkParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    text: '水印文字',
    position: 'bottom-right',
    opacity: 0.5,
    fontSize: 32,
    color: '#ffffff',
    rotation: 0,
    tiled: false,
    outputFormat: 'png',
    quality: 0.92,
  },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(source.width, source.height);
        if (params.outputFormat === 'jpeg') fillJpegBackground(canvasContext, source.width, source.height);
        canvasContext.drawImage(image, 0, 0);
        const safeFontSize = Math.max(8, Math.round(params.fontSize));
        canvasContext.font = `700 ${safeFontSize}px sans-serif`;
        const textWidth = Math.max(1, canvasContext.measureText(params.text).width);
        const textHeight = safeFontSize * 1.15;
        const rotation = (params.rotation * Math.PI) / 180;

        if (params.text.trim() && params.tiled) {
          const stepX = Math.max(24, textWidth + safeFontSize * 2);
          const stepY = Math.max(24, textHeight + safeFontSize * 2);
          for (let y = -textHeight; y < source.height + stepY; y += stepY) {
            throwIfAborted(context.signal);
            for (let x = -textWidth; x < source.width + stepX; x += stepX) {
              drawTextOverlay(canvasContext, {
                text: params.text,
                x,
                y,
                fontSize: safeFontSize,
                color: params.color,
                opacity: params.opacity,
                rotation,
                align: 'left',
                baseline: 'top',
                strokeColor: 'rgba(0,0,0,0.35)',
                strokeWidth: Math.max(1, safeFontSize / 16),
                signal: context.signal,
              });
            }
          }
        } else if (params.text.trim()) {
          const point = calculateWatermarkPosition({
            canvasWidth: source.width,
            canvasHeight: source.height,
            watermarkWidth: textWidth,
            watermarkHeight: textHeight,
            position: params.position,
            margin: Math.max(12, safeFontSize / 2),
          });
          drawTextOverlay(canvasContext, {
            text: params.text,
            x: point.x + textWidth / 2,
            y: point.y + textHeight / 2,
            fontSize: safeFontSize,
            color: params.color,
            opacity: params.opacity,
            rotation,
            strokeColor: 'rgba(0,0,0,0.55)',
            strokeWidth: Math.max(1, safeFontSize / 16),
            signal: context.signal,
          });
        }

        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-watermark', outputExtension(params.outputFormat)),
          outputMime(params.outputFormat),
          outputQuality(params.quality),
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};

export interface AddTextParams {
  text: string;
  xPercent: number;
  yPercent: number;
  color: string;
  fontSize: number;
  outputFormat: CreativeOutputFormat;
  quality: number;
}

export const addTextImageProcessor: ImageProcessor<AddTextParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    text: '',
    xPercent: 50,
    yPercent: 50,
    color: '#ffffff',
    fontSize: 32,
    outputFormat: 'png',
    quality: 0.92,
  },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(source.width, source.height);
        if (params.outputFormat === 'jpeg') fillJpegBackground(canvasContext, source.width, source.height);
        canvasContext.drawImage(image, 0, 0);
        if (params.text.trim()) {
          drawTextOverlay(canvasContext, {
            text: params.text,
            x: source.width * Math.min(100, Math.max(0, params.xPercent)) / 100,
            y: source.height * Math.min(100, Math.max(0, params.yPercent)) / 100,
            fontSize: Math.max(8, Math.round(params.fontSize)),
            color: params.color,
            align: 'center',
            baseline: 'middle',
            strokeColor: params.color.toLowerCase() === '#000000' ? '#ffffff' : '#000000',
            strokeWidth: Math.max(1, params.fontSize / 16),
            signal: context.signal,
          });
        }
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-text', outputExtension(params.outputFormat)),
          outputMime(params.outputFormat),
          outputQuality(params.quality),
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};

export interface ScreenshotParams {
  background: string;
  padding: number;
  borderRadius: number;
  shadow: boolean;
}

function parseScreenshotBackground(value: string): string | { from: string; to: string } {
  const [type, colors = ''] = value.split(':');
  if (type === 'linear') {
    const [from, to] = colors.split(',');
    if (from && to) return { from, to };
  }
  return colors || value;
}

export const screenshotBeautifyImageProcessor: ImageProcessor<ScreenshotParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    background: 'solid:#111111',
    padding: 60,
    borderRadius: 16,
    shadow: true,
  },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(source.width, source.height);
        drawScreenshotBeautification(canvasContext, image, {
          sourceWidth: source.width,
          sourceHeight: source.height,
          padding: Math.max(0, Math.round(params.padding)),
          borderRadius: Math.max(0, Math.round(params.borderRadius)),
          background: parseScreenshotBackground(params.background),
          shadow: params.shadow,
          signal: context.signal,
        });
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-beautified', 'png'),
          'image/png',
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};

export interface MemeParams {
  topText: string;
  bottomText: string;
  fontSize: number;
}

export const memeImageProcessor: ImageProcessor<MemeParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: { topText: '', bottomText: '', fontSize: 48 },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(source.width, source.height);
        drawMeme(canvasContext, image, {
          sourceWidth: source.width,
          sourceHeight: source.height,
          topText: params.topText,
          bottomText: params.bottomText,
          fontSize: Math.max(12, Math.round(params.fontSize)),
          signal: context.signal,
        });
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-meme', 'png'),
          'image/png',
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};

export interface SocialMediaCoverParams {
  templateName: string;
  targetWidth: number;
  targetHeight: number;
  fit: SocialCoverFit;
  title: string;
  subtitle: string;
  overlayOpacity: number;
}

export const socialMediaCoverImageProcessor: ImageProcessor<SocialMediaCoverParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    templateName: 'twitter',
    targetWidth: 1500,
    targetHeight: 500,
    fit: 'cover',
    title: '',
    subtitle: '',
    overlayOpacity: 0.5,
  },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(params.targetWidth, params.targetHeight);
        drawSocialMediaCover(canvasContext, image, {
          sourceWidth: source.width,
          sourceHeight: source.height,
          targetWidth: params.targetWidth,
          targetHeight: params.targetHeight,
          fit: params.fit,
          background: '#0f172a',
          overlayOpacity: params.overlayOpacity,
          title: params.title,
          subtitle: params.subtitle,
          signal: context.signal,
        });
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, `-${params.templateName}-cover`, 'png'),
          'image/png',
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};

export interface MosaicSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MosaicParams {
  regions: readonly MosaicSelection[];
  wholeImage: boolean;
  blockSize: number;
  outputFormat: CreativeOutputFormat;
  quality: number;
}

export const mosaicImageProcessor: ImageProcessor<MosaicParams> = {
  accept: 'image/png,image/jpeg,image/webp',
  mode: 'per-file',
  defaultParams: {
    regions: [],
    wholeImage: false,
    blockSize: 10,
    outputFormat: 'png',
    quality: 0.92,
  },
  concurrency: 2,
  async process(files, params, context) {
    const outputs: ProcessedAsset[] = [];
    for (const file of files) {
      throwIfAborted(context.signal);
      const image = await decodeImage(file, context.signal);
      try {
        const source = getDecodedSize(image);
        const { canvas, context: canvasContext } = createCanvas(source.width, source.height);
        if (params.outputFormat === 'jpeg') fillJpegBackground(canvasContext, source.width, source.height);
        canvasContext.drawImage(image, 0, 0);
        const regions = params.wholeImage
          ? [{ x: 0, y: 0, width: source.width, height: source.height }]
          : params.regions.map((region) => ({
            x: region.x * source.width,
            y: region.y * source.height,
            width: region.width * source.width,
            height: region.height * source.height,
          }));
        await drawMosaicCooperatively(canvasContext, regions, params.blockSize, context.signal);
        outputs.push(await canvasToProcessedAsset(
          canvas,
          buildOutputName(file.name, '-mosaic', outputExtension(params.outputFormat)),
          outputMime(params.outputFormat),
          outputQuality(params.quality),
        ));
      } finally {
        releaseDecodedImage(image);
      }
    }
    return outputs;
  },
};
