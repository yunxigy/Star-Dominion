import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

const ImageBrightness: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [saturation, setSaturation] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (files[0]) {
      const url = URL.createObjectURL(files[0]);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [files[0]]);

  const getFilterString = () => {
    const b = 100 + brightness;
    const c = 100 + contrast;
    const s = 100 + saturation;
    return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
  };

  const applyFilters = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.filter = getFilterString();
      ctx.drawImage(img, 0, 0);

      const blob = await canvasToBlob(canvas, 'image/png');
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    const blob = await canvasToBlob(canvasRef.current, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_adjusted.png';
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
            <button onClick={() => { clearFiles(); setPreviewUrl(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">亮度: <span className="text-emerald-400">{brightness}</span></label>
              <input type="range" min={-100} max={100} value={brightness} onChange={e => setBrightness(Number(e.target.value))} className="w-full accent-emerald-500" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">对比度: <span className="text-emerald-400">{contrast}</span></label>
              <input type="range" min={-100} max={100} value={contrast} onChange={e => setContrast(Number(e.target.value))} className="w-full accent-emerald-500" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">饱和度: <span className="text-emerald-400">{saturation}</span></label>
              <input type="range" min={-100} max={100} value={saturation} onChange={e => setSaturation(Number(e.target.value))} className="w-full accent-emerald-500" />
            </div>
          </div>

          <Btn onClick={applyFilters} disabled={processing}>{processing ? '处理中...' : '应用调整'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {previewUrl && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={previewUrl} style={{ filter: getFilterString() }} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
            </div>
          )}

          <Btn onClick={handleDownload}>下载结果</Btn>
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageBrightness;
