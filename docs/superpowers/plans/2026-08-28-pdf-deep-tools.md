# PDF Deep Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight explicit PDF search routes for page numbers, crop, resize, reorder, long image, metadata, links, and PDF-to-Word while reusing existing PDF/document infrastructure.

**Architecture:** Put byte-level PDF operations in pure async functions around `pdf-lib`, keep rendering/link extraction in a focused `pdfjs-dist` adapter, and expose route-specific UIs through shared upload/result components. Seven tools remain local; PDF-to-Word is a thin, honest route over the existing `/document-api` image-based Word conversion and preserves its upload disclosure.

**Tech Stack:** React 18, TypeScript, pdf-lib, pdfjs-dist, JSZip, Vitest, Testing Library, existing document-converter API

---

## File map

- Create `SD/components/tools/pdf/deep/core.ts`: page numbers, crop, resize, reorder, and metadata operations.
- Create `SD/components/tools/pdf/deep/core.test.ts`: generated-fixture PDF tests.
- Create `SD/components/tools/pdf/deep/render.ts`: page rendering, long-image composition, and link extraction.
- Create `SD/components/tools/pdf/deep/render.test.ts`: mocked pdfjs/canvas tests.
- Create `SD/components/tools/pdf/deep/download.ts`: safe blob download helper.
- Create `SD/components/tools/pdf/deep/PdfToolShell.tsx`: shared local PDF upload/status shell.
- Create `SD/components/tools/pdf/deep/PdfDeepTools.tsx`: eight named route components.
- Create `SD/components/tools/pdf/deep/PdfDeepTools.test.tsx`: representative UI tests.
- Modify `SD/components/tools/pdf/PdfPageEditor.tsx`: use shared reorder core where behavior overlaps.
- Modify `SD/components/tools/document/DocumentConversionCenter.tsx`: export typed conversion helper/target metadata without changing existing UI behavior.
- Create `SD/components/tools/document/documentConversionApi.ts`: shared conversion request and filename handling.
- Create `SD/components/tools/document/documentConversionApi.test.ts`: PDF-to-Word response/error tests.
- Modify `SD/tools/registry.tsx`: eight PDF routes.
- Modify `SD/seo/categoryContent.ts`: mention deeper PDF operations without changing category identity.
- Modify `SD/tools/registryMetadata.test.ts`: registration/privacy contract.

### Task 1: Add PDF fixture helpers and page reordering

**Files:**
- Create: `SD/components/tools/pdf/deep/core.ts`
- Create: `SD/components/tools/pdf/deep/core.test.ts`

- [ ] **Step 1: Write the failing reorder tests**

```ts
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { reorderPdfPages } from './core';

async function fixturePdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage([200, 300]);
  document.addPage([300, 400]);
  document.addPage([400, 500]);
  return document.save();
}

describe('reorderPdfPages', () => {
  it('copies pages in the exact requested order', async () => {
    const output = await reorderPdfPages(await fixturePdf(), [2, 0, 1]);
    const document = await PDFDocument.load(output);
    expect(document.getPages().map(page => page.getWidth())).toEqual([400, 200, 300]);
  });

  it('rejects duplicate, missing, and out-of-range page indexes', async () => {
    await expect(reorderPdfPages(await fixturePdf(), [0, 0, 2])).rejects.toThrow('页面顺序必须包含每一页且不能重复');
    await expect(reorderPdfPages(await fixturePdf(), [0, 1])).rejects.toThrow('页面顺序必须包含每一页且不能重复');
    await expect(reorderPdfPages(await fixturePdf(), [0, 1, 3])).rejects.toThrow('页面顺序必须包含每一页且不能重复');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: FAIL because `core.ts` does not exist.

- [ ] **Step 3: Implement reordering**

```ts
import { PDFDocument } from 'pdf-lib';

export async function reorderPdfPages(input: Uint8Array, order: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(input);
  const count = source.getPageCount();
  const valid = order.length === count && new Set(order).size === count && order.every(index => Number.isInteger(index) && index >= 0 && index < count);
  if (!valid) throw new Error('页面顺序必须包含每一页且不能重复');
  const output = await PDFDocument.create();
  const pages = await output.copyPages(source, order);
  pages.forEach(page => output.addPage(page));
  return output.save();
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/pdf/deep/core.ts SD/components/tools/pdf/deep/core.test.ts
git commit -m "feat: add tested PDF page reordering core"
```

### Task 2: Add page numbers and crop boxes

**Files:**
- Modify: `SD/components/tools/pdf/deep/core.ts`
- Modify: `SD/components/tools/pdf/deep/core.test.ts`

- [ ] **Step 1: Write failing page-number and crop tests**

Generate a two-page fixture. Assert `addPdfPageNumbers` preserves page count and adds a content stream to every selected page; assert start number and `top-left`/`bottom-center` positions are accepted. Assert `cropPdfPages` sets crop boxes using millimetres converted by `72 / 25.4`, rejects negative margins, and rejects margins that remove the full page.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: FAIL because the new functions do not exist.

- [ ] **Step 3: Implement page numbering**

```ts
export type PageNumberOptions = {
  start: number;
  position: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  fontSize: number;
  marginMm: number;
  selectedPages?: number[];
};
```

Load with `PDFDocument`, embed `StandardFonts.Helvetica`, validate positive integer start, font size `6..72`, margin `0..50`, and selected zero-based indexes. Draw ASCII page numbers with `page.drawText`; compute horizontal alignment from `font.widthOfTextAtSize` and vertical placement from page height/margin.

- [ ] **Step 4: Implement crop boxes**

```ts
export type CropMarginsMm = { top: number; right: number; bottom: number; left: number };
```

For every page, convert margins to points, read existing crop box or media size, calculate the remaining rectangle, require width/height at least 1 point, then call `page.setCropBox(x + left, y + bottom, width - left - right, height - top - bottom)`.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/components/tools/pdf/deep/core.ts SD/components/tools/pdf/deep/core.test.ts
git commit -m "feat: add PDF page numbers and crop operations"
```

### Task 3: Add page resize and metadata operations

**Files:**
- Modify: `SD/components/tools/pdf/deep/core.ts`
- Modify: `SD/components/tools/pdf/deep/core.test.ts`

- [ ] **Step 1: Write failing resize and metadata tests**

Assert `resizePdfPages` outputs A4 portrait dimensions within 0.1 points and preserves page count. Assert custom dimensions reject zero/negative/out-of-range values. Create metadata fixture with title, author, subject, keywords, creator, and producer; assert `readPdfMetadata` returns values and `clearPdfMetadata` returns a PDF whose user-controlled fields are empty.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: FAIL because resize/metadata functions do not exist.

- [ ] **Step 3: Implement page resizing with content preservation**

Define presets A4 `210×297`, A3 `297×420`, Letter `215.9×279.4`, and Legal `215.9×355.6` millimetres. Create a new document, embed each source page, add a target-size page, calculate `scale = Math.min(targetWidth/sourceWidth, targetHeight/sourceHeight)`, center the embedded page, and draw it. Accept custom width/height from `10..2000` mm and portrait/landscape orientation.

- [ ] **Step 4: Implement metadata read/clear**

Return title, author, subject, keywords, creator, producer, creationDate, and modificationDate as strings. Clear user-controlled string fields with the documented pdf-lib setters and set creator/producer to `逐梦工具箱`; preserve page content and dates unless the user selects a `clearDates` option.

- [ ] **Step 5: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/pdf/deep/core.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/components/tools/pdf/deep/core.ts SD/components/tools/pdf/deep/core.test.ts
git commit -m "feat: add PDF resize and metadata operations"
```

### Task 4: Add long-image rendering and link extraction

**Files:**
- Create: `SD/components/tools/pdf/deep/render.ts`
- Create: `SD/components/tools/pdf/deep/render.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Mock `pdfjs-dist` document/page objects and canvas factories. Assert `extractPdfLinks` filters annotations with a safe HTTP(S) URL, returns page number/link text/URL, removes duplicates, and ignores `javascript:`, `file:`, and missing URLs. Assert `renderPdfToLongImage` renders pages in order, limits scale to keep width at or below 2400px, adds configurable 16px gaps, rejects a final canvas above 60 million pixels, and returns a PNG blob.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/pdf/deep/render.test.ts`

Expected: FAIL because `render.ts` does not exist.

- [ ] **Step 3: Implement PDF.js document loading**

Import `pdfjs-dist` dynamically, configure the worker using the project's existing PDF worker pattern, pass a copied `Uint8Array`, and always call `document.destroy()` in `finally`.

- [ ] **Step 4: Implement link extraction**

For every page call `getAnnotations()`, accept annotations whose `subtype === 'Link'` and whose `url` parses as HTTP(S), return `{ page: pageNumber, text: annotation.title || annotation.contents || '', url }`, and stable-deduplicate by `page|url|text`.

- [ ] **Step 5: Implement long-image composition**

Render each page to a temporary canvas at a scale bounded by requested DPI and 2400px width. Calculate total height before allocating the output canvas; reject more than 60 million pixels with `PDF 页面过多或尺寸过大，请降低清晰度`. Fill the output white, draw every page centered with 16px gaps, then resolve `canvas.toBlob(..., 'image/png')` and reject null blobs.

- [ ] **Step 6: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/pdf/deep/render.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add SD/components/tools/pdf/deep/render.ts SD/components/tools/pdf/deep/render.test.ts
git commit -m "feat: render PDF long images and extract links"
```

### Task 5: Extract the existing document conversion API

**Files:**
- Create: `SD/components/tools/document/documentConversionApi.ts`
- Create: `SD/components/tools/document/documentConversionApi.test.ts`
- Modify: `SD/components/tools/document/DocumentConversionCenter.tsx`

- [ ] **Step 1: Write the failing PDF-to-Word request tests**

Mock `fetch`. Assert `convertDocument([file], 'pdf-to-word-image')` posts to `/document-api/api/v1/convert`, includes target/file in FormData, returns blob plus RFC 5987 decoded filename, maps JSON `detail` errors, and rejects files over 50 MiB before requesting.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/document/documentConversionApi.test.ts`

Expected: FAIL because the API module does not exist.

- [ ] **Step 3: Implement the shared conversion API**

Export `DocumentConversionTarget`, `DOCUMENT_CONVERSION_TARGETS`, `getResponseFilename`, `loadDocumentCapabilities`, and `convertDocument`. Preserve the current `/document-api` endpoints, multi-file behavior, and stable error strings. Use `credentials: 'same-origin'` and no manually set multipart content type.

- [ ] **Step 4: Refactor the conversion center**

Replace its local `Target`, `TARGETS`, filename parser, capability fetch, and conversion fetch with imports from the new module. Preserve rendered labels and behavior exactly.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/document/documentConversionApi.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/components/tools/document/documentConversionApi.ts SD/components/tools/document/documentConversionApi.test.ts SD/components/tools/document/DocumentConversionCenter.tsx
git commit -m "refactor: share document conversion API"
```

### Task 6: Build the shared PDF shell and eight UIs

**Files:**
- Create: `SD/components/tools/pdf/deep/download.ts`
- Create: `SD/components/tools/pdf/deep/PdfToolShell.tsx`
- Create: `SD/components/tools/pdf/deep/PdfDeepTools.tsx`
- Create: `SD/components/tools/pdf/deep/PdfDeepTools.test.tsx`
- Modify: `SD/components/tools/pdf/PdfPageEditor.tsx`

- [ ] **Step 1: Write failing representative UI tests**

Render `PdfPageNumbersTool`, upload an in-memory PDF, select bottom-center/start 5, process, and assert a Download result. Render `PdfMetadataTool`, upload a metadata fixture, assert title/author appear, clear metadata, and assert a downloadable result. Render `PdfToWordTool`, assert the visible notice says the file uploads to the site service and the output is image-based rather than editable text.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/pdf/deep/PdfDeepTools.test.tsx`

Expected: FAIL because UI modules do not exist.

- [ ] **Step 3: Implement the shared shell and download helper**

`PdfToolShell` accepts title, description, maxBytes default 100 MiB, one PDF file, loading/error/result state, and control children. Validate MIME or `.pdf`, display local/upload privacy notice supplied by the route, and never read the file before validation. `downloadBlob` creates, clicks, and revokes an object URL.

- [ ] **Step 4: Implement eight named exports**

Create `PdfPageNumbersTool`, `PdfCropTool`, `PdfPageSizeTool`, `PdfReorderTool`, `PdfLongImageTool`, `PdfMetadataTool`, `PdfLinkExtractorTool`, and `PdfToWordTool`. Wire the first seven to local core/render functions. Reorder uses an accessible ordered page list with move-up/down buttons and calls `reorderPdfPages`; refactor `PdfPageEditor` to import that core rather than duplicate copy-order code. PDF-to-Word calls `convertDocument([file], 'pdf-to-word-image')`, shows service capabilities, and uses `privacy="backend-upload"` wording.

- [ ] **Step 5: Run UI tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/pdf/deep/PdfDeepTools.test.tsx components/tools/document/documentConversionApi.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add SD/components/tools/pdf/deep SD/components/tools/pdf/PdfPageEditor.tsx
git commit -m "feat: add PDF deep-tools interfaces"
```

### Task 7: Register eight PDF routes

**Files:**
- Modify: `SD/tools/registry.tsx`
- Modify: `SD/seo/categoryContent.ts`
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Add the failing registry contract**

Assert PDF contains these IDs: `pdf-page-numbers`, `pdf-crop-pages`, `pdf-page-size`, `pdf-reorder-pages`, `pdf-to-long-image`, `pdf-metadata`, `pdf-link-extractor`, and `pdf-to-word`. Assert the first seven are local/stable and `pdf-to-word` is `backend-upload`/stable.

- [ ] **Step 2: Run the registry test and verify RED**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts`

Expected: FAIL because the routes are absent.

- [ ] **Step 3: Add named lazy imports and definitions**

Import each named export through `React.lazy(() => import('../components/tools/pdf/deep/PdfDeepTools').then(module => ({ default: module.PdfPageNumbersTool })))`, using the corresponding export for all eight. Register unique Chinese names/descriptions, PDF category, red/rose visual tokens, explicit privacy/status, and Chinese/pinyin/English intent tags.

- [ ] **Step 4: Update PDF category content**

Change the PDF description to mention page numbers, crop, page size, ordering, long images, metadata and links. Add FAQ explaining that PDF-to-Word uploads to the document conversion service and produces an image-based DOCX; keep local-tool privacy wording accurate.

- [ ] **Step 5: Run registry, SEO, and generated-route tests**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts seo/categoryContent.test.ts seo/pageMetadata.test.ts scripts/generate-static-pages.test.ts`

Expected: PASS.

- [ ] **Step 6: Build generated PDF routes**

Run: `cd SD && npm run build`

Expected: exit 0 and all eight `dist/tool/<id>/index.html` pages exist.

- [ ] **Step 7: Commit**

```bash
git add SD/tools/registry.tsx SD/seo/categoryContent.ts SD/tools/registryMetadata.test.ts SD/public/sitemap.xml
git commit -m "feat: register PDF deep tools"
```

### Task 8: Full PDF verification

**Files:**
- Modify: `SD/components/tools/pdf/deep/core.ts`
- Modify: `SD/components/tools/pdf/deep/render.ts`
- Modify: `SD/components/tools/pdf/deep/PdfToolShell.tsx`
- Modify: `SD/components/tools/pdf/deep/PdfDeepTools.tsx`
- Modify: `SD/components/tools/document/documentConversionApi.ts`
- Modify: `SD/tools/registry.tsx`

- [ ] **Step 1: Run all PDF/document tests**

Run: `cd SD && npm test -- components/tools/pdf components/tools/document/documentConversionApi.test.ts`

Expected: all tests pass.

- [ ] **Step 2: Run complete frontend verification**

Run: `cd SD && npm test && npm run lint && npm run validate && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Browser-check representative tools**

At desktop and 390×844 widths, verify `/tool/pdf-page-numbers`, `/tool/pdf-reorder-pages`, `/tool/pdf-to-long-image`, `/tool/pdf-metadata`, `/tool/pdf-link-extractor`, and `/tool/pdf-to-word`. Confirm no footer obstruction, local/upload notices are correct, errors are actionable, and downloads have `.pdf`, `.png`, `.txt`/`.csv`, or `.docx` names as appropriate.

- [ ] **Step 4: Verify files with independent readers**

Load generated PDFs back through `PDFDocument.load`, decode the PNG dimensions through the browser, parse extracted link JSON/CSV, and open the PDF-to-Word response using the existing document-converter test fixture. Reject any output that is only renamed source bytes.

- [ ] **Step 5: Commit concrete verification fixes**

```bash
git add SD/components/tools/pdf SD/components/tools/document SD/tools/registry.tsx SD/seo/categoryContent.ts SD/public/sitemap.xml
git commit -m "fix: resolve PDF deep-tools verification findings"
```

Do not create an empty commit when no fixes were required.
