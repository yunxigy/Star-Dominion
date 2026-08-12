import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileArchive, FileText, RefreshCw, Server, UploadCloud } from 'lucide-react';
import { Btn, UploadZone, formatFileSize } from '../shared';

type Target =
  | 'pdf-to-word-image'
  | 'office-to-pdf'
  | 'pdf-table-to-xlsx'
  | 'markdown-to-docx'
  | 'html-to-docx'
  | 'scan-to-docx';

type Capability = Record<'libreoffice' | 'pdf' | 'pdf_tables' | 'ocr', boolean>;

const TARGETS: Array<{
  value: Target;
  label: string;
  detail: string;
  accept: string;
  capability?: keyof Capability;
}> = [
  { value: 'pdf-to-word-image', label: 'PDF → Word（图片版）', detail: '每页 PDF 渲染为高清图片写入 DOCX，版式稳定但文字不可编辑', accept: '.pdf', capability: 'pdf' },
  { value: 'office-to-pdf', label: 'Word / Excel / PPT → PDF', detail: '服务器 LibreOffice 真实转换，保留 Office 页面布局', accept: '.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.odp', capability: 'libreoffice' },
  { value: 'pdf-table-to-xlsx', label: 'PDF 表格 → Excel', detail: '按页面和表格写入 XLSX，可在 Excel 中继续编辑', accept: '.pdf', capability: 'pdf_tables' },
  { value: 'markdown-to-docx', label: 'Markdown → Word', detail: '转换标题、段落、列表、引用、代码、图片和表格', accept: '.md,.markdown' },
  { value: 'html-to-docx', label: 'HTML → Word', detail: '转换常见 HTML 结构，并过滤脚本内容', accept: '.html,.htm' },
  { value: 'scan-to-docx', label: '图片 / 扫描件 → 可编辑 Word', detail: 'OCR 生成可编辑段落，同时保留原始页面图片', accept: '.png,.jpg,.jpeg,.tif,.tiff,.bmp,.webp,.pdf', capability: 'ocr' },
];

const API = '/document-api';

function getFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get('content-disposition') || '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const plain = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || fallback;
}

const DocumentConversionCenter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState<Target>('office-to-pdf');
  const [files, setFiles] = useState<File[]>([]);
  const [capabilities, setCapabilities] = useState<Capability | null>(null);
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = useMemo(() => TARGETS.find(item => item.value === target)!, [target]);

  const loadCapabilities = useCallback(async () => {
    try {
      const response = await fetch(`${API}/api/v1/capabilities`);
      if (!response.ok) throw new Error('service unavailable');
      const payload = await response.json() as { dependencies: Capability };
      setCapabilities(payload.dependencies);
      setServiceOnline(true);
    } catch {
      setServiceOnline(false);
      setCapabilities(null);
    }
  }, []);

  useEffect(() => { void loadCapabilities(); }, [loadCapabilities]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setError('');
    setFiles(prev => [...prev, ...Array.from(list)]);
  };

  const removeFile = (index: number) => setFiles(prev => prev.filter((_, itemIndex) => itemIndex !== index));

  const convert = async () => {
    if (!files.length) { setError('请先上传文件'); return; }
    setBusy(true);
    setError('');
    setStatus(files.length > 1 ? `正在转换 ${files.length} 个文件并打包...` : '正在转换，请稍候...');
    try {
      const form = new FormData();
      form.append('target', target);
      const endpoint = files.length > 1 ? `${API}/api/v1/convert/batch` : `${API}/api/v1/convert`;
      if (files.length > 1) files.forEach(file => form.append('files', file, file.name));
      else form.append('file', files[0], files[0].name);
      const response = await fetch(endpoint, { method: 'POST', body: form });
      if (!response.ok) {
        let message = `转换失败（HTTP ${response.status}）`;
        try { message = (await response.json() as { detail?: string }).detail || message; } catch { /* non-JSON error */ }
        throw new Error(message);
      }
      const blob = await response.blob();
      const filename = getFilename(response, files.length > 1 ? 'document-conversion-results.zip' : `${files[0].name}.converted`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(`转换完成：${filename}`);
    } catch (conversionError) {
      setStatus('');
      setError(conversionError instanceof Error ? conversionError.message : '转换失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const capabilityReady = serviceOnline === true && (!selected.capability || capabilities?.[selected.capability] === true);

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[#d8b58e] bg-[#fff8ef] p-4">
        <div className="flex items-start gap-3">
          <FileArchive className="mt-0.5 h-5 w-5 text-[#9a5a28]" />
          <div>
            <h2 className="text-base font-semibold text-[#5f3214]">真实文档转换中心</h2>
            <p className="mt-1 text-sm leading-6 text-[#6d5a47]">文件会发送到本站转换服务处理。服务不保存文件；Office 转 PDF 依赖 LibreOffice，扫描件转 Word 依赖 Tesseract OCR。</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {TARGETS.map(item => (
          <button
            key={item.value}
            type="button"
            onClick={() => { setTarget(item.value); setFiles([]); setError(''); setStatus(''); }}
            className={`rounded-xl border p-3 text-left transition-colors ${target === item.value ? 'border-[#9a5a28] bg-[#f1dcc2]' : 'border-[#d8b58e] bg-white hover:bg-[#fff4e6]'}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="text-sm font-semibold text-[#5f3214]">{item.label}</span>
              {item.capability && capabilities && (capabilities[item.capability] ? <CheckCircle2 className="h-4 w-4 text-[#5f6f42]" /> : <AlertTriangle className="h-4 w-4 text-[#b45309]" />)}
            </div>
            <span className="mt-1 block text-xs leading-5 text-[#8b735c]">{item.detail}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#ead0ad] bg-[#fff4e6] px-3 py-2 text-xs text-[#6d5a47]">
        <span className="flex items-center gap-1.5"><Server className="h-3.5 w-3.5" />转换服务：{serviceOnline === null ? '检测中' : serviceOnline ? '在线' : '未连接'}</span>
        <button type="button" onClick={() => void loadCapabilities()} className="flex items-center gap-1 text-[#7a421b] hover:underline"><RefreshCw className="h-3.5 w-3.5" />重新检测</button>
      </div>

      {!capabilityReady && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          当前服务器尚未提供此转换所需依赖。请先安装服务端依赖，页面不会生成伪造文件。
        </div>
      )}

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={addFiles} accept={selected.accept} label="拖拽或点击上传文档" sublabel={`当前支持：${selected.accept.replace(/,/g, '、')}；单文件不超过 50 MB`} />
      <input ref={inputRef} type="file" multiple className="hidden" accept={selected.accept} onChange={event => { addFiles(event.target.files); event.currentTarget.value = ''; }} />

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm text-[#6d5a47]"><span>已选择 {files.length} 个文件</span><button type="button" onClick={() => setFiles([])} className="text-xs text-red-600 hover:underline">清空</button></div>
          {files.map((file, index) => (
            <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-lg border border-[#ead0ad] bg-white px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-[#9a5a28]" />
              <span className="min-w-0 flex-1 truncate text-sm text-[#5f3214]">{file.name}</span>
              <span className="text-xs text-[#8b735c]">{formatFileSize(file.size)}</span>
              <button type="button" onClick={() => removeFile(index)} className="text-xs text-red-600 hover:underline">移除</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={convert} disabled={busy || !files.length || !capabilityReady}><UploadCloud className="mr-1 inline h-4 w-4" />{busy ? '转换中...' : files.length > 1 ? '批量转换并下载 ZIP' : '开始转换并下载'}</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {status && <p className="flex items-center gap-2 text-sm text-[#5f6f42]"><Download className="h-4 w-4" />{status}</p>}
      {error && <p className="flex items-start gap-2 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
    </div>
  );
};

export default DocumentConversionCenter;
