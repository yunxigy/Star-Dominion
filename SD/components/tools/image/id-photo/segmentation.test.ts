import { afterEach, describe, expect, it } from 'vitest';

import { resetPortraitSegmenter, segmentPortrait } from './segmentation';

interface FakeMask {
  width: number;
  height: number;
  getAsFloat32Array: () => Float32Array;
  close: () => void;
}

function makeResult(background = [0.9, 0.1], dimensions: readonly [number, number] = [2, 1]) {
  const closeCalls = [0, 0, 0, 0, 0, 0];
  const masks: FakeMask[] = closeCalls.map((_, index) => ({
    width: dimensions[0],
    height: dimensions[1],
    getAsFloat32Array: () => new Float32Array(index === 0 ? background : [0.02, 0.18]),
    close: () => { closeCalls[index] += 1; },
  }));
  return { result: { confidenceMasks: masks }, closeCalls, masks };
}

afterEach(async () => {
  await resetPortraitSegmenter();
});

describe('segmentPortrait', () => {
  it('copies the background mask and closes every MediaPipe mask', async () => {
    const { result, closeCalls } = makeResult();
    const snapshot = await segmentPortrait('image' as never, async () => ({
      segment: () => result,
    }));
    expect(snapshot).toEqual({
      width: 2,
      height: 1,
      backgroundConfidence: new Float32Array([0.9, 0.1]),
    });
    expect(closeCalls).toEqual([1, 1, 1, 1, 1, 1]);
  });

  it('reuses one initialization promise across calls', async () => {
    let initializations = 0;
    const factory = async () => {
      initializations += 1;
      return { segment: () => makeResult().result };
    };
    await Promise.all([
      segmentPortrait('first' as never, factory),
      segmentPortrait('second' as never, factory),
    ]);
    expect(initializations).toBe(1);
  });

  it('clears a failed initialization so the user can retry', async () => {
    let attempts = 0;
    const factory = async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('model unavailable');
      return { segment: () => makeResult().result };
    };
    await expect(segmentPortrait('image' as never, factory)).rejects.toThrow('model unavailable');
    await expect(segmentPortrait('image' as never, factory)).resolves.toMatchObject({ width: 2 });
    expect(attempts).toBe(2);
  });

  it('rejects invalid class counts and still closes returned masks', async () => {
    const { result, masks, closeCalls } = makeResult();
    result.confidenceMasks = masks.slice(0, 5);
    await expect(segmentPortrait('image' as never, async () => ({ segment: () => result })))
      .rejects.toThrow('six confidence masks');
    expect(closeCalls).toEqual([1, 1, 1, 1, 1, 0]);
  });

  it('rejects inconsistent dimensions and an image without a confident person', async () => {
    const inconsistent = makeResult();
    inconsistent.masks[1].width = 3;
    await expect(segmentPortrait('image' as never, async () => ({ segment: () => inconsistent.result })))
      .rejects.toThrow('dimensions');
    await resetPortraitSegmenter();

    const empty = makeResult([0.99, 0.98]);
    await expect(segmentPortrait('image' as never, async () => ({ segment: () => empty.result })))
      .rejects.toThrow('person');
    expect(empty.closeCalls).toEqual([1, 1, 1, 1, 1, 1]);
  });
});
