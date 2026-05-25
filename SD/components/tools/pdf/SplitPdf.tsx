import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn, TextInput } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type SplitMode = 'single' | 'range';

function parseRanges(input: string, max: number): number[][] {
  return input.split(',').map(part => {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number);
      const start = Math.max(1, Math.min(a, max));
      const end = Math.max(1, Math.min(b, max));
      return Array.from({ length: end - start + 1 }, (_, i) => start + i);
    }
    const n = Number(trimmed);
    return n >= 1 && n <= max ? [n] : [];
  }).filter(r => r.length > 0);
}

const SplitPdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.pdf');
  const [mode, setMode] = useState<SplitMode>('single');
  const [rangeText, setRangeText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  const file = files[0];

  const loadPageCount = async (f: File) => {
    const buf = await f.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf }).promise;
    setPageCount(doc.numPages);
  };

  React.useEffect(() => { if (file) loadPageCount(file); }, [file]);

  const renderPageToCanvas = async (doc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return canvas;
  };

  const addPageToPdf = (output: jsPDF, canvas: HTMLCanvasElement, page: pdfjsLib.PDFPageProxy) => {
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const vp = page.getViewport({ scale: 1 });
    const w = vp.width;
    const h = vp.height;
    output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
    output.addImage(imgData, 'JPEG', 0, 0, w, h);
  };

  const handleSplit = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    setLoading(true);
    setStatus('正在拆分...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      if (mode === 'single') {
        for (let p = 1; p <= doc.numPages; p++) {
          setStatus(`正在处理第 ${p}/${doc.numPages} 页...`);
          const page = await doc.getPage(p);
          const canvas = await renderPageToCanvas(doc, p);
          const output = new jsPDF();
          output.deletePage(1);
          addPageToPdf(output, canvas, page);
          output.save(`page_${p}.pdf`);
        }
        setStatus(`拆分完成，共 ${doc.numPages} 个文件`);
      } else {
        const ranges = parseRanges(rangeText, doc.numPages);
        for (let r = 0; r < ranges.length; r++) {
          const pages = ranges[r];
          setStatus(`正在处理范围 ${r + 1}/${ranges.length}...`);
          const output = new jsPDF();
          output.deletePage(1);
          for (const p of pages) {
            const page = await doc.getPage(p);
            const canvas = await renderPageToCanvas(doc, p);
            addPageToPdf(output, canvas, page);
          }
          output.save(`range_${r + 1}.pdf`);
        }
        setStatus(`拆分完成，共 ${ranges.length} 个文件`);
      }
    } catch (err: any) {
      setStatus(`拆分失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，选择拆分方式。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
          {pageCount > 0 && <span className="text-xs text-slate-500 ml-2">共 {pageCount} 页</span>}
        </div>
      )}
      <div className="flex gap-2">
        <Btn onClick={() => setMode('single')} variant={mode === 'single' ? 'primary' : 'ghost'}>逐页拆分</Btn>
        <Btn onClick={() => setMode('range')} variant={mode === 'range' ? 'primary' : 'ghost'}>按范围拆分</Btn>
      </div>
      {mode === 'range' && (
        <div>
          <TextInput value={rangeText} onChange={setRangeText} placeholder="输入页码范围，如: 1-3,5,7-10" />
          <p className="text-xs text-slate-500 mt-1">用逗号分隔多个范围，用连字符表示连续页</p>
        </div>
      )}
      <Btn onClick={handleSplit} disabled={!file || loading || (mode === 'range' && !rangeText.trim())}>
        {loading ? '拆分中...' : '开始拆分'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default SplitPdf;
