import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

const ImageSharpen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [amount, setAmount] = useState(1);
  const [originalUrl, setOriginalUrl] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const resultCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (files[0]) {
      const url = URL.createObjectURL(files[0]);
      setOriginalUrl(url);
      setResultUrl('');
      return () => URL.revokeObjectURL(url);
    }
  }, [files[0]]);

  const applySharpen = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImage(originalUrl);
      const w = img.width;
      const h = img.height;

      const origCanvas = originalCanvasRef.current!;
      origCanvas.width = w;
      origCanvas.height = h;
      const origCtx = origCanvas.getContext('2d')!;
      origCtx.drawImage(img, 0, 0);

      const resultCanvas = resultCanvasRef.current!;
      resultCanvas.width = w;
      resultCanvas.height = h;
      const resultCtx = resultCanvas.getContext('2d')!;

      const imageData = origCtx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const copy = new Uint8ClampedArray(data);

      // Sharpen convolution kernel: center = 1 + 4*amount, neighbors = -amount
      const k = amount;
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = (y * w + x) * 4;
          for (let c = 0; c < 3; c++) {
            const center = copy[idx + c];
            const top = copy[((y - 1) * w + x) * 4 + c];
            const bottom = copy[((y + 1) * w + x) * 4 + c];
            const left = copy[(y * w + (x - 1)) * 4 + c];
            const right = copy[(y * w + (x + 1)) * 4 + c];
            const val = center * (1 + 4 * k) - k * (top + bottom + left + right);
            data[idx + c] = Math.min(255, Math.max(0, val));
          }
        }
      }

      resultCtx.putImageData(imageData, 0, 0);
      const blob = await canvasToBlob(resultCanvas, 'image/png');
      setResultUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!resultCanvasRef.current) return;
    const blob = await canvasToBlob(resultCanvasRef.current, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_sharpened.png';
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
            <button onClick={() => { clearFiles(); setOriginalUrl(''); setResultUrl(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <label className="text-sm text-slate-400 mb-1 block">锐化强度: <span className="text-emerald-400">{amount.toFixed(1)}</span></label>
            <input type="range" min={0.1} max={5} step={0.1} value={amount} onChange={e => setAmount(parseFloat(e.target.value))} className="w-full accent-emerald-500" />
          </div>

          <Btn onClick={applySharpen} disabled={processing}>{processing ? '处理中...' : '应用锐化'}</Btn>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">原图</p>
              <canvas ref={originalCanvasRef} className="hidden" />
              {originalUrl && <img src={originalUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">锐化后</p>
              <canvas ref={resultCanvasRef} className="hidden" />
              {resultUrl && <img src={resultUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />}
            </div>
          </div>

          {resultUrl && <Btn onClick={handleDownload}>下载结果</Btn>}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageSharpen;
