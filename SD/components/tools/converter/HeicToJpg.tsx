import React, { useState } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, downloadBlob } from '../shared';

const heicAvailable = false;

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
  const [libLoaded] = useState(heicAvailable);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    setError('heic2any 库未安装，请运行 npm install heic2any 后重试');
  };

  const handleDownload = (result: ConvertedFile) => {
    downloadBlob(result.blob, result.name);
  };

  const handleDownloadAll = () => {
    results.forEach(r => downloadBlob(r.blob, r.name));
  };

  if (!libLoaded) {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-900/20 border border-yellow-500/30 rounded-lg p-4">
          <p className="text-yellow-400 font-medium mb-2">缺少 heic2any 依赖库</p>
          <p className="text-sm text-slate-400">
            HEIC 格式转换需要 heic2any 库支持。浏览器原生不支持 HEIC/HEIF 格式。
          </p>
          <div className="mt-3 bg-slate-800 rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1">安装命令:</p>
            <code className="text-sm text-violet-400 font-mono">npm install heic2any</code>
          </div>
          <p className="text-sm text-slate-500 mt-2">
            或者，您可以先使用其他工具（如系统相册或在线转换器）将 HEIC 转为 JPG/PNG 后再上传。
          </p>
        </div>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <input {...inputProps} />
      {files.length === 0 ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".heic,.heif" label="上传 HEIC 图片" sublabel="支持 .heic / .heif 格式 (iPhone 照片)" />
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
            <label className="text-sm text-slate-400">JPEG 质量: {quality}%</label>
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
            <Btn onClick={handleConvert} disabled={processing}>
              {processing ? '转换中...' : '开始转换'}
            </Btn>
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
                <div className="rounded-lg max-h-32 w-full flex items-center justify-center bg-slate-900">
                  <p className="text-xs text-slate-600">HEIC 预览不可用</p>
                </div>
                <img src={r.convertedUrl} className="rounded-lg max-h-32 w-full object-contain bg-slate-900" />
              </div>
              <Btn onClick={() => handleDownload(r)}>下载 JPG</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default HeicToJpg;
