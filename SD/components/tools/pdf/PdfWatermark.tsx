import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';
import { useFileUpload, UploadZone, Btn, TextInput } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';


const PdfWatermark: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps, handleFiles } = useFileUpload('.pdf');
  const [text, setText] = useState('CONFIDENTIAL');
  const [opacity, setOpacity] = useState(0.3);
  const [fontSize, setFontSize] = useState(40);
  const [angle, setAngle] = useState(45);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const file = files[0];

  const handleWatermark = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    if (!text.trim()) { setStatus('请输入水印文字'); return; }
    setLoading(true);
    setStatus('正在添加水印...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const output = new jsPDF();
      output.deletePage(1);
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在处理第 ${p}/${doc.numPages} 页...`);
        const page = await doc.getPage(p);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvas, viewport }).promise;

        // Draw watermark
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.fillStyle = '#888888';
        ctx.font = `${fontSize}px sans-serif`;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angle * Math.PI) / 180);
        const metrics = ctx.measureText(text);
        const stepX = metrics.width + 200;
        const stepY = fontSize * 4;
        for (let y = -canvas.height; y < canvas.height; y += stepY) {
          for (let x = -canvas.width; x < canvas.width; x += stepX) {
            ctx.fillText(text, x - metrics.width / 2, y);
          }
        }
        ctx.restore();

        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        const vp1 = page.getViewport({ scale: 1 });
        const w = vp1.width;
        const h = vp1.height;
        output.addPage([w, h], w > h ? 'landscape' as const : 'portrait' as const);
        output.addImage(imgData, 'JPEG', 0, 0, w, h);
      }
      output.save(`watermarked_${file.name}`);
      setStatus('水印添加完成，已下载');
    } catch (err: any) {
      setStatus(`添加水印失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，添加文字水印。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name}</span>
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500 block mb-1">水印文字</label>
        <TextInput value={text} onChange={setText} placeholder="输入水印文字" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs text-slate-500 block mb-1">透明度 ({Math.round(opacity * 100)}%)</label>
          <input type="range" min="0.05" max="1" step="0.05" value={opacity}
            onChange={e => setOpacity(Number(e.target.value))}
            className="w-full accent-violet-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">字号 ({fontSize})</label>
          <input type="range" min="10" max="100" step="2" value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            className="w-full accent-violet-500" />
        </div>
        <div>
          <label className="text-xs text-slate-500 block mb-1">角度 ({angle}°)</label>
          <input type="range" min="0" max="90" step="5" value={angle}
            onChange={e => setAngle(Number(e.target.value))}
            className="w-full accent-violet-500" />
        </div>
      </div>
      <Btn onClick={handleWatermark} disabled={!file || loading || !text.trim()}>
        {loading ? '添加水印中...' : '添加水印'}
      </Btn>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default PdfWatermark;
