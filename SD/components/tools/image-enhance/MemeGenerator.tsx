import React, { useEffect, useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

const MemeGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [topText, setTopText] = useState('');
  const [bottomText, setBottomText] = useState('');
  const [fontSize, setFontSize] = useState(48);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const drawMemeText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number) => {
    ctx.font = `bold ${size}px Impact, Arial Black, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = '#000000';
    ctx.fillStyle = '#ffffff';
    ctx.lineJoin = 'round';

    // Draw stroke
    ctx.strokeText(text, x, y);
    // Draw fill
    ctx.fillText(text, x, y);
  };

  const handleApply = async () => {
    if (!files[0] || (!topText && !bottomText)) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const centerX = img.width / 2;
      const padding = img.height * 0.05;

      if (topText) {
        drawMemeText(ctx, topText.toUpperCase(), centerX, fontSize + padding, fontSize);
      }
      if (bottomText) {
        drawMemeText(ctx, bottomText.toUpperCase(), centerX, img.height - padding, fontSize);
      }

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
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_meme.png';
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
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">顶部文字</label>
              <input type="text" value={topText} onChange={e => setTopText(e.target.value)} placeholder="输入顶部文字"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">底部文字</label>
              <input type="text" value={bottomText} onChange={e => setBottomText(e.target.value)} placeholder="输入底部文字"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">字号: <span className="text-emerald-400">{fontSize}px</span></label>
              <input type="range" min={20} max={120} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full accent-emerald-500" />
            </div>
          </div>

          <Btn onClick={handleApply} disabled={processing}>{processing ? '处理中...' : '生成表情包'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载表情包</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default MemeGenerator;
