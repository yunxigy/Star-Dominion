import React, { useState, useRef } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob } from '../shared';

type BgColor = 'blue' | 'red' | 'white';

const BG_COLORS: { value: BgColor; label: string; color: string }[] = [
  { value: 'blue', label: '蓝底', color: '#438edb' },
  { value: 'red', label: '红底', color: '#d03c3c' },
  { value: 'white', label: '白底', color: '#ffffff' },
];

// HSL color space utilities
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
  return { h: h * 360, s: s * 100, l: l * 100 };
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};

// Check if a pixel is likely background (not skin)
const isBackground = (r: number, g: number, b: number, targetBg: BgColor, sensitivity: number): boolean => {
  const hsl = rgbToHsl(r, g, b);

  // Skin tone detection: hue roughly 0-50, saturation > 20, lightness 30-85
  const isSkinTone = hsl.h >= 0 && hsl.h <= 50 && hsl.s > 20 && hsl.l > 30 && hsl.l < 85;
  if (isSkinTone) return false;

  // Background color matching based on target
  switch (targetBg) {
    case 'blue':
      // Blue background: hue 190-250, decent saturation
      return hsl.h >= 190 && hsl.h <= 250 && hsl.s > 20 && hsl.l > 20;
    case 'red':
      // Red background: hue 340-360 or 0-20, decent saturation
      return ((hsl.h >= 340 || hsl.h <= 20)) && hsl.s > 30 && hsl.l > 20;
    case 'white':
      // White background: high lightness, low saturation
      return hsl.l > 80 && hsl.s < 20;
    default:
      return false;
  }
};

const IdPhotoBgColor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('image/*');
  const [targetColor, setTargetColor] = useState<BgColor>('blue');
  const [sensitivity, setSensitivity] = useState(50);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleChangeBg = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const img = await loadImage(URL.createObjectURL(files[0]));
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      const targetRgb = hexToRgb(BG_COLORS.find(c => c.value === targetColor)?.color || '#438edb');

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        if (isBackground(r, g, b, targetColor, sensitivity)) {
          // Blend with target color based on how "background-like" the pixel is
          const hsl = rgbToHsl(r, g, b);
          let blendFactor = 0.9;

          // For blue: stronger blend for more saturated blue pixels
          if (targetColor === 'blue') {
            blendFactor = Math.min(1, (hsl.s / 100) * 1.2);
          }
          // For red: stronger blend for more saturated red pixels
          else if (targetColor === 'red') {
            blendFactor = Math.min(1, (hsl.s / 100) * 1.2);
          }
          // For white: blend based on lightness
          else {
            blendFactor = Math.min(1, (hsl.l / 100) * 1.1);
          }

          blendFactor = Math.max(0.5, blendFactor);

          data[i] = Math.round(r * (1 - blendFactor) + targetRgb.r * blendFactor);
          data[i + 1] = Math.round(g * (1 - blendFactor) + targetRgb.g * blendFactor);
          data[i + 2] = Math.round(b * (1 - blendFactor) + targetRgb.b * blendFactor);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('换底色失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0]) return;
    const img = await loadImage(URL.createObjectURL(files[0]));
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const targetRgb = hexToRgb(BG_COLORS.find(c => c.value === targetColor)?.color || '#438edb');

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      if (isBackground(r, g, b, targetColor, sensitivity)) {
        const hsl = rgbToHsl(r, g, b);
        let blendFactor = 0.9;
        if (targetColor === 'blue') blendFactor = Math.min(1, (hsl.s / 100) * 1.2);
        else if (targetColor === 'red') blendFactor = Math.min(1, (hsl.s / 100) * 1.2);
        else blendFactor = Math.min(1, (hsl.l / 100) * 1.1);
        blendFactor = Math.max(0.5, blendFactor);

        data[i] = Math.round(r * (1 - blendFactor) + targetRgb.r * blendFactor);
        data[i + 1] = Math.round(g * (1 - blendFactor) + targetRgb.g * blendFactor);
        data[i + 2] = Math.round(b * (1 - blendFactor) + targetRgb.b * blendFactor);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    const name = files[0].name.replace(/\.[^.]+$/, '') + `_${targetColor}.jpg`;
    downloadBlob(blob, name);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/*" label="上传证件照" sublabel="上传带背景色的证件照" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreview(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">目标底色</label>
            <div className="grid grid-cols-3 gap-2">
              {BG_COLORS.map(({ value, label, color }) => (
                <button
                  key={value}
                  onClick={() => setTargetColor(value)}
                  className={`px-3 py-2 text-sm rounded-lg flex items-center justify-center gap-2 ${targetColor === value ? 'ring-2 ring-violet-500 bg-slate-800 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  <div className="w-4 h-4 rounded-full border border-slate-600" style={{ backgroundColor: color }} />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">灵敏度: {sensitivity}%</label>
            <input
              type="range"
              min={20}
              max={80}
              value={sensitivity}
              onChange={e => setSensitivity(Number(e.target.value))}
              className="w-full accent-violet-500"
            />
            <div className="flex justify-between text-xs text-slate-600">
              <span>低 (保留更多细节)</span>
              <span>高 (替换更彻底)</span>
            </div>
          </div>

          <Btn onClick={handleChangeBg} disabled={processing}>{processing ? '处理中...' : '换底色预览'}</Btn>

          {preview && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-slate-500 mb-1">原图</p>
                  <img src={URL.createObjectURL(files[0])} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-1">换底后</p>
                  <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
                </div>
              </div>
              <Btn onClick={handleDownload}>下载换底照片</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default IdPhotoBgColor;
