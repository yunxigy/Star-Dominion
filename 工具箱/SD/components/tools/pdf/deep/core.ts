import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

export async function reorderPdfPages(input: Uint8Array, order: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(input, { updateMetadata: false });
  const count = source.getPageCount();
  const valid = order.length === count && new Set(order).size === count && order.every((index) => Number.isInteger(index) && index >= 0 && index < count);
  if (!valid) throw new Error('页面顺序必须包含每一页且不能重复');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach((page: any) => output.addPage(page));
  return output.save();
}

export type PageNumberOptions = {
  start: number;
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  fontSize: number;
  marginMm: number;
  selectedPages?: number[];
};

const mmToPoints = (value: number) => value * 72 / 25.4;
const assertPageIndexes = (indexes: number[] | undefined, count: number) => {
  if (!indexes) return Array.from({ length: count }, (_, index) => index);
  if (new Set(indexes).size !== indexes.length || indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= count)) throw new Error('页面选择无效');
  return indexes;
};

export async function addPdfPageNumbers(input: Uint8Array, options: PageNumberOptions): Promise<Uint8Array> {
  if (!Number.isInteger(options.start) || options.start < 1) throw new Error('起始页码必须是正整数');
  if (!Number.isFinite(options.fontSize) || options.fontSize < 6 || options.fontSize > 72) throw new Error('字号必须在 6 到 72 之间');
  if (!Number.isFinite(options.marginMm) || options.marginMm < 0 || options.marginMm > 50) throw new Error('边距必须在 0 到 50 毫米之间');
  const document = await PDFDocument.load(input, { updateMetadata: false });
  const pages = document.getPages();
  const selected = new Set(assertPageIndexes(options.selectedPages, pages.length));
  const font = await document.embedFont(StandardFonts.Helvetica);
  const margin = mmToPoints(options.marginMm);
  pages.forEach((page: any, index: number) => {
    if (!selected.has(index)) return;
    const label = String(options.start + index);
    const width = page.getWidth();
    const height = page.getHeight();
    const textWidth = font.widthOfTextAtSize(label, options.fontSize);
    const horizontal = options.position.endsWith('left') ? margin : options.position.endsWith('right') ? width - margin - textWidth : (width - textWidth) / 2;
    const vertical = options.position.startsWith('top') ? height - margin - options.fontSize : margin;
    page.drawText(label, { x: Math.max(0, horizontal), y: Math.max(0, vertical), size: options.fontSize, font });
  });
  return document.save();
}

export type CropMarginsMm = { top: number; right: number; bottom: number; left: number };

export async function cropPdfPages(input: Uint8Array, margins: CropMarginsMm): Promise<Uint8Array> {
  if (Object.values(margins).some((value) => !Number.isFinite(value) || value < 0)) throw new Error('裁剪边距不能为负数');
  const document = await PDFDocument.load(input, { updateMetadata: false });
  document.getPages().forEach((page: any) => {
    const box = page.getCropBox ? page.getCropBox() : page.getMediaBox();
    const top = mmToPoints(margins.top); const right = mmToPoints(margins.right); const bottom = mmToPoints(margins.bottom); const left = mmToPoints(margins.left);
    const width = box.width - left - right; const height = box.height - top - bottom;
    if (width < 1 || height < 1) throw new Error('裁剪边距过大，页面没有剩余空间');
    page.setCropBox(box.x + left, box.y + bottom, width, height);
  });
  return document.save();
}

export type PageSizePreset = 'A4' | 'A3' | 'Letter' | 'Legal';
export type ResizeOptions = { preset?: PageSizePreset; widthMm?: number; heightMm?: number; orientation?: 'portrait' | 'landscape' };

const PRESETS: Record<PageSizePreset, [number, number]> = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };

export async function resizePdfPages(input: Uint8Array, options: ResizeOptions = {}): Promise<Uint8Array> {
  let [widthMm, heightMm] = options.preset ? PRESETS[options.preset] : [options.widthMm ?? 210, options.heightMm ?? 297];
  if (!Number.isFinite(widthMm) || !Number.isFinite(heightMm) || widthMm < 10 || heightMm < 10 || widthMm > 2000 || heightMm > 2000) throw new Error('页面尺寸必须在 10 到 2000 毫米之间');
  if (options.orientation === 'landscape' && widthMm < heightMm) [widthMm, heightMm] = [heightMm, widthMm];
  if (options.orientation === 'portrait' && widthMm > heightMm) [widthMm, heightMm] = [heightMm, widthMm];
  const source = await PDFDocument.load(input, { updateMetadata: false });
  const output = await PDFDocument.create();
  const targetWidth = mmToPoints(widthMm); const targetHeight = mmToPoints(heightMm);
  const sourcePages = source.getPages();
  const copiedPages = await output.copyPages(source, sourcePages.map((_: any, index: number) => index));
  copiedPages.forEach((page: any, index: number) => {
    const sourcePage: any = sourcePages[index];
    const sourceWidth = sourcePage.getWidth(); const sourceHeight = sourcePage.getHeight();
    const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
    page.setSize(targetWidth, targetHeight);
    page.scaleContent(scale, scale);
    page.translateContent((targetWidth - sourceWidth * scale) / 2, (targetHeight - sourceHeight * scale) / 2);
    output.addPage(page);
  });
  return output.save();
}

export type PdfMetadata = { title: string; author: string; subject: string; keywords: string[]; creator: string; producer: string; creationDate: string | null; modificationDate: string | null };

export async function readPdfMetadata(input: Uint8Array): Promise<PdfMetadata> {
  const document = await PDFDocument.load(input, { updateMetadata: false });
  return {
    title: document.getTitle() ?? '', author: document.getAuthor() ?? '', subject: document.getSubject() ?? '', keywords: (document.getKeywords() ?? '').split(/[ ,]+/u).filter(Boolean), creator: document.getCreator() ?? '', producer: document.getProducer() ?? '',
    creationDate: document.getCreationDate()?.toISOString() ?? null, modificationDate: document.getModificationDate()?.toISOString() ?? null,
  };
}

export async function clearPdfMetadata(input: Uint8Array, options: { clearDates?: boolean } = {}): Promise<Uint8Array> {
  const document = await PDFDocument.load(input, { updateMetadata: false });
  document.setTitle(''); document.setAuthor(''); document.setSubject(''); document.setKeywords([]); document.setCreator('逐梦工具箱'); document.setProducer('逐梦工具箱');
  if (options.clearDates) { const epoch = new Date(0); document.setCreationDate(epoch); document.setModificationDate(epoch); }
  return document.save();
}

export { degrees };
