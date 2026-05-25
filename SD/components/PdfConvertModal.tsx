import React, { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, FileText, Upload, Download, Image as ImageIcon, Trash2, ChevronLeft, FileSpreadsheet } from 'lucide-react';

interface PdfConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type Mode = 'select' | 'pdf2img' | 'img2pdf' | 'word2pdf';

export const PdfConvertModal: React.FC<PdfConvertModalProps> = ({ isOpen, onClose }) => {
  const [mode, setMode] = useState<Mode>('select');
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfPages, setPdfPages] = useState<string[]>([]);
  const [imgFiles, setImgFiles] = useState<{ file: File; preview: string }[]>([]);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pdfjsLib, setPdfjsLib] = useState<any>(null);
  const [wordFile, setWordFile] = useState<File | null>(null);
  const [wordHtml, setWordHtml] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wordRenderRef = useRef<HTMLDivElement>(null);

  const loadPdfjs = useCallback(async () => {
    if (pdfjsLib) return pdfjsLib;
    const lib = await import('pdfjs-dist');
    lib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${lib.version}/pdf.worker.min.mjs`;
    setPdfjsLib(lib);
    return lib;
  }, [pdfjsLib]);

  const handlePdfUpload = useCallback(async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    if (file.type !== 'application/pdf') return;
    setPdfFile(file);
    setConverting(true);
    setProgress(0);

    try {
      const lib = await loadPdfjs();
      const buffer = await file.arrayBuffer();
      const doc = await lib.getDocument({ data: buffer }).promise;
      const pages: string[] = [];

      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d')!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        pages.push(canvas.toDataURL('image/png'));
        setProgress(Math.round((i / doc.numPages) * 100));
      }
      setPdfPages(pages);
    } catch (e) {
      console.error('PDF parse error:', e);
    }
    setConverting(false);
  }, [loadPdfjs]);

  const handleImgUpload = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImgs = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map(file => ({ file, preview: URL.createObjectURL(file) }));
    setImgFiles(prev => [...prev, ...newImgs]);
  }, []);

  const downloadPage = useCallback((dataUrl: string, index: number) => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `page_${index + 1}.png`;
    a.click();
  }, []);

  const downloadAllPages = useCallback(() => {
    pdfPages.forEach((page, i) => downloadPage(page, i));
  }, [pdfPages, downloadPage]);

  const convertToPdf = useCallback(async () => {
    if (imgFiles.length === 0) return;
    setConverting(true);
    setProgress(0);

    try {
      const { jsPDF } = await import('jspdf');
      const pdf = new jsPDF();

      for (let i = 0; i < imgFiles.length; i++) {
        const img = imgFiles[i];
        const imgEl = await new Promise<HTMLImageElement>((resolve) => {
          const el = new window.Image();
          el.onload = () => resolve(el);
          el.src = img.preview;
        });

        const canvas = document.createElement('canvas');
        canvas.width = imgEl.width;
        canvas.height = imgEl.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(imgEl, 0, 0);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);

        const pxW = imgEl.width;
        const pxH = imgEl.height;
        const pdfW = pdf.internal.pageSize.getWidth();
        const pdfH = pdf.internal.pageSize.getHeight();
        const ratio = Math.min(pdfW / pxW, pdfH / pxH);
        const w = pxW * ratio;
        const h = pxH * ratio;
        const x = (pdfW - w) / 2;
        const y = (pdfH - h) / 2;

        if (i > 0) pdf.addPage();
        pdf.addImage(dataUrl, 'JPEG', x, y, w, h);
        setProgress(Math.round(((i + 1) / imgFiles.length) * 100));
      }

      pdf.save('converted.pdf');
    } catch (e) {
      console.error('PDF creation error:', e);
    }
    setConverting(false);
  }, [imgFiles]);

  const removeImg = useCallback((index: number) => {
    setImgFiles(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const handleWordUpload = useCallback(async (files: FileList | null) => {
    if (!files || !files[0]) return;
    const file = files[0];
    const name = file.name.toLowerCase();
    if (!name.endsWith('.docx') && !name.endsWith('.doc')) return;
    setWordFile(file);
    setConverting(true);
    setProgress(10);

    try {
      const mammoth = await import('mammoth');
      const buffer = await file.arrayBuffer();
      setProgress(40);
      const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
      setWordHtml(result.value);
      setProgress(100);
    } catch (e) {
      console.error('Word parse error:', e);
      alert('Word 文件解析失败，请确保是 .docx 格式');
      setWordFile(null);
    }
    setConverting(false);
  }, []);

  const convertWordToPdf = useCallback(async () => {
    if (!wordHtml) return;
    setConverting(true);
    setProgress(10);

    try {
      const [{ jsPDF }, html2canvas] = await Promise.all([
        import('jspdf'),
        import('html2canvas').then(m => m.default || m),
      ]);

      // Render HTML to a hidden container
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:0;width:794px;padding:40px;background:#fff;color:#000;font-family:SimSun,serif;font-size:14px;line-height:1.8;';
      container.innerHTML = wordHtml;
      document.body.appendChild(container);

      setProgress(30);

      // Split into pages by measuring height
      const pageHeightPx = 1123; // ~A4 at 96dpi minus margins
      const totalHeight = container.scrollHeight;
      const totalPages = Math.max(1, Math.ceil(totalHeight / pageHeightPx));

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = pdf.internal.pageSize.getHeight();

      for (let i = 0; i < totalPages; i++) {
        // Create a clipping container for each page
        const pageDiv = document.createElement('div');
        pageDiv.style.cssText = `position:absolute;left:-9999px;top:0;width:794px;height:${pageHeightPx}px;overflow:hidden;background:#fff;`;
        const inner = document.createElement('div');
        inner.style.cssText = `padding:40px;font-family:SimSun,serif;font-size:14px;line-height:1.8;color:#000;`;
        inner.innerHTML = wordHtml;
        inner.style.transform = `translateY(-${i * pageHeightPx}px)`;
        pageDiv.appendChild(inner);
        document.body.appendChild(pageDiv);

        const canvas = await html2canvas(pageDiv, { scale: 2, useCORS: true });
        const imgData = canvas.toDataURL('image/jpeg', 0.92);
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, 0, pdfW, pdfH);

        document.body.removeChild(pageDiv);
        setProgress(30 + Math.round((i + 1) / totalPages * 65));
      }

      document.body.removeChild(container);

      const outName = wordFile?.name.replace(/\.[^.]+$/, '.pdf') || 'converted.pdf';
      pdf.save(outName);
      setProgress(100);
    } catch (e) {
      console.error('Word→PDF error:', e);
      alert('转换失败: ' + (e as Error).message);
    }
    setConverting(false);
  }, [wordHtml, wordFile]);

  const reset = useCallback(() => {
    pdfPages.forEach(url => URL.revokeObjectURL(url));
    imgFiles.forEach(img => URL.revokeObjectURL(img.preview));
    setPdfFile(null);
    setPdfPages([]);
    setImgFiles([]);
    setWordFile(null);
    setWordHtml('');
    setMode('select');
    setProgress(0);
  }, [pdfPages, imgFiles]);

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
          className="relative w-full max-w-2xl bg-gradient-to-b from-slate-900 to-black border border-red-500/30 rounded-2xl shadow-[0_0_50px_rgba(239,68,68,0.2)] overflow-hidden max-h-[85vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-red-500/5 shrink-0">
            <div className="flex items-center gap-2">
              {mode !== 'select' && (
                <button onClick={reset} className="p-1 rounded hover:bg-slate-800 text-slate-400 mr-1">
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <h2 className="text-2xl font-bold text-red-400 flex items-center gap-2">
                <FileText className="w-6 h-6" />
                PDF 转换
              </h2>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Mode Selection */}
            {mode === 'select' && (
              <div className="p-6 space-y-4">
                <button
                  onClick={() => setMode('pdf2img')}
                  className="w-full p-6 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-red-500/50 hover:bg-slate-800 transition-all text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                      <ImageIcon className="w-8 h-8 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-200">PDF → 图片</h3>
                      <p className="text-sm text-slate-400">将 PDF 每页导出为 PNG 图片</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setMode('img2pdf')}
                  className="w-full p-6 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-red-500/50 hover:bg-slate-800 transition-all text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                      <FileText className="w-8 h-8 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-200">图片 → PDF</h3>
                      <p className="text-sm text-slate-400">将多张图片合并为一个 PDF</p>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setMode('word2pdf')}
                  className="w-full p-6 rounded-xl border border-slate-700 bg-slate-800/50 hover:border-red-500/50 hover:bg-slate-800 transition-all text-left group"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-lg bg-red-500/10 group-hover:bg-red-500/20 transition-colors">
                      <FileSpreadsheet className="w-8 h-8 text-red-400" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-200">Word → PDF</h3>
                      <p className="text-sm text-slate-400">将 Word 文档转换为 PDF</p>
                    </div>
                  </div>
                </button>
              </div>
            )}

            {/* PDF to Image */}
            {mode === 'pdf2img' && (
              <div className="p-6 space-y-4">
                {!pdfFile ? (
                  <div
                    className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-red-500/50 transition-colors"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.pdf';
                      input.onchange = (e) => handlePdfUpload((e.target as HTMLInputElement).files);
                      input.click();
                    }}
                  >
                    <Upload className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">点击上传 PDF 文件</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{pdfFile.name}</span>
                      {pdfPages.length > 0 && (
                        <button
                          onClick={downloadAllPages}
                          className="flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-500/30 rounded-lg text-sm text-green-400 hover:bg-green-600/30 transition-colors"
                        >
                          <Download className="w-4 h-4" /> 全部下载 ({pdfPages.length}页)
                        </button>
                      )}
                    </div>

                    {converting && (
                      <div className="space-y-2">
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-xs text-slate-500 text-center">解析中... {progress}%</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-3 max-h-[400px] overflow-y-auto">
                      {pdfPages.map((page, i) => (
                        <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-900">
                          <img src={page} className="w-full" />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                            <button
                              onClick={() => downloadPage(page, i)}
                              className="p-3 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
                            >
                              <Download className="w-5 h-5 text-white" />
                            </button>
                          </div>
                          <div className="absolute bottom-2 left-2 text-xs font-mono text-slate-300 bg-black/50 px-2 py-1 rounded">
                            第 {i + 1} 页
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Image to PDF */}
            {mode === 'img2pdf' && (
              <div className="p-6 space-y-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => inputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-sm text-slate-300 hover:bg-slate-700 transition-colors"
                  >
                    <Upload className="w-4 h-4" /> 添加图片
                  </button>
                  {imgFiles.length > 0 && (
                    <>
                      <button
                        onClick={convertToPdf}
                        disabled={converting}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 rounded-lg text-sm text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                      >
                        {converting ? '生成中...' : `生成 PDF (${imgFiles.length}张)`}
                      </button>
                      <button
                        onClick={() => { imgFiles.forEach(i => URL.revokeObjectURL(i.preview)); setImgFiles([]); }}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 rounded-lg text-sm text-slate-400 hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" /> 清空
                      </button>
                    </>
                  )}
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={e => handleImgUpload(e.target.files)}
                />

                {converting && (
                  <div className="space-y-2">
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="text-xs text-slate-500 text-center">生成中... {progress}%</p>
                  </div>
                )}

                {imgFiles.length === 0 ? (
                  <div
                    className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-red-500/50 transition-colors"
                    onClick={() => inputRef.current?.click()}
                  >
                    <Upload className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">点击上传图片</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-3 max-h-[350px] overflow-y-auto">
                    {imgFiles.map((img, i) => (
                      <div key={i} className="relative group rounded-lg overflow-hidden border border-slate-700 bg-slate-900">
                        <img src={img.preview} className="w-full h-24 object-cover" />
                        <button
                          onClick={() => removeImg(i)}
                          className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-1 left-1 text-xs font-mono text-slate-300 bg-black/50 px-1.5 py-0.5 rounded">
                          {i + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Word to PDF */}
            {mode === 'word2pdf' && (
              <div className="p-6 space-y-4">
                {!wordFile ? (
                  <div
                    className="border-2 border-dashed border-slate-700 rounded-xl p-12 text-center cursor-pointer hover:border-red-500/50 transition-colors"
                    onClick={() => {
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.docx,.doc';
                      input.onchange = (e) => handleWordUpload((e.target as HTMLInputElement).files);
                      input.click();
                    }}
                  >
                    <Upload className="w-12 h-12 text-slate-600 mx-auto mb-3" />
                    <p className="text-slate-400">点击上传 Word 文件</p>
                    <p className="text-xs text-slate-600 mt-1">支持 .docx 格式</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-300">{wordFile.name}</span>
                      <button
                        onClick={() => { setWordFile(null); setWordHtml(''); }}
                        className="text-xs text-slate-500 hover:text-red-400 transition-colors"
                      >
                        重新选择
                      </button>
                    </div>

                    {converting && (
                      <div className="space-y-2">
                        <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                          <div className="h-full bg-red-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                        </div>
                        <p className="text-xs text-slate-500 text-center">
                          {progress < 40 ? '解析中...' : progress < 100 ? '生成 PDF 中...' : '完成!'} {progress}%
                        </p>
                      </div>
                    )}

                    {wordHtml && !converting && (
                      <>
                        <div className="p-4 rounded-lg bg-slate-800/50 border border-slate-700 max-h-[300px] overflow-y-auto">
                          <div
                            ref={wordRenderRef}
                            className="prose prose-invert prose-sm max-w-none"
                            style={{ fontSize: 13, lineHeight: 1.7 }}
                            dangerouslySetInnerHTML={{ __html: wordHtml }}
                          />
                        </div>
                        <button
                          onClick={convertWordToPdf}
                          className="flex items-center gap-2 px-6 py-3 bg-red-600 rounded-lg text-white hover:bg-red-500 transition-colors"
                        >
                          <Download className="w-4 h-4" /> 转换并下载 PDF
                        </button>
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="p-4 bg-slate-900/80 text-center text-xs text-slate-600 border-t border-slate-800 shrink-0">
            纯前端转换 • 文件不会上传到服务器
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
