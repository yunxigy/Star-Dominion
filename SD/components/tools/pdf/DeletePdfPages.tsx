import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn, TextInput } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

function parseDeletePages(input: string, max: number): Set<number> {
  const result = new Set<number>();
  input.split(',').forEach(part => {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [a, b] = trimmed.split('-').map(Number);
      const start = Math.max(1, Math.min(a, max));
      const end = Math.max(1, Math.min(b, max));
      for (let i = start; i <= end; i++) result.add(i);
    } else {
      const n = Number(trimmed);
      if (n >= 1 && n <= max) result.add(n);
    }
  });
  return result;
}

const DeletePdfPages: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps, handleFiles } = useFileUpload('.pdf');
  const [deleteText, setDeleteText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  const file = files[0];

  React.useEffect(() => {
    if (file) {
      file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: buf }).promise).then(doc => setPageCount(doc.numPages));
    }
  }, [file]);

  const handleDelete = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    if (!deleteText.trim()) { setStatus('请输入要删除的页码'); return; }
    const toDelete = parseDeletePages(deleteText, pageCount);
    if (toDelete.size === 0) { setStatus('页码格式无效'); return; }
    if (toDelete.size >= pageCount) { setStatus('不能删除所有页面'); return; }
    setLoading(true);
    setStatus('正在处理...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const output = new jsPDF();
      output.deletePage(1);
      let kept = 0;
      for (let p = 1; p <= doc.numPages; p++) {
        if (toDelete.has(p)) continue;
        kept++;
        setStatus(`正在处理第 ${p} 页...`);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const vp1 = page.getViewport({ scale: 1 });
        const w = vp1.width;
        const h = vp1.height;
        output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
        output.addImage(imgData, 'JPEG', 0, 0, w, h);
      }
      output.save(`deleted_${file.name}`);
      setStatus(`完成，已删除 ${toDelete.size} 页，保留 ${kept} 页`);
    } catch (err: any) {
      setStatus(`处理失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const parsedPages = deleteText.trim() ? Array.from(parseDeletePages(deleteText, pageCount)) : [];

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，指定要删除的页码。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name}</span>
          {pageCount > 0 && <span className="text-xs text-slate-500 ml-2">共 {pageCount} 页</span>}
        </div>
      )}
      <div>
        <TextInput value={deleteText} onChange={setDeleteText} placeholder="输入要删除的页码，如: 1,3,5-7" />
        {parsedPages.length > 0 && (
          <p className="text-xs text-slate-500 mt-1">将删除第 {parsedPages.sort((a, b) => a - b).join(', ')} 页</p>
        )}
      </div>
      <Btn onClick={handleDelete} disabled={!file || loading || !deleteText.trim()}>
        {loading ? '处理中...' : '删除页面并下载'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default DeletePdfPages;
