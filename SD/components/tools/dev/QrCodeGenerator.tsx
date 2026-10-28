import React, { useState, useRef } from 'react';
import { TextArea, Btn } from '../shared';
import QRCode from 'qrcode';

type OutputFormat = 'svg' | 'png';

const QrCodeGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrSvg, setQrSvg] = useState('');
  const [format, setFormat] = useState<OutputFormat>('png');
  const [error, setError] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const handleGenerate = async () => {
    if (!input.trim()) return;
    setError('');
    try {
      if (format === 'svg') {
        const svg = await QRCode.toString(input, { type: 'svg', margin: 2, color: { dark: '#000000', light: '#ffffff' } });
        setQrSvg(svg);
        setQrDataUrl('');
      } else {
        const url = await QRCode.toDataURL(input, { width: 512, margin: 2, color: { dark: '#000000', light: '#ffffff' } });
        setQrDataUrl(url);
        setQrSvg('');
      }
    } catch (e: any) {
      setError('生成失败: ' + e.message);
    }
  };

  const handleDownload = () => {
    if (format === 'svg' && qrSvg) {
      const blob = new Blob([qrSvg], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'qrcode.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else if (qrDataUrl) {
      const a = document.createElement('a');
      a.href = qrDataUrl;
      a.download = 'qrcode.png';
      a.click();
    }
  };

  const handleCopy = async () => {
    if (format === 'svg' && qrSvg) {
      await navigator.clipboard.writeText(qrSvg);
    } else if (qrDataUrl) {
      const res = await fetch(qrDataUrl);
      const blob = await res.blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    }
  };

  return (
    <div className="space-y-4">
      <TextArea
        value={input}
        onChange={setInput}
        placeholder="输入文本或 URL 生成二维码..."
        rows={3}
      />

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-400">格式:</label>
          <select
            value={format}
            onChange={e => setFormat(e.target.value as OutputFormat)}
            className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="png">PNG 图片</option>
            <option value="svg">SVG 矢量</option>
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={handleGenerate} disabled={!input.trim()}>生成二维码</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>

      {error && <p className="text-red-400 text-sm">{error}</p>}

      {(qrDataUrl || qrSvg) && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-center space-y-3">
          <div className="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center overflow-hidden">
            {qrDataUrl && <img src={qrDataUrl} alt="QR Code" className="w-full h-full" />}
            {qrSvg && <div dangerouslySetInnerHTML={{ __html: qrSvg }} className="w-full h-full" />}
          </div>
          <div className="flex gap-2 justify-center">
            <Btn onClick={handleDownload}>下载</Btn>
            <Btn onClick={handleCopy} variant="ghost">复制</Btn>
          </div>
          <p className="text-xs text-slate-500">内容: {input.length > 50 ? input.slice(0, 50) + '...' : input}</p>
        </div>
      )}

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
};

export default QrCodeGenerator;
