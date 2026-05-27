import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

const CropImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(0);
  const [h, setH] = useState(0);
  const [naturalW, setNaturalW] = useState(0);
  const [naturalH, setNaturalH] = useState(0);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (files[0]) {
      loadImageFromBlob(files[0]).then(img => {
        setNaturalW(img.width);
        setNaturalH(img.height);
        setW(img.width);
        setH(img.height);
        setX(0);
        setY(0);
      }).catch(() => {});
    }
  }, [files]);

  const handleCrop = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
      const blob = await canvasToBlob(canvas, 'image/png');
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('裁剪失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0]) return;
    const img = await loadImageFromBlob(files[0]);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
    const blob = await canvasToBlob(canvas, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_cropped.png';
    downloadBlob(blob, name);
  };

  const numberInput = (label: string, value: number, set: (v: number) => void, max: number) => (
    <div>
      <label className="text-sm text-slate-400 mb-1 block">{label}</label>
      <input type="number" min={0} max={max} value={value} onChange={e => set(Math.max(0, Math.min(max, Number(e.target.value))))} className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50" />
    </div>
  );

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传图片" sublabel="支持 JPG/PNG/WebP" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); setNaturalW(0); setNaturalH(0); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>
          <p className="text-xs text-slate-500">图片尺寸: {naturalW} x {naturalH}</p>
          <div className="grid grid-cols-2 gap-3">
            {numberInput('X', x, setX, naturalW)}
            {numberInput('Y', y, setY, naturalH)}
            {numberInput('宽度', w, setW, naturalW)}
            {numberInput('高度', h, setH, naturalH)}
          </div>
          <Btn onClick={handleCrop} disabled={processing}>{processing ? '处理中...' : '裁剪预览'}</Btn>
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">裁剪结果</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载裁剪图片</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default CropImage;
