import React, { useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { useFileUpload, UploadZone, Btn, TextArea, copyToClipboard } from '../shared';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';


const ExtractPdfText: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { files, triggerUpload, inputProps, handleFiles } = useFileUpload('.pdf');
  const [text, setText] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [pageFilter, setPageFilter] = useState<'all' | 'single'>('all');
  const [pageNum, setPageNum] = useState('1');
  const [pageCount, setPageCount] = useState(0);

  const file = files[0];

  React.useEffect(() => {
    if (file) {
      file.arrayBuffer().then(buf => pdfjsLib.getDocument({ data: buf }).promise).then(doc => setPageCount(doc.numPages));
    }
  }, [file]);

  const handleExtract = async () => {
    if (!file) { setStatus('请先上传PDF文件'); return; }
    setLoading(true);
    setText('');
    setStatus('正在提取文字...');
    try {
      const buf = await file.arrayBuffer();
      const doc = await pdfjsLib.getDocument({ data: buf }).promise;
      const allText: string[] = [];
      const startP = pageFilter === 'single' ? Math.max(1, Math.min(Number(pageNum) || 1, doc.numPages)) : 1;
      const endP = pageFilter === 'single' ? startP : doc.numPages;
      for (let p = startP; p <= endP; p++) {
        setStatus(`正在提取第 ${p}/${endP} 页...`);
        const page = await doc.getPage(p);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        allText.push(`--- 第 ${p} 页 ---\n${pageText}`);
      }
      const result = allText.join('\n\n');
      setText(result);
      setStatus(`提取完成，共 ${result.length} 个字符`);
    } catch (err: any) {
      setStatus(`提取失败: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${file?.name.replace(/\.pdf$/i, '') || 'extracted'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      <p className="text-slate-400 text-sm">上传PDF文件，提取文字内容。</p>
      <input {...inputProps} />
      {!file ? (
        <UploadZone onUpload={triggerUpload} onDropFiles={handleFiles} accept=".pdf" label="点击上传PDF文件" />
      ) : (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
          <span className="text-sm text-slate-200">{file.name}</span>
          {pageCount > 0 && <span className="text-xs text-slate-500 ml-2">共 {pageCount} 页</span>}
        </div>
      )}
      <div className="flex gap-2 items-center">
        <Btn onClick={() => setPageFilter('all')} variant={pageFilter === 'all' ? 'primary' : 'ghost'}>全部页面</Btn>
        <Btn onClick={() => setPageFilter('single')} variant={pageFilter === 'single' ? 'primary' : 'ghost'}>指定页</Btn>
        {pageFilter === 'single' && (
          <input type="number" min={1} max={pageCount || 999} value={pageNum}
            onChange={e => setPageNum(e.target.value)}
            className="w-20 bg-slate-800/50 border border-slate-700 rounded-lg p-2 text-sm text-slate-200 text-center focus:outline-none focus:border-violet-500/50" />
        )}
      </div>
      <Btn onClick={handleExtract} disabled={!file || loading}>
        {loading ? '提取中...' : '提取文字'}
      </Btn>
      {text && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Btn onClick={() => copyToClipboard(text)} variant="ghost">复制全部</Btn>
            <Btn onClick={handleDownload} variant="ghost">下载TXT</Btn>
          </div>
          <TextArea value={text} onChange={setText} readOnly rows={12} className="max-h-80 overflow-y-auto" />
        </div>
      )}
      {status && <p className="text-sm text-slate-300">{status}</p>}
    </div>
  );
};

export default ExtractPdfText;
