import React, { useState, useRef, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

const ImageExifRemover: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/jpeg,image/jpg');
  const [originalSize, setOriginalSize] = useState(0);
  const [cleanSize, setCleanSize] = useState(0);
  const [cleanUrl, setCleanUrl] = useState('');
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => { if (cleanUrl) URL.revokeObjectURL(cleanUrl); }, [cleanUrl]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const handleRemoveExif = async () => {
    if (!files[0]) return;
    setProcessing(true);
    try {
      const file = files[0];
      setOriginalSize(file.size);

      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);

      // Re-encode as JPEG to strip EXIF
      const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
      setCleanSize(blob.size);
      setCleanUrl(URL.createObjectURL(blob));
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert('处理失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!files[0]) return;
    const url = URL.createObjectURL(files[0]);
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.95);
    const name = files[0].name.replace(/\.[^.]+$/, '') + '_no_exif.jpg';
    downloadBlob(blob, name);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/jpeg,image/jpg" label="上传 JPG 图片" sublabel="仅支持 JPG/JPEG 格式" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setCleanUrl(''); setOriginalSize(0); setCleanSize(0); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <Btn onClick={handleRemoveExif} disabled={processing}>{processing ? '处理中...' : '去除 EXIF 信息'}</Btn>

          {cleanUrl && (
            <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">原始大小</span>
                <span className="text-slate-200">{formatSize(originalSize)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">处理后大小</span>
                <span className="text-emerald-400">{formatSize(cleanSize)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">减少</span>
                <span className="text-emerald-400">{formatSize(originalSize - cleanSize)}</span>
              </div>
            </div>
          )}

          {cleanUrl && (
            <div>
              <p className="text-xs text-slate-500 mb-1">预览</p>
              <img src={cleanUrl} className="rounded-lg max-h-48 w-full object-contain bg-slate-800" />
            </div>
          )}

          {cleanUrl && <Btn onClick={handleDownload}>下载无 EXIF 图片</Btn>}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default ImageExifRemover;
