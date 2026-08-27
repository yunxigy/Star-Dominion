import { describe, expect, it, vi } from 'vitest';
import { extractPdfLinks, renderPdfToLongImage } from './render';

describe('PDF render adapters', () => {
  it('extracts only safe HTTP links and de-duplicates them', async () => {
    const destroy = vi.fn();
    vi.doMock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 1, getPage: async () => ({ getAnnotations: async () => [{ subtype: 'Link', url: 'https://example.com', title: 'Example' }, { subtype: 'Link', url: 'https://example.com', title: 'Example' }, { subtype: 'Link', url: 'javascript:alert(1)' }, { subtype: 'Link', url: 'file:///tmp/a' }] }), destroy }) }) }));
    const links = await extractPdfLinks(new Uint8Array([1, 2]));
    expect(links).toEqual([{ page: 1, text: 'Example', url: 'https://example.com/' }]);
    vi.doUnmock('pdfjs-dist');
  });
  it('rejects an oversized composed canvas before allocation', async () => {
    vi.doMock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve({ numPages: 2, getPage: async () => ({ getViewport: () => ({ width: 10_000, height: 10_000 }) }), destroy: vi.fn() }) }) }));
    await expect(renderPdfToLongImage(new Uint8Array([1]), { maxPixels: 100 })).rejects.toThrow('PDF 页面过多或尺寸过大');
    vi.doUnmock('pdfjs-dist');
  });
});
