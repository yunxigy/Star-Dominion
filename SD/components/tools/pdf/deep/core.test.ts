import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { addPdfPageNumbers, clearPdfMetadata, cropPdfPages, readPdfMetadata, reorderPdfPages, resizePdfPages } from './core';

async function fixturePdf(): Promise<Uint8Array> { const document = await PDFDocument.create(); document.addPage([200, 300]); document.addPage([300, 400]); document.addPage([400, 500]); document.setTitle('Fixture'); document.setAuthor('Author'); return document.save(); }

describe('reorderPdfPages', () => {
  it('copies pages in the exact requested order', async () => { const output = await reorderPdfPages(await fixturePdf(), [2, 0, 1]); const document = await PDFDocument.load(output); expect(document.getPages().map((page: any) => page.getWidth())).toEqual([400, 200, 300]); });
  it('rejects duplicate, missing, and out-of-range indexes', async () => { await expect(reorderPdfPages(await fixturePdf(), [0, 0, 2])).rejects.toThrow('页面顺序必须包含每一页且不能重复'); await expect(reorderPdfPages(await fixturePdf(), [0, 1])).rejects.toThrow('页面顺序必须包含每一页且不能重复'); await expect(reorderPdfPages(await fixturePdf(), [0, 1, 3])).rejects.toThrow('页面顺序必须包含每一页且不能重复'); });
});

describe('PDF page operations', () => {
  it('adds page numbers, crops and resizes pages', async () => {
    const source = await fixturePdf();
    const numbered = await addPdfPageNumbers(source, { start: 5, position: 'bottom-center', fontSize: 12, marginMm: 10 });
    expect((await PDFDocument.load(numbered)).getPageCount()).toBe(3);
    const cropped = await cropPdfPages(source, { top: 10, right: 10, bottom: 10, left: 10 });
    expect((await PDFDocument.load(cropped)).getPages()[0].getCropBox().width).toBeLessThan(200);
    const resized = await resizePdfPages(source, { preset: 'A4', orientation: 'portrait' });
    expect((await PDFDocument.load(resized)).getPages()[0].getWidth()).toBeCloseTo(210 * 72 / 25.4, 1);
  });
  it('reads and clears user metadata', async () => { const source = await fixturePdf(); expect(await readPdfMetadata(source)).toMatchObject({ title: 'Fixture', author: 'Author' }); const cleared = await clearPdfMetadata(source); expect(await readPdfMetadata(cleared)).toMatchObject({ title: '', author: '', subject: '', keywords: [], creator: '逐梦工具箱', producer: '逐梦工具箱' }); });
});
