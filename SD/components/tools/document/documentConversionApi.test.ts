// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { convertDocument, getResponseFilename } from './documentConversionApi';

describe('document conversion API', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('posts the target and file and decodes RFC 5987 filenames', async () => {
    const file = new File(['pdf'], 'source.pdf', { type: 'application/pdf' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('result', { status: 200, headers: { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent('结果.docx')}` } })));
    const result = await convertDocument([file], 'pdf-to-word-image');
    expect(result.filename).toBe('结果.docx');
    const request = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(request.method).toBe('POST');
    expect(request.body).toBeInstanceOf(FormData);
    expect((request.body as FormData).get('target')).toBe('pdf-to-word-image');
    expect((request.body as FormData).get('file')).toMatchObject({ name: 'source.pdf' });
  });
  it('rejects oversized files before requesting', async () => {
    const file = new File(['x'], 'large.pdf'); Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(convertDocument([file], 'pdf-to-word-image')).rejects.toThrow('超过 50 MB');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('falls back when a response filename is not provided', () => { expect(getResponseFilename(new Response(''), 'fallback.docx')).toBe('fallback.docx'); });
});
