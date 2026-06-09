import React, { useState, useCallback, useRef } from 'react';
import { Upload, Loader2, Copy, Download, Trash2, ImageIcon } from 'lucide-react';

export default function OcrRecognition({ onClose }: { onClose: () => void }) {
  const [image, setImage] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('chi_sim+eng');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setImage(ev.target?.result as string);
        setResult('');
      };
      reader.readAsDataURL(file);
    }
  }, []);

  const handleRecognize = useCallback(async () => {
    if (!image) return;

    setLoading(true);
    try {
      const Tesseract = await import('tesseract.js');
      const { data: { text } } = await Tesseract.recognize(image, language, {
        logger: (info) => {
          console.log(info);
        },
      });
      setResult(text);
    } catch (err) {
      console.error('OCR failed:', err);
      setResult('识别失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [image, language]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(result);
  }, [result]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([result], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ocr-result.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleClear = useCallback(() => {
    setImage(null);
    setResult('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  return (
    <div className="space-y-6">
      {/* Language Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">识别语言</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/20"
        >
          <option value="chi_sim+eng">中文+英文</option>
          <option value="chi_sim">中文</option>
          <option value="eng">英文</option>
          <option value="jpn">日文</option>
          <option value="kor">韩文</option>
        </select>
      </div>

      {/* Upload Area */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">上传图片</label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
          id="ocr-upload"
        />
        <label
          htmlFor="ocr-upload"
          className="flex flex-col items-center justify-center gap-3 p-8 border-2 border-dashed border-white/20 rounded-xl cursor-pointer hover:border-white/40 transition-colors"
        >
          {image ? (
            <img src={image} alt="Preview" className="max-h-48 rounded-lg object-contain" />
          ) : (
            <>
              <ImageIcon className="w-12 h-12 text-slate-400" />
              <span className="text-sm text-slate-400">点击或拖拽上传图片</span>
            </>
          )}
        </label>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleRecognize}
          disabled={loading || !image}
          className="flex-1 py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              识别中...
            </>
          ) : (
            '开始识别'
          )}
        </button>
        <button
          onClick={handleClear}
          className="px-4 py-3 bg-white/5 border border-white/10 text-slate-300 rounded-xl hover:bg-white/10 transition-colors"
        >
          <Trash2 className="w-5 h-5" />
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">识别结果</label>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                title="复制"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={handleDownload}
                className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                title="下载"
              >
                <Download className="w-4 h-4" />
              </button>
            </div>
          </div>
          <textarea
            value={result}
            onChange={(e) => setResult(e.target.value)}
            className="w-full h-48 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
            placeholder="识别结果将显示在这里..."
          />
        </div>
      )}
    </div>
  );
}
