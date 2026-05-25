import React, { useRef, useState } from 'react';
import { Btn } from '../shared';

const QrCodeReader: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('需要安装 jsQR 依赖包才能解析二维码。npm install jsQR');
    setResult('');
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
      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {error && <p className="text-yellow-400/80 text-sm">{error}</p>}
      {result && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-sm text-slate-200 font-mono break-all">{result}</p>
        </div>
      )}
    </div>
  );
};

export default QrCodeReader;
