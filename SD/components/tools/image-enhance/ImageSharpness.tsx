import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

const ImageSharpness: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [intensity, setIntensity] = useState(5);
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

  const applyUnsharpMask = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImage(originalUrl);
      const w = img.width;
      const h = img.height;

      // Draw original
      const origCanvas = originalCanvasRef.current!;
      origCanvas.width = w;
      origCanvas.height = h;
      const origCtx = origCanvas.getContext('2d')!;
      origCtx.drawImage(img, 0, 0);

      // Create blurred version
      const blurCanvas = document.createElement('canvas');
      blurCanvas.width = w;
      blurCanvas.height = h;
      const blurCtx = blurCanvas.getContext('2d')!;
      blurCtx.filter = `blur(${intensity}px)`;
      blurCtx.drawImage(img, 0, 0);

      // Unsharp mask: original + (original - blurred) * amount
      const resultCanvas = resultCanvasRef.current!;
      resultCanvas.width = w;
      resultCanvas.height = h;
      const resultCtx = resultCanvas.getContext('2d')!;

      const origData = origCtx.getImageData(0, 0, w, h);
      const blurData = blurCtx.getImageData(0, 0, w, h);
      const resultData = resultCtx.createImageData(w, h);

      const amount = intensity * 0.5;
      for (let i = 0; i < origData.data.length; i += 4) {
        resultData.data[i] = Math.min(255, Math.max(0, origData.data[i] + (origData.data[i] - blurData.data[i]) * amount));
        resultData.data[i + 1] = Math.min(255, Math.max(0, origData.data[i + 1] + (origData.data[i + 1] - blurData.data[i + 1]) * amount));
        resultData.data[i + 2] = Math.min(255, Math.max(0, origData.data[i + 2] + (origData.data[i + 2] - blurData.data[i + 2]) * amount));
        resultData.data[i + 3] = origData.data[i + 3];
      }
      resultCtx.putImageData(resultData, 0, 0);

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
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_sharp.png';
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
            <label className="text-sm text-slate-400 mb-1 block">清晰度强度: <span className="text-emerald-400">{intensity}</span></label>
            <input type="range" min={1} max={10} value={intensity} onChange={e => setIntensity(Number(e.target.value))} className="w-full accent-emerald-500" />
          </div>

          <Btn onClick={applyUnsharpMask} disabled={processing}>{processing ? '处理中...' : '增强清晰度'}</Btn>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-500 mb-1">原图</p>
              <canvas ref={originalCanvasRef} className="hidden" />
              {originalUrl && <img src={originalUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />}
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">增强后</p>
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

export default ImageSharpness;
