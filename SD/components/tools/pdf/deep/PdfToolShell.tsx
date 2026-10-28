import React, { useRef, useState } from 'react';
import { Btn, UploadZone, formatFileSize } from '../../shared';
import { downloadBlob } from './download';

export type PdfToolResult = { blob?: Blob; filename?: string; text?: string };
export type PdfToolShellProps = { title: string; description: string; privacy?: 'local' | 'backend-upload'; maxBytes?: number; onProcess: (file: File) => Promise<PdfToolResult>; onFileChange?: (file: File) => void; children?: React.ReactNode; onClose: () => void };

export const PdfToolShell: React.FC<PdfToolShellProps> = ({ title, description, privacy = 'local', maxBytes = 100 * 1024 * 1024, onProcess, onFileChange, children, onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<PdfToolResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const acceptFile = (candidate: File | undefined) => {
    if (!candidate) return;
    if (candidate.type !== 'application/pdf' && !/\.pdf$/i.test(candidate.name)) { setError('请选择 PDF 文件'); return; }
    if (candidate.size > maxBytes) { setError(`文件超过 ${formatFileSize(maxBytes)} 限制`); return; }
    setError(''); setResult(null); setStatus(''); setFile(candidate); onFileChange?.(candidate);
  };
  const run = async () => {
    if (!file) { setError('请先上传 PDF 文件'); return; }
    setBusy(true); setError(''); setStatus('');
    try { const next = await onProcess(file); setResult(next); setStatus(next.blob ? '处理完成，可下载结果' : '处理完成'); } catch (processingError) { setResult(null); setError(processingError instanceof Error ? processingError.message : 'PDF 处理失败'); } finally { setBusy(false); }
  };
  return <div className="space-y-5"><div><h2 className="text-lg font-semibold text-[#5f3214]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#6d5a47]">{description}</p><p className={`mt-1 text-xs ${privacy === 'local' ? 'text-[#5f6f42]' : 'text-[#9a5a28]'}`}>{privacy === 'local' ? '本地处理：PDF 不会上传。' : '服务端处理：PDF 会上传到本站文档转换服务，生成图片版 Word。'}</p></div>{!file ? <><UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={(files) => acceptFile(files[0])} accept=".pdf,application/pdf" label="拖拽或点击上传 PDF" sublabel={`单文件不超过 ${formatFileSize(maxBytes)}`} /><input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" onChange={(event) => { acceptFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></> : <div className="flex items-center gap-3 rounded-lg border border-[#ead0ad] bg-[#fff4e6] px-3 py-2"><span className="min-w-0 flex-1 truncate text-sm text-[#5f3214]">{file.name}</span><span className="text-xs text-[#8b735c]">{formatFileSize(file.size)}</span><button type="button" className="text-xs text-red-700 hover:underline" onClick={() => { setFile(null); setResult(null); setStatus(''); }}>重新选择</button></div>}{children && <div className="rounded-lg border border-[#ead0ad] bg-[#fff8ef] p-3">{children}</div>}<div className="flex flex-wrap gap-2"><Btn onClick={() => { void run(); }} disabled={busy || !file}>{busy ? '处理中…' : '开始处理'}</Btn>{result?.blob && <Btn onClick={() => downloadBlob(result.blob!, result.filename || 'result.pdf')} variant="secondary">下载结果</Btn>}<Btn onClick={onClose} variant="ghost">关闭</Btn></div>{result?.text && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-[#d8b58e] bg-[#fff4e6] p-3 text-sm text-[#2f241b]">{result.text}</pre>}{status && <p role="status" className="text-sm text-[#5f6f42]">{status}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}</div>;
};

export default PdfToolShell;
