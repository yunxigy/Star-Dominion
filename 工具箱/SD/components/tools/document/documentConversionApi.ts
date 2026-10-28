export type DocumentConversionTarget = 'pdf-to-word-image' | 'office-to-pdf' | 'pdf-table-to-xlsx' | 'markdown-to-docx' | 'html-to-docx' | 'scan-to-docx';
export type DocumentCapability = Record<'libreoffice' | 'pdf' | 'pdf_tables' | 'ocr', boolean>;
export type DocumentConversionTargetMeta = { value: DocumentConversionTarget; label: string; detail: string; accept: string; capability?: keyof DocumentCapability };

export const DOCUMENT_CONVERSION_TARGETS: DocumentConversionTargetMeta[] = [
  { value: 'pdf-to-word-image', label: 'PDF → Word（图片版）', detail: '每页 PDF 渲染为高清图片写入 DOCX，版式稳定但文字不可编辑', accept: '.pdf', capability: 'pdf' },
  { value: 'office-to-pdf', label: 'Word / Excel / PPT → PDF', detail: '服务器 LibreOffice 真实转换，保留 Office 页面布局', accept: '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp', capability: 'libreoffice' },
  { value: 'pdf-table-to-xlsx', label: 'PDF 表格 → Excel', detail: '按页面和表格写入 XLSX，可在 Excel 中继续编辑', accept: '.pdf', capability: 'pdf_tables' },
  { value: 'markdown-to-docx', label: 'Markdown → Word', detail: '转换标题、段落、列表、引用、代码、图片和表格', accept: '.md,.markdown' },
  { value: 'html-to-docx', label: 'HTML → Word', detail: '转换常见 HTML 结构，并过滤脚本内容', accept: '.html,.htm' },
  { value: 'scan-to-docx', label: '图片 / 扫描件 → 可编辑 Word', detail: 'OCR 生成可编辑段落，同时保留原始页面图片', accept: '.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.pdf', capability: 'ocr' },
];

const API = '/document-api';
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function getResponseFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) { try { return decodeURIComponent(encoded); } catch { /* use the plain fallback below */ } }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1] || fallback;
}

export async function loadDocumentCapabilities(): Promise<DocumentCapability> {
  const response = await fetch(`${API}/api/v1/capabilities`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error('文档转换服务未连接');
  const payload = await response.json() as { dependencies?: DocumentCapability };
  return payload.dependencies ?? { libreoffice: false, pdf: false, pdf_tables: false, ocr: false };
}

export async function convertDocument(files: File[], target: DocumentConversionTarget): Promise<{ blob: Blob; filename: string }> {
  if (!files.length) throw new Error('请先上传文件');
  const oversized = files.find((file) => file.size > MAX_FILE_BYTES);
  if (oversized) throw new Error(`文件“${oversized.name}”超过 50 MB 限制`);
  const form = new FormData(); form.append('target', target);
  const endpoint = files.length > 1 ? `${API}/api/v1/convert/batch` : `${API}/api/v1/convert`;
  if (files.length > 1) files.forEach((file) => form.append('files', file, file.name));
  else form.append('file', files[0], files[0].name);
  const response = await fetch(endpoint, { method: 'POST', body: form, credentials: 'same-origin' });
  if (!response.ok) {
    let message = `转换失败（HTTP ${response.status}）`;
    try { message = (await response.json() as { detail?: string; message?: string }).detail || message; } catch { /* stable fallback */ }
    throw new Error(message);
  }
  return { blob: await response.blob(), filename: getResponseFilename(response, files.length > 1 ? 'document-conversion-results.zip' : `${files[0].name}.converted`) };
}
