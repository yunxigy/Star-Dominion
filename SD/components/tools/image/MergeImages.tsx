import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob } from '../shared';

type Direction = 'horizontal' | 'vertical';

const MergeImages: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles } = useFileUpload('image/*');
  const [direction, setDirection] = useState<Direction>('horizontal');
  const [gap, setGap] = useState(0);
  const [preview, setPreview] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleMerge = async () => {
    if (files.length < 2) return;
    setProcessing(true);
    try {
      const images = await Promise.all(files.map(f => loadImage(URL.createObjectURL(f))));

      let totalW = 0, totalH = 0;
      if (direction === 'horizontal') {
        totalW = images.reduce((s, img) => s + img.width, 0) + gap * (images.length - 1);
        totalH = Math.max(...images.map(img => img.height));
      } else {
        totalW = Math.max(...images.map(img => img.width));
        totalH = images.reduce((s, img) => s + img.height, 0) + gap * (images.length - 1);
      }

      const canvas = document.createElement('canvas');
      canvas.width = totalW;
      canvas.height = totalH;
      const ctx = canvas.getContext('2d')!;

      let offsetX = 0, offsetY = 0;
      for (const img of images) {
        ctx.drawImage(img, offsetX, offsetY);
        if (direction === 'horizontal') {
          offsetX += img.width + gap;
        } else {
          offsetY += img.height + gap;
        }
      }

      const blob = await canvasToBlob(canvas, 'image/png');
      setPreview(URL.createObjectURL(blob));
    } catch (e: any) {
      alert('拼接失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async () => {
    if (!preview) return;
    const blob = await fetch(preview).then(r => r.blob());
    downloadBlob(blob, `merged_${direction}.png`);
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/*" label="上传多张图片" sublabel="至少需要2张图片" />
      ) : (
        <>
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-800/50 rounded-lg px-3 py-1.5">
                <span className="truncate flex-1">{f.name}</span>
                <button onClick={() => clearFiles()} className="text-red-400 hover:text-red-300 text-xs">移除</button>
              </div>
            ))}
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">排列方式</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setDirection('horizontal')}
                className={`px-3 py-2 text-sm rounded-lg ${direction === 'horizontal' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                横向拼接
              </button>
              <button
                onClick={() => setDirection('vertical')}
                className={`px-3 py-2 text-sm rounded-lg ${direction === 'vertical' ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'}`}
              >
                纵向拼接
              </button>
            </div>
          </div>

          <div>
            <label className="text-sm text-slate-400 mb-1 block">间距: {gap}px</label>
            <input type="range" min={0} max={100} value={gap} onChange={e => setGap(Number(e.target.value))} className="w-full accent-violet-500" />
          </div>

          <Btn onClick={handleMerge} disabled={processing || files.length < 2}>{processing ? '拼接中...' : '拼接预览'}</Btn>

          {preview && (
            <div>
              <p className="text-xs text-slate-500 mb-1">拼接结果</p>
              <img src={preview} className="rounded-lg max-h-64 w-full object-contain bg-slate-800" />
              <Btn onClick={handleDownload}>下载拼接图片</Btn>
            </div>
          )}
        </>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default MergeImages;
