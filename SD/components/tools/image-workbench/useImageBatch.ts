import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';
import {
  createBatchItems,
  imageQueueReducer,
  type ImageQueueAction,
} from './queue';
import {
  formatProcessingError,
  readImageMetadata,
  revokeOutputAssets,
  runWithConcurrency,
} from './processing';
import type {
  BatchItem,
  ImageMetadata,
  ImageProcessor,
  ImageQueueState,
  OutputAsset,
  ProcessedAsset,
  ProcessorMode,
} from './types';

export interface UseImageBatchResult<P> {
  items: BatchItem<P>[];
  selected: BatchItem<P> | null;
  isProcessing: boolean;
  addFiles(files: readonly File[]): Promise<void>;
  removeItem(id: string): void;
  moveItem(id: string, direction: 'up' | 'down'): void;
  selectItem(id: string): void;
  setSelectedParams(params: P): void;
  applyParamsToAll(params: P): void;
  processSelected(): Promise<void>;
  processAll(): Promise<void>;
  retryItem(id: string): Promise<void>;
  reset(): void;
  allOutputs: OutputAsset[];
}

export type ImageBatchScope = 'selected' | 'all';

export interface ImageBatchJob<P> {
  key: string;
  ownerId: string;
  itemIds: string[];
  files: File[];
  params: P;
}

export interface BatchMetadataResult {
  id: string;
  metadata: ImageMetadata | null;
  error: string | null;
}

type MetadataReader = (
  file: File,
  signal?: AbortSignal,
) => Promise<ImageMetadata>;

export function planImageBatchJobs<P>(
  items: readonly BatchItem<P>[],
  selectedId: string | null,
  mode: ProcessorMode,
  scope: ImageBatchScope,
): ImageBatchJob<P>[] {
  if (items.length === 0) return [];

  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  if (mode === 'group') {
    return [{
      key: 'group',
      ownerId: selected.id,
      itemIds: items.map((item) => item.id),
      files: items.map((item) => item.file),
      params: selected.params,
    }];
  }

  const plannedItems = scope === 'selected' ? [selected] : items;
  return plannedItems.map((item) => ({
    key: `item:${item.id}`,
    ownerId: item.id,
    itemIds: [item.id],
    files: [item.file],
    params: item.params,
  }));
}

export function resolveBatchConcurrency(concurrency?: number): number {
  return concurrency ?? 2;
}

export function canCommitImageBatchJob(
  version: number,
  currentVersion: number,
  aborted: boolean,
  mounted: boolean,
): boolean {
  return mounted && !aborted && version === currentVersion;
}

export async function readBatchMetadata<P>(
  items: readonly BatchItem<P>[],
  reader: MetadataReader,
  signal: AbortSignal,
): Promise<BatchMetadataResult[]> {
  return Promise.all(items.map(async (item) => {
    try {
      return {
        id: item.id,
        metadata: await reader(item.file, signal),
        error: null,
      };
    } catch (error) {
      return {
        id: item.id,
        metadata: null,
        error: formatProcessingError(error),
      };
    }
  }));
}

export function flattenBatchOutputs<P>(
  items: readonly BatchItem<P>[],
): OutputAsset[] {
  return items.flatMap((item) => item.outputs);
}

export function collectBatchObjectUrls<P>(
  items: readonly BatchItem<P>[],
): string[] {
  return items.flatMap((item) => [
    item.sourceUrl,
    ...item.outputs.map((output) => output.url),
  ]);
}

let nextOutputId = 0;

function createOutputAssets(assets: readonly ProcessedAsset[]): OutputAsset[] {
  const outputs: OutputAsset[] = [];

  try {
    for (const asset of assets) {
      nextOutputId += 1;
      outputs.push({
        ...asset,
        id: `output-${Date.now()}-${nextOutputId}`,
        url: URL.createObjectURL(asset.blob),
      });
    }
    return outputs;
  } catch (error) {
    revokeOutputAssets(outputs);
    throw error;
  }
}

const INITIAL_STATE = { items: [], selectedId: null };

export function useImageBatch<P>(
  processor: ImageProcessor<P>,
): UseImageBatchResult<P> {
  const [state, reactDispatch] = useReducer(
    imageQueueReducer<P>,
    INITIAL_STATE as ImageQueueState<P>,
  );
  const stateRef = useRef(state);
  const mountedRef = useRef(true);
  const processAllVersionRef = useRef(0);
  const jobVersionsRef = useRef(new Map<string, number>());
  const jobControllersRef = useRef(new Map<string, AbortController>());
  const metadataControllersRef = useRef(new Set<AbortController>());
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  stateRef.current = state;

  const dispatch = useCallback((action: ImageQueueAction<P>): void => {
    if (!mountedRef.current) return;
    stateRef.current = imageQueueReducer(stateRef.current, action);
    reactDispatch(action);
  }, []);

  const clearPreviewTimer = useCallback((): void => {
    if (previewTimerRef.current === null) return;
    clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
  }, []);

  const invalidateProcessAll = useCallback((): number => {
    processAllVersionRef.current += 1;
    return processAllVersionRef.current;
  }, []);

  const abortJob = useCallback((key: string): void => {
    jobControllersRef.current.get(key)?.abort();
    jobControllersRef.current.delete(key);
    jobVersionsRef.current.delete(key);
  }, []);

  const abortAllJobs = useCallback((): void => {
    for (const controller of jobControllersRef.current.values()) {
      controller.abort();
    }
    jobControllersRef.current.clear();
    jobVersionsRef.current.clear();
  }, []);

  const releaseItemOutputs = useCallback((items: readonly BatchItem<P>[]): void => {
    for (const item of items) {
      if (item.outputs.length === 0) continue;
      revokeOutputAssets(item.outputs);
      dispatch({ type: 'clear-outputs', id: item.id });
    }
  }, [dispatch]);

  const cancelProcessingItems = useCallback((items: readonly BatchItem<P>[]): void => {
    for (const item of items) {
      if (item.status === 'processing') {
        dispatch({ type: 'retry', id: item.id });
      }
    }
  }, [dispatch]);

  const beginJob = useCallback((key: string) => {
    abortJob(key);
    const version = (jobVersionsRef.current.get(key) ?? 0) + 1;
    const controller = new AbortController();
    jobVersionsRef.current.set(key, version);
    jobControllersRef.current.set(key, controller);
    return { version, controller };
  }, [abortJob]);

  const executeJob = useCallback(async (
    job: ImageBatchJob<P>,
    preview: boolean,
  ): Promise<void> => {
    if (!mountedRef.current) return;

    const { version, controller } = beginJob(job.key);
    const currentItems = job.itemIds
      .map((id) => stateRef.current.items.find((item) => item.id === id))
      .filter((item): item is BatchItem<P> => item !== undefined);

    if (currentItems.length !== job.itemIds.length) {
      controller.abort();
      return;
    }

    releaseItemOutputs(currentItems);
    for (const id of job.itemIds) {
      dispatch({ type: 'start', id });
    }

    try {
      const processed = await processor.process(job.files, job.params, {
        preview,
        signal: controller.signal,
      });
      const currentVersion = jobVersionsRef.current.get(job.key) ?? 0;
      if (!canCommitImageBatchJob(
        version,
        currentVersion,
        controller.signal.aborted,
        mountedRef.current,
      )) {
        return;
      }

      const outputs = createOutputAssets(processed);
      if (!canCommitImageBatchJob(
        version,
        jobVersionsRef.current.get(job.key) ?? 0,
        controller.signal.aborted,
        mountedRef.current,
      )) {
        revokeOutputAssets(outputs);
        return;
      }

      for (const id of job.itemIds) {
        dispatch({
          type: 'succeed',
          id,
          outputs: id === job.ownerId ? outputs : [],
        });
      }
    } catch (error) {
      const currentVersion = jobVersionsRef.current.get(job.key) ?? 0;
      if (!canCommitImageBatchJob(
        version,
        currentVersion,
        controller.signal.aborted,
        mountedRef.current,
      )) {
        return;
      }

      const message = formatProcessingError(error);
      for (const id of job.itemIds) {
        dispatch({ type: 'fail', id, error: message });
      }
    } finally {
      if (jobControllersRef.current.get(job.key) === controller) {
        jobControllersRef.current.delete(job.key);
      }
    }
  }, [beginJob, dispatch, processor, releaseItemOutputs]);

  const runSelected = useCallback(async (
    selectedId: string | null,
    preview: boolean,
  ): Promise<void> => {
    if (!mountedRef.current) return;
    const jobs = planImageBatchJobs(
      stateRef.current.items,
      selectedId,
      processor.mode,
      'selected',
    );
    if (jobs[0]) await executeJob(jobs[0], preview);
  }, [executeJob, processor.mode]);

  const addFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (!mountedRef.current || files.length === 0) return;
    const remaining = processor.maxFiles === undefined
      ? files.length
      : Math.max(0, processor.maxFiles - stateRef.current.items.length);
    const acceptedFiles = files.slice(0, remaining);
    if (acceptedFiles.length === 0) return;

    if (processor.mode === 'group') {
      invalidateProcessAll();
      clearPreviewTimer();
      abortJob('group');
      const currentItems = stateRef.current.items;
      releaseItemOutputs(currentItems);
      cancelProcessingItems(currentItems);
    }
    const items = createBatchItems(acceptedFiles, processor.defaultParams);
    dispatch({ type: 'add', items });

    const controller = new AbortController();
    metadataControllersRef.current.add(controller);
    try {
      const results = await readBatchMetadata(
        items,
        readImageMetadata,
        controller.signal,
      );
      if (!mountedRef.current || controller.signal.aborted) return;

      for (const result of results) {
        if (!stateRef.current.items.some((item) => item.id === result.id)) {
          continue;
        }
        if (result.metadata) {
          dispatch({
            type: 'set-metadata',
            id: result.id,
            metadata: result.metadata,
          });
        } else if (result.error) {
          dispatch({ type: 'fail', id: result.id, error: result.error });
        }
      }
    } finally {
      metadataControllersRef.current.delete(controller);
    }
  }, [
    abortJob,
    cancelProcessingItems,
    clearPreviewTimer,
    dispatch,
    invalidateProcessAll,
    processor.defaultParams,
    processor.maxFiles,
    processor.mode,
    releaseItemOutputs,
  ]);

  const removeItem = useCallback((id: string): void => {
    if (!mountedRef.current) return;
    clearPreviewTimer();
    invalidateProcessAll();
    const current = stateRef.current;
    const item = current.items.find((candidate) => candidate.id === id);
    if (!item) return;

    abortJob(`item:${id}`);
    const affectedItems = processor.mode === 'group' ? current.items : [item];
    if (processor.mode === 'group') abortJob('group');
    releaseItemOutputs(affectedItems);
    cancelProcessingItems(affectedItems);
    URL.revokeObjectURL(item.sourceUrl);
    dispatch({ type: 'remove', id });
  }, [
    abortJob,
    cancelProcessingItems,
    clearPreviewTimer,
    dispatch,
    invalidateProcessAll,
    processor.mode,
    releaseItemOutputs,
  ]);

  const moveItem = useCallback((id: string, direction: 'up' | 'down'): void => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    if (!current.items.some((item) => item.id === id)) return;
    clearPreviewTimer();
    invalidateProcessAll();
    if (processor.mode === 'group') {
      abortJob('group');
      releaseItemOutputs(current.items);
      cancelProcessingItems(current.items);
    }
    dispatch({ type: 'move', id, direction });
  }, [
    abortJob,
    cancelProcessingItems,
    clearPreviewTimer,
    dispatch,
    invalidateProcessAll,
    processor.mode,
    releaseItemOutputs,
  ]);

  const selectItem = useCallback((id: string): void => {
    dispatch({ type: 'select', id });
  }, [dispatch]);

  const setSelectedParams = useCallback((params: P): void => {
    if (!mountedRef.current) return;
    const current = stateRef.current;
    const selected = current.items.find((item) => item.id === current.selectedId);
    if (!selected) return;

    invalidateProcessAll();
    const affectedItems = processor.mode === 'group' ? current.items : [selected];
    abortJob(`item:${selected.id}`);
    if (processor.mode === 'group') abortJob('group');
    releaseItemOutputs(affectedItems);
    cancelProcessingItems(affectedItems);
    dispatch({ type: 'set-item-params', id: selected.id, params });
  }, [
    abortJob,
    cancelProcessingItems,
    dispatch,
    invalidateProcessAll,
    processor.mode,
    releaseItemOutputs,
  ]);

  const applyParamsToAll = useCallback((params: P): void => {
    if (!mountedRef.current) return;
    invalidateProcessAll();
    const items = stateRef.current.items;
    abortAllJobs();
    releaseItemOutputs(items);
    cancelProcessingItems(items);
    dispatch({ type: 'apply-params-to-all', params });
  }, [
    abortAllJobs,
    cancelProcessingItems,
    dispatch,
    invalidateProcessAll,
    releaseItemOutputs,
  ]);

  const processSelected = useCallback(async (): Promise<void> => {
    clearPreviewTimer();
    invalidateProcessAll();
    await runSelected(stateRef.current.selectedId, false);
  }, [clearPreviewTimer, invalidateProcessAll, runSelected]);

  const processAll = useCallback(async (): Promise<void> => {
    if (!mountedRef.current) return;
    clearPreviewTimer();
    const runVersion = invalidateProcessAll();
    abortAllJobs();
    const jobs = planImageBatchJobs(
      stateRef.current.items,
      stateRef.current.selectedId,
      processor.mode,
      'all',
    );
    await runWithConcurrency(
      jobs,
      resolveBatchConcurrency(processor.concurrency),
      async (job) => {
        if (
          !mountedRef.current ||
          processAllVersionRef.current !== runVersion
        ) {
          return;
        }
        await executeJob(job, false);
      },
    );
  }, [
    abortAllJobs,
    clearPreviewTimer,
    executeJob,
    invalidateProcessAll,
    processor.concurrency,
    processor.mode,
  ]);

  const retryItem = useCallback(async (id: string): Promise<void> => {
    if (!mountedRef.current) return;
    clearPreviewTimer();
    invalidateProcessAll();
    const current = stateRef.current;
    const item = current.items.find((candidate) => candidate.id === id);
    if (!item) return;

    const affectedItems = processor.mode === 'group' ? current.items : [item];
    abortJob(`item:${id}`);
    if (processor.mode === 'group') abortJob('group');
    releaseItemOutputs(affectedItems);
    cancelProcessingItems(affectedItems);
    dispatch({ type: 'retry', id });
    await runSelected(id, false);
  }, [
    abortJob,
    cancelProcessingItems,
    clearPreviewTimer,
    dispatch,
    invalidateProcessAll,
    processor.mode,
    releaseItemOutputs,
    runSelected,
  ]);

  const reset = useCallback((): void => {
    if (!mountedRef.current) return;
    clearPreviewTimer();
    invalidateProcessAll();
    abortAllJobs();
    for (const controller of metadataControllersRef.current) {
      controller.abort();
    }
    metadataControllersRef.current.clear();
    for (const url of collectBatchObjectUrls(stateRef.current.items)) {
      URL.revokeObjectURL(url);
    }
    dispatch({ type: 'reset' });
  }, [abortAllJobs, clearPreviewTimer, dispatch, invalidateProcessAll]);

  const previewItem = useCallback(async (id?: string): Promise<void> => {
    clearPreviewTimer();
    invalidateProcessAll();
    await runSelected(id ?? stateRef.current.selectedId, true);
  }, [clearPreviewTimer, invalidateProcessAll, runSelected]);

  const selected = state.items.find((item) => item.id === state.selectedId) ?? null;

  useEffect(() => {
    clearPreviewTimer();
    if (
      state.items.length !== 1 ||
      !selected ||
      !selected.stale ||
      selected.status === 'processing'
    ) {
      return;
    }

    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      const current = stateRef.current;
      const currentSelected = current.items.find(
        (item) => item.id === current.selectedId,
      );
      if (
        current.items.length !== 1 ||
        current.selectedId !== selected.id ||
        !currentSelected ||
        !currentSelected.stale ||
        currentSelected.status === 'processing'
      ) {
        return;
      }
      void previewItem(currentSelected.id);
    }, 200);

    return clearPreviewTimer;
  }, [
    clearPreviewTimer,
    previewItem,
    selected?.id,
    selected?.params,
    selected?.stale,
    selected?.status,
    state.items.length,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      invalidateProcessAll();
      clearPreviewTimer();
      abortAllJobs();
      for (const controller of metadataControllersRef.current) {
        controller.abort();
      }
      metadataControllersRef.current.clear();
      for (const url of collectBatchObjectUrls(stateRef.current.items)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [abortAllJobs, clearPreviewTimer, invalidateProcessAll]);

  const allOutputs = useMemo(
    () => flattenBatchOutputs(state.items),
    [state.items],
  );

  return {
    items: state.items,
    selected,
    isProcessing: state.items.some((item) => item.status === 'processing'),
    addFiles,
    removeItem,
    moveItem,
    selectItem,
    setSelectedParams,
    applyParamsToAll,
    processSelected,
    processAll,
    retryItem,
    reset,
    allOutputs,
  };
}
