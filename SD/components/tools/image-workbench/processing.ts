import type { ImageMetadata, OutputAsset, ProcessedAsset } from './types';

type Worker<T, R> = (item: T, index: number) => Promise<R> | R;

function createAbortError(): DOMException {
  return new DOMException('操作已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function waitForWorker<R>(work: Promise<R>, signal?: AbortSignal): Promise<R> {
  if (!signal) return work;
  throwIfAborted(signal);

  return new Promise<R>((resolve, reject) => {
    let settled = false;

    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };
    const onAbort = () => finish(() => reject(createAbortError()));

    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: Worker<T, R>,
  signal?: AbortSignal,
): Promise<R[]> {
  throwIfAborted(signal);
  if (items.length === 0) return [];

  const requestedConcurrency = Number.isFinite(concurrency)
    ? Math.floor(concurrency)
    : 1;
  const workerCount = Math.max(1, Math.min(requestedConcurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let hasFailure = false;
  let firstFailure: unknown;
  let wakeForAbort: (() => void) | null = null;
  const running = new Set<Promise<void>>();
  const abortWakeup = signal
    ? new Promise<void>((resolve) => {
      wakeForAbort = resolve;
    })
    : null;

  const recordFailure = (error: unknown) => {
    if (hasFailure) return;
    hasFailure = true;
    firstFailure = error;
  };
  const onAbort = () => {
    recordFailure(createAbortError());
    wakeForAbort?.();
  };
  const startNext = () => {
    const index = nextIndex;
    nextIndex += 1;

    let work: Promise<R>;
    try {
      work = Promise.resolve(worker(items[index], index));
    } catch (error) {
      recordFailure(error);
      return;
    }

    let tracked: Promise<void>;
    tracked = work.then(
      (result) => {
        results[index] = result;
      },
      (error: unknown) => {
        recordFailure(error);
      },
    ).finally(() => {
      running.delete(tracked);
    });
    running.add(tracked);
  };

  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    while (nextIndex < items.length && running.size < workerCount && !hasFailure) {
      startNext();
    }

    while (running.size > 0) {
      const pending = Array.from(running);
      if (abortWakeup && !signal?.aborted) pending.push(abortWakeup);
      await Promise.race(pending);

      if (hasFailure) break;
      while (nextIndex < items.length && running.size < workerCount) {
        startNext();
        if (hasFailure) break;
      }
    }

    if (hasFailure) {
      await Promise.all(Array.from(running));
      throw firstFailure;
    }

    return results;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function decodeImage(
  file: File,
  signal?: AbortSignal,
): Promise<ImageBitmap | HTMLImageElement> {
  throwIfAborted(signal);

  if (typeof createImageBitmap === 'function') {
    let bitmapPromise: Promise<ImageBitmap> | null = null;
    try {
      bitmapPromise = Promise.resolve(createImageBitmap(file));
      const bitmap = await waitForWorker(bitmapPromise, signal);
      throwIfAborted(signal);
      return bitmap;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        if (bitmapPromise) {
          void bitmapPromise.then(
            (bitmap) => bitmap.close(),
            () => undefined,
          );
        }
        throw error;
      }
    }
  }

  throwIfAborted(signal);
  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = new Image();
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      let settled = false;

      const cleanup = () => {
        image.onload = null;
        image.onerror = null;
        signal?.removeEventListener('abort', onAbort);
      };
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };
      const onAbort = () => finish(() => {
        image.src = '';
        reject(createAbortError());
      });

      image.onload = () => finish(() => resolve(image));
      image.onerror = () => finish(() => reject(new Error('图片解码失败')));
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        image.src = sourceUrl;
      } catch (error) {
        finish(() => reject(error));
      }
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export async function readImageMetadata(
  file: File,
  signal?: AbortSignal,
): Promise<ImageMetadata> {
  const decoded = await decodeImage(file, signal);

  try {
    const naturalWidth = 'naturalWidth' in decoded ? decoded.naturalWidth : 0;
    const naturalHeight = 'naturalHeight' in decoded ? decoded.naturalHeight : 0;
    const width = naturalWidth || decoded.width;
    const height = naturalHeight || decoded.height;

    if (!width || !height) {
      throw new Error('图片解码失败');
    }

    return {
      width,
      height,
      mime: file.type || 'application/octet-stream',
      bytes: file.size,
    };
  } finally {
    if ('close' in decoded && typeof decoded.close === 'function') {
      decoded.close();
    }
  }
}

export function canvasToProcessedAsset(
  canvas: HTMLCanvasElement,
  name: string,
  mime: string,
  quality?: number,
): Promise<ProcessedAsset> {
  return new Promise<ProcessedAsset>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas 导出失败'));
        return;
      }

      resolve({
        name,
        blob,
        width: canvas.width,
        height: canvas.height,
      });
    }, mime, quality);
  });
}

export function revokeOutputAssets(outputs: readonly OutputAsset[]): void {
  for (const output of outputs) {
    URL.revokeObjectURL(output.url);
  }
}

export function formatProcessingError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '处理已取消，请重新开始。';
  }

  if (error instanceof Error) {
    if (error.message.includes('图片解码失败')) {
      return '图片解码失败，请确认文件格式受支持且文件未损坏。';
    }
    if (error.name === 'SecurityError' || error.message.toLowerCase().includes('canvas')) {
      return '图片导出失败，请确认图片来源允许处理，并尝试降低尺寸或更换输出格式。';
    }
    return `处理失败：${error.message}`;
  }

  return '处理失败，请重试或更换图片。';
}
