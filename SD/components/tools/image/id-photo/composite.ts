import type { PhotoBackground, RgbColor } from './types';

interface CompositeInput {
  source: Uint8ClampedArray;
  alpha: Float32Array;
  width: number;
  height: number;
  background: PhotoBackground;
  estimatedOriginalBackground?: RgbColor;
}

const clampByte = (value: number) => Math.min(255, Math.max(0, value));
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function backgroundAt(background: PhotoBackground, y: number, height: number): RgbColor {
  if (background.kind === 'solid') return background.color;
  const amount = height <= 1 ? 0 : y / (height - 1);
  return background.top.map((value, channel) =>
    value + (background.bottom[channel] - value) * amount,
  ) as unknown as RgbColor;
}

function foregroundChannel(
  source: number,
  alpha: number,
  oldBackground: number | undefined,
): number {
  if (oldBackground === undefined || alpha <= 0 || alpha >= 1) return source;
  return clampByte((source - (1 - alpha) * oldBackground) / alpha);
}

export function compositeRgba({
  source,
  alpha,
  width,
  height,
  background,
  estimatedOriginalBackground,
}: CompositeInput): Uint8ClampedArray {
  const pixelCount = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0
    || source.length !== pixelCount * 4 || alpha.length !== pixelCount) {
    throw new Error('Image dimensions do not match source and mask buffers');
  }

  const output = new Uint8ClampedArray(source.length);
  for (let index = 0; index < pixelCount; index += 1) {
    const sourceOffset = index * 4;
    const row = Math.floor(index / width);
    const target = backgroundAt(background, row, height);
    const maskAlpha = clamp01(alpha[index]);
    const effectiveAlpha = maskAlpha * (source[sourceOffset + 3] / 255);

    for (let channel = 0; channel < 3; channel += 1) {
      const foreground = foregroundChannel(
        source[sourceOffset + channel],
        maskAlpha,
        estimatedOriginalBackground?.[channel],
      );
      output[sourceOffset + channel] = Math.round(
        foreground * effectiveAlpha + target[channel] * (1 - effectiveAlpha),
      );
    }
    output[sourceOffset + 3] = 255;
  }
  return output;
}
