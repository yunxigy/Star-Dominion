import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

const CompressImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [quality, setQuality] = useState(0.6);
  const [originalSize, setOriginalSize] = useState(0);
  const [compressedSize, setCompressedSize] = useState(0);
  const [originalUrl, setOriginalUrl] = useState('');
  const [compressedUrl, setCompressedUrl] = useState('');

  useEffect(() => () => revokeUrls([originalUrl, compressedUrl]), [originalUrl, compressedUrl]);
  const [processing, setProcessing] = useState(false);

  const handleCompress = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const file = files[0];
      setOriginalSize(file.size);
      const url = URL.createObjectURL(file);
      setOriginalUrl(url);
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
      setCompressedSize(blob.size);
      setCompressedUrl(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('压缩失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0]) return;
    const img = await loadImageFromBlob(files[0]);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_compressed.jpg';
    downloadBlob(blob, name);
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
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
            <button onClick={() => { clearFiles(); setOriginalUrl(''); setCompressedUrl(''); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">压缩质量: {quality.toFixed(1)}</label>
            <input type="range" min={0.1} max={1} step={0.1} value={quality} onChange={e => setQuality(parseFloat(e.target.value))} className="w-full accent-violet-500" />
          </div>
          <Btn onClick={handleCompress} disabled={processing}>{processing ? '处理中...' : '压缩预览'}</Btn>
          {originalUrl && compressedUrl && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-slate-500 mb-1">原图 ({formatSize(originalSize)})</p>
                <img src={originalUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">压缩后 ({formatSize(compressedSize)}) <span className="text-green-400">-{((1 - compressedSize / originalSize) * 100).toFixed(1)}%</span></p>
                <img src={compressedUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
              </div>
            </div>
          )}
          {compressedUrl && <Btn onClick={handleDownload}>下载压缩图片</Btn>}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default CompressImage;
