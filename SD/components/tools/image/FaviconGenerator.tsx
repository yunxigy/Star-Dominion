import React, { useState, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, loadImageFromBlob, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

interface FaviconSize {
  size: number;
  label: string;
}

const FAVICON_SIZES: FaviconSize[] = [
  { size: 16, label: '16x16' },
  { size: 24, label: '24x24' },
  { size: 32, label: '32x32' },
  { size: 48, label: '48x48' },
  { size: 64, label: '64x64' },
  { size: 128, label: '128x128' },
  { size: 256, label: '256x256' },
];

const FaviconGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, handleFiles } = useFileUpload('image/*');
  const [selectedSizes, setSelectedSizes] = useState<Set<number>>(new Set([16, 32, 64]));
  const [previews, setPreviews] = useState<Map<number, string>>(new Map());
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => revokeUrls([...previews.values()]), [previews]);

  const toggleSize = (size: number) => {
    setSelectedSizes(prev => {
      const next = new Set(prev);
      if (next.has(size)) next.delete(size);
      else next.add(size);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (!files[0] || selectedSizes.size === 0) return;
    setProcessing(true);
    try {
      const img = await loadImageFromBlob(files[0]);
      const newPreviews = new Map<number, string>();

      for (const size of selectedSizes) {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d')!;
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, size, size);
        const blob = await canvasToBlob(canvas, 'image/png');
        newPreviews.set(size, URL.createObjectURL(blob));
      }

      setPreviews(newPreviews);
    } catch (e: any) {
      alert('生成失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (size: number) => {
    const url = previews.get(size);
    if (!url) return;
    const blob = await fetch(url).then(r => r.blob());
    downloadBlob(blob, `favicon_${size}x${size}.png`);
  };

  const handleDownloadAll = async () => {
    for (const size of selectedSizes) {
      await handleDownload(size);
    }
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/*" label="上传图片" sublabel="建议使用正方形图片" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <span className="truncate">{files[0].name}</span>
            <button onClick={() => { clearFiles(); setPreviews(new Map()); }} className="text-red-400 hover:text-red-300 text-xs">移除</button>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-2 block">选择尺寸</label>
            <div className="flex flex-wrap gap-2">
              {FAVICON_SIZES.map(({ size, label }) => (
                <button
                  key={size}
                  onClick={() => toggleSize(size)}
                  className={`px-3 py-1.5 text-xs rounded-lg ${selectedSizes.has(size) ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <Btn onClick={handleGenerate} disabled={processing || selectedSizes.size === 0}>
            {processing ? '生成中...' : '生成 Favicon'}
          </Btn>

          {previews.size > 0 && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {Array.from(previews.entries()).map(([size, url]) => (
                  <div key={size} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-2">{size}x{size}</p>
                    <div className="flex justify-center mb-2">
                      <img src={url} className="border border-slate-600 rounded" style={{ width: Math.min(size, 64), height: Math.min(size, 64), imageRendering: size <= 32 ? 'pixelated' : 'auto' }} />
                    </div>
                    <button onClick={() => handleDownload(size)} className="text-xs text-violet-400 hover:text-violet-300">下载</button>
                  </div>
                ))}
              </div>
              <Btn onClick={handleDownloadAll}>下载全部</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default FaviconGenerator;
