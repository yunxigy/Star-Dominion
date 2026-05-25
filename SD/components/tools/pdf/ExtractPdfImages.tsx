import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useFileUpload, UploadZone, Btn, downloadBlob } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

interface ExtractedImage {
  dataUrl: string;
  page: number;
  index: number;
  width: number;
  height: number;
}

const ExtractPdfImages: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.pdf');
  const [images, setImages] = useState<ExtractedImage[]>([]);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const file = files[0];

  const handleExtract = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    setLoading(true);
    setImages([]);
    setStatus('正在提取图片...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const extracted: ExtractedImage[] = [];
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在扫描第 ${p}/${doc.numPages} 页...`);
        const page = await doc.getPage(p);
        const ops = await page.getOperatorList();
        for (let i = 0; i < ops.fnArray.length; i++) {
          if (ops.fnArray[i] === pdfjsLib.OPS.paintImageXObject ||
              ops.fnArray[i] === (pdfjsLib.OPS as any).paintJpegXObject) {
            try {
              const imgName = ops.argsArray[i][0];
              const img = await new Promise<any>((resolve, reject) => {
                page.objs.get(imgName, (obj: any) => {
                  if (obj) resolve(obj);
                  else reject(new Error('Image object not found'));
                });
              });
              if (!img || !img.data) continue;
              const canvas = document.createElement('canvas');
              canvas.width = img.width;
              canvas.height = img.height;
              const ctx = canvas.getContext('2d')!;
              const imageData = ctx.createImageData(img.width, img.height);
              const src = img.data;
              const dst = imageData.data;
              const len = Math.min(src.length, dst.length);
              for (let j = 0; j < len; j++) {
                dst[j] = src[j];
              }
              ctx.putImageData(imageData, 0, 0);
              extracted.push({
                dataUrl: canvas.toDataURL('image/png'),
                page: p,
                index: extracted.length + 1,
                width: img.width,
                height: img.height,
              });
            } catch {
              // Skip images that can't be extracted
            }
          }
        }
      }
      setImages(extracted);
      setStatus(extracted.length > 0 ? `提取完成，共找到 ${extracted.length} 张图片` : '未找到内嵌图片');
    } catch (err: any) {
      setStatus(`提取失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = (img: ExtractedImage) => {
    const a = document.createElement('a');
    a.href = img.dataUrl;
    a.download = `page${img.page}_img${img.index}.png`;
    a.click();
  };

  const handleDownloadAll = () => {
    images.forEach(img => handleDownload(img));
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，提取内嵌的图片资源。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
        </div>
      )}
      <Btn onClick={handleExtract} disabled={!file || loading}>
        {loading ? '提取中...' : '开始提取'}
      </Btn>
      {images.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400">共 {images.length} 张图片</span>
            <Btn onClick={handleDownloadAll} variant="ghost">全部下载</Btn>
          </div>
          <div className="grid grid-cols-2 gap-3 max-h-80 overflow-y-auto">
            {images.map((img, i) => (
              <div key={i} className="bg-slate-800/50 border border-slate-700 rounded-lg p-2 space-y-2">
                <img src={img.dataUrl} alt={`Page ${img.page} Image ${img.index}`}
                  className="w-full h-32 object-contain rounded" />
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">第{img.page}页, {img.width}x{img.height}</span>
                  <button onClick={() => handleDownload(img)} className="text-xs text-violet-400 hover:text-violet-300">下载</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default ExtractPdfImages;
