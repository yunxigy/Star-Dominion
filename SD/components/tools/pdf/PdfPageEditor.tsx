import React, { useState, useCallback, useRef } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { GripVertical, RotateCw, Trash2, Plus, FileText, Download } from 'lucide-react';

interface PageInfo {
  index: number;
  rotation: number;
  deleted: boolean;
  label: string;
}

const PdfPageEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const loadPdf = useCallback(async (f: File) => {
    setFile(f);
    setLoading(true);
    try {
      // Use pdf-lib to get page count
      const arrayBuffer = await f.arrayBuffer();
      const pdfLib = await import('pdf-lib');
      const pdfDoc = await pdfLib.PDFDocument.load(arrayBuffer);
      const pageCount = pdfDoc.getPageCount();
      const newPages: PageInfo[] = Array.from({ length: pageCount }, (_, i) => ({
        index: i,
        rotation: 0,
        deleted: false,
        label: `第 ${i + 1} 页`,
      }));
      setPages(newPages);
    } catch (e: any) {
      setResult('PDF 加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const rotatePage = (idx: number) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
  };

  const toggleDelete = (idx: number) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, deleted: !p.deleted } : p));
  };

  const movePage = (from: number, to: number) => {
    if (to < 0 || to >= pages.length) return;
    setPages(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(to, 0, item);
      return arr;
    });
  };

  const addBlankPage = () => {
    setPages(prev => [...prev, { index: -1, rotation: 0, deleted: false, label: `空白页` }]);
  };

  const executeEdit = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfLib = await import('pdf-lib');
      const srcDoc = await pdfLib.PDFDocument.load(arrayBuffer);
      const newDoc = await pdfLib.PDFDocument.create();

      for (const page of pages) {
        if (page.deleted) continue;
        if (page.index === -1) {
          // Add blank page
          const blankPage = newDoc.addPage([595.28, 841.89]); // A4
          if (page.rotation) blankPage.setRotation(pdfLib.degrees(page.rotation));
        } else {
          const [copiedPage] = await newDoc.copyPages(srcDoc, [page.index]);
          if (page.rotation) copiedPage.setRotation(pdfLib.degrees(page.rotation));
          newDoc.addPage(copiedPage);
        }
      }

      const pdfBytes = await newDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
      setResult(`编辑完成: ${pages.filter(p => !p.deleted).length} 页已导出`);
    } catch (e: any) {
      setResult('编辑失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">拖拽排序、旋转、删除、插入空白页，所有操作本地完成</p>

      {!file && (
        <UploadZone onUpload={() => inputRef.current?.click()} accept=".pdf" label="上传 PDF 文件" sublabel="支持拖拽" />
      )}
      <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) loadPdf(e.target.files[0]); }} />

      {file && (
        <div className="space-y-3">
          <div className="flex items-center justify-between bg-[#fff4e6] rounded-lg px-3 py-2">
            <span className="text-sm text-[#6d5a47]">{file.name} ({formatFileSize(file.size)})</span>
            <button onClick={() => { setFile(null); setPages([]); }} className="text-red-500 text-xs hover:underline">重新选择</button>
          </div>

          {pages.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-[#6d5a47]">共 {pages.length} 页 (保留 {pages.filter(p => !p.deleted).length} 页)</span>
                <button onClick={addBlankPage} className="flex items-center gap-1 text-xs text-[#7a421b] hover:underline">
                  <Plus className="w-3 h-3" />插入空白页
                </button>
              </div>

              <div className="max-h-80 overflow-y-auto space-y-1">
                {pages.map((page, idx) => (
                  <div key={idx} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${page.deleted ? 'border-red-300 bg-red-50 opacity-50' : 'border-[#c79f72]/30 bg-[#fff4e6]'}`}>
                    <GripVertical className="w-4 h-4 text-[#8b735c] cursor-grab" />
                    <span className="flex-1 text-sm text-[#6d5a47]">{page.label}</span>
                    {page.rotation > 0 && <span className="text-xs text-amber-600">{page.rotation}°</span>}
                    <button onClick={() => movePage(idx, idx - 1)} className="text-[#8b735c] hover:text-[#6d5a47] text-xs" disabled={idx === 0}>↑</button>
                    <button onClick={() => movePage(idx, idx + 1)} className="text-[#8b735c] hover:text-[#6d5a47] text-xs" disabled={idx === pages.length - 1}>↓</button>
                    <button onClick={() => rotatePage(idx)} className="text-[#8b735c] hover:text-[#6d5a47]"><RotateCw className="w-4 h-4" /></button>
                    <button onClick={() => toggleDelete(idx)} className={page.deleted ? 'text-green-500 hover:text-green-700' : 'text-red-500 hover:text-red-700'}>
                      {page.deleted ? '恢复' : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex gap-2">
                <Btn onClick={executeEdit} disabled={loading}>{loading ? '处理中...' : '导出编辑后 PDF'}</Btn>
                <Btn onClick={onClose} variant="ghost">关闭</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {result && <ResultBox label="结果" value={result} onCopy={() => copyToClipboard(result)} />}
    </div>
  );
};

export default PdfPageEditor;