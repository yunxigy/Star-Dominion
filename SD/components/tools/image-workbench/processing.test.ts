import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputAsset } from './types';
import {
  MAX_CANVAS_EDGE,
  assertCanvasDimensions,
  canvasToProcessedAsset,
  decodeImage,
  formatProcessingError,
  readImageMetadata,
  revokeOutputAssets,
  runWithConcurrency,
} from './processing';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFile(name = 'photo.png', type = 'image/png'): File {
  return Object.assign(new Blob(['pixels'], { type }), {
    name,
    lastModified: 0,
  }) as File;
}

describe('runWithConcurrency', () => {
  it('limits concurrent workers and preserves input order', async () => {
    let active = 0;
    let peak = 0;
    const releases = new Map<number, () => void>();

    const resultPromise = runWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.set(value, resolve));
      active -= 1;
      return value * 10;
    });

    await vi.waitFor(() => expect(releases.size).toBe(2));
    releases.get(2)?.();
    await vi.waitFor(() => expect(releases.has(3)).toBe(true));
    releases.get(1)?.();
    await vi.waitFor(() => expect(releases.has(4)).toBe(true));
    releases.get(4)?.();
    releases.get(3)?.();

    await expect(resultPromise).resolves.toEqual([10, 20, 30, 40]);
    expect(peak).toBe(2);
  });

  it('normalizes a non-positive concurrency to one worker', async () => {
    let active = 0;
    let peak = 0;

    const results = await runWithConcurrency([1, 2, 3], 0, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return value;
    });

    expect(results).toEqual([1, 2, 3]);
    expect(peak).toBe(1);
  });

  it('never creates more workers than there are items', async () => {
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = runWithConcurrency([1, 2], 99, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await gate;
      active -= 1;
      return value;
    });

    await vi.waitFor(() => expect(active).toBe(2));
    release();
    await expect(resultPromise).resolves.toEqual([1, 2]);
    expect(peak).toBe(2);
  });

  it('propagates the original worker error', async () => {
    const failure = new Error('processor exploded');

    await expect(
      runWithConcurrency([1], 2, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
  });

  it('waits for every started worker to settle before rejecting the first error', async () => {
    const failure = new Error('first worker failed');
    const started: number[] = [];
    let releaseSecond!: () => void;
    let secondSettled = false;
    let runSettled = false;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const resultPromise = runWithConcurrency([1, 2, 3], 2, async (value) => {
      started.push(value);
      if (value === 1) throw failure;
      await secondGate;
      secondSettled = true;
      return value;
    });
    const observedResult = resultPromise.then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ).finally(() => {
      runSettled = true;
    });

    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeActiveWorker = runSettled;
    releaseSecond();

    const observed = await observedResult;
    expect(settledBeforeActiveWorker).toBe(false);
    expect(secondSettled).toBe(true);
    expect(observed.error).toBe(failure);
    expect(started).toEqual([1, 2]);
  });

  it('does not start work when the signal is already aborted', async () => {
    const controller = new AbortController();
    const worker = vi.fn(async (value: number) => value);
    controller.abort();

    await expect(
      runWithConcurrency([1, 2], 2, worker, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(worker).not.toHaveBeenCalled();
  });

  it('does not start another item after the signal aborts', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const resultPromise = runWithConcurrency([1, 2, 3], 1, async (value) => {
      started.push(value);
      await gate;
      return value;
    }, controller.signal);

    await vi.waitFor(() => expect(started).toEqual([1]));
    controller.abort();
    release();

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([1]);
  });

  it('waits for workers already running at cancellation before rejecting', async () => {
    const controller = new AbortController();
    const started: number[] = [];
    const settled: number[] = [];
    let releaseWorkers!: () => void;
    let runSettled = false;
    const workerGate = new Promise<void>((resolve) => {
      releaseWorkers = resolve;
    });

    const resultPromise = runWithConcurrency([1, 2, 3], 2, async (value) => {
      started.push(value);
      await workerGate;
      settled.push(value);
      return value;
    }, controller.signal);
    const observedResult = resultPromise.then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    ).finally(() => {
      runSettled = true;
    });

    await vi.waitFor(() => expect(started).toEqual([1, 2]));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const settledBeforeActiveWorkers = runSettled;
    releaseWorkers();

    const observed = await observedResult;
    expect(settledBeforeActiveWorkers).toBe(false);
    expect(settled.sort()).toEqual([1, 2]);
    expect(observed.error).toMatchObject({ name: 'AbortError' });
    expect(started).toEqual([1, 2]);
  });
});

describe('image decoding and output lifecycle', () => {
  it('rejects invalid and unsafe canvas dimensions before allocating output', () => {
    expect(() => assertCanvasDimensions(0, 10)).toThrow('Canvas 尺寸必须是正整数');
    expect(() => assertCanvasDimensions(Number.NaN, 10)).toThrow('Canvas 尺寸必须是正整数');
    expect(() => assertCanvasDimensions(MAX_CANVAS_EDGE + 1, 1)).toThrow('图片尺寸过大');
  });

  it('prefers createImageBitmap when the browser supports it', async () => {
    const bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
    const createImageBitmap = vi.fn(async () => bitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('Image', class {
      constructor() {
        throw new Error('Image fallback should not be used');
      }
    });

    const result = await decodeImage(makeFile(), new AbortController().signal);

    expect(result).toBe(bitmap);
    expect(createImageBitmap).toHaveBeenCalledOnce();
  });

  it('closes a bitmap that finishes decoding after cancellation', async () => {
    const controller = new AbortController();
    const close = vi.fn();
    const bitmap = { width: 640, height: 480, close } as unknown as ImageBitmap;
    let resolveBitmap!: (value: ImageBitmap) => void;
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise<ImageBitmap>((resolve) => {
      resolveBitmap = resolve;
    })));

    const resultPromise = decodeImage(makeFile(), controller.signal);
    controller.abort();

    await expect(resultPromise).rejects.toMatchObject({ name: 'AbortError' });
    resolveBitmap(bitmap);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
  });

  it('falls back to Image and always revokes its temporary object URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:temporary-image');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    class SuccessfulImage {
      naturalWidth = 320;
      naturalHeight = 180;
      onload: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    vi.stubGlobal('Image', SuccessfulImage);

    const result = await decodeImage(makeFile(), new AbortController().signal);

    expect(result).toBeInstanceOf(SuccessfulImage);
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:temporary-image');
  });

  it('revokes the fallback object URL when image decoding fails', async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('createImageBitmap', undefined);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:broken-image'),
      revokeObjectURL,
    });

    class BrokenImage {
      onload: (() => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      set src(_value: string) {
        queueMicrotask(() => this.onerror?.({} as Event));
      }
    }
    vi.stubGlobal('Image', BrokenImage);

    await expect(
      decodeImage(makeFile('broken.png'), new AbortController().signal),
    ).rejects.toThrow('图片解码失败');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:broken-image');
  });

  it('reads file metadata and closes a temporary bitmap', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 1280,
      height: 720,
      close,
    })));

    const file = makeFile('cover.webp', 'image/webp');
    const metadata = await readImageMetadata(file, new AbortController().signal);

    expect(metadata).toEqual({
      width: 1280,
      height: 720,
      mime: 'image/webp',
      bytes: file.size,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it('exports a canvas as a processed asset', async () => {
    const blob = new Blob(['result'], { type: 'image/webp' });
    const toBlob = vi.fn((callback: BlobCallback, mime?: string, quality?: number) => {
      expect(mime).toBe('image/webp');
      expect(quality).toBe(0.8);
      callback(blob);
    });
    const canvas = { width: 400, height: 300, toBlob } as unknown as HTMLCanvasElement;

    await expect(
      canvasToProcessedAsset(canvas, 'result.webp', 'image/webp', 0.8),
    ).resolves.toEqual({
      name: 'result.webp',
      blob,
      width: 400,
      height: 300,
    });
  });

  it('aligns the output extension with the MIME actually returned by the browser', async () => {
    const fallbackBlob = new Blob(['fallback'], { type: 'image/png' });
    const canvas = {
      width: 10,
      height: 10,
      toBlob: (callback: BlobCallback) => callback(fallbackBlob),
    } as unknown as HTMLCanvasElement;

    await expect(
      canvasToProcessedAsset(canvas, 'requested.webp', 'image/webp'),
    ).resolves.toMatchObject({ name: 'requested.png', blob: fallbackBlob });
  });

  it('rejects when a canvas cannot produce a blob', async () => {
    const canvas = {
      width: 1,
      height: 1,
      toBlob: (callback: BlobCallback) => callback(null),
    } as unknown as HTMLCanvasElement;

    await expect(
      canvasToProcessedAsset(canvas, 'result.png', 'image/png'),
    ).rejects.toThrow('Canvas 导出失败');
  });

  it('formats a synchronous canvas security failure as an actionable export error', async () => {
    const securityError = new DOMException('The canvas is tainted', 'SecurityError');
    const canvas = {
      width: 1,
      height: 1,
      toBlob: () => {
        throw securityError;
      },
    } as unknown as HTMLCanvasElement;

    const error = await canvasToProcessedAsset(canvas, 'result.png', 'image/png')
      .then(() => null, (caught: unknown) => caught);

    expect(error).toBe(securityError);
    expect(formatProcessingError(error))
      .toBe('图片导出失败，请确认图片来源允许处理，并尝试降低尺寸或更换输出格式。');
  });

  it('revokes every output object URL', () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { revokeObjectURL });
    const outputs: OutputAsset[] = [
      { id: '1', name: 'a.png', blob: new Blob(), url: 'blob:a' },
      { id: '2', name: 'b.png', blob: new Blob(), url: 'blob:b' },
    ];

    revokeOutputAssets(outputs);

    expect(revokeObjectURL.mock.calls).toEqual([['blob:a'], ['blob:b']]);
  });
});

describe('formatProcessingError', () => {
  it('maps cancellation, decoding, canvas and unknown failures to actionable text', () => {
    expect(formatProcessingError(new DOMException('stopped', 'AbortError')))
      .toBe('处理已取消，请重新开始。');
    expect(formatProcessingError(new Error('图片解码失败')))
      .toBe('图片解码失败，请确认文件格式受支持且文件未损坏。');
    expect(formatProcessingError(new Error('Canvas 导出失败')))
      .toBe('图片导出失败，请确认图片来源允许处理，并尝试降低尺寸或更换输出格式。');
    expect(formatProcessingError(new Error('Canvas context lost')))
      .toBe('图片导出失败，请确认图片来源允许处理，并尝试降低尺寸或更换输出格式。');
    expect(formatProcessingError(new Error('worker unavailable')))
      .toBe('处理失败：worker unavailable');
    expect(formatProcessingError('unknown'))
      .toBe('处理失败，请重试或更换图片。');
  });
});
