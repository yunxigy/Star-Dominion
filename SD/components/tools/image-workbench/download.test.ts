import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputAsset } from './types';
import {
  buildOutputName,
  buildZipBlob,
  dedupeOutputNames,
  downloadBlob,
  downloadOutput,
  downloadOutputsAsZip,
} from './download';

afterEach(() => {
  vi.unstubAllGlobals();
});

function output(id: string, name: string, contents = id): OutputAsset {
  return {
    id,
    name,
    blob: new Blob([contents], { type: 'image/png' }),
    url: `blob:${id}`,
  };
}

function installDownloadDom() {
  const anchor = {
    href: '',
    download: '',
    click: vi.fn(),
  };
  const createElement = vi.fn((tag: string) => {
    expect(tag).toBe('a');
    return anchor;
  });
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:download');
  const revokeObjectURL = vi.fn();

  vi.stubGlobal('document', { createElement });
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

  return { anchor, createElement, createObjectURL, revokeObjectURL };
}

describe('output naming', () => {
  it('replaces the source extension with a normalized output extension', () => {
    expect(buildOutputName('photo.jpeg', '-compressed', 'webp'))
      .toBe('photo-compressed.webp');
    expect(buildOutputName('archive.photo.png', '-small', '.jpg'))
      .toBe('archive.photo-small.jpg');
    expect(buildOutputName('untitled', '-edited', 'png'))
      .toBe('untitled-edited.png');
  });

  it('adds -2 and -3 before the extension for repeated names', () => {
    const named = dedupeOutputNames([
      output('1', 'result.png'),
      output('2', 'result.png'),
      output('3', 'result.png'),
    ]);

    expect(named.map((item) => item.downloadName)).toEqual([
      'result.png',
      'result-2.png',
      'result-3.png',
    ]);
  });

  it('avoids collisions with names that already contain a numeric suffix', () => {
    const named = dedupeOutputNames([
      output('1', 'result.png'),
      output('2', 'result.png'),
      output('3', 'result-2.png'),
      output('4', 'RESULT.PNG'),
    ]);

    expect(named.map((item) => item.downloadName)).toEqual([
      'result.png',
      'result-2.png',
      'result-2-2.png',
      'RESULT-3.PNG',
    ]);
  });

  it('does not depend on locale-sensitive lowercasing', () => {
    const localeLowerCase = vi.spyOn(String.prototype, 'toLocaleLowerCase')
      .mockImplementation(() => {
        throw new Error('locale-sensitive casing must not be used');
      });

    try {
      const named = dedupeOutputNames([
        output('1', 'Result.png'),
        output('2', 'RESULT.PNG'),
      ]);
      expect(named.map((item) => item.downloadName))
        .toEqual(['Result.png', 'RESULT-2.PNG']);
    } finally {
      localeLowerCase.mockRestore();
    }
  });
});

describe('browser downloads', () => {
  it('keeps the object URL alive through click and revokes it on a later task', async () => {
    const dom = installDownloadDom();
    const blob = new Blob(['file']);
    dom.anchor.click.mockImplementation(() => {
      expect(dom.revokeObjectURL).not.toHaveBeenCalled();
    });

    downloadBlob(blob, 'photo.png');

    expect(dom.createObjectURL).toHaveBeenCalledWith(blob);
    expect(dom.anchor.href).toBe('blob:download');
    expect(dom.anchor.download).toBe('photo.png');
    expect(dom.anchor.click).toHaveBeenCalledOnce();
    expect(dom.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('does not swallow a click error and still revokes the URL later', async () => {
    const dom = installDownloadDom();
    const failure = new Error('click blocked');
    dom.anchor.click.mockImplementation(() => {
      throw failure;
    });

    expect(() => downloadBlob(new Blob(), 'photo.png')).toThrow(failure);
    expect(dom.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('downloads one output with its output name', async () => {
    const dom = installDownloadDom();
    const item = output('single', 'single-result.webp');

    downloadOutput(item);

    expect(dom.createObjectURL).toHaveBeenCalledWith(item.blob);
    expect(dom.anchor.download).toBe('single-result.webp');
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('zip downloads', () => {
  it('creates an application/zip archive containing every deduplicated output', async () => {
    const zipBlob = await buildZipBlob([
      output('1', 'a.png', 'first'),
      output('2', 'a.png', 'second'),
    ]);

    expect(zipBlob.type).toBe('application/zip');
    expect(zipBlob.size).toBeGreaterThan(0);

    const archive = await JSZip.loadAsync(await zipBlob.arrayBuffer());
    expect(Object.keys(archive.files).sort()).toEqual(['a-2.png', 'a.png']);
    await expect(archive.file('a.png')?.async('string')).resolves.toBe('first');
    await expect(archive.file('a-2.png')?.async('string')).resolves.toBe('second');
  });

  it('converts each input at most once in Node and lets JSZip create the final Blob', async () => {
    vi.stubGlobal('FileReader', undefined);
    const first = output('1', 'a.png', 'first');
    const second = output('2', 'b.png', 'second');
    const firstRead = vi.spyOn(first.blob, 'arrayBuffer');
    const secondRead = vi.spyOn(second.blob, 'arrayBuffer');

    const zipBlob = await buildZipBlob([first, second]);

    expect(zipBlob).toBeInstanceOf(Blob);
    expect(firstRead).toHaveBeenCalledOnce();
    expect(secondRead).toHaveBeenCalledOnce();

    const source = readFileSync(new URL('./download.ts', import.meta.url), 'utf8');
    expect(source).toContain("generateAsync({ type: 'blob', mimeType: 'application/zip' })");
    expect(source).not.toContain('new Uint8Array(bytes.byteLength)');
    expect(source).not.toContain('return new Blob([blobBytes.buffer]');
  });

  it('builds the zip only when the zip download function is invoked', async () => {
    const dom = installDownloadDom();
    const outputs = [output('1', 'a.png', 'first')];

    expect(dom.createObjectURL).not.toHaveBeenCalled();
    await downloadOutputsAsZip(outputs, 'processed-images.zip');

    expect(dom.createObjectURL).toHaveBeenCalledOnce();
    const downloadedBlob = dom.createObjectURL.mock.calls[0][0] as Blob;
    expect(downloadedBlob.type).toBe('application/zip');
    expect(dom.anchor.download).toBe('processed-images.zip');
    expect(dom.revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dom.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });
});
