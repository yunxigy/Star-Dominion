import mammoth from 'mammoth';
import { parse as parseYaml } from 'yaml';

export interface InvoiceFields {
  invoiceNumber?: string;
  date?: string;
  amount?: string;
  tax?: string;
}

function normalizeMoney(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/,/g, '').trim();
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount.toFixed(2) : undefined;
}

export function parseInvoiceText(text: string): InvoiceFields {
  const normalized = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
  const invoiceNumber = normalized.match(
    /(?:发票号码|票据号码|发票号)\s*[：:]?\s*([0-9]{8,20})/i,
  )?.[1];
  const dateMatch = normalized.match(
    /(?:开票日期|日期)\s*[：:]?\s*(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?/,
  );
  const amountMatch = normalized.match(
    /(?:价税合计(?:（小写）|\(小写\))?|合计金额|总金额)\s*[：:]?\s*[¥￥]?\s*([0-9][0-9,.]*)/i,
  );
  const taxMatch = normalized.match(
    /(?:税额)\s*[：:]?\s*[¥￥]?\s*([0-9][0-9,.]*)/i,
  );

  return {
    invoiceNumber,
    date: dateMatch
      ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}`
      : undefined,
    amount: normalizeMoney(amountMatch?.[1]),
    tax: normalizeMoney(taxMatch?.[1]),
  };
}

export function parseOpenApiDocument(
  content: string,
  fileName = 'openapi.json',
): Record<string, any> {
  const lowerName = fileName.toLowerCase();
  const parsed = lowerName.endsWith('.yaml') || lowerName.endsWith('.yml')
    ? parseYaml(content)
    : JSON.parse(content);

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenAPI 文档根节点必须是对象');
  }
  if (!('openapi' in parsed) && !('swagger' in parsed)) {
    throw new Error('缺少 openapi 或 swagger 版本字段');
  }
  return parsed as Record<string, any>;
}

export async function extractContractText(
  fileName: string,
  source: ArrayBuffer,
): Promise<string> {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.docx')) {
    const nodeBuffer = (globalThis as any).Buffer;
    const input = nodeBuffer
      ? { buffer: nodeBuffer.from(source) }
      : { arrayBuffer: source };
    const result = await mammoth.extractRawText(input as any);
    return result.value.trim();
  }
  if (lowerName.endsWith('.txt') || lowerName.endsWith('.md')) {
    return new TextDecoder('utf-8').decode(source).trim();
  }
  throw new Error('仅支持 TXT、Markdown 和 DOCX 文件');
}

export interface SupportedDocumentFile {
  name: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
  text: () => Promise<string>;
}

export interface LocalOcrOptions {
  workerPath: string;
  corePath: string;
  langPath: string;
  gzip: false;
  cacheMethod: 'none';
}

export function localOcrOptions(): LocalOcrOptions {
  return {
    workerPath: '/assets/worker.min.js',
    corePath: '/assets/tesseract-core-lstm.wasm.js',
    langPath: '/assets/tessdata',
    gzip: false,
    cacheMethod: 'none',
  };
}

export type ImplementedScanMode = 'auto-crop' | 'de-shadow' | 'enhance-bw';

export function getImplementedScanModes(): ImplementedScanMode[] {
  return ['auto-crop', 'de-shadow', 'enhance-bw'];
}

export type SupportedPrivacyTarget = 'image-exif' | 'pdf-meta' | 'file-timestamp';

export function getSupportedPrivacyTargets(): SupportedPrivacyTarget[] {
  return ['image-exif', 'pdf-meta', 'file-timestamp'];
}

export async function readSupportedDocumentText(file: SupportedDocumentFile): Promise<string> {
  if (file.name.toLowerCase().endsWith('.docx')) {
    return extractContractText(file.name, await file.arrayBuffer());
  }
  return (await file.text()).trim();
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function summarizePdfExtraction(text: string, pageCount: number): string {
  const content = text.replace(/--- 第 \d+ 页 ---/g, '').trim();
  if (!content) return `未检测到可复制的文字层（共 ${pageCount} 页），这通常是扫描 PDF，请使用“可搜索 PDF OCR”工具`;
  return `提取完成，共 ${content.length} 个字符`;
}

export function resolveOcrPageRange(
  pageCount: number,
  startPage = 1,
  endPage = pageCount,
): number[] {
  const safeCount = Math.max(0, Math.floor(pageCount));
  if (safeCount === 0) return [];
  const start = Math.min(safeCount, Math.max(1, Math.floor(startPage)));
  const end = Math.min(safeCount, Math.max(start, Math.floor(endPage)));
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
