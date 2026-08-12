import React, { useState, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Palette, Copy, CheckCircle, Eye, EyeOff } from 'lucide-react';

interface RGB { r: number; g: number; b: number; }
interface HSL { h: number; s: number; l: number; }

const hexToRgb = (hex: string): RGB | null => {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return null;
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
};

const rgbToHsl = (r: number, g: number, b: number): HSL => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
};

const hslToRgb = (h: number, s: number, l: number): RGB => {
  h /= 360; s /= 100; l /= 100;
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1/3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1/3) * 255),
  };
};

// Relative luminance (WCAG)
const luminance = (r: number, g: number, b: number): number => {
  const [rs, gs, bs] = [r, g, b].map(c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const contrastRatio = (c1: RGB, c2: RGB): number => {
  const l1 = luminance(c1.r, c1.g, c1.b);
  const l2 = luminance(c2.r, c2.g, c2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
};

const ColorTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [hex, setHex] = useState('#7a421b');
  const [rgb, setRgb] = useState<RGB>({ r: 122, g: 66, b: 27 });
  const [hsl, setHsl] = useState<HSL>({ h: 26, s: 64, l: 29 });
  const [copied, setCopied] = useState('');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [showContrast, setShowContrast] = useState(false);

  const updateFromHex = useCallback((h: string) => {
    setHex(h);
    const c = hexToRgb(h);
    if (c) {
      setRgb(c);
      setHsl(rgbToHsl(c.r, c.g, c.b));
    }
  }, []);

  const updateFromRgb = useCallback((r: number, g: number, b: number) => {
    const c = { r: Math.max(0, Math.min(255, r)), g: Math.max(0, Math.min(255, g)), b: Math.max(0, Math.min(255, b)) };
    setRgb(c);
    setHex(rgbToHex(c.r, c.g, c.b));
    setHsl(rgbToHsl(c.r, c.g, c.b));
  }, []);

  const updateFromHsl = useCallback((h: number, s: number, l: number) => {
    const c = hslToRgb(h, s, l);
    setRgb(c);
    setHex(rgbToHex(c.r, c.g, c.b));
    setHsl({ h: Math.max(0, Math.min(360, h)), s: Math.max(0, Math.min(100, s)), l: Math.max(0, Math.min(100, l)) });
  }, []);

  const handleCopy = async (text: string, label: string) => {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(''), 2000);
  };

  const ratio = showContrast ? contrastRatio(rgb, hexToRgb(bgColor) || { r: 255, g: 255, b: 255 }) : 0;
  const wcagAA = ratio >= 4.5;
  const wcagAAA = ratio >= 7;
  const wcagAALarge = ratio >= 3;

  // Generate palette variations
  const palette = [
    { label: '浅色', color: rgbToHex(...Object.values(hslToRgb(hsl.h, hsl.s, Math.min(95, hsl.l + 30))) as [number, number, number]) },
    { label: '原色', color: hex },
    { label: '深色', color: rgbToHex(...Object.values(hslToRgb(hsl.h, hsl.s, Math.max(5, hsl.l - 20))) as [number, number, number]) },
    { label: '互补', color: rgbToHex(...Object.values(hslToRgb((hsl.h + 180) % 360, hsl.s, hsl.l)) as [number, number, number]) },
    { label: '类似1', color: rgbToHex(...Object.values(hslToRgb((hsl.h + 30) % 360, hsl.s, hsl.l)) as [number, number, number]) },
    { label: '类似2', color: rgbToHex(...Object.values(hslToRgb((hsl.h + 330) % 360, hsl.s, hsl.l)) as [number, number, number]) },
    { label: '三等分1', color: rgbToHex(...Object.values(hslToRgb((hsl.h + 120) % 360, hsl.s, hsl.l)) as [number, number, number]) },
    { label: '三等分2', color: rgbToHex(...Object.values(hslToRgb((hsl.h + 240) % 360, hsl.s, hsl.l)) as [number, number, number]) },
  ];

  const CopyBtn = ({ text, label }: { text: string; label: string }) => (
    <button onClick={() => handleCopy(text, label)} className="p-0.5 text-[#7a421b] hover:text-[#6f3714]">
      {copied === label ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
    </button>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">颜色工具 — 取色、格式转换、调色板、对比度检查</p>

      {/* Color picker + preview */}
      <div className="flex gap-3 items-start">
        <div className="relative">
          <input type="color" value={hex} onChange={e => updateFromHex(e.target.value)}
            className="w-16 h-16 rounded-lg border-2 border-[#ead0ad] cursor-pointer" />
        </div>
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg border border-[#ead0ad]" style={{ backgroundColor: hex }} />
            <div className="flex-1">
              <label className="text-[10px] text-[#8b735c]">HEX</label>
              <div className="flex items-center gap-1">
                <input value={hex} onChange={e => { const v = e.target.value; if (/^#[0-9a-f]{0,6}$/i.test(v)) updateFromHex(v); }}
                  className="flex-1 text-xs border border-[#ead0ad] rounded px-2 py-1 font-mono" />
                <CopyBtn text={hex} label="hex" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RGB */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#6f3714]">RGB</span>
          <CopyBtn text={`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`} label="rgb" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['r', 'g', 'b'] as const).map(ch => (
            <div key={ch}>
              <label className="text-[10px] text-[#8b735c]">{ch.toUpperCase()}</label>
              <input type="range" min="0" max="255" value={rgb[ch]}
                onChange={e => updateFromRgb(ch === 'r' ? +e.target.value : rgb.r, ch === 'g' ? +e.target.value : rgb.g, ch === 'b' ? +e.target.value : rgb.b)}
                className="w-full h-1.5 accent-[#7a421b]" />
              <input type="number" min="0" max="255" value={rgb[ch]}
                onChange={e => updateFromRgb(ch === 'r' ? +e.target.value : rgb.r, ch === 'g' ? +e.target.value : rgb.g, ch === 'b' ? +e.target.value : rgb.b)}
                className="w-full text-xs border border-[#ead0ad] rounded px-1 py-0.5 text-center" />
            </div>
          ))}
        </div>
      </div>

      {/* HSL */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#6f3714]">HSL</span>
          <CopyBtn text={`hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`} label="hsl" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="text-[10px] text-[#8b735c]">H (色相)</label>
            <input type="range" min="0" max="360" value={hsl.h} onChange={e => updateFromHsl(+e.target.value, hsl.s, hsl.l)}
              className="w-full h-1.5 accent-[#7a421b]" />
            <input type="number" min="0" max="360" value={hsl.h} onChange={e => updateFromHsl(+e.target.value, hsl.s, hsl.l)}
              className="w-full text-xs border border-[#ead0ad] rounded px-1 py-0.5 text-center" />
          </div>
          <div>
            <label className="text-[10px] text-[#8b735c]">S (饱和度)</label>
            <input type="range" min="0" max="100" value={hsl.s} onChange={e => updateFromHsl(hsl.h, +e.target.value, hsl.l)}
              className="w-full h-1.5 accent-[#7a421b]" />
            <input type="number" min="0" max="100" value={hsl.s} onChange={e => updateFromHsl(hsl.h, +e.target.value, hsl.l)}
              className="w-full text-xs border border-[#ead0ad] rounded px-1 py-0.5 text-center" />
          </div>
          <div>
            <label className="text-[10px] text-[#8b735c]">L (亮度)</label>
            <input type="range" min="0" max="100" value={hsl.l} onChange={e => updateFromHsl(hsl.h, hsl.s, +e.target.value)}
              className="w-full h-1.5 accent-[#7a421b]" />
            <input type="number" min="0" max="100" value={hsl.l} onChange={e => updateFromHsl(hsl.h, hsl.s, +e.target.value)}
              className="w-full text-xs border border-[#ead0ad] rounded px-1 py-0.5 text-center" />
          </div>
        </div>
      </div>

      {/* Palette */}
      <div className="border border-[#ead0ad] rounded-lg p-3">
        <div className="text-xs font-medium text-[#6f3714] mb-2">调色板</div>
        <div className="grid grid-cols-4 gap-1.5">
          {palette.map((p, i) => (
            <button key={i} onClick={() => updateFromHex(p.color)} className="group relative">
              <div className="h-10 rounded border border-[#ead0ad] transition-transform hover:scale-105" style={{ backgroundColor: p.color }} />
              <div className="text-[8px] text-center text-[#8b735c] mt-0.5">{p.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Contrast checker */}
      <div className="border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#6f37114]">WCAG 对比度检查</span>
          <button onClick={() => setShowContrast(!showContrast)} className="text-[#7a421b]">
            {showContrast ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
        </div>
        {showContrast && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#8b735c]">背景色:</span>
              <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                className="w-8 h-8 rounded border border-[#ead0ad] cursor-pointer" />
              <span className="text-xs font-mono text-[#6d5a47]">{bgColor}</span>
            </div>
            <div className="flex items-center gap-3 rounded-lg p-3" style={{ backgroundColor: bgColor }}>
              <span className="text-lg font-bold" style={{ color: hex }}>Aa</span>
              <span className="text-sm" style={{ color: hex }}>示例文本</span>
            </div>
            <div className="text-center">
              <span className="text-2xl font-bold text-[#7a421b]">{ratio.toFixed(2)}:1</span>
            </div>
            <div className="grid grid-cols-3 gap-1 text-center text-[10px]">
              <div className={`rounded p-1 ${wcagAA ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                AA 正文 {wcagAA ? '✓' : '✗'}
              </div>
              <div className={`rounded p-1 ${wcagAALarge ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                AA 大字 {wcagAALarge ? '✓' : '✗'}
              </div>
              <div className={`rounded p-1 ${wcagAAA ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                AAA 正文 {wcagAAA ? '✓' : '✗'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ColorTool;