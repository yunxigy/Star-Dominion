import { describe, expect, it } from 'vitest';

import {
  applyOverrides,
  blurAlpha,
  buildPersonAlpha,
  paintOverride,
  pushMaskHistory,
  resampleAlpha,
  undoMaskHistory,
} from './mask';

describe('buildPersonAlpha', () => {
  it('derives foreground from model confidence, never from output color', () => {
    const alpha = buildPersonAlpha({
      backgroundConfidence: new Float32Array([0.95, 0.1]),
      width: 2,
      height: 1,
      threshold: 0.5,
      featherRadius: 0,
    });
    expect(Array.from(alpha)).toEqual([0, 1]);
  });

  it('changes soft edges when threshold and feather controls change', () => {
    const input = {
      backgroundConfidence: new Float32Array([0.9, 0.55, 0.2]),
      width: 3,
      height: 1,
    };
    const sharp = buildPersonAlpha({ ...input, threshold: 0.5, featherRadius: 0 });
    const soft = buildPersonAlpha({ ...input, threshold: 0.65, featherRadius: 1 });
    expect(Array.from(soft)).not.toEqual(Array.from(sharp));
    expect(soft[1]).toBeGreaterThan(0);
    expect(soft[1]).toBeLessThan(1);
  });

  it('clamps threshold and validates dimensions', () => {
    expect(Array.from(buildPersonAlpha({
      backgroundConfidence: new Float32Array([0, 1]),
      width: 2,
      height: 1,
      threshold: 5,
      featherRadius: 0,
    }))).toEqual([0, 0]);
    expect(() => buildPersonAlpha({
      backgroundConfidence: new Float32Array([0]),
      width: 2,
      height: 1,
      threshold: 0.5,
      featherRadius: 0,
    })).toThrow('dimensions');
  });
});

describe('blurAlpha', () => {
  it('returns an exact copy at radius zero', () => {
    const input = new Float32Array([0, 0.5, 1]);
    const output = blurAlpha(input, 3, 1, 0);
    expect(output).not.toBe(input);
    expect(Array.from(output)).toEqual([0, 0.5, 1]);
  });

  it('preserves a constant mask', () => {
    const output = blurAlpha(new Float32Array(9).fill(0.4), 3, 3, 2);
    output.forEach((value) => expect(value).toBeCloseTo(0.4));
  });
});

describe('resampleAlpha', () => {
  it('maps mask corners to full-resolution output without changing the source', () => {
    const input = new Float32Array([0, 1, 0.25, 0.75]);
    const output = resampleAlpha(input, 2, 2, 3, 3);
    expect(Array.from(input)).toEqual([0, 1, 0.25, 0.75]);
    expect(output[0]).toBe(0);
    expect(output[2]).toBe(1);
    expect(output[6]).toBe(0.25);
    expect(output[8]).toBe(0.75);
    expect(output[4]).toBeCloseTo(0.5);
  });
});

describe('manual mask overrides', () => {
  it('applies erase and restore strokes independently of automatic controls', () => {
    const empty = new Int8Array(25);
    const erased = paintOverride(empty, 5, 5, { x: 2, y: 2, radius: 1, mode: 'erase' });
    const restored = paintOverride(erased, 5, 5, { x: 4, y: 4, radius: 1, mode: 'restore' });
    const alpha = applyOverrides(new Float32Array(25).fill(0.5), restored);
    expect(alpha[12]).toBe(0);
    expect(alpha[24]).toBe(1);
  });

  it('clips strokes and leaves the input immutable', () => {
    const input = new Int8Array(4);
    const output = paintOverride(input, 2, 2, { x: -1, y: 0, radius: 1.5, mode: 'restore' });
    expect(Array.from(input)).toEqual([0, 0, 0, 0]);
    expect(Array.from(output)).toEqual([1, 0, 1, 0]);
  });

  it('caps history and undo returns the exact previous snapshot', () => {
    const first = new Int8Array([0, -1, 0]);
    let history = pushMaskHistory([], first, 2);
    history = pushMaskHistory(history, new Int8Array([1, 0, 0]), 2);
    history = pushMaskHistory(history, new Int8Array([0, 0, 1]), 2);
    expect(history).toHaveLength(2);
    expect(undoMaskHistory(history)).toEqual({
      mask: new Int8Array([0, 0, 1]),
      history: [new Int8Array([1, 0, 0])],
    });
  });
});
