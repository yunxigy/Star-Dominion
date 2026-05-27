import React, { useState } from 'react';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn } from '../shared';

const ImageToPdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, removeFile, clearFiles, triggerUpload, inputProps, handleFiles } = useFileUpload('image/*');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageSize, setPageSize] = useState<'a4' | 'fit'>('a4');

  const loadImageEl = (file: File): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });

  const handleConvert = async () => {
    if (files.length === 0) { setStatus('请先上传图片'); return; }
    setLoading(true);
    setStatus('正在转换...');
    try {
      const output = new jsPDF();
      output.deletePage(1);
      for (let i = 0; i < files.length; i++) {
        setStatus(`正在处理第 ${i + 1}/${files.length} 张图片...`);
        const img = await loadImageEl(files[i]);
        const imgW = img.naturalWidth;
        const imgH = img.naturalHeight;
        if (pageSize === 'a4') {
          const pageW = 210;
          const pageH = 297;
          const ratio = Math.min(pageW / imgW, pageH / imgH);
          const w = imgW * ratio;
          const h = imgH * ratio;
          const x = (pageW - w) / 2;
          const y = (pageH - h) / 2;
          output.addPage('a4', 'portrait');
          output.addImage(img.src, 'JPEG', x, y, w, h);
        } else {
          const unit = 0.264583;
          const w = imgW * unit;
          const h = imgH * unit;
          output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
          output.addImage(img.src, 'JPEG', 0, 0, w, h);
        }
        URL.revokeObjectURL(img.src);
      }
      output.save('images.pdf');
      setStatus('转换完成，已下载 images.pdf');
    } catch (err: any) {
      setStatus(`转换失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传多张图片，合并为一个PDF文件。</p>
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="点击上传图片" sublabel="支持 JPG、PNG 等格式" />
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
      <div>
        <p className="text-xs text-slate-500 mb-2">页面大小</p>
        <div className="flex gap-2">
          <Btn onClick={() => setPageSize('a4')} variant={pageSize === 'a4' ? 'primary' : 'ghost'}>A4</Btn>
          <Btn onClick={() => setPageSize('fit')} variant={pageSize === 'fit' ? 'primary' : 'ghost'}>自适应图片</Btn>
        </div>
      </div>
      <Btn onClick={handleConvert} disabled={files.length === 0 || loading}>
        {loading ? '转换中...' : `转换 ${files.length} 张图片`}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default ImageToPdf;
