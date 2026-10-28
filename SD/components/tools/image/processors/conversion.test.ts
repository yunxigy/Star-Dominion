import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  blobToDataUrl,
  dataUrlToBlob,
  faviconImageProcessor,
  imageToBase64Processor,
  idPhotoImageProcessor,
  millimetersToPixels,
  pixelsToMillimeters,
} from './conversion';

interface CanvasRecord {
  width: number;
  height: number;
  context: {
    drawImage: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    fillStyle: string;
  };
}

function makeFile(name = 'portrait.png', type = 'image/png'): File {
  return Object.assign(new Blob(['pixels'], { type }), {
    name,
    lastModified: 0,
  }) as File;
}

function installCanvasHarness(width = 600, height = 800): CanvasRecord[] {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
    width,
    height,
    close: vi.fn(),
  })));
  const canvases: CanvasRecord[] = [];

  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const context = {
        drawImage: vi.fn(),
        fillRect: vi.fn(),
        fillStyle: '',
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
      canvases.push(canvas);
      return canvas;
    }),
  });

  return canvases;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Data URL and Blob conversion', () => {
  it('round-trips binary bytes and MIME without a network request', async () => {
    const source = new Blob([new Uint8Array([0, 1, 2, 127, 128, 255])], {
      type: 'image/png',
    });

    const dataUrl = await blobToDataUrl(source);
    const result = dataUrlToBlob(dataUrl);

    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await result.arrayBuffer())))
      .toEqual([0, 1, 2, 127, 128, 255]);
  });

  it('decodes percent-encoded non-base64 Data URLs', async () => {
    const result = dataUrlToBlob('data:text/plain;charset=utf-8,hello%20world');

    expect(result.type).toBe('text/plain;charset=utf-8');
    expect(await result.text()).toBe('hello world');
  });

  it('rejects malformed Data URLs', () => {
    expect(() => dataUrlToBlob('not-a-data-url')).toThrow('无效的 Data URL');
  });
});

describe('favicon and ID photo conversion', () => {
  it('keeps source bytes intact for local Base64 conversion', async () => {
    const source = makeFile('photo.jpeg', 'image/jpeg');
    const [output] = await imageToBase64Processor.process(
      [source],
      {},
      { preview: false, signal: new AbortController().signal },
    );

    expect(output.name).toBe('photo-base64.jpg');
    expect(output.blob).toBe(source);
  });

  it('generates every selected favicon size as a matching PNG asset', async () => {
    const canvases = installCanvasHarness(512, 256);

    const outputs = await faviconImageProcessor.process(
      [makeFile('brand.logo.webp', 'image/webp')],
      { sizes: [16, 32, 180] },
      { preview: false, signal: new AbortController().signal },
    );

    expect(faviconImageProcessor.mode).toBe('per-file');
    expect(outputs.map((output) => output.name)).toEqual([
      'brand.logo-favicon-16x16.png',
      'brand.logo-favicon-32x32.png',
      'brand.logo-favicon-180x180.png',
    ]);
    expect(outputs.every((output) => output.blob.type === 'image/png')).toBe(true);
    expect(outputs.map(({ width, height }) => [width, height])).toEqual([
      [16, 16],
      [32, 32],
      [180, 180],
    ]);
    expect(canvases).toHaveLength(3);
  });

  it('checks cancellation between favicon sizes', async () => {
    const controller = new AbortController();
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 256,
      height: 256,
      close: vi.fn(),
    })));
    let canvasCount = 0;
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        canvasCount += 1;
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({
            drawImage: vi.fn(),
            fillRect: vi.fn(),
            fillStyle: '',
          })),
          toBlob: vi.fn((callback: BlobCallback, mime?: string) => {
            if (canvasCount === 1) controller.abort();
            callback(new Blob(['rendered'], { type: mime }));
          }),
        };
      }),
    });

    await expect(faviconImageProcessor.process(
      [makeFile()],
      { sizes: [16, 32] },
      { preview: false, signal: controller.signal },
    )).rejects.toMatchObject({ name: 'AbortError' });
    expect(canvasCount).toBe(1);
  });

  it('converts millimetres and DPI using physical inch units', () => {
    expect(millimetersToPixels(25, 300)).toBe(295);
    expect(millimetersToPixels(35, 300)).toBe(413);
    expect(pixelsToMillimeters(295, 300)).toBeCloseTo(24.98, 2);
  });

  it('renders ID photos at mm/DPI dimensions and exports white-backed JPEG', async () => {
    const canvases = installCanvasHarness(1200, 800);

    const [output] = await idPhotoImageProcessor.process(
      [makeFile('person.transparent.png')],
      { widthMm: 25, heightMm: 35, dpi: 300, quality: 0.9 },
      { preview: false, signal: new AbortController().signal },
    );

    expect(output.name).toBe('person.transparent-id-photo.jpg');
    expect(output.blob.type).toBe('image/jpeg');
    expect(output).toMatchObject({ width: 295, height: 413 });
    expect(canvases[0].context.fillStyle).toBe('#ffffff');
    expect(canvases[0].context.fillRect).toHaveBeenCalledWith(0, 0, 295, 413);
  });
});
