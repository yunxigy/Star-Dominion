import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, canvasToBlob, downloadBlob } from '../shared';

interface ConvertedFile {
  name: string;
  originalSize: number;
  convertedSize: number;
  originalUrl: string;
  convertedUrl: string;
  blob: Blob;
}

const SvgToPng: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, removeFile } = useFileUpload('image/svg+xml');
  const [width, setWidth] = useState(512);
  const [height, setHeight] = useState(512);
  const [keepRatio, setKeepRatio] = useState(true);
  const [results, setResults] = useState<ConvertedFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const readSvgAsDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('读取 SVG 文件失败'));
      reader.readAsDataURL(file);
    });
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError('');
    const newResults: ConvertedFile[] = [];
    try {
      for (const file of files) {
        const dataUrl = await readSvgAsDataUrl(file);
        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('SVG 图像加载失败'));
          img.src = dataUrl;
        });

        let outWidth = width;
        let outHeight = height;
        if (keepRatio && img.naturalWidth > 0 && img.naturalHeight > 0) {
          const ratio = img.naturalWidth / img.naturalHeight;
          if (width / height > ratio) {
            outWidth = Math.round(height * ratio);
            outHeight = height;
          } else {
            outWidth = width;
            outHeight = Math.round(width / ratio);
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = outWidth;
        canvas.height = outHeight;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, outWidth, outHeight);
        const blob = await canvasToBlob(canvas, 'image/png');
        newResults.push({
          name: file.name.replace(/\.[^.]+$/, '.png'),
          originalSize: file.size,
          convertedSize: blob.size,
          originalUrl: dataUrl,
          convertedUrl: URL.createObjectURL(blob),
          blob,
        });
      }
      setResults(newResults);
    } catch (e: any) {
      setError('转换失败: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = (result: ConvertedFile) => {
    downloadBlob(result.blob, result.name);
  };

  const handleDownloadAll = () => {
    results.forEach(r => downloadBlob(r.blob, r.name));
  };

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} accept="image/svg+xml,.svg" label="上传 SVG 文件" sublabel="支持 .svg 矢量图格式" />
      ) : (
        <>
          <div className="space-y-1">
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-slate-300 bg-slate-800/50 rounded-lg px-3 py-2">
                <span className="truncate flex-1">{f.name}</span>
                <span className="text-xs text-slate-500">{formatSize(f.size)}</span>
                <button onClick={() => removeFile(i)} className="text-red-400 hover:text-red-300 text-xs">移除</button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-sm text-slate-400">输出宽度 (px)</label>
              <input
                type="number"
                min={1}
                max={8192}
                value={width}
                onChange={e => {
                  const w = parseInt(e.target.value) || 1;
                  setWidth(w);
                  if (keepRatio) {
                    // Can't auto-calc height without knowing SVG ratio yet
                  }
                }}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-slate-400">输出高度 (px)</label>
              <input
                type="number"
                min={1}
                max={8192}
                value={height}
                onChange={e => setHeight(parseInt(e.target.value) || 1)}
                className="w-full bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={keepRatio}
              onChange={e => setKeepRatio(e.target.checked)}
              className="accent-violet-500"
            />
            保持宽高比
          </label>
          <div className="flex gap-2">
            <Btn onClick={handleConvert} disabled={processing}>{processing ? '转换中...' : '开始转换'}</Btn>
            <Btn onClick={() => { clearFiles(); setResults([]); }} variant="ghost">清空</Btn>
          </div>
        </>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-400">转换结果 ({results.length} 个文件)</p>
            {results.length > 1 && <Btn onClick={handleDownloadAll} variant="ghost">全部下载</Btn>}
          </div>
          {results.map((r, i) => (
            <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-300 truncate">{r.name}</span>
                <span className="text-xs text-slate-500">
                  {formatSize(r.originalSize)} → {formatSize(r.convertedSize)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg max-h-32 w-full flex items-center justify-center bg-slate-900 p-2">
                  <img src={r.originalUrl} className="max-h-28 max-w-full object-contain" />
                </div>
                <img src={r.convertedUrl} className="rounded-lg max-h-32 w-full object-contain bg-slate-900" />
              </div>
              <Btn onClick={() => handleDownload(r)}>下载 PNG</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default SvgToPng;
