import { readFileSync } from 'node:fs';
import React from 'react';
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
import { ImageActionBar } from './ImageActionBar';
import { ImageBatchQueue } from './ImageBatchQueue';
import {
  BatchImageTool,
  type BatchImageToolControlContext,
} from './BatchImageTool';
import { ImageDropzone } from './ImageDropzone';
import { ImagePreviewPane } from './ImagePreviewPane';
import type {
  BatchItem,
  ImageProcessor,
  ProcessedAsset,
} from './types';

interface Params {
  quality: number;
}

const batchImageToolSourceUrl = new URL('./BatchImageTool.tsx', import.meta.url);
const renderers: ReactTestRenderer[] = [];

afterEach(() => {
  act(() => {
    for (const renderer of renderers.splice(0)) renderer.unmount();
  });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function installBrowserGlobals() {
  let nextUrl = 0;
  const createObjectURL = vi.fn((_value: Blob) => {
    nextUrl += 1;
    return `blob:test-${nextUrl}`;
  });
  const revokeObjectURL = vi.fn();
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(),
  };

  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width: 640,
    height: 360,
    close: vi.fn(),
  })));
  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => {
      expect(tag).toBe('a');
      return anchor;
    }),
  });

  return { anchor, createObjectURL, revokeObjectURL };
}

function assets(...names: string[]): ProcessedAsset[] {
  return names.map((name) => ({
    name,
    blob: new Blob([name], { type: 'image/png' }),
    width: 640,
    height: 360,
  }));
}

function makeProcessor(
  process: ImageProcessor<Params>['process'],
): ImageProcessor<Params> {
  return {
    accept: 'image/png,image/jpeg',
    mode: 'per-file',
    defaultParams: { quality: 80 },
    maxFiles: 4,
    process,
  };
}

function mountTool(
  processor: ImageProcessor<Params>,
  options: {
    maxFileSizeBytes?: number;
    zipFilename?: string;
    notice?: React.ReactNode;
    renderControls?: (
      context: BatchImageToolControlContext<Params>,
    ) => React.ReactNode;
  } = {},
) {
  let controls: BatchImageToolControlContext<Params> | null = null;
  const renderControls = options.renderControls ?? ((context) => {
    controls = context;
    return <span>质量：{context.selectedParams.quality}</span>;
  });
  let renderer!: ReactTestRenderer;

  act(() => {
    renderer = create(
      <BatchImageTool
        processor={processor}
        parameterTitle="导出参数"
        parameterDescription="设置每张图片的导出质量"
        renderControls={renderControls}
        notice={options.notice}
        zipFilename={options.zipFilename}
        maxFileSizeBytes={options.maxFileSizeBytes}
      />,
    );
  });
  renderers.push(renderer);

  return {
    renderer,
    get controls() {
      if (!controls) throw new Error('Controls were not rendered');
      return controls;
    },
    dropzone: () => renderer.root.findByType(ImageDropzone),
    queue: () => renderer.root.findByType(ImageBatchQueue<Params>),
    preview: () => renderer.root.findByType(ImagePreviewPane),
    actions: () => renderer.root.findByType(ImageActionBar),
  };
}

async function addFiles(
  mounted: ReturnType<typeof mountTool>,
  files: readonly File[],
): Promise<void> {
  await act(async () => {
    await mounted.dropzone().props.onFiles(files);
  });
}

describe('BatchImageTool', () => {
  it('wires upload, selection, removal and per-item/shared parameter controls', async () => {
    installBrowserGlobals();
    const mounted = mountTool(makeProcessor(vi.fn(async () => [])), {
      maxFileSizeBytes: 5 * 1024 * 1024,
      notice: <span>本地处理说明</span>,
    });

    expect(mounted.dropzone().props).toMatchObject({
      accept: 'image/png,image/jpeg',
      maxFiles: 4,
      maxFileSizeBytes: 5 * 1024 * 1024,
      multiple: true,
    });
    expect(mounted.controls.selectedParams).toEqual({ quality: 80 });

    await addFiles(mounted, [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.jpg', { type: 'image/jpeg' }),
    ]);

    expect(mounted.queue().props.items).toHaveLength(2);
    expect(mounted.preview().props.source.name).toBe('first.png');

    act(() => mounted.controls.setSelectedParams({ quality: 60 }));
    expect(mounted.queue().props.items[0].params).toEqual({ quality: 60 });
    expect(mounted.queue().props.items[1].params).toEqual({ quality: 80 });

    const secondId = mounted.queue().props.items[1].id;
    act(() => mounted.queue().props.select(secondId));
    expect(mounted.controls.selectedParams).toEqual({ quality: 80 });
    expect(mounted.preview().props.source.name).toBe('second.jpg');

    act(() => mounted.controls.applyParamsToAll({ quality: 70 }));
    expect(mounted.queue().props.items.map(
      (item: BatchItem<Params>) => item.params.quality,
    ))
      .toEqual([70, 70]);

    act(() => mounted.queue().props.remove(secondId));
    expect(mounted.queue().props.items).toHaveLength(1);
    expect(mounted.preview().props.source.name).toBe('first.png');
    expect(JSON.stringify(mounted.renderer.toJSON())).toContain('本地处理说明');
  });

  it('processes selected/all, selects outputs, downloads one/ZIP and resets', async () => {
    const browser = installBrowserGlobals();
    const process = vi.fn(async (files: readonly File[]) => assets(
      `${files[0].name}-one.png`,
      `${files[0].name}-two.png`,
    ));
    const mounted = mountTool(makeProcessor(process), {
      zipFilename: 'my-results.zip',
    });
    await addFiles(mounted, [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' }),
    ]);

    const secondId = mounted.queue().props.items[1].id;
    act(() => mounted.queue().props.select(secondId));
    await act(async () => mounted.actions().props.processSelected());

    expect(process).toHaveBeenCalledTimes(1);
    expect(process.mock.calls[0][0][0].name).toBe('second.png');
    expect(mounted.preview().props.source.name).toBe('second.png');
    expect(mounted.preview().props.outputs).toHaveLength(2);

    const secondOutput = mounted.preview().props.outputs[1];
    act(() => mounted.preview().props.selectOutput(secondOutput.id));
    expect(mounted.preview().props.selectedOutputId).toBe(secondOutput.id);

    act(() => mounted.actions().props.downloadSelected());
    expect(browser.anchor.download).toBe('second.png-two.png');
    expect(browser.anchor.click).toHaveBeenCalledOnce();

    await act(async () => mounted.actions().props.processAll());
    expect(process).toHaveBeenCalledTimes(3);
    expect(mounted.actions().props.downloadZipDisabled).toBe(false);

    await act(async () => mounted.actions().props.downloadZip());
    expect(browser.anchor.download).toBe('my-results.zip');
    expect(browser.anchor.click).toHaveBeenCalledTimes(2);

    act(() => mounted.actions().props.reset());
    expect(mounted.queue().props.items).toEqual([]);
    expect(mounted.preview().props.source).toBeUndefined();
    expect(mounted.actions().props).toMatchObject({
      resetDisabled: true,
      processSelectedDisabled: true,
      processAllDisabled: true,
      downloadSelectedDisabled: true,
      downloadZipDisabled: true,
    });
  });

  it('reports processing failures, exposes retry and blocks oversized files without alert', async () => {
    installBrowserGlobals();
    const process = vi.fn()
      .mockRejectedValueOnce(new Error('decoder failed'))
      .mockResolvedValueOnce(assets('retried.png'));
    const mounted = mountTool(makeProcessor(process), {
      maxFileSizeBytes: 5,
    });

    await addFiles(mounted, [
      new File([new Uint8Array(8)], 'too-large.png', { type: 'image/png' }),
      new File(['ok'], 'ok.png', { type: 'image/png' }),
    ]);

    expect(mounted.queue().props.items.map(
      (item: BatchItem<Params>) => item.file.name,
    ))
      .toEqual(['ok.png']);
    expect(JSON.stringify(mounted.renderer.toJSON())).toContain('too-large.png');
    expect(JSON.stringify(mounted.renderer.toJSON())).toContain('超过');

    await act(async () => mounted.actions().props.processSelected());
    expect(mounted.queue().props.items[0]).toMatchObject({
      status: 'error',
      error: '处理失败：decoder failed',
    });
    expect(mounted.actions().props.error).toContain('decoder failed');

    await act(async () => {
      await mounted.queue().props.retry(mounted.queue().props.items[0].id);
    });
    expect(mounted.queue().props.items[0]).toMatchObject({
      status: 'done',
      error: null,
    });
    expect(JSON.stringify(mounted.actions().props.status)).toContain('已完成');

    const source = readFileSync(batchImageToolSourceUrl, 'utf8');
    expect(source).not.toMatch(/\b(?:window\.)?alert\s*\(/);
  });

  it('reports files skipped when an upload exceeds the queue limit', async () => {
    installBrowserGlobals();
    const processor = makeProcessor(vi.fn(async () => []));
    processor.maxFiles = 2;
    const mounted = mountTool(processor);

    await addFiles(mounted, [
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
      new File(['three'], 'three.png', { type: 'image/png' }),
    ]);

    expect(mounted.queue().props.items.map((item) => item.file.name))
      .toEqual(['one.png', 'two.png']);
    expect(JSON.stringify(mounted.renderer.toJSON())).toContain('three.png');
    expect(JSON.stringify(mounted.renderer.toJSON())).toContain('最多 2 张');
  });

  it('falls back to a current output after reprocessing invalidates the chosen output', async () => {
    const browser = installBrowserGlobals();
    const process = vi.fn()
      .mockResolvedValueOnce(assets('old-one.png', 'old-two.png'))
      .mockResolvedValueOnce(assets('new-only.png'));
    const mounted = mountTool(makeProcessor(process));
    await addFiles(mounted, [
      new File(['image'], 'source.png', { type: 'image/png' }),
    ]);

    await act(async () => mounted.actions().props.processSelected());
    const oldSecond = mounted.preview().props.outputs[1];
    act(() => mounted.preview().props.selectOutput(oldSecond.id));
    expect(mounted.preview().props.selectedOutputId).toBe(oldSecond.id);

    await act(async () => mounted.actions().props.processSelected());
    const newOnly = mounted.preview().props.outputs[0];
    expect(newOnly.name).toBe('new-only.png');
    expect(mounted.preview().props.selectedOutputId).toBe(newOnly.id);

    act(() => mounted.actions().props.downloadSelected());
    expect(browser.anchor.download).toBe('new-only.png');
  });

  it('exports the high-level component and its low-level dependencies from the barrel', async () => {
    const workbench = await import('./index');

    expect(workbench.BatchImageTool).toBe(BatchImageTool);
    expect(workbench.ImageDropzone).toBe(ImageDropzone);
    expect(workbench.ImageBatchQueue).toBe(ImageBatchQueue);
    expect(workbench.ImagePreviewPane).toBe(ImagePreviewPane);
    expect(workbench.downloadOutputsAsZip).toBeTypeOf('function');
    expect(workbench.useImageBatch).toBeTypeOf('function');
  });
});
