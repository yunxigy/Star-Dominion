import React, { useState, useEffect } from 'react';
import { useFileUpload, UploadZone, Btn, loadImage, downloadBlob, revokeUrls } from '../shared';

interface ConvertedFile {
  name: string;
  originalSize: number;
  convertedSize: number;
  originalUrl: string;
  blob: Blob;
}

const ICO_SIZES = [16, 32, 48, 64, 128, 256];

const PngToIco: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, inputProps, triggerUpload, clearFiles, removeFile, handleFiles } = useFileUpload('image/png');
  const [selectedSizes, setSelectedSizes] = useState<number[]>([16, 32, 48, 64, 128, 256]);
  const [results, setResults] = useState<ConvertedFile[]>([]);
  const [processing, setProcessing] = useState(false);

  useEffect(() => () => { results.forEach(r => { if (r.originalUrl) URL.revokeObjectURL(r.originalUrl); }); }, [results]);
  const [error, setError] = useState('');

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const toggleSize = (size: number) => {
    setSelectedSizes(prev =>
      prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size].sort((a, b) => a - b)
    );
  };

  const canvasToPngArrayBuffer = async (canvas: HTMLCanvasElement): Promise<ArrayBuffer> => {
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png');
    });
    return blob.arrayBuffer();
  };

  const buildIcoFile = (pngDataArray: { width: number; height: number; data: ArrayBuffer }[]): Blob => {
    const count = pngDataArray.length;
    // ICO header: 6 bytes
    // Each directory entry: 16 bytes
    // Total header + directory: 6 + count * 16
    const headerSize = 6 + count * 16;
    let totalSize = headerSize;
    for (const item of pngDataArray) {
      totalSize += item.data.byteLength;
    }

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // ICO header
    view.setUint16(0, 0, true);        // reserved
    view.setUint16(2, 1, true);        // type: 1 = icon
    view.setUint16(4, count, true);    // number of images

    let dataOffset = headerSize;
    for (let i = 0; i < count; i++) {
      const entryOffset = 6 + i * 16;
      const item = pngDataArray[i];
      view.setUint8(entryOffset, item.width < 256 ? item.width : 0);      // width
      view.setUint8(entryOffset + 1, item.height < 256 ? item.height : 0); // height
      view.setUint8(entryOffset + 2, 0);   // color count (0 for PNG)
      view.setUint8(entryOffset + 3, 0);   // reserved
      view.setUint16(entryOffset + 4, 1, true);  // color planes
      view.setUint16(entryOffset + 6, 32, true); // bits per pixel
      view.setUint32(entryOffset + 8, item.data.byteLength, true);  // data size
      view.setUint32(entryOffset + 12, dataOffset, true);           // data offset

      // Copy PNG data
      const uint8 = new Uint8Array(buffer);
      uint8.set(new Uint8Array(item.data), dataOffset);
      dataOffset += item.data.byteLength;
    }

    return new Blob([buffer], { type: 'image/x-icon' });
  };

  const handleConvert = async () => {
    if (files.length === 0) return;
    if (selectedSizes.length === 0) {
      setError('请至少选择一个尺寸');
      return;
    }
    setProcessing(true);
    setError('');
    const newResults: ConvertedFile[] = [];
    try {
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const img = await loadImage(url);

        const pngDataArray: { width: number; height: number; data: ArrayBuffer }[] = [];
        for (const size of selectedSizes) {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, size, size);
          const data = await canvasToPngArrayBuffer(canvas);
          pngDataArray.push({ width: size, height: size, data });
        }

        const blob = buildIcoFile(pngDataArray);
        newResults.push({
          name: file.name.replace(/\.[^.]+$/, '.ico'),
          originalSize: file.size,
          convertedSize: blob.size,
          originalUrl: url,
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
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept="image/png" label="上传 PNG 图片" sublabel="转换为 ICO 图标文件" />
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
            <label className="text-sm text-slate-400">ICO 包含尺寸:</label>
            <div className="flex flex-wrap gap-2">
              {ICO_SIZES.map(size => (
                <button
                  key={size}
                  onClick={() => toggleSize(size)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    selectedSizes.includes(size)
                      ? 'bg-violet-600 text-white'
                      : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                  }`}
                >
                  {size}x{size}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-600">已选 {selectedSizes.length} 个尺寸</p>
          </div>
          <div className="flex gap-2">
            <Btn onClick={handleConvert} disabled={processing || selectedSizes.length === 0}>
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
                  原始: {formatSize(r.originalSize)} → ICO: {formatSize(r.convertedSize)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <img src={r.originalUrl} className="rounded-lg max-h-16 w-16 object-contain bg-slate-900" />
                <div className="text-xs text-slate-500">
                  包含 {selectedSizes.length} 个尺寸: {selectedSizes.join(', ')}px
                </div>
              </div>
              <Btn onClick={() => handleDownload(r)}>下载 ICO</Btn>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={onClose} variant="ghost">关闭</Btn>
    </div>
  );
};

export default PngToIco;
