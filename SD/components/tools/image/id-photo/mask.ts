import type { MaskStroke, SegmentationSnapshot } from './types';

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function assertDimensions(length: number, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || length !== width * height) {
    throw new Error('Mask dimensions do not match the supplied buffer');
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value > edge0 ? 1 : 0;
  const amount = clamp01((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

export function blurAlpha(
  input: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  assertDimensions(input.length, width, height);
  const safeRadius = Math.min(32, Math.max(0, Math.round(radius)));
  if (safeRadius === 0) return input.slice();

  const horizontal = new Float32Array(input.length);
  const output = new Float32Array(input.length);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let sampleX = Math.max(0, x - safeRadius); sampleX <= Math.min(width - 1, x + safeRadius); sampleX += 1) {
        total += input[y * width + sampleX];
        count += 1;
      }
      horizontal[y * width + x] = total / count;
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let total = 0;
      let count = 0;
      for (let sampleY = Math.max(0, y - safeRadius); sampleY <= Math.min(height - 1, y + safeRadius); sampleY += 1) {
        total += horizontal[sampleY * width + x];
        count += 1;
      }
      output[y * width + x] = clamp01(total / count);
    }
  }

  return output;
}

export function buildPersonAlpha({
  backgroundConfidence,
  width,
  height,
  threshold,
  featherRadius,
}: SegmentationSnapshot & { threshold: number; featherRadius: number }): Float32Array {
  assertDimensions(backgroundConfidence.length, width, height);
  const safeThreshold = clamp01(Number.isFinite(threshold) ? threshold : 0.5);
  const upperEdge = Math.min(1, safeThreshold + 0.1);
  const alpha = new Float32Array(backgroundConfidence.length);

  for (let index = 0; index < alpha.length; index += 1) {
    const foregroundConfidence = 1 - clamp01(backgroundConfidence[index]);
    alpha[index] = smoothstep(safeThreshold, upperEdge, foregroundConfidence);
  }

  return blurAlpha(alpha, width, height, featherRadius);
}

export function resampleAlpha(
  input: Float32Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Float32Array {
  assertDimensions(input.length, sourceWidth, sourceHeight);
  if (!Number.isInteger(targetWidth) || !Number.isInteger(targetHeight) || targetWidth <= 0 || targetHeight <= 0) {
    throw new Error('Target mask dimensions must be positive integers');
  }
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return input.slice();

  const output = new Float32Array(targetWidth * targetHeight);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = targetHeight === 1 ? 0 : (y / (targetHeight - 1)) * (sourceHeight - 1);
    const top = Math.floor(sourceY);
    const bottom = Math.min(sourceHeight - 1, top + 1);
    const vertical = sourceY - top;
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = targetWidth === 1 ? 0 : (x / (targetWidth - 1)) * (sourceWidth - 1);
      const left = Math.floor(sourceX);
      const right = Math.min(sourceWidth - 1, left + 1);
      const horizontal = sourceX - left;
      const topValue = input[top * sourceWidth + left] * (1 - horizontal)
        + input[top * sourceWidth + right] * horizontal;
      const bottomValue = input[bottom * sourceWidth + left] * (1 - horizontal)
        + input[bottom * sourceWidth + right] * horizontal;
      output[y * targetWidth + x] = clamp01(topValue * (1 - vertical) + bottomValue * vertical);
    }
  }
  return output;
}

export function paintOverride(
  input: Int8Array,
  width: number,
  height: number,
  stroke: MaskStroke,
): Int8Array {
  assertDimensions(input.length, width, height);
  const output = input.slice();
  const radius = Math.max(0, stroke.radius);
  const radiusSquared = radius * radius;
  const value = stroke.mode === 'erase' ? -1 : 1;
  const minX = Math.max(0, Math.floor(stroke.x - radius));
  const maxX = Math.min(width - 1, Math.ceil(stroke.x + radius));
  const minY = Math.max(0, Math.floor(stroke.y - radius));
  const maxY = Math.min(height - 1, Math.ceil(stroke.y + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const deltaX = x - stroke.x;
      const deltaY = y - stroke.y;
      if (deltaX * deltaX + deltaY * deltaY <= radiusSquared) output[y * width + x] = value;
    }
  }
  return output;
}

export function applyOverrides(alpha: Float32Array, overrides: Int8Array): Float32Array {
  if (alpha.length !== overrides.length) throw new Error('Mask dimensions do not match override dimensions');
  const output = alpha.slice();
  for (let index = 0; index < output.length; index += 1) {
    if (overrides[index] < 0) output[index] = 0;
    if (overrides[index] > 0) output[index] = 1;
  }
  return output;
}

export function pushMaskHistory(
  history: readonly Int8Array[],
  previous: Int8Array,
  limit: number,
): Int8Array[] {
  const safeLimit = Math.max(1, Math.floor(limit));
  return [...history, previous.slice()].slice(-safeLimit);
}

export function undoMaskHistory(
  history: readonly Int8Array[],
): { mask: Int8Array; history: Int8Array[] } | null {
  if (history.length === 0) return null;
  return {
    mask: history[history.length - 1].slice(),
    history: history.slice(0, -1).map((snapshot) => snapshot.slice()),
  };
}
