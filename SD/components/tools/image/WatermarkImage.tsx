import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob } from '../shared';

type Position = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center';

const POSITIONS: { value: Position; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-right', label: '右上' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-right', label: '右下' },
  { value: 'center', label: '居中' },
];

const WatermarkImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('image/*');
  const [text, setText] = useState('水印文字');
  const [position, setPosition] = useState<Position>('bottom-right');
  const [opacity, setOpacity] = useState(0.5);
  const [fontSize, setFontSize] = useState(32);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const getPos = (pos: Position, cw: number, ch: number, tw: number, th: number) => {
    const pad = 20;
    switch (pos) {
      case 'top-left': return { x: pad, y: pad + th };
      case 'top-right': return { x: cw - tw - pad, y: pad + th };
      case 'bottom-left': return { x: pad, y: ch - pad };
      case 'bottom-right': return { x: cw - tw - pad, y: ch - pad };
      case 'center': return { x: (cw - tw) / 2, y: (ch + th) / 2 };
    }
  };

  const handleWatermark = async () => {
    if (!files[0] || !text) return;
    setProcessing(true);
    try {
      const img = await loadImage(URL.createObjectURL(files[0]));
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      ctx.font = `bold ${fontSize}px sans-serif`;
      const metrics = ctx.measureText(text);
      const tw = metrics.width;
      const th = fontSize;

      const pos = getPos(position, canvas.width, canvas.height, tw, th);
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
      alert('添加水印失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0] || !text) return;
    const img = await loadImage(URL.createObjectURL(files[0]));
    const canvas = document.createElement('canvas');
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
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_watermark.png';
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/*" label="上传图片" sublabel="支持 JPG/PNG/WebP" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">水印文字</label>
            <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="输入水印文字" className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50" />
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">位置</label>
            <div className="grid grid-cols-5 gap-1">
              {POSITIONS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPosition(p.value)}
                  className={`px-2 py-1 text-xs rounded ${position === p.value ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-slate-400 mb-1 block">透明度: {opacity.toFixed(2)}</label>
              <input type="range" min={0.1} max={1} step={0.05} value={opacity} onChange={e => setOpacity(parseFloat(e.target.value))} className="w-full accent-violet-500" />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-1 block">字号: {fontSize}px</label>
              <input type="range" min={12} max={120} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full accent-violet-500" />
            </div>
          </div>

          <Btn onClick={handleWatermark} disabled={processing}>{processing ? '处理中...' : '添加水印'}</Btn>

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

export default WatermarkImage;
