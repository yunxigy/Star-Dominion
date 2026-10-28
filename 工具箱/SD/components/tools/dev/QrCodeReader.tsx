import React, { useRef, useState, useCallback } from 'react';
import { Btn } from '../shared';

const QrCodeReader: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setResult('');
    setLoading(true);

    try {
      const jsQR = (await import('jsqr')).default;
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          setError('无法创建 canvas 上下文');
          setLoading(false);
          return;
        }
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height);

        if (code) {
          setResult(code.data);
        } else {
          setError('未识别到二维码，请确保图片清晰且包含二维码');
        }
        URL.revokeObjectURL(url);
        setLoading(false);
      };

      img.onerror = () => {
        setError('图片加载失败');
        URL.revokeObjectURL(url);
        setLoading(false);
      };

      img.src = url;
    } catch (e: any) {
      setError(`jsQR 加载失败: ${e.message}`);
      setLoading(false);
    }
  }, []);

  const copyResult = () => {
    navigator.clipboard.writeText(result);
  };

  return (
    <div className="space-y-3">
      <div
        className="border-2 border-dashed border-slate-700 rounded-xl p-8 text-center cursor-pointer hover:border-violet-500/50 transition-colors"
        onClick={() => ref.current?.click()}
      >
        <p className="text-slate-400">点击上传二维码图片</p>
        <p className="text-xs text-slate-600 mt-1">支持 PNG, JPG, BMP</p>
      </div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={handleFile} />

      {loading && <p className="text-slate-400 text-sm">识别中...</p>}
      {error && <p className="text-yellow-400/80 text-sm">{error}</p>}

      {result && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs text-slate-500">识别结果</span>
            <button onClick={copyResult} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
          </div>
          <p className="text-sm text-slate-200 font-mono break-all">{result}</p>
          {result.startsWith('http') && (
            <a href={result} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline mt-2 block">
              打开链接 →
            </a>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default QrCodeReader;
