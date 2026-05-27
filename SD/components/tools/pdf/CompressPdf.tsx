import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const QUALITY_OPTIONS = [
  { label: '低压缩 (高质量)', scale: 1.2, quality: 0.85 },
  { label: '中等压缩', scale: 0.8, quality: 0.65 },
  { label: '高压缩 (低质量)', scale: 0.5, quality: 0.45 },
];

const CompressPdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps, handleFiles } = useFileUpload('.pdf');
  const [level, setLevel] = useState(1);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ before: number; after: number } | null>(null);

  const file = files[0];

  const handleCompress = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    setLoading(true);
    setResult(null);
    setStatus('正在压缩...');
    try {
      const { scale, quality } = QUALITY_OPTIONS[level];
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const output = new jsPDF();
      output.deletePage(1);
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在压缩第 ${p}/${doc.numPages} 页...`);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        await page.render({ canvas, viewport }).promise;
        const imgData = canvas.toDataURL('image/jpeg', quality);
        const vp1 = page.getViewport({ scale: 1 });
        const w = vp1.width;
        const h = vp1.height;
        output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
        output.addImage(imgData, 'JPEG', 0, 0, w, h);
      }
      const blob = output.output('blob');
      const afterSize = blob.size;
      setResult({ before: file.size, after: afterSize });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `compressed_${file.name}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus('压缩完成，文件已下载');
    } catch (err: any) {
      setStatus(`压缩失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，降低图片分辨率进行压缩。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
        </div>
      )}
      <div>
        <p className="text-xs text-slate-500 mb-2">压缩级别</p>
        <div className="flex gap-2">
          {QUALITY_OPTIONS.map((opt, i) => (
            <Btn key={i} onClick={() => setLevel(i)} variant={level === i ? 'primary' : 'ghost'}>
              {opt.label}
            </Btn>
          ))}
        </div>
      </div>
      <Btn onClick={handleCompress} disabled={!file || loading}>
        {loading ? '压缩中...' : '开始压缩'}
      </Btn>
      {result && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm">
          <div className="flex justify-between"><span className="text-slate-400">原始大小</span><span className="text-slate-200">{(result.before / 1024).toFixed(1)} KB</span></div>
          <div className="flex justify-between"><span className="text-slate-400">压缩后</span><span className="text-slate-200">{(result.after / 1024).toFixed(1)} KB</span></div>
          <div className="flex justify-between"><span className="text-slate-400">压缩率</span><span className="text-green-400">{((1 - result.after / result.before) * 100).toFixed(1)}%</span></div>
        </div>
      )}
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default CompressPdf;
