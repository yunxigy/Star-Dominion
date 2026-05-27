import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

interface Rect { x: number; y: number; w: number; h: number; }

const ImageMosaic: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [blockSize, setBlockSize] = useState(10);
  const [processing, setProcessing] = useState(false);
  const [resultUrl, setResultUrl] = useState('');

  useEffect(() => () => revokeUrls([resultUrl]), [resultUrl]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [startPt, setStartPt] = useState<{ x: number; y: number } | null>(null);
  const [currentRect, setCurrentRect] = useState<Rect | null>(null);
  const [appliedRects, setAppliedRects] = useState<Rect[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const loadImageToCanvas = useCallback(async () => {
    if (!files[0] || !canvasRef.current) return;
    const img = await loadImageFromBlob(files[0]);
    imgRef.current = img;
    const canvas = canvasRef.current;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    if (overlayRef.current) {
      overlayRef.current.width = img.width;
      overlayRef.current.height = img.height;
    }
    setImgLoaded(true);
    setAppliedRects([]);
    setResultUrl('');
  }, [files[0]]);

  useEffect(() => {
    loadImageToCanvas();
  }, [loadImageToCanvas]);

  const getCanvasCoords = (e: React.MouseEvent): { x: number; y: number } | null => {
    if (!containerRef.current || !canvasRef.current) return null;
    const rect = containerRef.current.getBoundingClientRect();
    const scaleX = canvasRef.current.width / rect.width;
    const scaleY = canvasRef.current.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const pt = getCanvasCoords(e);
    if (!pt) return;
    setSelecting(true);
    setStartPt(pt);
    setCurrentRect(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!selecting || !startPt) return;
    const pt = getCanvasCoords(e);
    if (!pt) return;
    const x = Math.min(startPt.x, pt.x);
    const y = Math.min(startPt.y, pt.y);
    const w = Math.abs(pt.x - startPt.x);
    const h = Math.abs(pt.y - startPt.y);
    setCurrentRect({ x, y, w, h });

    // Draw selection overlay
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
    }
  };

  const handleMouseUp = () => {
    if (selecting && currentRect && currentRect.w > 5 && currentRect.h > 5) {
      setAppliedRects(prev => [...prev, currentRect]);
    }
    setSelecting(false);
    setStartPt(null);
    setCurrentRect(null);
    if (overlayRef.current) {
      const ctx = overlayRef.current.getContext('2d')!;
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
  };

  const applyMosaic = (ctx: CanvasRenderingContext2D, rect: Rect, bs: number) => {
    const { x, y, w, h } = rect;
    for (let py = y; py < y + h; py += bs) {
      for (let px = x; px < x + w; px += bs) {
        const bw = Math.min(bs, x + w - px);
        const bh = Math.min(bs, y + h - py);
        const imgData = ctx.getImageData(px, py, bw, bh);
        const data = imgData.data;
        let r = 0, g = 0, b = 0, count = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i]; g += data[i + 1]; b += data[i + 2]; count++;
        }
        r = Math.round(r / count);
        g = Math.round(g / count);
        b = Math.round(b / count);
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(px, py, bw, bh);
      }
    }
  };

  const handleApplyMosaic = async () => {
    if (!canvasRef.current || appliedRects.length === 0) return;
    setProcessing(true);
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d')!;

      // Redraw original image
      if (imgRef.current) {
        ctx.drawImage(imgRef.current, 0, 0);
      }

      // Apply mosaic to each selected rect
      for (const rect of appliedRects) {
        applyMosaic(ctx, rect, blockSize);
      }

      const blob = await canvasToBlob(canvas, 'image/png');
      setResultUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    const blob = await canvasToBlob(canvasRef.current, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_mosaic.png';
    downloadBlob(blob, name);
  };

  const handleReset = () => {
    setAppliedRects([]);
    setResultUrl('');
    if (imgRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d')!;
      ctx.drawImage(imgRef.current, 0, 0);
    }
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
            <button onClick={() => { clearFiles(); setImgLoaded(false); setResultUrl(''); setAppliedRects([]); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
            <label className="text-sm text-slate-400 mb-1 block">马赛克块大小: <span className="text-emerald-400">{blockSize}px</span></label>
            <input type="range" min={5} max={50} value={blockSize} onChange={e => setBlockSize(Number(e.target.value))} className="w-full accent-emerald-500" />
          </div>

          <p className="text-xs text-slate-500">在图片上拖拽选择要打马赛克的区域，可多次选择</p>

          <div ref={containerRef} className="relative cursor-crosshair rounded-lg overflow-hidden bg-slate-800"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}>
            <canvas ref={canvasRef} className="w-full object-contain max-h-64" />
            <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />
          </div>

          {appliedRects.length > 0 && (
            <p className="text-xs text-emerald-400">已选择 {appliedRects.length} 个区域</p>
          )}

          <div className="flex gap-2">
            <Btn onClick={handleApplyMosaic} disabled={processing || appliedRects.length === 0}>
              {processing ? '处理中...' : '应用马赛克'}
            </Btn>
            <Btn onClick={handleReset} variant="ghost">重置选区</Btn>
          </div>

          {resultUrl && (
            <div>
              <p className="text-xs text-slate-500 mb-1">结果预览</p>
              <img src={resultUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载结果</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageMosaic;
