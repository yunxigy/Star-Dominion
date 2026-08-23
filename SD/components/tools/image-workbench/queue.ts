import type {
  BatchItem,
  ImageQueueState,
  OutputAsset,
} from './types';

export type ImageQueueAction<P> =
  | { type: 'add'; items: BatchItem<P>[] }
  | { type: 'select'; id: string | null }
  | { type: 'set-item-params'; id: string; params: P }
  | { type: 'apply-params-to-all'; params: P }
  | { type: 'start'; id: string }
  | { type: 'progress'; id: string; progress: number }
  | { type: 'succeed'; id: string; outputs: OutputAsset[] }
  | { type: 'fail'; id: string; error: string }
  | { type: 'retry'; id: string }
  | { type: 'remove'; id: string };

let nextBatchItemId = 0;

const createBatchItemId = (): string => {
  nextBatchItemId += 1;
  return `image-${Date.now()}-${nextBatchItemId}`;
};

const cloneParams = <P>(params: P): P => {
  if (Array.isArray(params)) {
    return [...params] as P;
  }
  if (params !== null && typeof params === 'object') {
    return { ...params } as P;
  }
  return params;
};

export const createBatchItems = <P>(
  files: readonly File[],
  params: P,
): BatchItem<P>[] =>
  files.map((file) => ({
    id: createBatchItemId(),
    file,
    sourceUrl: URL.createObjectURL(file),
    metadata: null,
    params: cloneParams(params),
    status: 'queued',
    progress: 0,
    outputs: [],
    error: null,
    stale: false,
  }));

const updateItem = <P>(
  state: ImageQueueState<P>,
  id: string,
  update: (item: BatchItem<P>) => BatchItem<P>,
): ImageQueueState<P> => {
  const index = state.items.findIndex((item) => item.id === id);
  if (index === -1) {
    return state;
  }
  return {
    ...state,
    items: state.items.map((item, itemIndex) =>
      itemIndex === index ? update(item) : item,
    ),
  };
};

export const imageQueueReducer = <P>(
  state: ImageQueueState<P>,
  action: ImageQueueAction<P>,
): ImageQueueState<P> => {
  switch (action.type) {
    case 'add':
      if (action.items.length === 0) {
        return state;
      }
      return {
        items: [...state.items, ...action.items],
        selectedId: state.selectedId ?? action.items[0].id,
      };
    case 'select':
      if (
        action.id !== null &&
        !state.items.some((item) => item.id === action.id)
      ) {
        return state;
      }
      return { ...state, selectedId: action.id };
    case 'set-item-params':
      return updateItem(state, action.id, (item) => ({
        ...item,
        params: cloneParams(action.params),
        stale: true,
      }));
    case 'apply-params-to-all':
      return {
        ...state,
        items: state.items.map((item) => ({
          ...item,
          params: cloneParams(action.params),
          stale: true,
        })),
      };
    case 'start':
      return updateItem(state, action.id, (item) => ({
        ...item,
        status: 'processing',
        progress: 0,
        error: null,
      }));
    case 'progress':
      return updateItem(state, action.id, (item) => ({
        ...item,
        progress: Math.min(100, Math.max(0, action.progress)),
      }));
    case 'succeed':
      return updateItem(state, action.id, (item) => ({
        ...item,
        status: 'done',
        progress: 100,
        outputs: [...action.outputs],
        error: null,
        stale: false,
      }));
    case 'fail':
      return updateItem(state, action.id, (item) => ({
        ...item,
        status: 'error',
        error: action.error,
      }));
    case 'retry':
      return updateItem(state, action.id, (item) => ({
        ...item,
        status: 'queued',
        progress: 0,
        outputs: [],
        error: null,
        stale: true,
      }));
    case 'remove': {
      const removedIndex = state.items.findIndex(
        (item) => item.id === action.id,
      );
      if (removedIndex === -1) {
        return state;
      }
      const items = state.items.filter((item) => item.id !== action.id);
      const selectedId =
        state.selectedId === action.id
          ? (items[Math.min(removedIndex, items.length - 1)]?.id ?? null)
          : state.selectedId;
      return { items, selectedId };
    }
  }
};
