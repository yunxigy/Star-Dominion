import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, downloadBlob } from '../shared';

interface ConvertedFile {
  name: string;
  originalSize: number;
  convertedSize: number;
  originalUrl: string;
  convertedUrl: string;
  blob: Blob;
}

const HeicToJpg: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, removeFile, handleFiles } = useFileUpload('.heic,.heif');
  const [quality, setQuality] = useState(80);
  const [results, setResults] = useState<ConvertedFile[]>([]);
  const [processing, setProcessing] = useState(false);
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
      const heic2any = (await import('heic2any')).default;
      for (const file of files) {
        try {
          const blob = await heic2any({
            blob: file,
            toType: 'image/jpeg',
            quality: quality / 100,
          }) as Blob;
          const url = URL.createObjectURL(blob);
          newResults.push({
            name: file.name.replace(/\.heic$/i, '.jpg').replace(/\.heif$/i, '.jpg'),
            originalSize: file.size,
            convertedSize: blob.size,
            originalUrl: URL.createObjectURL(file),
            convertedUrl: url,
            blob,
          });
        } catch (e: any) {
          setError(`转换失败: ${e.message || '文件格式不支持'}`);
        }
      }
      setResults(newResults);
    } catch (e: any) {
      setError(`heic2any 加载失败: ${e.message}`);
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
    <div className="space-y-4">
      <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".heic,.heif" label="上传 HEIC/HEIF 图片" sublabel="支持 iPhone 拍摄的 HEIC/HEIF 格式" />
      {files.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">已选择 {files.length} 个文件</span>
            <Btn onClick={clearFiles} variant="ghost">清空</Btn>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-400">质量:</label>
            <input type="range" min="10" max="100" value={quality} onChange={e => setQuality(Number(e.target.value))} className="flex-1" />
            <span className="text-sm text-slate-300 w-10">{quality}%</span>
          </div>
          <Btn onClick={handleConvert} disabled={processing}>
            {processing ? '转换中...' : '开始转换'}
          </Btn>
        </div>
      )}
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">转换结果</span>
            <Btn onClick={handleDownloadAll} variant="ghost">全部下载</Btn>
          </div>
          {results.map((r, i) => (
            <div key={i} className="flex items-center justify-between bg-slate-800/50 rounded-lg p-3">
              <div>
                <p className="text-sm text-slate-200">{r.name}</p>
                <p className="text-xs text-slate-500">{formatSize(r.originalSize)} → {formatSize(r.convertedSize)}</p>
              </div>
              <Btn onClick={() => handleDownload(r)} variant="ghost">下载</Btn>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default HeicToJpg;
