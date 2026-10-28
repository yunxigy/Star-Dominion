import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  calculateDrawRect,
  compressImageProcessor,
  fitDimensions,
  resizeImageProcessor,
  splitGridRects,
} from './basic';
import {
  calculateMergeLayout,
  mergeImageProcessor,
} from './composition';

interface CanvasHarness {
  canvases: Array<{
    width: number;
    height: number;
    context: {
      drawImage: ReturnType<typeof vi.fn>;
      fillRect: ReturnType<typeof vi.fn>;
      fillStyle: string;
      globalAlpha: number;
      save: ReturnType<typeof vi.fn>;
      restore: ReturnType<typeof vi.fn>;
    };
    toBlob: ReturnType<typeof vi.fn>;
  }>;
  close: ReturnType<typeof vi.fn>;
}

function makeFile(name = 'photo.png', type = 'image/png'): File {
  return Object.assign(new Blob(['pixels'], { type }), {
    name,
    lastModified: 0,
  }) as File;
}

function installCanvasHarness(width = 1200, height = 800): CanvasHarness {
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width, height, close })));
  const canvases: CanvasHarness['canvases'] = [];

  vi.stubGlobal('document', {
    createElement: vi.fn((tag: string) => {
      if (tag !== 'canvas') throw new Error(`Unexpected element: ${tag}`);
      const context = {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
        globalAlpha: 1,
        save: vi.fn(),
        restore: vi.fn(),
      };
      const canvas = {
        width: 0,
        height: 0,
        context,
        getContext: vi.fn(() => context),
        toBlob: vi.fn((callback: BlobCallback, mime?: string) => {
          callback(new Blob(['rendered'], { type: mime }));
        }),
      };
      canvases.push(canvas as unknown as CanvasHarness['canvases'][number]);
      return canvas;
    }),
  });

  return { canvases, close };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('basic image geometry', () => {
  it('keeps the source ratio when only width is constrained', () => {
    expect(fitDimensions(1200, 800, 600, undefined, true))
      .toEqual({ width: 600, height: 400 });
  });

  it('uses explicit dimensions when aspect ratio is disabled', () => {
    expect(fitDimensions(1200, 800, 500, 500, false))
      .toEqual({ width: 500, height: 500 });
  });

  it('centers a contained image without cropping', () => {
    expect(calculateDrawRect(1200, 800, 400, 400, 'contain')).toEqual({
      sx: 0,
      sy: 0,
      sWidth: 1200,
      sHeight: 800,
      dx: 0,
      dy: 66.5,
      dWidth: 400,
      dHeight: 267,
    });
  });

  it('centers a covered image and crops only the overflowing axis', () => {
    expect(calculateDrawRect(1200, 800, 400, 400, 'cover')).toEqual({
      sx: 200,
      sy: 0,
      sWidth: 800,
      sHeight: 800,
      dx: 0,
      dy: 0,
      dWidth: 400,
      dHeight: 400,
    });
  });

  it('splits odd dimensions with no gaps or lost edge pixels', () => {
    expect(splitGridRects(5, 5, 2, 2)).toEqual([
      { x: 0, y: 0, width: 3, height: 3 },
      { x: 3, y: 0, width: 2, height: 3 },
      { x: 0, y: 3, width: 3, height: 2 },
      { x: 3, y: 3, width: 2, height: 2 },
    ]);
  });

  it('rejects grids that would create zero-sized slices', () => {
    expect(() => splitGridRects(2, 10, 2, 3))
      .toThrow('切图行列数不能超过图片像素尺寸');
  });
});

describe('basic processors', () => {
  it('implements ImageProcessor and keeps output MIME and extension aligned', async () => {
    const harness = installCanvasHarness();
    const signal = new AbortController().signal;

    const [output] = await resizeImageProcessor.process(
      [makeFile('holiday.photo.png')],
      {
        width: 600,
        height: undefined,
        keepAspectRatio: true,
        format: 'webp',
        quality: 0.8,
      },
      { preview: false, signal },
    );

    expect(resizeImageProcessor.mode).toBe('per-file');
    expect(output.name).toBe('holiday.photo-resized.webp');
    expect(output.blob.type).toBe('image/webp');
    expect(output).toMatchObject({ width: 600, height: 400 });
    expect(harness.close).toHaveBeenCalledOnce();
  });

  it('fills JPEG output with white before drawing transparent source pixels', async () => {
    const harness = installCanvasHarness(320, 180);

    const [output] = await compressImageProcessor.process(
      [makeFile('transparent.png')],
      { quality: 0.9, format: 'jpeg' },
      { preview: false, signal: new AbortController().signal },
    );

    const { context } = harness.canvases[0];
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 320, 180);
    expect(context.fillRect.mock.invocationCallOrder[0])
      .toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
    expect(output.name).toBe('transparent-compressed.jpg');
    expect(output.blob.type).toBe('image/jpeg');
  });

  it('checks an already-aborted signal before decoding', async () => {
    const harness = installCanvasHarness();
    const controller = new AbortController();
    controller.abort();

    await expect(resizeImageProcessor.process(
      [makeFile()],
      resizeImageProcessor.defaultParams,
      { preview: false, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(harness.canvases).toHaveLength(0);
  });
});

describe('composition layouts', () => {
  const sizes = [
    { width: 100, height: 50 },
    { width: 40, height: 80 },
    { width: 60, height: 30 },
  ];

  it('lays images out horizontally and vertically with centered cross-axis alignment', () => {
    expect(calculateMergeLayout(sizes.slice(0, 2), {
      layout: 'horizontal',
      gap: 10,
      columns: 2,
      align: 'center',
    })).toEqual({
      width: 150,
      height: 80,
      placements: [
        { x: 0, y: 15, width: 100, height: 50 },
        { x: 110, y: 0, width: 40, height: 80 },
      ],
    });

    expect(calculateMergeLayout(sizes.slice(0, 2), {
      layout: 'vertical',
      gap: 10,
      columns: 2,
      align: 'center',
    })).toEqual({
      width: 100,
      height: 140,
      placements: [
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 30, y: 60, width: 40, height: 80 },
      ],
    });
  });

  it('lays images out on a deterministic grid', () => {
    expect(calculateMergeLayout(sizes, {
      layout: 'grid',
      gap: 10,
      columns: 2,
      align: 'center',
    })).toEqual({
      width: 210,
      height: 170,
      placements: [
        { x: 0, y: 15, width: 100, height: 50 },
        { x: 140, y: 0, width: 40, height: 80 },
        { x: 20, y: 115, width: 60, height: 30 },
      ],
    });
  });

  it('uses group mode, buildOutputName naming, and aligned PNG output', async () => {
    const harness = installCanvasHarness(100, 50);

    const [output] = await mergeImageProcessor.process(
      [makeFile('first.png'), makeFile('second.jpg', 'image/jpeg')],
      {
        layout: 'horizontal',
        columns: 2,
        gap: 4,
        align: 'center',
        backgroundColor: '#ffffff',
        format: 'png',
        quality: 0.92,
      },
      { preview: false, signal: new AbortController().signal },
    );

    expect(mergeImageProcessor.mode).toBe('group');
    expect(output.name).toBe('first-merged.png');
    expect(output.blob.type).toBe('image/png');
    expect(harness.close).toHaveBeenCalledTimes(2);
  });

  it('always paints an opaque white base before transparent JPEG merge output', async () => {
    const harness = installCanvasHarness(100, 50);

    await mergeImageProcessor.process(
      [makeFile('first.png'), makeFile('second.png')],
      {
        layout: 'horizontal',
        columns: 2,
        gap: 0,
        align: 'center',
        backgroundColor: 'transparent',
        format: 'jpeg',
        quality: 0.9,
      },
      { preview: false, signal: new AbortController().signal },
    );

    const { context } = harness.canvases[0];
    expect(context.fillStyle).toBe('#ffffff');
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 200, 50);
    expect(context.fillRect.mock.invocationCallOrder[0])
      .toBeLessThan(context.drawImage.mock.invocationCallOrder[0]);
  });
});
