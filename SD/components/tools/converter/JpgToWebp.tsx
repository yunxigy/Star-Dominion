import React, { useState, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, canvasToBlob, downloadBlob, revokeUrls } from '../shared';

interface ConvertedFile {
  name: string;
  originalSize: number;
  convertedSize: number;
  originalUrl: string;
  convertedUrl: string;
  blob: Blob;
}

const JpgToWebp: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, removeFile, handleFiles } = useFileUpload('image/jpeg');
  const [quality, setQuality] = useState(80);
  const [results, setResults] = useState<ConvertedFile[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => { results.forEach(r => { URL.revokeObjectURL(r.originalUrl); URL.revokeObjectURL(r.convertedUrl); }); }, [results]);
  const [error, setError] = useState('');

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    setProcessing(true);
    setError('');
    const newResults: ConvertedFile[] = [];
    try {
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const blob = await canvasToBlob(canvas, 'image/webp', quality / 100);
        newResults.push({
          name: file.name.replace(/\.[^.]+$/, '.webp'),
          originalSize: file.size,
          convertedSize: blob.size,
          originalUrl: url,
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
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/jpeg" label="上传 JPG 图片" sublabel="转换为 WebP 格式，体积更小" />
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
          <div className="space-y-2">
            <label className="text-sm text-slate-400">WebP 质量: {quality}%</label>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={quality}
              onChange={e => setQuality(parseInt(e.target.value))}
              className="w-full accent-violet-500"
            />
          </div>
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
                  <span className="text-green-400 ml-1">-{((1 - r.convertedSize / r.originalSize) * 100).toFixed(1)}%</span>
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <img src={r.originalUrl} className="rounded-lg max-h-32 w-full object-contain bg-slate-900" />
                <img src={r.convertedUrl} className="rounded-lg max-h-32 w-full object-contain bg-slate-900" />
              </div>
              <Btn onClick={() => handleDownload(r)}>下载 WebP</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default JpgToWebp;
