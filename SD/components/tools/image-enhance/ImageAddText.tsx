import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob, useFileObjectUrl } from '../shared';

const ImageAddText: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const fileUrl = useFileObjectUrl(files[0]);
  const [text, setText] = useState('');
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [color, setColor] = useState('#ffffff');
  const [fontSize, setFontSize] = useState(32);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (files[0]) {
      const url = URL.createObjectURL(files[0]);
      const img = new Image();
      img.onload = () => {
        setImgDims({ w: img.width, h: img.height });
        setX(Math.floor(img.width / 2));
        setY(Math.floor(img.height / 2));
        URL.revokeObjectURL(url);
      };
      img.src = url;
      setPreview('');
    }
  }, [files[0]]);

  const handlePreviewMouseDown = (e: React.MouseEvent) => {
    if (!previewRef.current || !files[0]) return;
    setDragging(true);
    updatePosition(e);
  };

  const handlePreviewMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !previewRef.current) return;
    updatePosition(e);
  };

  const handlePreviewMouseUp = () => {
    setDragging(false);
  };

  const updatePosition = (e: React.MouseEvent) => {
    if (!previewRef.current) return;
    const rect = previewRef.current.getBoundingClientRect();
    const scaleX = imgDims.w / rect.width;
    const scaleY = imgDims.h / rect.height;
    const px = Math.max(0, Math.min(imgDims.w, Math.round((e.clientX - rect.left) * scaleX)));
    const py = Math.max(0, Math.min(imgDims.h, Math.round((e.clientY - rect.top) * scaleY)));
    setX(px);
    setY(py);
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
      ctx.fillStyle = color;
      ctx.strokeStyle = color === '#000000' ? '#ffffff' : '#000000';
      ctx.lineWidth = 2;
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);

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
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_text.png';
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
              <label className="text-sm text-slate-400 mb-1 block">文字内容</label>
              <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="输入文字"
                className="w-full bg-slate-900/50 border border-slate-600 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-emerald-500/50" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">X 坐标: <span className="text-emerald-400">{x}</span></label>
                <input type="range" min={0} max={imgDims.w} value={x} onChange={e => setX(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">Y 坐标: <span className="text-emerald-400">{y}</span></label>
                <input type="range" min={0} max={imgDims.h} value={y} onChange={e => setY(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-slate-400 mb-1 block">文字颜色</label>
                <input type="color" value={color} onChange={e => setColor(e.target.value)}
                  className="w-full h-9 rounded cursor-pointer bg-transparent" />
              </div>
              <div>
                <label className="text-sm text-slate-400 mb-1 block">字号: <span className="text-emerald-400">{fontSize}px</span></label>
                <input type="range" min={12} max={120} value={fontSize} onChange={e => setFontSize(Number(e.target.value))} className="w-full accent-emerald-500" />
              </div>
            </div>

            <p className="text-xs text-slate-500">提示: 可在下方预览图上点击或拖拽设置文字位置</p>
          </div>

          <div ref={previewRef}
            className="relative cursor-crosshair rounded-lg overflow-hidden bg-slate-800"
            onMouseDown={handlePreviewMouseDown}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={handlePreviewMouseUp}
            onMouseLeave={handlePreviewMouseUp}>
            {files[0] && (
              <img src={fileUrl} className="w-full object-contain max-h-48" draggable={false} />
            )}
            {text && (
              <div className="absolute pointer-events-none" style={{
                left: `${(x / imgDims.w) * 100}%`,
                top: `${(y / imgDims.h) * 100}%`,
                color,
                fontSize: `${Math.max(10, fontSize * (previewRef.current?.clientWidth || 400) / imgDims.w)}px`,
                fontWeight: 'bold',
                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                transform: 'translate(-50%, -100%)',
              }}>
                {text}
              </div>
            )}
          </div>

          <Btn onClick={handleApply} disabled={processing}>{processing ? '处理中...' : '应用文字'}</Btn>

          <canvas ref={canvasRef} className="hidden" />
          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">结果预览</p>
              <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载结果</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageAddText;
