import { createElement } from 'react';
import {
  act,
  create,
  type ReactTestRenderer,
} from 'react-test-renderer';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type {
  BatchItem,
  ImageMetadata,
  ImageProcessor,
  ProcessedAsset,
  ProcessorContext,
} from './types';
import {
  canCommitImageBatchJob,
  collectBatchObjectUrls,
  flattenBatchOutputs,
  planImageBatchJobs,
  readBatchMetadata,
  resolveBatchConcurrency,
  useImageBatch,
  type UseImageBatchResult,
} from './useImageBatch';

interface Params {
  quality: number;
}

const makeItem = (id: string, quality: number): BatchItem<Params> => ({
  id,
  file: new File([id], `${id}.png`, { type: 'image/png' }),
  sourceUrl: `blob:source-${id}`,
  metadata: null,
  params: { quality },
  status: 'queued',
  progress: 0,
  outputs: [],
  error: null,
  stale: false,
});

const renderers: ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installImageGlobals() {
  let nextUrl = 0;
  const createObjectURL = vi.fn((_value: Blob) => {
    nextUrl += 1;
    return `blob:test-${nextUrl}`;
  });
  const revokeObjectURL = vi.fn();
  const close = vi.fn();
  const createImageBitmap = vi.fn(async () => ({
    width: 320,
    height: 180,
    close,
  }));

  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  return { createObjectURL, revokeObjectURL, createImageBitmap, close };
}

function processed(name: string, contents = name): ProcessedAsset[] {
  return [{
    name,
    blob: new Blob([contents], { type: 'image/png' }),
    width: 320,
    height: 180,
  }];
}

function makeProcessor(
  process: ImageProcessor<Params>['process'],
  mode: ImageProcessor<Params>['mode'] = 'per-file',
): ImageProcessor<Params> {
  return {
    accept: 'image/*',
    mode,
    defaultParams: { quality: 80 },
    process,
  };
}

function mountBatch(processor: ImageProcessor<Params>) {
  let current: UseImageBatchResult<Params> | null = null;

  function Harness() {
    current = useImageBatch(processor);
    return null;
  }

  let renderer: ReactTestRenderer | null = null;
  act(() => {
    renderer = create(createElement(Harness));
  });
  renderers.push(renderer as unknown as ReactTestRenderer);

  return {
    get current(): UseImageBatchResult<Params> {
      if (!current) throw new Error('Hook was not mounted');
      return current;
    },
    unmount(): void {
      act(() => renderer?.unmount());
    },
  };
}

async function addFiles(
  mounted: ReturnType<typeof mountBatch>,
  names: readonly string[],
): Promise<void> {
  await act(async () => {
    await mounted.current.addFiles(
      names.map((name) => new File([name], name, { type: 'image/png' })),
    );
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('planImageBatchJobs', () => {
  it('plans independent per-file jobs for all items', () => {
    const items = [makeItem('first', 60), makeItem('second', 80)];

    const jobs = planImageBatchJobs(items, 'second', 'per-file', 'all');

    expect(jobs.map((job) => ({
      key: job.key,
      ownerId: job.ownerId,
      itemIds: job.itemIds,
      files: job.files.map((file) => file.name),
      params: job.params,
    }))).toEqual([
      {
        key: 'item:first',
        ownerId: 'first',
        itemIds: ['first'],
        files: ['first.png'],
        params: { quality: 60 },
      },
      {
        key: 'item:second',
        ownerId: 'second',
        itemIds: ['second'],
        files: ['second.png'],
        params: { quality: 80 },
      },
    ]);
  });

  it('limits a selected per-file plan to the selected item', () => {
    const items = [makeItem('first', 60), makeItem('second', 80)];

    const jobs = planImageBatchJobs(items, 'second', 'per-file', 'selected');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      key: 'item:second',
      ownerId: 'second',
      itemIds: ['second'],
      params: { quality: 80 },
    });
  });

  it('plans group mode as one job containing every input', () => {
    const items = [makeItem('first', 60), makeItem('second', 80)];

    const jobs = planImageBatchJobs(items, 'second', 'group', 'selected');

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      key: 'group',
      ownerId: 'second',
      itemIds: ['first', 'second'],
      params: { quality: 80 },
    });
    expect(jobs[0].files.map((file) => file.name)).toEqual([
      'first.png',
      'second.png',
    ]);
  });
});

describe('batch orchestration decisions', () => {
  it('uses two workers by default and preserves an explicit concurrency', () => {
    expect(resolveBatchConcurrency(undefined)).toBe(2);
    expect(resolveBatchConcurrency(4)).toBe(4);
  });

  it('commits only the current non-aborted job while mounted', () => {
    expect(canCommitImageBatchJob(3, 3, false, true)).toBe(true);
    expect(canCommitImageBatchJob(2, 3, false, true)).toBe(false);
    expect(canCommitImageBatchJob(3, 3, true, true)).toBe(false);
    expect(canCommitImageBatchJob(3, 3, false, false)).toBe(false);
  });

  it('isolates a metadata failure from successful files', async () => {
    const items = [makeItem('good', 60), makeItem('bad', 80)];
    const metadata: ImageMetadata = {
      width: 320,
      height: 180,
      mime: 'image/png',
      bytes: items[0].file.size,
    };

    const results = await readBatchMetadata(
      items,
      async (file) => {
        if (file.name === 'bad.png') throw new Error('图片解码失败');
        return metadata;
      },
      new AbortController().signal,
    );

    expect(results).toEqual([
      { id: 'good', metadata, error: null },
      {
        id: 'bad',
        metadata: null,
        error: '图片解码失败，请确认文件格式受支持且文件未损坏。',
      },
    ]);
  });

  it('flattens outputs and lists every owned object URL for cleanup', () => {
    const first = makeItem('first', 60);
    const second = makeItem('second', 80);
    first.outputs = [{
      id: 'output-1',
      name: 'result.png',
      blob: new Blob(['result']),
      url: 'blob:output-1',
    }];

    expect(flattenBatchOutputs([first, second])).toEqual(first.outputs);
    expect(collectBatchObjectUrls([first, second])).toEqual([
      'blob:source-first',
      'blob:output-1',
      'blob:source-second',
    ]);
  });
});

describe('useImageBatch mounted orchestration', () => {
  it('exposes the planned Task 3 hook contract', () => {
    installImageGlobals();
    const mounted = mountBatch(makeProcessor(async () => []));

    expect(Object.keys(mounted.current).sort()).toEqual([
      'addFiles',
      'allOutputs',
      'applyParamsToAll',
      'isProcessing',
      'items',
      'processAll',
      'processSelected',
      'removeItem',
      'reset',
      'retryItem',
      'selectItem',
      'selected',
      'setSelectedParams',
    ]);
  });

  it('cancels a pending auto-preview when formal processing starts', async () => {
    vi.useFakeTimers();
    installImageGlobals();
    const process = vi.fn(async (
      _files: readonly File[],
      _params: Params,
      context: ProcessorContext,
    ) => processed(context.preview ? 'preview.png' : 'final.png'));
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);

    act(() => mounted.current.setSelectedParams({ quality: 70 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await act(async () => mounted.current.processSelected());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(process).toHaveBeenCalledTimes(1);
    expect(process.mock.calls.map(([, , context]) => context.preview))
      .toEqual([false]);
    expect(mounted.current.allOutputs[0].name).toBe('final.png');
  });

  it('stops auto-preview retries after rejection until params change again', async () => {
    vi.useFakeTimers();
    installImageGlobals();
    const process = vi.fn().mockRejectedValue(new Error('preview failure'));
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);

    act(() => mounted.current.setSelectedParams({ quality: 70 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    expect(process).toHaveBeenCalledTimes(1);
    expect(mounted.current.selected).toMatchObject({
      status: 'error',
      error: '处理失败：preview failure',
      stale: false,
    });

    act(() => mounted.current.setSelectedParams({ quality: 60 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    for (let cycle = 0; cycle < 3; cycle += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
    }

    expect(process).toHaveBeenCalledTimes(2);
    expect(mounted.current.selected).toMatchObject({
      status: 'error',
      error: '处理失败：preview failure',
      stale: false,
    });
  });

  it.each([
    'processAll',
    'retryItem',
    'reset',
    'removeItem',
  ] as const)('clears the preview timer before %s', async (operation) => {
    vi.useFakeTimers();
    installImageGlobals();
    const process = vi.fn(async () => processed('result.png'));
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);
    act(() => mounted.current.setSelectedParams({ quality: 70 }));
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      const id = mounted.current.items[0].id;
      if (operation === 'processAll') await mounted.current.processAll();
      if (operation === 'retryItem') await mounted.current.retryItem(id);
      if (operation === 'reset') mounted.current.reset();
      if (operation === 'removeItem') mounted.current.removeItem(id);
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('rechecks processing state before a queued preview callback runs', async () => {
    vi.useFakeTimers();
    installImageGlobals();
    const first = deferred<ProcessedAsset[]>();
    const process = vi.fn((
      _files: readonly File[],
      _params: Params,
      _context: ProcessorContext,
    ) => first.promise);
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);
    act(() => mounted.current.setSelectedParams({ quality: 70 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
      .mockImplementation(() => undefined);
    let formalRun!: Promise<void>;
    act(() => {
      formalRun = mounted.current.processSelected();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(
      expect.any(Array),
      { quality: 70 },
      expect.objectContaining({ preview: false }),
    );
    first.resolve(processed('preview.png'));
    await act(async () => formalRun);
    clearTimeoutSpy.mockRestore();
  });

  it('prevents an older aborted task from replacing a newer result', async () => {
    const urls = installImageGlobals();
    const oldTask = deferred<ProcessedAsset[]>();
    const newTask = deferred<ProcessedAsset[]>();
    let oldSignal: AbortSignal | undefined;
    const process = vi.fn<
      [readonly File[], Params, ProcessorContext],
      Promise<ProcessedAsset[]>
    >()
      .mockImplementationOnce((_files, _params, context) => {
        oldSignal = context.signal;
        return oldTask.promise;
      })
      .mockImplementationOnce(() => newTask.promise);
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);

    let oldRun!: Promise<void>;
    let newRun!: Promise<void>;
    act(() => {
      oldRun = mounted.current.processSelected();
    });
    act(() => {
      newRun = mounted.current.processSelected();
    });
    expect(oldSignal?.aborted).toBe(true);

    newTask.resolve(processed('new.png'));
    await act(async () => newRun);
    oldTask.resolve(processed('old.png'));
    await act(async () => oldRun);

    expect(mounted.current.allOutputs.map((output) => output.name)).toEqual(['new.png']);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it('prevents queued jobs from an older processAll run replacing newer results', async () => {
    installImageGlobals();
    const oldFirst = deferred<ProcessedAsset[]>();
    const process = vi.fn()
      .mockImplementationOnce(() => oldFirst.promise)
      .mockResolvedValueOnce(processed('new-first.png'))
      .mockResolvedValueOnce(processed('new-second.png'))
      .mockResolvedValueOnce(processed('stale-second.png'));
    const processor = makeProcessor(process);
    processor.concurrency = 1;
    const mounted = mountBatch(processor);
    await addFiles(mounted, ['first.png', 'second.png']);

    let oldRun!: Promise<void>;
    act(() => {
      oldRun = mounted.current.processAll();
    });
    await act(async () => mounted.current.processAll());
    expect(mounted.current.allOutputs.map((output) => output.name)).toEqual([
      'new-first.png',
      'new-second.png',
    ]);

    oldFirst.resolve(processed('stale-first.png'));
    await act(async () => oldRun);

    expect(process).toHaveBeenCalledTimes(3);
    expect(mounted.current.allOutputs.map((output) => output.name)).toEqual([
      'new-first.png',
      'new-second.png',
    ]);
  });

  it('keeps a per-file processAll snapshot running when files are added', async () => {
    installImageGlobals();
    const firstTask = deferred<ProcessedAsset[]>();
    let secondRuns = 0;
    const process = vi.fn((files: readonly File[]) => {
      const name = files[0].name;
      if (name === 'first.png') return firstTask.promise;
      if (name === 'second.png') {
        secondRuns += 1;
        return Promise.resolve(processed(
          secondRuns === 1 ? 'existing-second.png' : 'final-second.png',
        ));
      }
      return Promise.resolve(processed(`unexpected-${name}`));
    });
    const processor = makeProcessor(process);
    processor.concurrency = 1;
    const mounted = mountBatch(processor);
    await addFiles(mounted, ['first.png', 'second.png']);
    act(() => mounted.current.selectItem(mounted.current.items[1].id));
    await act(async () => mounted.current.processSelected());
    const existingSecondOutput = mounted.current.allOutputs[0];

    let run!: Promise<void>;
    act(() => {
      run = mounted.current.processAll();
    });
    await addFiles(mounted, ['third.png']);

    expect(mounted.current.allOutputs).toContain(existingSecondOutput);
    expect(process.mock.calls.map(([files]) => files[0].name)).toEqual([
      'second.png',
      'first.png',
    ]);

    firstTask.resolve(processed('final-first.png'));
    await act(async () => run);

    expect(process.mock.calls.map(([files]) => files[0].name)).toEqual([
      'second.png',
      'first.png',
      'second.png',
    ]);
    expect(mounted.current.allOutputs.map((output) => output.name)).toEqual([
      'final-first.png',
      'final-second.png',
    ]);
    expect(mounted.current.items[2]).toMatchObject({
      file: expect.objectContaining({ name: 'third.png' }),
      status: 'queued',
      outputs: [],
    });
  });

  it('releases old output URLs on reprocess and source/output URLs on remove', async () => {
    const urls = installImageGlobals();
    const process = vi.fn()
      .mockResolvedValueOnce(processed('first.png'))
      .mockResolvedValueOnce(processed('second.png'));
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);
    await act(async () => mounted.current.processSelected());
    const firstOutputUrl = mounted.current.allOutputs[0].url;

    await act(async () => mounted.current.processSelected());
    const sourceUrl = mounted.current.items[0].sourceUrl;
    const secondOutputUrl = mounted.current.allOutputs[0].url;
    expect(urls.revokeObjectURL).toHaveBeenCalledWith(firstOutputUrl);

    act(() => mounted.current.removeItem(mounted.current.items[0].id));
    expect(urls.revokeObjectURL).toHaveBeenCalledWith(sourceUrl);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith(secondOutputUrl);
    expect(mounted.current.items).toEqual([]);
  });

  it('releases source and output URLs on reset and unmount', async () => {
    const urls = installImageGlobals();
    const process = vi.fn(async () => processed('result.png'));
    const resetMounted = mountBatch(makeProcessor(process));
    await addFiles(resetMounted, ['reset.png']);
    await act(async () => resetMounted.current.processSelected());
    const resetUrls = [
      resetMounted.current.items[0].sourceUrl,
      resetMounted.current.allOutputs[0].url,
    ];
    act(() => resetMounted.current.reset());
    expect(urls.revokeObjectURL.mock.calls.map((call) => call[0]))
      .toEqual(expect.arrayContaining(resetUrls));

    const unmountMounted = mountBatch(makeProcessor(process));
    await addFiles(unmountMounted, ['unmount.png']);
    await act(async () => unmountMounted.current.processSelected());
    const unmountUrls = [
      unmountMounted.current.items[0].sourceUrl,
      unmountMounted.current.allOutputs[0].url,
    ];
    unmountMounted.unmount();
    expect(urls.revokeObjectURL.mock.calls.map((call) => call[0]))
      .toEqual(expect.arrayContaining(unmountUrls));
  });

  it('does not dispatch or create an output URL after unmount', async () => {
    const urls = installImageGlobals();
    const task = deferred<ProcessedAsset[]>();
    let activeSignal: AbortSignal | undefined;
    const process = vi.fn((_files, _params, context: ProcessorContext) => {
      activeSignal = context.signal;
      expect(context.signal.aborted).toBe(false);
      return task.promise;
    });
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);
    const sourceUrl = mounted.current.items[0].sourceUrl;

    let run!: Promise<void>;
    act(() => {
      run = mounted.current.processSelected();
    });
    const signal = activeSignal;
    if (!signal) throw new Error('Processor was not called');
    mounted.unmount();
    expect(signal.aborted).toBe(true);
    expect(urls.revokeObjectURL).toHaveBeenCalledWith(sourceUrl);

    task.resolve(processed('late.png'));
    await act(async () => run);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('stores group outputs only on the owner and exposes them through allOutputs', async () => {
    installImageGlobals();
    let processedNames: string[] = [];
    const process = vi.fn(async (
      files: readonly File[],
      _params: Params,
      _context: ProcessorContext,
    ) => {
      processedNames = files.map((file) => file.name);
      return processed('group.png');
    });
    const mounted = mountBatch(makeProcessor(process, 'group'));
    await addFiles(mounted, ['first.png', 'second.png']);
    act(() => mounted.current.selectItem(mounted.current.items[1].id));

    await act(async () => mounted.current.processAll());

    expect(processedNames).toEqual(['first.png', 'second.png']);
    expect(mounted.current.items[0].outputs).toEqual([]);
    expect(mounted.current.items[1].outputs).toHaveLength(1);
    expect(mounted.current.allOutputs).toEqual(mounted.current.items[1].outputs);
  });

  it('revokes completed group outputs when adding files changes the input set', async () => {
    const urls = installImageGlobals();
    const process = vi.fn(async () => processed('group.png'));
    const mounted = mountBatch(makeProcessor(process, 'group'));
    await addFiles(mounted, ['first.png', 'second.png']);
    await act(async () => mounted.current.processAll());
    const oldOutputUrl = mounted.current.allOutputs[0].url;

    await addFiles(mounted, ['third.png']);

    expect(urls.revokeObjectURL).toHaveBeenCalledWith(oldOutputUrl);
    expect(mounted.current.allOutputs).toEqual([]);
  });

  it('aborts an active group job and ignores its late result when adding files', async () => {
    const urls = installImageGlobals();
    const oldTask = deferred<ProcessedAsset[]>();
    let oldSignal: AbortSignal | undefined;
    const process = vi.fn((
      _files: readonly File[],
      _params: Params,
      context: ProcessorContext,
    ) => {
      oldSignal = context.signal;
      return oldTask.promise;
    });
    const mounted = mountBatch(makeProcessor(process, 'group'));
    await addFiles(mounted, ['first.png', 'second.png']);

    let oldRun!: Promise<void>;
    act(() => {
      oldRun = mounted.current.processAll();
    });
    await addFiles(mounted, ['third.png']);
    const wasAbortedWhenFilesWereAdded = oldSignal?.aborted;

    oldTask.resolve(processed('stale-group.png'));
    await act(async () => oldRun);

    expect(wasAbortedWhenFilesWereAdded).toBe(true);
    expect(mounted.current.allOutputs).toEqual([]);
    expect(urls.createObjectURL).toHaveBeenCalledTimes(3);
  });

  it('moves through process failure, retry success and reset', async () => {
    const urls = installImageGlobals();
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce(processed('retried.png'));
    const mounted = mountBatch(makeProcessor(process));
    await addFiles(mounted, ['one.png']);

    await act(async () => mounted.current.processSelected());
    expect(mounted.current.selected).toMatchObject({
      status: 'error',
      error: '处理失败：first failure',
    });

    await act(async () => mounted.current.retryItem(mounted.current.items[0].id));
    expect(mounted.current.selected).toMatchObject({
      status: 'done',
      error: null,
    });
    expect(mounted.current.allOutputs[0].name).toBe('retried.png');
    const ownedUrls = [
      mounted.current.items[0].sourceUrl,
      mounted.current.allOutputs[0].url,
    ];

    act(() => mounted.current.reset());
    expect(mounted.current.items).toEqual([]);
    expect(mounted.current.allOutputs).toEqual([]);
    expect(urls.revokeObjectURL.mock.calls.map((call) => call[0]))
      .toEqual(expect.arrayContaining(ownedUrls));
  });
});
