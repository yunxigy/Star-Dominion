import React, { useState } from 'react';
import { Btn, downloadDataUrl } from '../shared';

const Base64ToImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');

  const handleConvert = () => {
    setError('');
    if (!input.trim()) {
      setError('请输入 Base64 字符串');
      return;
    }

    let dataUrl = input.trim();
    // If it doesn't start with data:, try to add the prefix
    if (!dataUrl.startsWith('data:')) {
      // Try to detect image type from base64 header
      if (dataUrl.startsWith('/9j/')) {
        dataUrl = 'data:image/jpeg;base64,' + dataUrl;
      } else if (dataUrl.startsWith('iVBOR')) {
        dataUrl = 'data:image/png;base64,' + dataUrl;
      } else if (dataUrl.startsWith('R0lGOD')) {
        dataUrl = 'data:image/gif;base64,' + dataUrl;
      } else if (dataUrl.startsWith('UklGR')) {
        dataUrl = 'data:image/webp;base64,' + dataUrl;
      } else {
        dataUrl = 'data:image/png;base64,' + dataUrl;
      }
    }

    // Validate by trying to load it
    const img = new Image();
    img.onload = () => {
      setPreview(dataUrl);
      setError('');
    };
    img.onerror = () => {
      setError('无效的 Base64 图片数据');
      setPreview('');
    };
    img.src = dataUrl;
  };

  const handleDownload = () => {
    if (!preview) return;
    // Detect extension from mime type
    let ext = 'png';
    if (preview.includes('image/jpeg')) ext = 'jpg';
    else if (preview.includes('image/gif')) ext = 'gif';
    else if (preview.includes('image/webp')) ext = 'webp';
    downloadDataUrl(preview, `converted.${ext}`);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-sm text-slate-400 mb-1 block">输入 Base64 字符串</label>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="粘贴 Base64 字符串 (支持带 data: 前缀或纯 base64)"
          rows={6}
          className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 font-mono resize-y focus:outline-none focus:border-violet-500/50"
        />
      </div>
      <Btn onClick={handleConvert}>转换为图片</Btn>
      {error && <p className="text-sm text-red-400">{error}</p>}
      {preview && (
        <div>
          <p className="text-xs text-slate-500 mb-1">预览</p>
          <img src={preview} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
          <Btn onClick={handleDownload}>下载图片</Btn>
        </div>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default Base64ToImage;
