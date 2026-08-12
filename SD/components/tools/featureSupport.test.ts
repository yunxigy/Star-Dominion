import JSZip from 'jszip';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  extractContractText,
  getImplementedScanModes,
  getSupportedPrivacyTargets,
  parseInvoiceText,
  parseOpenApiDocument,
  localOcrOptions,
  readSupportedDocumentText,
  resolveOcrPageRange,
  summarizePdfExtraction,
  withTimeout,
} from './featureSupport';

async function createMinimalDocx(text: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '</Types>',
  );
  zip.folder('_rels')?.file(
    '.rels',
    '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>',
  );
  zip.folder('word')?.file(
    'document.xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>` +
      '</w:document>',
  );
  return zip.generateAsync({ type: 'arraybuffer' });
}

describe('professional tool feature support', () => {
  it('extracts meaningful fields from Chinese invoice OCR text', () => {
    const parsed = parseInvoiceText(`
      增值税电子普通发票
      发票号码：12345678
      开票日期：2026年07月26日
      税额：¥113.27
      价税合计（小写）：¥1,234.56
    `);

    expect(parsed.invoiceNumber).toBe('12345678');
    expect(parsed.date).toBe('2026-07-26');
    expect(parsed.tax).toBe('113.27');
    expect(parsed.amount).toBe('1234.56');
  });

  it('parses YAML OpenAPI documents instead of rejecting them', () => {
    const parsed = parseOpenApiDocument(
      `
openapi: 3.0.3
info:
  title: Demo API
  version: 1.0.0
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
`,
      'openapi.yaml',
    );

    expect(parsed.openapi).toBe('3.0.3');
    expect(parsed.info.title).toBe('Demo API');
    expect(parsed.paths['/health'].get).toBeDefined();
  });

  it('extracts actual text from DOCX contract files', async () => {
    const buffer = await createMinimalDocx('合同付款与违约责任');
    const text = await extractContractText('contract.docx', buffer);

    expect(text).toContain('合同付款与违约责任');
  });

  it('uses the DOCX parser for real uploaded Office files instead of binary file.text()', async () => {
    const source = await readFile(resolve(process.cwd(), '../ceshi/01.docx'));
    const arrayBuffer = source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) as ArrayBuffer;
    const text = await readSupportedDocumentText({
      name: '01.docx',
      arrayBuffer: async () => arrayBuffer,
      text: async () => 'PK binary should never be used',
    });

    expect(text).toContain('初代玩法设计文档');
    expect(text).not.toContain('PK binary');
  });

  it('processes the requested PDF page range without a hidden five-page cap', () => {
    expect(resolveOcrPageRange(12, 1, 12)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(resolveOcrPageRange(12, 4, 6)).toEqual([4, 5, 6]);
  });

  it('fails a stalled OCR job with a user-visible timeout instead of waiting forever', async () => {
    await expect(withTimeout(new Promise<string>(() => undefined), 5, 'OCR 超时')).rejects.toThrow('OCR 超时');
  });

  it('identifies scanned PDFs when the text layer is empty', () => {
    expect(summarizePdfExtraction('--- 第 1 页 ---\n\n--- 第 2 页 ---\n', 2)).toContain('扫描');
    expect(summarizePdfExtraction('--- 第 1 页 ---\n合同正文', 1)).toContain('提取完成');
  });

  it('uses bundled OCR assets instead of a network CDN', () => {
    expect(localOcrOptions()).toMatchObject({
      workerPath: '/assets/worker.min.js',
      corePath: '/assets/tesseract-core-lstm.wasm.js',
      langPath: '/assets/tessdata',
      gzip: false,
    });
  });

  it('exposes only scan modes that have a real implementation', () => {
    expect(getImplementedScanModes()).toEqual(['auto-crop', 'de-shadow', 'enhance-bw']);
    expect(getImplementedScanModes()).not.toContain('perspective');
    expect(getImplementedScanModes()).not.toContain('multi-pdf');
  });

  it('exposes only privacy targets that can be completed in the browser', () => {
    expect(getSupportedPrivacyTargets()).toEqual(['image-exif', 'pdf-meta', 'file-timestamp']);
    expect(getSupportedPrivacyTargets()).not.toContain('office-meta');
  });
});
