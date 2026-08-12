import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Btn, copyToClipboard, UploadZone } from '../shared';
import { Crop, Palette, Download, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';

const PHOTO_SIZES = [
  { name: '一寸', w: 295, h: 413, desc: '25×35mm' },
  { name: '二寸', w: 413, h: 579, desc: '35×49mm' },
  { name: '小一寸', w: 260, h: 378, desc: '22×32mm' },
  { name: '小二寸', w: 390, h: 567, desc: '33×48mm' },
  { name: '大一寸', w: 390, h: 567, desc: '33×48mm' },
  { name: '护照', w: 354, h: 472, desc: '33×48mm' },
  { name: '签证', w: 600, h: 600, desc: '51×51mm' },
];

const BG_COLORS = [
  { name: '白色', color: '#ffffff' },
  { name: '蓝色', color: '#438edb' },
  { name: '红色', color: '#d03030' },
  { name: '渐变蓝', color: '#1a6fc4' },
  { name: '浅灰', color: '#e5e5e5' },
  { name: '自定义', color: '' },
];

const IdPhoto: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSrc, setImageSrc] = useState('');
  const [selectedSize, setSelectedSize] = useState(0);
  const [bgColor, setBgColor] = useState('#438edb');
  const [customColor, setCustomColor] = useState('#438edb');
  const [zoom, setZoom] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const [previewUrl, setPreviewUrl] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const size = PHOTO_SIZES[selectedSize];

  const handleFileUpload = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    setImageSrc(url);
    const img = document.createElement('img');
    img.onload = () => {
      setImage(img);
      setZoom(1);
      setOffsetX(0);
      setOffsetY(0);
      setPreviewUrl('');
    };
    img.src = url;
  }, []);

  const handleColorSelect = (color: string, idx: number) => {
    if (BG_COLORS[idx].name === '自定义') {
      setBgColor(customColor);
    } else {
      setBgColor(color);
    }
  };

  useEffect(() => {
    if (customColor && bgColor !== BG_COLORS.slice(0, -1).find(c => c.color === bgColor)?.color) {
      setBgColor(customColor);
    }
  }, [customColor]);

  const generatePreview = useCallback(() => {
    if (!image || !canvasRef.current) return;

    const canvas = canvasRef.current;
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, size.w, size.h);

    // Calculate image placement (cover mode)
    const targetRatio = size.w / size.h;
    const imgRatio = image.width / image.height;

    let drawW: number, drawH: number;
    if (imgRatio > targetRatio) {
      drawH = size.h * zoom;
      drawW = drawH * imgRatio;
    } else {
      drawW = size.w * zoom;
      drawH = drawW / imgRatio;
    }

    const x = (size.w - drawW) / 2 + offsetX;
    const y = (size.h - drawH) / 2 + offsetY;

    ctx.drawImage(image, x, y, drawW, drawH);

    setPreviewUrl(canvas.toDataURL('image/png'));
  }, [image, size, bgColor, zoom, offsetX, offsetY]);

  const handleDownload = () => {
    if (!previewUrl) return;
    const a = document.createElement('a');
    a.href = previewUrl;
    a.download = `证件照_${size.name}_${size.w}x${size.h}.png`;
    a.click();
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - offsetX, y: e.clientY - offsetY });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffsetX(e.clientX - dragStart.x);
    setOffsetY(e.clientY - dragStart.y);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">证件照处理 — 尺寸裁剪、背景换色、预览下载</p>

      {/* Upload */}
      {!image && (
        <>
        <UploadZone onUpload={() => fileInputRef.current?.click()} accept="image/*" />
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
      </>
      )}

      {image && (
        <>
          {/* Size selection */}
          <div>
            <label className="text-xs font-medium text-[#6d5a47] mb-1 block">照片尺寸</label>
            <div className="flex flex-wrap gap-1">
              {PHOTO_SIZES.map((s, i) => (
                <button key={i} onClick={() => { setSelectedSize(i); setPreviewUrl(''); }}
                  className={`px-2 py-1 text-xs rounded border transition-all
                    ${selectedSize === i ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
                  {s.name}
                  <span className="text-[10px] opacity-70 ml-1">{s.desc}</span>
                </button>
              ))}
            </div>
            <div className="text-[10px] text-[#8b735c] mt-1">
              输出尺寸: {size.w} × {size.h} 像素
            </div>
          </div>

          {/* Background color */}
          <div>
            <label className="text-xs font-medium text-[#6d5a47] mb-1 block">背景颜色</label>
            <div className="flex items-center gap-2">
              {BG_COLORS.map((c, i) => (
                <button key={i} onClick={() => handleColorSelect(c.color, i)}
                  className={`w-8 h-8 rounded-full border-2 transition-all ${bgColor === (c.name === '自定义' ? customColor : c.color) ? 'ring-2 ring-[#7a421b] ring-offset-1 border-[#7a421b]' : 'border-[#ead0ad]'}`}
                  style={{ backgroundColor: c.name === '自定义' ? customColor : c.color }}
                  title={c.name}>
                  {c.name === '自定义' && <span className="text-[8px] text-white font-bold">+</span>}
                </button>
              ))}
              <input type="color" value={customColor} onChange={e => { setCustomColor(e.target.value); setBgColor(e.target.value); }}
                className="w-8 h-8 rounded cursor-pointer" title="自定义颜色" />
            </div>
          </div>

          {/* Zoom & position controls */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#8b735c]">缩放:</label>
            <button onClick={() => setZoom(z => Math.max(0.5, z - 0.1))} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-xs font-mono text-[#6d5a47] min-w-[3rem] text-center">{(zoom * 100).toFixed(0)}%</span>
            <button onClick={() => setZoom(z => Math.min(3, z + 0.1))} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
              <ZoomIn className="w-4 h-4" />
            </button>
            <button onClick={() => { setZoom(1); setOffsetX(0); setOffsetY(0); }}
              className="text-[10px] text-[#8b735c] hover:text-[#7a421b] ml-2">重置</button>
          </div>

          {/* Preview area */}
          <div className="grid grid-cols-2 gap-3">
            {/* Original with crop overlay */}
            <div>
              <label className="text-xs text-[#8b735c] mb-1 block">原图（拖拽调整位置）</label>
              <div className="relative border border-[#ead0ad] rounded-lg overflow-hidden bg-[#f5f5f5]"
                style={{ height: 250 }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}>
                <img src={imageSrc} alt="原图" className="w-full h-full object-contain cursor-move select-none"
                  draggable={false} />
                {/* Crop ratio overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="border-2 border-dashed border-[#7a421b]/50 rounded"
                    style={{ aspectRatio: `${size.w}/${size.h}`, maxHeight: '80%' }} />
                </div>
              </div>
            </div>

            {/* Preview */}
            <div>
              <label className="text-xs text-[#8b735c] mb-1 block">预览</label>
              <div className="border border-[#ead0ad] rounded-lg flex items-center justify-center bg-[#f5f5f5]"
                style={{ height: 250 }}>
                {previewUrl ? (
                  <img src={previewUrl} alt="预览" className="max-w-full max-h-full object-contain" />
                ) : (
                  <span className="text-xs text-[#8b735c]">点击"生成预览"</span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <Btn onClick={generatePreview}>
              <Crop className="w-3 h-3 mr-1" />生成预览
            </Btn>
            {previewUrl && (
              <Btn onClick={handleDownload} variant="ghost">
                <Download className="w-3 h-3 mr-1" />下载
              </Btn>
            )}
            <Btn onClick={() => { setImage(null); setImageSrc(''); setPreviewUrl(''); }} variant="ghost">重新上传</Btn>
          </div>

          {/* Hidden canvas */}
          <canvas ref={canvasRef} className="hidden" />
        </>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
        提示：此工具仅提供基础裁剪和背景换色功能。智能抠图（去除原背景）需要后端AI服务支持，当前为手动模式。
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default IdPhoto;