export type PdfLink = { page: number; text: string; url: string };
export type LongImageOptions = { dpi?: number; gap?: number; maxWidth?: number; maxPixels?: number };

type PdfJsDocument = { numPages: number; getPage: (page: number) => Promise<any>; destroy: () => Promise<void> | void };

async function loadPdfDocument(input: Uint8Array): Promise<PdfJsDocument> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
  return pdfjs.getDocument({ data: input.slice() }).promise as Promise<PdfJsDocument>;
}

export async function extractPdfLinks(input: Uint8Array): Promise<PdfLink[]> {
  const document = await loadPdfDocument(input);
  const links: PdfLink[] = [];
  const seen = new Set<string>();
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const annotations = await page.getAnnotations();
      for (const annotation of annotations ?? []) {
        if (annotation.subtype !== 'Link' || typeof annotation.url !== 'string') continue;
        let parsed: URL;
        try { parsed = new URL(annotation.url); } catch { continue; }
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
        const link = { page: pageNumber, text: String(annotation.title || annotation.contents || ''), url: parsed.toString() };
        const key = `${link.page}|${link.url}|${link.text}`;
        if (!seen.has(key)) { seen.add(key); links.push(link); }
      }
    }
    return links;
  } finally {
    await document.destroy();
  }
}

export async function renderPdfToLongImage(input: Uint8Array, options: LongImageOptions = {}): Promise<Blob> {
  const dpi = Math.min(300, Math.max(36, options.dpi ?? 144));
  const gap = Math.max(0, Math.min(128, options.gap ?? 16));
  const maxWidth = Math.max(320, Math.min(2400, options.maxWidth ?? 2400));
  const maxPixels = options.maxPixels ?? 60_000_000;
  const document = await loadPdfDocument(input);
  try {
    const pages: Array<{ page: any; width: number; height: number }> = [];
    const baseScale = dpi / 72;
    let width = 0;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const baseViewport = page.getViewport({ scale: baseScale });
      width = Math.max(width, baseViewport.width);
      pages.push({ page, width: baseViewport.width, height: baseViewport.height });
    }
    const scaleFactor = width > maxWidth ? maxWidth / width : 1;
    const dimensions = pages.map((item) => ({ ...item, width: Math.max(1, Math.round(item.width * scaleFactor)), height: Math.max(1, Math.round(item.height * scaleFactor)) }));
    const outputWidth = Math.max(1, Math.ceil(Math.max(...dimensions.map((item) => item.width))));
    const outputHeight = dimensions.reduce((sum, item) => sum + item.height, 0) + gap * Math.max(0, dimensions.length - 1);
    if (outputWidth * outputHeight > maxPixels) throw new Error('PDF 页面过多或尺寸过大，请降低清晰度');
    const output = documentForCanvas().createElement('canvas') as HTMLCanvasElement;
    output.width = outputWidth; output.height = outputHeight;
    const context = output.getContext('2d');
    if (!context) throw new Error('浏览器不支持 Canvas');
    context.fillStyle = '#ffffff'; context.fillRect(0, 0, outputWidth, outputHeight);
    let y = 0;
    for (const item of dimensions) {
      const canvas = documentForCanvas().createElement('canvas') as HTMLCanvasElement;
      canvas.width = item.width; canvas.height = item.height;
      const viewport = item.page.getViewport({ scale: baseScale * scaleFactor });
      await item.page.render({ canvasContext: canvas.getContext('2d'), canvas, viewport }).promise;
      context.drawImage(canvas, Math.round((outputWidth - item.width) / 2), y, item.width, item.height);
      y += item.height + gap;
    }
    return new Promise((resolve, reject) => output.toBlob((blob) => blob ? resolve(blob) : reject(new Error('无法生成 PNG 图片')), 'image/png'));
  } finally {
    await document.destroy();
  }
}

function documentForCanvas(): Document {
  if (typeof document === 'undefined') throw new Error('当前环境不支持 Canvas');
  return document;
}
