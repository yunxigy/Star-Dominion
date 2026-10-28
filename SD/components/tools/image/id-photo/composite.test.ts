import { describe, expect, it } from 'vitest';

import { compositeRgba, estimateCornerBackground } from './composite';

describe('compositeRgba', () => {
  it('preserves blue clothing when model alpha marks it as foreground', () => {
    const result = compositeRgba({
      source: new Uint8ClampedArray([20, 80, 200, 255]),
      alpha: new Float32Array([1]),
      width: 1,
      height: 1,
      background: { kind: 'solid', color: [208, 48, 48] },
    });
    expect(Array.from(result)).toEqual([20, 80, 200, 255]);
  });

  it('uses one alpha blend for transparent and edge pixels', () => {
    const result = compositeRgba({
      source: new Uint8ClampedArray([0, 0, 0, 255, 100, 100, 100, 255]),
      alpha: new Float32Array([0, 0.5]),
      width: 2,
      height: 1,
      background: { kind: 'solid', color: [255, 255, 255] },
    });
    expect(Array.from(result.slice(0, 4))).toEqual([255, 255, 255, 255]);
    expect(Array.from(result.slice(4, 8))).toEqual([178, 178, 178, 255]);
  });

  it('renders a deterministic vertical gradient', () => {
    const result = compositeRgba({
      source: new Uint8ClampedArray(12),
      alpha: new Float32Array([0, 0, 0]),
      width: 1,
      height: 3,
      background: { kind: 'vertical-gradient', top: [0, 20, 40], bottom: [100, 120, 140] },
    });
    expect(Array.from(result)).toEqual([
      0, 20, 40, 255,
      50, 70, 90, 255,
      100, 120, 140, 255,
    ]);
  });

  it('reduces the estimated old background color only on partial edges', () => {
    const result = compositeRgba({
      source: new Uint8ClampedArray([228, 128, 128, 255, 20, 80, 200, 255]),
      alpha: new Float32Array([0.5, 1]),
      width: 2,
      height: 1,
      background: { kind: 'solid', color: [0, 0, 0] },
      estimatedOriginalBackground: [255, 255, 255],
    });
    expect(Array.from(result.slice(0, 4))).toEqual([101, 1, 1, 255]);
    expect(Array.from(result.slice(4, 8))).toEqual([20, 80, 200, 255]);
  });

  it('validates source and mask dimensions', () => {
    expect(() => compositeRgba({
      source: new Uint8ClampedArray(4),
      alpha: new Float32Array(2),
      width: 1,
      height: 1,
      background: { kind: 'solid', color: [255, 255, 255] },
    })).toThrow('dimensions');
  });
});

describe('estimateCornerBackground', () => {
  it('averages corner samples without being affected by the center portrait', () => {
    const pixels = new Uint8ClampedArray([
      100, 110, 120, 255, 0, 0, 0, 255, 110, 120, 130, 255,
      0, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255,
      120, 130, 140, 255, 0, 0, 0, 255, 130, 140, 150, 255,
    ]);
    expect(estimateCornerBackground(pixels, 3, 3, 1)).toEqual([115, 125, 135]);
  });
});
