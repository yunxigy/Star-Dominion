import React, { useRef, useState } from 'react';
import { Download } from 'lucide-react';

import { localOcrOptions, resolveOcrPageRange, withTimeout } from '../featureSupport';
import { Btn, ResultBox, copyToClipboard, formatFileSize, UploadZone } from '../shared';

const OCR_TIMEOUT_MS = 60_000;

const SearchablePdfOcr: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [ocrText, setOcrText] = useState('');
  const [pageCount, setPageCount] = useState(0);
  const [startPage, setStartPage] = useState(1);
  const [endPage, setEndPage] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectFile = async (selected: File) => {
    setFile(selected);
    setResult('正在读取 PDF…');
    setOcrText('');
    try {
      const pdfJsLib = await import('pdfjs-dist');
      const pdf = await pdfJsLib.getDocument({ data: await selected.arrayBuffer() }).promise;
      setPageCount(pdf.numPages);
      setStartPage(1);
      setEndPage(pdf.numPages);
      setResult(`已读取 ${pdf.numPages} 页，请选择识别范围`);
    } catch (error) {
      setPageCount(0);
      setResult(`PDF 读取失败：${(error as Error).message}`);
    }
  };

  const processFile = async () => {
    if (!file || pageCount === 0) return;
    setLoading(true);
    setOcrText('');
    let worker: { recognize: (image: HTMLCanvasElement) => Promise<{ data: { text: string } }>; terminate: () => Promise<unknown> } | null = null;
    try {
      const Tesseract = await import('tesseract.js');
      const pdfJsLib = await import('pdfjs-dist');
      const pdf = await pdfJsLib.getDocument({ data: await file.arrayBuffer() }).promise;
      const pages = resolveOcrPageRange(pdf.numPages, startPage, endPage);
      if (pages.length === 0) throw new Error('没有可识别的页面');
      setResult('正在加载本地 OCR 模型…');
      worker = await withTimeout(
        Tesseract.createWorker('chi_sim+eng', 1, {
          ...localOcrOptions(),
          logger: ({ status, progress }: { status: string; progress: number }) => {
            if (status) setResult(`正在加载 OCR 模型：${status}${Number.isFinite(progress) ? ` ${Math.round(progress * 100)}%` : ''}`);
          },
        }),
        OCR_TIMEOUT_MS,
        'OCR 模型加载超时，请检查本地模型资源',
      );
      const textParts: string[] = [];

      for (const [index, pageNumber] of pages.entries()) {
        setResult(`正在识别第 ${pageNumber} 页（${index + 1}/${pages.length}）…`);
        const page = await pdf.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const embeddedText = textContent.items
          .map(item => ('str' in item ? item.str : ''))
          .join(' ')
          .trim();

        let text = embeddedText;
        if (text.length < 30) {
          const viewport = page.getViewport({ scale: 1.8 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('浏览器无法创建 OCR 画布');
          await page.render({ canvasContext: context, viewport, canvas } as any).promise;
          const recognized = await withTimeout(
            worker.recognize(canvas),
            OCR_TIMEOUT_MS,
            `第 ${pageNumber} 页 OCR 超时，请缩小页码范围或降低图片分辨率`,
          );
          text = recognized.data.text;
          canvas.width = 0;
          canvas.height = 0;
        }
        textParts.push(`--- 第 ${pageNumber} 页 ---\n${text.trim()}`);
      }

      setOcrText(textParts.join('\n\n'));
      setResult(`OCR 完成：已处理 ${pages.length} 页`);
    } catch (error) {
      setResult(`处理失败：${(error as Error).message}`);
    } finally {
      if (worker) await worker.terminate();
      setLoading(false);
    }
  };

  const downloadText = () => {
    if (!ocrText || !file) return;
    const blob = new Blob([ocrText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${file.name.replace(/\.pdf$/i, '')}_OCR.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">提取普通或扫描 PDF 中的中英文文字，保留页码并导出 TXT</p>

      <div className="flex items-center gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2">
        <span className="rounded bg-yellow-400 px-1.5 py-0.5 text-[10px] font-bold text-yellow-900">BETA</span>
        <span className="text-xs text-yellow-700">扫描页使用本地 Tesseract.js 识别，页数较多时耗时较长</span>
      </div>

      {!file && (
        <UploadZone onUpload={() => inputRef.current?.click()} accept=".pdf" label="上传 PDF" sublabel="支持普通和扫描 PDF" />
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={event => {
          const selected = event.target.files?.[0];
          if (selected) void selectFile(selected);
        }}
      />

      {file && (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-lg bg-[#fff4e6] px-3 py-2">
            <span className="text-sm text-[#6d5a47]">{file.name} ({formatFileSize(file.size)}) · {pageCount || '?'} 页</span>
            <button
              onClick={() => {
                setFile(null);
                setOcrText('');
                setResult('');
              }}
              className="text-xs text-red-500 hover:underline"
            >
              重新选择
            </button>
          </div>

          {pageCount > 0 && (
            <div className="flex items-center gap-3 text-xs text-[#6d5a47]">
              <label>
                从第{' '}
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={startPage}
                  onChange={event => setStartPage(Number(event.target.value))}
                  className="w-16 rounded border border-[#ead0ad] px-2 py-1"
                />{' '}
                页
              </label>
              <label>
                到第{' '}
                <input
                  type="number"
                  min={1}
                  max={pageCount}
                  value={endPage}
                  onChange={event => setEndPage(Number(event.target.value))}
                  className="w-16 rounded border border-[#ead0ad] px-2 py-1"
                />{' '}
                页
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Btn onClick={processFile} disabled={loading || pageCount === 0}>{loading ? '处理中…' : '开始 OCR'}</Btn>
            <Btn onClick={onClose} variant="ghost">关闭</Btn>
          </div>
        </div>
      )}

      {result && <ResultBox label="状态" value={result} onCopy={() => copyToClipboard(result)} />}
      {ocrText && (
        <div className="space-y-2">
          <ResultBox label="OCR 文字" value={ocrText} onCopy={() => copyToClipboard(ocrText)} />
          <Btn onClick={downloadText}><Download className="mr-1 h-4 w-4" />下载 TXT</Btn>
        </div>
      )}
    </div>
  );
};

export default SearchablePdfOcr;
