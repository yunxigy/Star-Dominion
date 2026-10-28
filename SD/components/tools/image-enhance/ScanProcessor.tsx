import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { getImplementedScanModes, type ImplementedScanMode } from '../featureSupport';
import { Crop, Sun, Contrast, Download, Image, Trash2 } from 'lucide-react';

type ScanMode = ImplementedScanMode;

interface ProcessedImage {
  original: File;
  url: string;
  processed?: string;
}

const ScanProcessor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<ScanMode>('auto-crop');
  const [images, setImages] = useState<ProcessedImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newImages = Array.from(fileList)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({ original: f, url: URL.createObjectURL(f) }));
    setImages(prev => [...prev, ...newImages]);
  }, []);

  const removeImage = (idx: number) => {
    setImages(prev => {
      URL.revokeObjectURL(prev[idx].url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const processImage = async (img: ProcessedImage): Promise<string | null> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const image = document.createElement('img');
      image.onload = () => {
        canvas.width = image.width;
        canvas.height = image.height;
        ctx!.drawImage(image, 0, 0);

        const imageData = ctx!.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        switch (mode) {
          case 'auto-crop': {
            // Simple auto-crop: find non-white borders
            let top = 0, bottom = canvas.height, left = 0, right = canvas.width;
            const threshold = 240;
            // Find top
            for (let y = 0; y < canvas.height; y++) {
              let isWhite = true;
              for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (data[i] < threshold || data[i+1] < threshold || data[i+2] < threshold) {
                  isWhite = false; break;
                }
              }
              if (!isWhite) { top = y; break; }
            }
            // Find bottom
            for (let y = canvas.height - 1; y >= 0; y--) {
              let isWhite = true;
              for (let x = 0; x < canvas.width; x++) {
                const i = (y * canvas.width + x) * 4;
                if (data[i] < threshold || data[i+1] < threshold || data[i+2] < threshold) {
                  isWhite = false; break;
                }
              }
              if (!isWhite) { bottom = y + 1; break; }
            }
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = right - left;
            cropCanvas.height = bottom - top;
            cropCanvas.getContext('2d')!.drawImage(canvas, left, top, right - left, bottom - top, 0, 0, right - left, bottom - top);
            resolve(cropCanvas.toDataURL('image/png'));
            break;
          }
          case 'enhance-bw': {
            // Convert to black and white with enhanced contrast
            for (let i = 0; i < data.length; i += 4) {
              const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
              const bw = gray > 128 ? 255 : 0;
              data[i] = data[i+1] = data[i+2] = bw;
            }
            ctx!.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
            break;
          }
          case 'de-shadow': {
            // Simple shadow removal by increasing brightness of dark areas
            for (let i = 0; i < data.length; i += 4) {
              const gray = data[i] * 0.299 + data[i+1] * 0.587 + data[i+2] * 0.114;
              if (gray < 180) {
                const factor = 1 + (180 - gray) / 300;
                data[i] = Math.min(255, data[i] * factor);
                data[i+1] = Math.min(255, data[i+1] * factor);
                data[i+2] = Math.min(255, data[i+2] * factor);
              }
            }
            ctx!.putImageData(imageData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
            break;
          }
          default:
            resolve(canvas.toDataURL('image/png'));
        }
      };
      image.src = img.url;
    });
  };

  const processAll = async () => {
    if (images.length === 0) return;
    setLoading(true);
    try {
      const processed = [];
      for (const img of images) {
        const result = await processImage(img);
        if (result) processed.push({ ...img, processed: result });
      }
      setImages(processed);
      setResult(`处理完成: ${processed.length} 张图片`);
    } catch (e: any) {
      setResult('处理失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadAll = () => {
    images.forEach((img, i) => {
      if (img.processed) {
        const a = document.createElement('a');
        a.href = img.processed;
        a.download = `scan_${i + 1}.png`;
        a.click();
      }
    });
  };

  const modeDetails: Record<ScanMode, { label: string; desc: string }> = {
    'auto-crop': { label: '自动裁边', desc: '去除白边自动裁剪' },
    'de-shadow': { label: '去阴影', desc: '消除扫描阴影' },
    'enhance-bw': { label: '黑白增强', desc: '增强对比度黑白化' },
  };
  const modes = getImplementedScanModes().map(key => ({ key, ...modeDetails[key] }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {modes.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === m.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {m.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[#8b735c]">{modes.find(m => m.key === mode)?.desc}</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept="image/*" label="上传扫描件图片" sublabel="支持批量上传" />
      <input ref={inputRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />

      {images.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm text-[#6d5a47]">已选择 {images.length} 张图片</p>
          <div className="grid grid-cols-4 gap-2 max-h-60 overflow-y-auto">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img src={img.processed || img.url} alt={`scan-${i}`} className="w-full h-20 object-cover rounded-lg border border-[#c79f72]/30" />
                <button onClick={() => removeImage(i)} className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn onClick={processAll} disabled={loading}>{loading ? '处理中...' : '开始处理'}</Btn>
            {images.some(i => i.processed) && <Btn onClick={downloadAll} variant="ghost"><Download className="w-4 h-4 inline mr-1" />下载全部</Btn>}
            <Btn onClick={onClose} variant="ghost">关闭</Btn>
          </div>
        </div>
      )}

      {result && <ResultBox label="结果" value={result} onCopy={() => copyToClipboard(result)} />}
    </div>
  );
};

export default ScanProcessor;
