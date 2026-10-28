import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image, Upload, Download, Trash2, CheckCircle2 } from 'lucide-react';

interface ImageConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type OutputFormat = 'image/png' | 'image/jpeg' | 'image/webp';
type FormatLabel = 'PNG' | 'JPG' | 'WebP';

interface ImageItem {
  id: string;
  file: File;
  preview: string;
  converted?: string;
  converting?: boolean;
}

const FORMAT_MAP: { label: FormatLabel; mime: OutputFormat }[] = [
  { label: 'PNG', mime: 'image/png' },
  { label: 'JPG', mime: 'image/jpeg' },
  { label: 'WebP', mime: 'image/webp' },
];

export const ImageConvertModal: React.FC<ImageConvertModalProps> = ({ isOpen, onClose }) => {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [targetFormat, setTargetFormat] = useState<OutputFormat>('image/png');
  const [quality, setQuality] = useState(0.92);
  const [converting, setConverting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImages: ImageItem[] = [];
    Array.from(files).forEach(file => {
      if (file.type.startsWith('image/')) {
        newImages.push({
          id: Math.random().toString(36).slice(2),
          file,
          preview: URL.createObjectURL(file),
        });
      }
    });
    setImages(prev => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((id: string) => {
    setImages(prev => {
      const item = prev.find(i => i.id === id);
      if (item) {
        URL.revokeObjectURL(item.preview);
        if (item.converted) URL.revokeObjectURL(item.converted);
      }
      return prev.filter(i => i.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    images.forEach(img => {
      URL.revokeObjectURL(img.preview);
      if (img.converted) URL.revokeObjectURL(img.converted);
    });
    setImages([]);
  }, [images]);

  const convertImage = useCallback((item: ImageItem): Promise<string> => {
    return new Promise((resolve) => {
      const img = new window.Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        // JPG doesn't support transparency, fill white
        if (targetFormat === 'image/jpeg') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(img, 0, 0);
        const blob = canvas.toDataURL(targetFormat, quality);
        resolve(blob);
      };
      img.src = item.preview;
    });
  }, [targetFormat, quality]);

  const handleConvertAll = useCallback(async () => {
    setConverting(true);
    const updated = [...images];
    for (let i = 0; i < updated.length; i++) {
      updated[i] = { ...updated[i], converting: true };
      setImages([...updated]);
      const result = await convertImage(updated[i]);
      updated[i] = { ...updated[i], converted: result, converting: false };
      setImages([...updated]);
    }
    setConverting(false);
  }, [images, convertImage]);

  const downloadOne = useCallback((item: ImageItem) => {
    if (!item.converted) return;
    const ext = targetFormat.split('/')[1] === 'jpeg' ? 'jpg' : targetFormat.split('/')[1];
    const name = item.file.name.replace(/\.[^.]+$/, `.${ext}`);
    const a = document.createElement('a');
    a.href = item.converted;
    a.download = name;
    a.click();
  }, [targetFormat]);

  const downloadAll = useCallback(() => {
    images.forEach(item => {
      if (item.converted) downloadOne(item);
    });
  }, [images, downloadOne]);

  const showQuality = targetFormat === 'image/jpeg' || targetFormat === 'image/webp';

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm"
        />
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 50 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 50 }}
          className="relative w-full max-w-2xl bg-gradient-to-b from-slate-900 to-black border border-violet-500/30 rounded-2xl shadow-[0_0_50px_rgba(139,92,246,0.2)] overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-violet-500/5 shrink-0">
            <h2 className="text-2xl font-bold text-violet-400 flex items-center gap-2">
              <Image className="w-6 h-6" />
              图片格式转换
            </h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Controls */}
          <div className="p-4 border-b border-slate-800 space-y-4 shrink-0">
            {/* Format selection */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-400">目标格式:</span>
              <div className="flex gap-2">
                {FORMAT_MAP.map(f => (
                  <button
                    key={f.label}
                    onClick={() => setTargetFormat(f.mime)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      targetFormat === f.mime
                        ? 'bg-violet-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quality slider */}
            {showQuality && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-400">质量:</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.01}
                  value={quality}
                  onChange={e => setQuality(parseFloat(e.target.value))}
                  className="flex-1 accent-violet-500"
                />
                <span className="text-sm text-slate-300 font-mono w-12">{Math.round(quality * 100)}%</span>
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
              >
                <Upload className="w-4 h-4" /> 添加图片
              </button>
              {images.length > 0 && (
                <>
                  <button
                    onClick={handleConvertAll}
                    disabled={converting}
                    className="flex items-center gap-2 px-4 py-2 bg-violet-600 rounded-lg text-sm text-white hover:bg-violet-500 transition-colors disabled:opacity-50"
                  >
                    {converting ? '转换中...' : `全部转换 (${images.length})`}
                  </button>
                  <button
                    onClick={clearAll}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-sm text-slate-400 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" /> 清空
                  </button>
                  {images.some(i => i.converted) && (
                    <button
                      onClick={downloadAll}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-500/30 rounded-lg text-sm text-green-400 hover:bg-green-600/30 transition-colors"
                    >
                      <Download className="w-4 h-4" /> 全部下载
                    </button>
                  )}
                </>
              )}
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={e => handleFiles(e.target.files)}
            />
          </div>

          {/* Image list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {images.length === 0 ? (
              <div
                className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-violet-500/50 transition-colors"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                <p className="text-slate-400">拖拽或点击上传图片</p>
                <p className="text-xs text-slate-600 mt-1">支持 PNG、JPG、WebP、BMP 等格式</p>
              </div>
            ) : (
              images.map(item => (
                <div key={item.id} className="flex items-center gap-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700">
                  <img src={item.preview} className="w-16 h-16 object-cover rounded-lg bg-slate-900" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-200 truncate">{item.file.name}</p>
                    <p className="text-xs text-slate-500">{(item.file.size / 1024).toFixed(1)} KB</p>
                  </div>
                  {item.converting && (
                    <span className="text-xs text-violet-400 animate-pulse">转换中...</span>
                  )}
                  {item.converted && !item.converting && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-5 h-5 text-green-400" />
                      <button
                        onClick={() => downloadOne(item)}
                        className="p-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => removeImage(item.id)}
                    className="p-2 rounded-lg hover:bg-slate-700 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="p-4 bg-slate-900/80 text-center text-xs text-slate-600 border-t border-slate-800 shrink-0">
            纯前端转换 • 图片不会上传到服务器
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
