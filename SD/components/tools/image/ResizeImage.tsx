import React, { useEffect, useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

const ResizeImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [lockRatio, setLockRatio] = useState(true);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleFileLoad = async () => {
    if (!files[0]) return;
    try {
      const img = await loadImageFromBlob(files[0]);
      setNaturalW(img.width);
      setNaturalH(img.height);
      setWidth(String(img.width));
      setHeight(String(img.height));
    } catch (e: any) {
      alert('加载图片失败: ' + e.message);
    }
  };

  const handleWidthChange = (v: string) => {
    setWidth(v);
    if (lockRatio && naturalW > 0 && v) {
      setHeight(String(Math.round(Number(v) * naturalH / naturalW)));
    }
  };

  const handleHeightChange = (v: string) => {
    setHeight(v);
    if (lockRatio && naturalH > 0 && v) {
      setWidth(String(Math.round(Number(v) * naturalW / naturalH)));
    }
  };

  const handleResize = async () => {
    if (!files[0] || !width || !height) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = document.createElement('canvas');
      canvas.width = Number(width);
      canvas.height = Number(height);
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, 'image/png');
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('缩放失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0] || !width || !height) return;
    const img = await loadImageFromBlob(files[0]);
    const canvas = document.createElement('canvas');
    canvas.width = Number(width);
    canvas.height = Number(height);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + `_${width}x${height}.png`;
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传图片" sublabel="支持 JPG/PNG/WebP" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setWidth(''); setHeight(''); setPreview(''); setNaturalW(0); setNaturalH(0); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>
          {naturalW > 0 && <p className="text-xs text-slate-500">原始尺寸: {naturalW} x {naturalH}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">宽度</label>
              <input type="number" value={width} onChange={e => handleWidthChange(e.target.value)} placeholder="宽度" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">高度</label>
              <input type="number" value={height} onChange={e => handleHeightChange(e.target.value)} placeholder="高度" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input type="checkbox" checked={lockRatio} onChange={e => setLockRatio(e.target.checked)} className="accent-violet-500" />
            锁定宽高比例
          </label>
          <Btn onClick={handleResize} disabled={processing}>{processing ? '处理中...' : '缩放预览'}</Btn>
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览 ({width} x {height})</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载缩放图片</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ResizeImage;
