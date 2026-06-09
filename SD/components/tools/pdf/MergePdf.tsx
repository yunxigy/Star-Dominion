import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';


const MergePdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, removeFile, clearFiles, triggerUpload, inputProps, handleFiles } = useFileUpload('.pdf');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const handleMerge = async () => {
    if (files.length < 2) { setStatus('请至少上传两个PDF文件'); return; }
    setLoading(true);
    setStatus('正在合并...');
    try {
      const output = new jsPDF();
      let firstPage = true;
      for (let i = 0; i < files.length; i++) {
        setStatus(`正在处理第 ${i + 1}/${files.length} 个文件: ${files[i].name}`);
        const buf = await files[i].arrayBuffer();
        const doc = await pdfjsLib.getDocument({ data: buf }).promise;
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvas, viewport }).promise;
          const imgData = canvas.toDataURL('image/jpeg', 0.92);
          const w = page.getViewport({ scale: 1 }).width;
          const h = page.getViewport({ scale: 1 }).height;
          const orient = w > h ? 'landscape' as const : 'portrait' as const;
          if (firstPage) {
            output.deletePage(1);
            output.addPage([w, h], orient);
            firstPage = false;
          } else {
            output.addPage([w, h], orient);
          }
          output.addImage(imgData, 'JPEG', 0, 0, w, h);
        }
      }
      output.save('merged.pdf');
      setStatus('合并完成，已下载 merged.pdf');
    } catch (err: any) {
      setStatus(`合并失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传多个PDF文件，按上传顺序合并为一个PDF。</p>
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".pdf" label="点击或拖拽上传PDF文件" sublabel="支持多个文件" />
      ) : (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
              <span className="text-sm text-slate-200 truncate">{i + 1}. {f.name} ({(f.size / 1024).toFixed(1)} KB)</span>
              <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-300 text-xs ml-2">移除</button>
            </div>
          ))}
          <div className="flex gap-2">
            <Btn onClick={triggerUpload} variant="ghost">继续添加</Btn>
            <Btn onClick={clearFiles} variant="ghost">清空</Btn>
          </div>
        </div>
      )}
      <Btn onClick={handleMerge} disabled={files.length < 2 || loading}>
        {loading ? '合并中...' : `合并 ${files.length} 个文件`}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default MergePdf;
