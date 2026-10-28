import { assertCanvasDimensions, yieldToBrowser } from '../../image-workbench/processing';

export type NineGridPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type SocialCoverFit = 'contain' | 'cover';

export interface Point { x: number; y: number }
export interface DrawRect { x: number; y: number; width: number; height: number }
export interface SocialCoverLayout { source: DrawRect; destination: DrawRect }

export interface WatermarkPositionOptions {
  canvasWidth: number;
  canvasHeight: number;
  watermarkWidth: number;
  watermarkHeight: number;
  position: NineGridPosition;
  margin?: number;
}

export interface TextOverlayOptions {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color?: string;
  fontFamily?: string;
  fontWeight?: string | number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  opacity?: number;
  rotation?: number;
  strokeColor?: string;
  strokeWidth?: number;
  maxWidth?: number;
  signal?: AbortSignal;
}

export interface ImageWatermarkOptions extends WatermarkPositionOptions {
  opacity?: number;
  rotation?: number;
  tiled?: boolean;
  horizontalGap?: number;
  verticalGap?: number;
  signal?: AbortSignal;
}

export interface MosaicRegion extends DrawRect {}

export interface ScreenshotBeautifyOptions {
  sourceWidth: number;
  sourceHeight: number;
  padding: number;
  borderRadius: number;
  background: string | { from: string; to: string };
  shadow?: boolean;
  signal?: AbortSignal;
}

export interface MemeOptions {
  sourceWidth: number;
  sourceHeight: number;
  topText?: string;
  bottomText?: string;
  fontSize: number;
  signal?: AbortSignal;
}

export interface SocialMediaCoverOptions {
  sourceWidth: number;
  sourceHeight: number;
  targetWidth: number;
  targetHeight: number;
  fit: SocialCoverFit;
  background?: string;
  overlayOpacity?: number;
  title?: string;
  subtitle?: string;
  signal?: AbortSignal;
}

function abortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label}必须大于 0`);
}

function opacity(value = 1): number {
  return Math.min(1, Math.max(0, value));
}

export function calculateNineGridPosition(
  containerWidth: number,
  containerHeight: number,
  contentWidth: number,
  contentHeight: number,
  position: NineGridPosition,
  margin = 0,
): Point {
  positive(containerWidth, '容器宽度');
  positive(containerHeight, '容器高度');
  positive(contentWidth, '内容宽度');
  positive(contentHeight, '内容高度');
  const safeMargin = Math.max(0, margin);
  const [vertical, horizontal = 'center'] = position === 'center'
    ? ['center', 'center']
    : position.split('-');
  const x = horizontal === 'left'
    ? safeMargin
    : horizontal === 'right'
      ? containerWidth - contentWidth - safeMargin
      : (containerWidth - contentWidth) / 2;
  const y = vertical === 'top'
    ? safeMargin
    : vertical === 'bottom'
      ? containerHeight - contentHeight - safeMargin
      : (containerHeight - contentHeight) / 2;
  return { x, y };
}

export function calculateWatermarkPosition(options: WatermarkPositionOptions): Point {
  return calculateNineGridPosition(
    options.canvasWidth,
    options.canvasHeight,
    options.watermarkWidth,
    options.watermarkHeight,
    options.position,
    options.margin,
  );
}

export function calculateSocialCoverLayout(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  fit: SocialCoverFit,
): SocialCoverLayout {
  positive(sourceWidth, '源图片宽度');
  positive(sourceHeight, '源图片高度');
  positive(targetWidth, '画布宽度');
  positive(targetHeight, '画布高度');

  if (fit === 'contain') {
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    const width = sourceWidth * scale;
    const height = sourceHeight * scale;
    return {
      source: { x: 0, y: 0, width: sourceWidth, height: sourceHeight },
      destination: {
        x: (targetWidth - width) / 2,
        y: (targetHeight - height) / 2,
        width,
        height,
      },
    };
  }

  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  let width = sourceWidth;
  let height = sourceHeight;
  let x = 0;
  let y = 0;
  if (sourceRatio > targetRatio) {
    width = sourceHeight * targetRatio;
    x = (sourceWidth - width) / 2;
  } else {
    height = sourceWidth / targetRatio;
    y = (sourceHeight - height) / 2;
  }
  return {
    source: { x, y, width, height },
    destination: { x: 0, y: 0, width: targetWidth, height: targetHeight },
  };
}

export function drawTextOverlay(
  context: CanvasRenderingContext2D,
  options: TextOverlayOptions,
): void {
  checkAbort(options.signal);
  if (!options.text) return;
  context.save();
  try {
    context.translate(options.x, options.y);
    context.rotate(options.rotation ?? 0);
    context.globalAlpha = opacity(options.opacity);
    context.font = `${options.fontWeight ?? 600} ${options.fontSize}px ${options.fontFamily ?? 'sans-serif'}`;
    context.textAlign = options.align ?? 'center';
    context.textBaseline = options.baseline ?? 'middle';
    context.lineJoin = 'round';
    if (options.strokeColor && (options.strokeWidth ?? 0) > 0) {
      context.strokeStyle = options.strokeColor;
      context.lineWidth = options.strokeWidth ?? 0;
      context.strokeText(options.text, 0, 0, options.maxWidth);
    }
    context.fillStyle = options.color ?? '#ffffff';
    context.fillText(options.text, 0, 0, options.maxWidth);
  } finally {
    context.restore();
  }
}

function drawRotatedImage(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
): void {
  context.save();
  try {
    context.translate(x + width / 2, y + height / 2);
    context.rotate(rotation);
    context.drawImage(image, -width / 2, -height / 2, width, height);
  } finally {
    context.restore();
  }
}

export function drawImageWatermark(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  options: ImageWatermarkOptions,
): void {
  checkAbort(options.signal);
  context.save();
  try {
    context.globalAlpha = opacity(options.opacity);
    const rotation = options.rotation ?? 0;
    if (!options.tiled) {
      const point = calculateWatermarkPosition(options);
      drawRotatedImage(
        context,
        image,
        point.x,
        point.y,
        options.watermarkWidth,
        options.watermarkHeight,
        rotation,
      );
      return;
    }

    const stepX = Math.max(1, options.watermarkWidth + (options.horizontalGap ?? 48));
    const stepY = Math.max(1, options.watermarkHeight + (options.verticalGap ?? 48));
    for (let y = -options.watermarkHeight; y < options.canvasHeight + stepY; y += stepY) {
      checkAbort(options.signal);
      for (let x = -options.watermarkWidth; x < options.canvasWidth + stepX; x += stepX) {
        drawRotatedImage(
          context,
          image,
          x,
          y,
          options.watermarkWidth,
          options.watermarkHeight,
          rotation,
        );
      }
    }
  } finally {
    context.restore();
  }
}

function clippedRegion(region: MosaicRegion, canvas: HTMLCanvasElement): DrawRect | null {
  const x = Math.max(0, Math.floor(region.x));
  const y = Math.max(0, Math.floor(region.y));
  const right = Math.min(canvas.width, Math.ceil(region.x + region.width));
  const bottom = Math.min(canvas.height, Math.ceil(region.y + region.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function drawMosaic(
  context: CanvasRenderingContext2D,
  regions: readonly MosaicRegion[],
  blockSize: number,
  signal?: AbortSignal,
): void {
  checkAbort(signal);
  assertCanvasDimensions(context.canvas.width, context.canvas.height);
  const size = Math.max(1, Math.floor(blockSize));
  for (const requested of regions) {
    checkAbort(signal);
    const region = clippedRegion(requested, context.canvas);
    if (!region) continue;
    const image = context.getImageData(region.x, region.y, region.width, region.height);
    for (let blockY = 0; blockY < region.height; blockY += size) {
      checkAbort(signal);
      for (let blockX = 0; blockX < region.width; blockX += size) {
        const endX = Math.min(region.width, blockX + size);
        const endY = Math.min(region.height, blockY + size);
        let red = 0; let green = 0; let blue = 0; let alpha = 0; let count = 0;
        for (let y = blockY; y < endY; y += 1) {
          for (let x = blockX; x < endX; x += 1) {
            const offset = (y * region.width + x) * 4;
            red += image.data[offset];
            green += image.data[offset + 1];
            blue += image.data[offset + 2];
            alpha += image.data[offset + 3];
            count += 1;
          }
        }
        for (let y = blockY; y < endY; y += 1) {
          for (let x = blockX; x < endX; x += 1) {
            const offset = (y * region.width + x) * 4;
            image.data[offset] = red / count;
            image.data[offset + 1] = green / count;
            image.data[offset + 2] = blue / count;
            image.data[offset + 3] = alpha / count;
          }
        }
      }
    }
    context.putImageData(image, region.x, region.y);
  }
}

export async function drawMosaicCooperatively(
  context: CanvasRenderingContext2D,
  regions: readonly MosaicRegion[],
  blockSize: number,
  signal?: AbortSignal,
): Promise<void> {
  checkAbort(signal);
  assertCanvasDimensions(context.canvas.width, context.canvas.height);
  const size = Math.max(1, Math.floor(blockSize));

  for (const requested of regions) {
    checkAbort(signal);
    const region = clippedRegion(requested, context.canvas);
    if (!region) continue;
    const image = context.getImageData(region.x, region.y, region.width, region.height);
    for (let blockY = 0; blockY < region.height; blockY += size) {
      await yieldToBrowser(signal);
      for (let blockX = 0; blockX < region.width; blockX += size) {
        const endX = Math.min(region.width, blockX + size);
        const endY = Math.min(region.height, blockY + size);
        let red = 0; let green = 0; let blue = 0; let alpha = 0; let count = 0;
        for (let y = blockY; y < endY; y += 1) {
          for (let x = blockX; x < endX; x += 1) {
            const offset = (y * region.width + x) * 4;
            red += image.data[offset];
            green += image.data[offset + 1];
            blue += image.data[offset + 2];
            alpha += image.data[offset + 3];
            count += 1;
          }
        }
        for (let y = blockY; y < endY; y += 1) {
          for (let x = blockX; x < endX; x += 1) {
            const offset = (y * region.width + x) * 4;
            image.data[offset] = red / count;
            image.data[offset + 1] = green / count;
            image.data[offset + 2] = blue / count;
            image.data[offset + 3] = alpha / count;
          }
        }
      }
    }
    context.putImageData(image, region.x, region.y);
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

export function drawScreenshotBeautification(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  options: ScreenshotBeautifyOptions,
): void {
  checkAbort(options.signal);
  const padding = Math.max(0, options.padding);
  const canvasWidth = Math.ceil(options.sourceWidth + padding * 2);
  const canvasHeight = Math.ceil(options.sourceHeight + padding * 2);
  assertCanvasDimensions(canvasWidth, canvasHeight);
  context.canvas.width = canvasWidth;
  context.canvas.height = canvasHeight;
  if (typeof options.background === 'string') {
    context.fillStyle = options.background;
  } else {
    const gradient = context.createLinearGradient(0, 0, context.canvas.width, context.canvas.height);
    gradient.addColorStop(0, options.background.from);
    gradient.addColorStop(1, options.background.to);
    context.fillStyle = gradient;
  }
  context.fillRect(0, 0, context.canvas.width, context.canvas.height);

  context.save();
  try {
    if (options.shadow) {
      context.shadowColor = 'rgba(15, 23, 42, 0.32)';
      context.shadowBlur = Math.max(12, padding / 2);
      context.shadowOffsetY = Math.max(4, padding / 8);
    }
    context.fillStyle = '#ffffff';
    roundedRect(context, padding, padding, options.sourceWidth, options.sourceHeight, options.borderRadius);
    context.fill();
  } finally {
    context.restore();
  }

  context.save();
  try {
    roundedRect(context, padding, padding, options.sourceWidth, options.sourceHeight, options.borderRadius);
    context.clip();
    context.drawImage(image, padding, padding, options.sourceWidth, options.sourceHeight);
  } finally {
    context.restore();
  }
}

export function drawMeme(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  options: MemeOptions,
): void {
  checkAbort(options.signal);
  assertCanvasDimensions(options.sourceWidth, options.sourceHeight);
  context.canvas.width = options.sourceWidth;
  context.canvas.height = options.sourceHeight;
  context.drawImage(image, 0, 0, options.sourceWidth, options.sourceHeight);
  const padding = options.sourceHeight * 0.05;
  if (options.topText) {
    drawTextOverlay(context, {
      text: options.topText.toUpperCase(), x: options.sourceWidth / 2,
      y: padding, fontSize: options.fontSize, baseline: 'top',
      fontFamily: 'Impact, Arial Black, sans-serif', fontWeight: 700,
      strokeColor: '#000000', strokeWidth: Math.max(3, options.fontSize / 8),
      maxWidth: options.sourceWidth * 0.92, signal: options.signal,
    });
  }
  if (options.bottomText) {
    drawTextOverlay(context, {
      text: options.bottomText.toUpperCase(), x: options.sourceWidth / 2,
      y: options.sourceHeight - padding, fontSize: options.fontSize, baseline: 'bottom',
      fontFamily: 'Impact, Arial Black, sans-serif', fontWeight: 700,
      strokeColor: '#000000', strokeWidth: Math.max(3, options.fontSize / 8),
      maxWidth: options.sourceWidth * 0.92, signal: options.signal,
    });
  }
}

export function drawSocialMediaCover(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  options: SocialMediaCoverOptions,
): SocialCoverLayout {
  checkAbort(options.signal);
  assertCanvasDimensions(options.targetWidth, options.targetHeight);
  const layout = calculateSocialCoverLayout(
    options.sourceWidth,
    options.sourceHeight,
    options.targetWidth,
    options.targetHeight,
    options.fit,
  );
  context.canvas.width = options.targetWidth;
  context.canvas.height = options.targetHeight;
  context.fillStyle = options.background ?? '#0f172a';
  context.fillRect(0, 0, options.targetWidth, options.targetHeight);
  const source = layout.source;
  const destination = layout.destination;
  context.drawImage(
    image,
    source.x, source.y, source.width, source.height,
    destination.x, destination.y, destination.width, destination.height,
  );
  checkAbort(options.signal);
  if ((options.overlayOpacity ?? 0) > 0) {
    context.fillStyle = `rgba(0, 0, 0, ${opacity(options.overlayOpacity)})`;
    context.fillRect(0, 0, options.targetWidth, options.targetHeight);
  }
  const titleSize = Math.max(24, Math.floor(options.targetWidth / 15));
  if (options.title) {
    drawTextOverlay(context, {
      text: options.title, x: options.targetWidth / 2,
      y: options.targetHeight / 2 - (options.subtitle ? titleSize * 0.35 : 0),
      fontSize: titleSize, color: '#ffffff', maxWidth: options.targetWidth * 0.9,
      signal: options.signal,
    });
  }
  if (options.subtitle) {
    drawTextOverlay(context, {
      text: options.subtitle, x: options.targetWidth / 2,
      y: options.targetHeight / 2 + (options.title ? titleSize * 0.65 : 0),
      fontSize: Math.max(14, Math.floor(titleSize * 0.5)),
      color: 'rgba(255,255,255,0.86)', maxWidth: options.targetWidth * 0.9,
      signal: options.signal,
    });
  }
  return layout;
}
