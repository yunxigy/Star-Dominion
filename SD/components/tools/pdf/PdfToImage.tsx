import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useFileUpload, UploadZone, Btn, downloadBlob } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

type ImgFormat = 'png' | 'jpeg';

const PdfToImage: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps } = useFileUpload('.pdf');
  const [format, setFormat] = useState<ImgFormat>('png');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageCount, setPageCount] = useState(0);

  const file = files[0];

  React.useEffect(() => {
    if (file) {
      file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: buf }).promise).then(doc => setPageCount(doc.numPages));
    }
  }, [file]);

  const renderPage = async (doc: pdfjsLib.PDFDocumentProxy, p: number): Promise<Blob> => {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport }).promise;
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), `image/${format}`, 0.92);
    });
  };

  const handleSingleDownload = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在导出第 ${p}/${doc.numPages} 页...`);
        const blob = await renderPage(doc, p);
        downloadBlob(blob, `${file.name.replace(/\.pdf$/i, '')}_page${p}.${format}`);
      }
      setStatus('导出完成');
    } catch (err: any) {
      setStatus(`导出失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleAllDownload = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const { default: JSZip } = await import('jszip').catch(() => {
        throw new Error('需要安装 jszip 库: npm install jszip');
      });
      const zip = new JSZip();
      for (let p = 1; p <= doc.numPages; p++) {
        setStatus(`正在处理第 ${p}/${doc.numPages} 页...`);
        const blob = await renderPage(doc, p);
        zip.file(`page${p}.${format}`, blob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(zipBlob, `${file.name.replace(/\.pdf$/i, '')}_images.zip`);
      setStatus('打包下载完成');
    } catch (err: any) {
      setStatus(`导出失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF，将每页导出为图片。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name}</span>
          {pageCount > 0 && <span className="text-xs text-slate-500 ml-2">共 {pageCount} 页</span>}
        </div>
      )}
      <div>
        <p className="text-xs text-slate-500 mb-2">输出格式</p>
        <div className="flex gap-2">
          <Btn onClick={() => setFormat('png')} variant={format === 'png' ? 'primary' : 'ghost'}>PNG</Btn>
          <Btn onClick={() => setFormat('jpeg')} variant={format === 'jpeg' ? 'primary' : 'ghost'}>JPEG</Btn>
        </div>
      </div>
      <div className="flex gap-2">
        <Btn onClick={handleSingleDownload} disabled={!file || loading}>
          {loading ? '导出中...' : '逐页下载'}
        </Btn>
        <Btn onClick={handleAllDownload} disabled={!file || loading} variant="ghost">
          打包为ZIP下载
        </Btn>
      </div>
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default PdfToImage;
