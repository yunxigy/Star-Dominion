import React, { useEffect, useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

const GRADIENT_PRESETS = [
  { label: '纯黑', value: 'solid:#111111' },
  { label: '深灰', value: 'solid:#1e293b' },
  { label: '紫蓝渐变', value: 'linear:#667eea,#764ba2' },
  { label: '粉橙渐变', value: 'linear:#f093fb,#f5576c' },
  { label: '青蓝渐变', value: 'linear:#4facfe,#00f2fe' },
  { label: '绿青渐变', value: 'linear:#43e97b,#38f9d7' },
  { label: '橙红渐变', value: 'linear:#fa709a,#fee140' },
];

const ScreenshotBeautify: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [bgPreset, setBgPreset] = useState(GRADIENT_PRESETS[0].value);
  const [shadow, setShadow] = useState(true);
  const [padding, setPadding] = useState(60);
  const [borderRadius, setBorderRadius] = useState(16);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawBackground = (ctx: CanvasRenderingContext2D, w: number, h: number) => {
    const parts = bgPreset.split(':');
    const type = parts[0];
    const colors = parts[1].split(',');

    if (type === 'solid') {
      ctx.fillStyle = colors[0];
      ctx.fillRect(0, 0, w, h);
    } else if (type === 'linear') {
      const grad = ctx.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, colors[0]);
      grad.addColorStop(1, colors[1]);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const roundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  };

  const handleApply = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvasW = img.width + padding * 2;
      const canvasH = img.height + padding * 2;

      const canvas = canvasRef.current!;
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;

      // Draw background
      drawBackground(ctx, canvasW, canvasH);

      // Draw shadow
      if (shadow) {
        ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
        ctx.shadowBlur = 30;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 10;
      }

      // Clip to rounded rect and draw image
      ctx.save();
      roundRect(ctx, padding, padding, img.width, img.height, borderRadius);
      ctx.clip();
      ctx.drawImage(img, padding, padding);
      ctx.restore();

      // Reset shadow
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Draw border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;
      roundRect(ctx, padding, padding, img.width, img.height, borderRadius);
      ctx.stroke();

      const blob = await canvasToBlob(canvas, 'image/png');
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!canvasRef.current) return;
    const blob = await canvasToBlob(canvasRef.current, 'image/png');
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_beautified.png';
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传截图" sublabel="支持 JPG/PNG/WebP" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">背景样式</label>
              <div className="grid grid-cols-4 gap-1">
                {GRADIENT_PRESETS.map(p => (
                  <button key={p.value} onClick={() => setBgPreset(p.value)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${bgPreset === p.value ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">内边距: <span className="text-emerald-400">{padding}px</span></label>
                <input type="range" min={20} max={150} value={padding} onChange={e => setPadding(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">圆角: <span className="text-emerald-400">{borderRadius}px</span></label>
                <input type="range" min={0} max={50} value={borderRadius} onChange={e => setBorderRadius(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="shadow" checked={shadow} onChange={e => setShadow(e.target.checked)}
                className="accent-emerald-500" />
              <label htmlFor="shadow" className="text-sm text-slate-400">添加阴影</label>
            </div>
          </div>

          <Btn onClick={handleApply} disabled={processing}>{processing ? '处理中...' : '美化截图'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载美化截图</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ScreenshotBeautify;
