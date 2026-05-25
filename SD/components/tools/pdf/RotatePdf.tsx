import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const RotatePdf: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.pdf');
  const [angle, setAngle] = useState<90 | 180 | 270>(90);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const file = files[0];

  const handleRotate = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    setLoading(true);
    setStatus('正在旋转...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const output = new jsPDF();
      output.deletePage(1);
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在处理第 ${p}/${doc.numPages} 页...`);
        const page = await doc.getPage(p);
        const baseVp = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        if (angle === 90 || angle === 270) {
          canvas.width = baseVp.height;
          canvas.height = baseVp.width;
        } else {
          canvas.width = baseVp.width;
          canvas.height = baseVp.height;
        }
        const ctx = canvas.getContext('2d')!;
        ctx.save();
        if (angle === 90) {
          ctx.translate(canvas.width, 0);
        } else if (angle === 180) {
          ctx.translate(canvas.width, canvas.height);
        } else if (angle === 270) {
          ctx.translate(0, canvas.height);
        }
        ctx.rotate((angle * Math.PI) / 180);
        await page.render({ canvas, viewport: baseVp }).promise;
        ctx.restore();
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const vp1 = page.getViewport({ scale: 1 });
        let w = vp1.width;
        let h = vp1.height;
        if (angle === 90 || angle === 270) { [w, h] = [h, w]; }
        output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
        output.addImage(imgData, 'JPEG', 0, 0, w, h);
      }
      output.save(`rotated_${angle}_${file.name}`);
      setStatus('旋转完成，已下载');
    } catch (err: any) {
      setStatus(`旋转失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，选择旋转角度。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name}</span>
        </div>
      )}
      <div>
        <p className="text-xs text-slate-500 mb-2">旋转角度</p>
        <div className="flex gap-2">
          {[90, 180, 270].map(a => (
            <Btn key={a} onClick={() => setAngle(a as 90 | 180 | 270)} variant={angle === a ? 'primary' : 'ghost'}>
              {a}°
            </Btn>
          ))}
        </div>
      </div>
      <Btn onClick={handleRotate} disabled={!file || loading}>
        {loading ? '旋转中...' : '开始旋转'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default RotatePdf;
