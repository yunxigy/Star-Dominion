import React, { useEffect, useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob , revokeUrls } from '../shared';

type Position =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right';

const POSITIONS: { value: Position; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '上中' },
  { value: 'top-right', label: '右上' },
  { value: 'center-left', label: '左中' },
  { value: 'center', label: '居中' },
  { value: 'center-right', label: '右中' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '下中' },
  { value: 'bottom-right', label: '右下' },
];

const ImageEnhanceWatermark: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [text, setText] = useState('水印文字');
  const [position, setPosition] = useState<Position>('bottom-right');
  const [opacity, setOpacity] = useState(0.5);
  const [fontSize, setFontSize] = useState(32);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const getPos = (pos: Position, cw: number, ch: number, tw: number, th: number) => {
    const pad = 20;
    switch (pos) {
      case 'top-left': return { x: pad, y: pad + th };
      case 'top-center': return { x: (cw - tw) / 2, y: pad + th };
      case 'top-right': return { x: cw - tw - pad, y: pad + th };
      case 'center-left': return { x: pad, y: (ch + th) / 2 };
      case 'center': return { x: (cw - tw) / 2, y: (ch + th) / 2 };
      case 'center-right': return { x: cw - tw - pad, y: (ch + th) / 2 };
      case 'bottom-left': return { x: pad, y: ch - pad };
      case 'bottom-center': return { x: (cw - tw) / 2, y: ch - pad };
      case 'bottom-right': return { x: cw - tw - pad, y: ch - pad };
    }
  };

  const handleApply = async () => {
    if (!files[0] || !text) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const canvas = canvasRef.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      ctx.font = `bold ${fontSize}px sans-serif`;
      const metrics = ctx.measureText(text);
      const pos = getPos(position, canvas.width, canvas.height, metrics.width, fontSize);

      ctx.globalAlpha = opacity;
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeText(text, pos.x, pos.y);
      ctx.fillText(text, pos.x, pos.y);
      ctx.globalAlpha = 1;

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
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_watermark.png';
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
              <label className="text-sm text-slate-400 mb-1 block">水印文字</label>
              <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="输入水印文字"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>

            <div>
              <label className="text-sm text-slate-400 mb-1 block">位置</label>
              <div className="grid grid-cols-3 gap-1">
                {POSITIONS.map(p => (
                  <button key={p.value} onClick={() => setPosition(p.value)}
                    className={`px-2 py-1 text-xs rounded transition-colors ${position === p.value ? 'bg-emerald-600 text-white' : 'bg-slate-700/50 text-slate-400 hover:bg-slate-600/50'}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">透明度: <span className="text-emerald-400">{opacity.toFixed(2)}</span></label>
                <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} className="w-full accent-emerald-500" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">字号: <span className="text-emerald-400">{fontSize}px</span></label>
                <input type="range" min={12} max={120} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
            </div>
          </div>

          <Btn onClick={handleApply} disabled={processing}>{processing ? '处理中...' : '添加水印'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载水印图片</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageEnhanceWatermark;
