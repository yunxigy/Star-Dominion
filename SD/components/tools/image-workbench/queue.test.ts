import { describe, expect, it } from 'vitest';
import type { ImageQueueState } from './types';
import { createBatchItems, imageQueueReducer } from './queue';

interface QualityParams {
  quality: number;
  format: 'png' | 'webp';
}

const makeFile = (name: string): File =>
  new File(['image-bytes'], name, { type: 'image/png' });

const makeOutput = (id: string, name: string) => ({
  id,
  name,
  blob: new Blob([name], { type: 'image/png' }),
  url: `blob:${id}`,
});

const initialParams = (): QualityParams => ({ quality: 80, format: 'webp' });

describe('createBatchItems', () => {
  it('creates one queued item per file with independent params', () => {
    const params = initialParams();
    const items = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      params,
    );

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.file.name)).toEqual(['a.png', 'b.png']);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(items[0].params).toEqual(params);
    expect(items[0].params).not.toBe(params);
    expect(items[0].params).not.toBe(items[1].params);
    expect(items.every((item) => item.status === 'queued')).toBe(true);
    expect(items.every((item) => item.progress === 0)).toBe(true);
    expect(items.every((item) => item.outputs.length === 0)).toBe(true);
    expect(items.every((item) => item.error === null)).toBe(true);
    expect(items.every((item) => item.stale === false)).toBe(true);
    expect(items.every((item) => item.metadata === null)).toBe(true);
    expect(items.every((item) => item.sourceUrl.startsWith('blob:'))).toBe(true);
  });
});

describe('imageQueueReducer', () => {
  it('adds files and selects the first newly added item when the queue was empty', () => {
    const added = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );
    const state = imageQueueReducer<QualityParams>(
      { items: [], selectedId: null },
      { type: 'add', items: added },
    );

    expect(state.items).toEqual(added);
    expect(state.selectedId).toBe(added[0].id);
  });

  it('keeps item params independent and marks only the changed item stale', () => {
    const [first, second] = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );
    const original = {
      items: [first, second],
      selectedId: first.id,
    };

    const state = imageQueueReducer(original, {
      type: 'set-item-params',
      id: first.id,
      params: { quality: 60, format: 'png' },
    });

    expect(state.items.map((item) => item.params)).toEqual([
      { quality: 60, format: 'png' },
      { quality: 80, format: 'webp' },
    ]);
    expect(state.items.map((item) => item.stale)).toEqual([true, false]);
    expect(state).not.toBe(original);
    expect(state.items).not.toBe(original.items);
    expect(state.items[0]).not.toBe(original.items[0]);
    expect(state.items[1]).toBe(original.items[1]);
    expect(original.items[0].params).toEqual(initialParams());
  });

  it('applies params to every item with independent copies and marks all stale', () => {
    const items = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );
    const state = imageQueueReducer(
      { items, selectedId: items[0].id },
      {
        type: 'apply-params-to-all',
        params: { quality: 70, format: 'png' },
      },
    );

    expect(state.items.map((item) => item.params)).toEqual([
      { quality: 70, format: 'png' },
      { quality: 70, format: 'png' },
    ]);
    expect(state.items[0].params).not.toBe(state.items[1].params);
    expect(state.items.every((item) => item.stale)).toBe(true);
  });

  it('marks an item as processing without mutating the previous state', () => {
    const [item] = createBatchItems([makeFile('a.png')], initialParams());
    const original = {
      items: [{ ...item, error: '旧错误', progress: 45 }],
      selectedId: item.id,
    };
    const state = imageQueueReducer(original, { type: 'start', id: item.id });

    expect(state.items[0].status).toBe('processing');
    expect(state.items[0].progress).toBe(0);
    expect(state.items[0].error).toBeNull();
    expect(original.items[0]).toMatchObject({
      status: 'queued',
      progress: 45,
      error: '旧错误',
    });
  });

  it('stores multiple successful outputs, clears errors and completes progress', () => {
    const [item] = createBatchItems([makeFile('a.png')], initialParams());
    const outputs = [
      makeOutput('one', 'a-1.png'),
      makeOutput('two', 'a-2.png'),
    ];
    const state = imageQueueReducer(
      {
        items: [{ ...item, status: 'processing', error: '旧错误', stale: true }],
        selectedId: item.id,
      },
      { type: 'succeed', id: item.id, outputs },
    );

    expect(state.items[0]).toMatchObject({
      status: 'done',
      progress: 100,
      outputs,
      error: null,
      stale: false,
    });
  });

  it('records a processing failure and clears staleness', () => {
    const [item] = createBatchItems([makeFile('a.png')], initialParams());
    const state = imageQueueReducer(
      {
        items: [{ ...item, status: 'processing', progress: 35, stale: true }],
        selectedId: item.id,
      },
      { type: 'fail', id: item.id, error: '无法解码图片' },
    );

    expect(state.items[0]).toMatchObject({
      status: 'error',
      error: '无法解码图片',
      stale: false,
    });
  });

  it('sets metadata without replacing the queue item', () => {
    const [item] = createBatchItems([makeFile('a.png')], initialParams());
    const metadata = {
      width: 640,
      height: 480,
      mime: 'image/png',
      bytes: item.file.size,
    };
    const state = imageQueueReducer(
      { items: [item], selectedId: item.id },
      { type: 'set-metadata', id: item.id, metadata },
    );

    expect(state.items[0]).toEqual({ ...item, metadata });
  });

  it('clears only the targeted item outputs before reprocessing', () => {
    const [first, second] = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );
    first.outputs = [makeOutput('first-output', 'a-result.png')];
    second.outputs = [makeOutput('second-output', 'b-result.png')];

    const state = imageQueueReducer(
      { items: [first, second], selectedId: first.id },
      { type: 'clear-outputs', id: first.id },
    );

    expect(state.items[0].outputs).toEqual([]);
    expect(state.items[1].outputs).toEqual(second.outputs);
  });

  it('resets the complete queue', () => {
    const items = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );

    const state = imageQueueReducer(
      { items, selectedId: items[0].id },
      { type: 'reset' },
    );

    expect(state).toEqual({ items: [], selectedId: null });
  });

  it('retries with the same input and params while clearing outputs and errors', () => {
    const [item] = createBatchItems([makeFile('a.png')], initialParams());
    const params: QualityParams = { quality: 63, format: 'png' };
    const output = makeOutput('old', 'old.png');
    const state = imageQueueReducer(
      {
        items: [
          {
            ...item,
            params,
            status: 'error',
            progress: 75,
            outputs: [output],
            error: '处理失败',
          },
        ],
        selectedId: item.id,
      },
      { type: 'retry', id: item.id },
    );

    expect(state.items[0].file).toBe(item.file);
    expect(state.items[0].params).toBe(params);
    expect(state.items[0]).toMatchObject({
      status: 'queued',
      progress: 0,
      outputs: [],
      error: null,
      stale: true,
    });
  });

  it('supports explicit selection and keeps it when an unselected item is removed', () => {
    const [first, second] = createBatchItems(
      [makeFile('a.png'), makeFile('b.png')],
      initialParams(),
    );
    let state = imageQueueReducer(
      { items: [first, second], selectedId: first.id },
      { type: 'select', id: second.id },
    );
    state = imageQueueReducer(state, { type: 'remove', id: first.id });

    expect(state.items.map((item) => item.id)).toEqual([second.id]);
    expect(state.selectedId).toBe(second.id);
  });

  it('moves queue items without changing the selected item', () => {
    const [first, second, third] = createBatchItems(
      [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')],
      initialParams(),
    );
    const original = { items: [first, second, third], selectedId: second.id };

    const moved = imageQueueReducer(original, {
      type: 'move',
      id: third.id,
      direction: 'up',
    });

    expect(moved.items.map((item) => item.id)).toEqual([first.id, third.id, second.id]);
    expect(moved.selectedId).toBe(second.id);
    expect(moved.items).not.toBe(original.items);
    expect(original.items.map((item) => item.id)).toEqual([first.id, second.id, third.id]);
    expect(imageQueueReducer(moved, {
      type: 'move', id: first.id, direction: 'up',
    })).toBe(moved);
  });

  it('falls back to the next item, then the previous item, then null when removing selection', () => {
    const [first, second, third] = createBatchItems(
      [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')],
      initialParams(),
    );
    let state: ImageQueueState<QualityParams> = {
      items: [first, second, third],
      selectedId: second.id,
    };

    state = imageQueueReducer(state, { type: 'remove', id: second.id });
    expect(state.selectedId).toBe(third.id);

    state = imageQueueReducer(state, { type: 'remove', id: third.id });
    expect(state.selectedId).toBe(first.id);

    state = imageQueueReducer(state, { type: 'remove', id: first.id });
    expect(state.selectedId).toBeNull();
  });
});
