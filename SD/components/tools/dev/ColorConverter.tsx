import React, { useState } from 'react';
import { TextInput, Btn, ResultBox, copyToClipboard } from '../shared';

function hexToRgb(hex: string) {
  const m = hex.replace('#', '').match(/^([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null;
}

function rgbToHsl(r: number, g: number, b: number) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const ColorConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('#8b5cf6');
  const [results, setResults] = useState<{ hex: string; rgb: string; hsl: string } | null>(null);

  const convert = () => {
    let rgb: number[] | null = null;
    const v = input.trim();
    if (v.startsWith('#')) rgb = hexToRgb(v);
    else {
      const m = v.match(/rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
      if (m) rgb = [Number(m[1]), Number(m[2]), Number(m[3])];
    }
    if (!rgb) return;
    const [r, g, b] = rgb;
    const [h, s, l] = rgbToHsl(r, g, b);
    setResults({
      hex: `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`,
      rgb: `rgb(${r}, ${g}, ${b})`,
      hsl: `hsl(${h}, ${s}%, ${l}%)`,
    });
  };

  return (
    <div className="space-y-3">
      <TextInput value={input} onChange={setInput} placeholder="#ff0000 或 rgb(255,0,0)" />
      <div className="flex gap-2">
        <Btn onClick={convert}>转换</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {results && (
        <div className="flex gap-3 items-start">
          <div className="w-16 h-16 rounded-lg border border-slate-700 shrink-0" style={{ background: results.hex }} />
          <div className="flex-1 space-y-1">
            <ResultBox label="HEX" value={results.hex} onCopy={() => copyToClipboard(results.hex)} />
            <ResultBox label="RGB" value={results.rgb} onCopy={() => copyToClipboard(results.rgb)} />
            <ResultBox label="HSL" value={results.hsl} onCopy={() => copyToClipboard(results.hsl)} />
          </div>
        </div>
      )}
    </div>
  );
};

export default ColorConverter;
