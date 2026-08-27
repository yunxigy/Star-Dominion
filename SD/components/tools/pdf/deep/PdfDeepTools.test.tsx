// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PdfCropTool, PdfLinkExtractorTool, PdfLongImageTool, PdfMetadataTool, PdfPageNumbersTool, PdfPageSizeTool, PdfReorderTool, PdfToWordTool } from './PdfDeepTools';

describe('PDF deep tool route exports', () => {
  it('exports eight named tools with privacy-aware shell copy', () => {
    const tools = [PdfPageNumbersTool, PdfCropTool, PdfPageSizeTool, PdfReorderTool, PdfLongImageTool, PdfMetadataTool, PdfLinkExtractorTool, PdfToWordTool];
    tools.forEach((Tool) => { const { unmount } = render(<Tool onClose={() => undefined} />); expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy(); unmount(); });
  });
  it('discloses the PDF-to-Word image-based server conversion', () => { render(<PdfToWordTool onClose={() => undefined} />); expect(screen.getByText(/图片版 Word/)).toBeTruthy(); expect(screen.getByText(/会上传到本站文档转换服务/)).toBeTruthy(); });
});
