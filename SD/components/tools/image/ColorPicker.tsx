import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useFileUpload, UploadZone, Btn, copyToClipboard, loadImage, loadImageFromBlob } from '../shared';

// Color conversion utilities
const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
};

const rgbToHsl = (r: number, g: number, b: number): { h: number; s: number; l: number } => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

const ColorPicker: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState<{ r: number; g: number; b: number } | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);

  const loadToCanvas = useCallback(async () => {
    if (!files[0] || !canvasRef.current) return;
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = canvasRef.current;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      setImgLoaded(true);
    } catch (e: any) {
      alert('加载图片失败: ' + e.message);
    }
  }, [files]);

  useEffect(() => {
    if (files[0]) loadToCanvas();
  }, [files, loadToCanvas]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.floor((e.clientX - rect.left) * scaleX);
    const y = Math.floor((e.clientY - rect.top) * scaleY);

    const pixel = ctx.getImageData(x, y, 1, 1).data;
    setColor({ r: pixel[0], g: pixel[1], b: pixel[2] });
  };

  const hex = color ? rgbToHex(color.r, color.g, color.b) : '';
  const hsl = color ? rgbToHsl(color.r, color.g, color.b) : null;

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传图片" sublabel="点击图片取色" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setColor(null); setImgLoaded(false); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              className="w-full cursor-crosshair"
              style={{ maxHeight: 300, objectFit: 'contain' }}
            />
          </div>
          <p className="text-xs text-slate-500">点击图片上的任意位置取色</p>

          {color && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg border border-slate-600" style={{ backgroundColor: `rgb(${color.r},${color.g},${color.b})` }} />
                <div>
                  <div className="text-sm text-slate-200 font-mono">RGB({color.r}, {color.g}, {color.b})</div>
                  {hsl && <div className="text-xs text-slate-400 font-mono">HSL({hsl.h}, {hsl.s}%, {hsl.l}%)</div>}
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-500">HEX</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-mono">{hex}</span>
                    <button onClick={() => copyToClipboard(hex)} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
                  </div>
                </div>
                <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                  <span className="text-xs text-slate-500">RGB</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-slate-200 font-mono">{`rgb(${color.r}, ${color.g}, ${color.b})`}</span>
                    <button onClick={() => copyToClipboard(`rgb(${color.r}, ${color.g}, ${color.b})`)} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
                  </div>
                </div>
                {hsl && (
                  <div className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2">
                    <span className="text-xs text-slate-500">HSL</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-slate-200 font-mono">{`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`}</span>
                      <button onClick={() => copyToClipboard(`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`)} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ColorPicker;
