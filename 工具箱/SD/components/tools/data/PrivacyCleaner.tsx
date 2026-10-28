import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { getSupportedPrivacyTargets, type SupportedPrivacyTarget } from '../featureSupport';
import { Shield, ShieldOff, Download, Trash2, CheckCircle, AlertTriangle } from 'lucide-react';

type CleanTarget = SupportedPrivacyTarget;

interface CleanResult {
  name: string;
  target: CleanTarget;
  cleaned: boolean;
  details: string;
  downloadUrl?: string;
}

const PrivacyCleaner: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [target, setTarget] = useState<CleanTarget>('image-exif');
  const [results, setResults] = useState<CleanResult[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const cleanImageExif = async (file: File): Promise<CleanResult> => {
    return new Promise((resolve) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        ctx!.drawImage(img, 0, 0);
        // Export as clean PNG (no EXIF)
        const dataUrl = canvas.toDataURL('image/png');
        resolve({
          name: file.name,
          target: 'image-exif',
          cleaned: true,
          details: `已清除 EXIF 数据 (${formatFileSize(file.size)} → PNG无元数据)`,
          downloadUrl: dataUrl,
        });
      };
      img.onerror = () => resolve({
        name: file.name, target: 'image-exif', cleaned: false, details: '图片加载失败',
      });
      img.src = URL.createObjectURL(file);
    });
  };

  const cleanPdfMeta = async (file: File): Promise<CleanResult> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const pdfLib = await import('pdf-lib');
      const pdfDoc = await pdfLib.PDFDocument.load(arrayBuffer);

      // Get existing metadata
      const oldMeta = {
        title: pdfDoc.getTitle(),
        author: pdfDoc.getAuthor(),
        subject: pdfDoc.getSubject(),
        creator: pdfDoc.getCreator(),
        producer: pdfDoc.getProducer(),
      };

      // Clear metadata
      pdfDoc.setTitle('');
      pdfDoc.setAuthor('');
      pdfDoc.setSubject('');
      pdfDoc.setCreator('');
      pdfDoc.setProducer('');
      pdfDoc.setKeywords([]);

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });

      return {
        name: file.name,
        target: 'pdf-meta',
        cleaned: true,
        details: `已清除 PDF 元数据 (标题: "${oldMeta.title || '无'}", 作者: "${oldMeta.author || '无'}", 创建者: "${oldMeta.creator || '无'}")`,
        downloadUrl: URL.createObjectURL(blob),
      };
    } catch (e: any) {
      return { name: file.name, target: 'pdf-meta', cleaned: false, details: 'PDF 处理失败: ' + e.message };
    }
  };

  const cleanFileTimestamp = async (file: File): Promise<CleanResult> => {
    // Cannot truly clean timestamps in browser, but we can note what's there
    return {
      name: file.name,
      target: 'file-timestamp',
      cleaned: false,
      details: `文件修改时间: ${new Date(file.lastModified).toLocaleString()}\n注意: 浏览器环境无法修改文件时间戳，需在本地系统操作`,
    };
  };

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    setLoading(true);
    try {
      const newResults: CleanResult[] = [];
      for (const file of Array.from(fileList)) {
        let result: CleanResult;
        switch (target) {
          case 'image-exif': result = await cleanImageExif(file); break;
          case 'pdf-meta': result = await cleanPdfMeta(file); break;
          case 'file-timestamp': result = await cleanFileTimestamp(file); break;
          default: result = { name: file.name, target, cleaned: false, details: '不支持的操作' };
        }
        newResults.push(result);
      }
      setResults(prev => [...prev, ...newResults]);
    } finally {
      setLoading(false);
    }
  }, [target]);

  const downloadResult = (result: CleanResult) => {
    if (!result.downloadUrl) return;
    const a = document.createElement('a');
    a.href = result.downloadUrl;
    a.download = `cleaned_${result.name.replace(/\.[^.]+$/, '')}.${result.target === 'image-exif' ? 'png' : 'pdf'}`;
    a.click();
  };

  const targetDetails: Record<CleanTarget, { label: string; desc: string; accept: string }> = {
    'image-exif': { label: '图片 EXIF', desc: '清除照片 GPS、设备、时间等 EXIF 信息', accept: 'image/*' },
    'pdf-meta': { label: 'PDF 属性', desc: '清除 PDF 标题、作者、关键词等元数据', accept: '.pdf' },
    'file-timestamp': { label: '时间戳（只读）', desc: '仅查看文件时间戳；浏览器无法修改原文件时间', accept: '*/*' },
  };
  const targets = getSupportedPrivacyTargets().map(key => ({ key, ...targetDetails[key] }));

  const currentTarget = targets.find(t => t.key === target)!;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">清除图片 EXIF 和 PDF 属性；时间戳仅提供只读查看</p>

      <div className="flex flex-wrap gap-2">
        {targets.map(t => (
          <button key={t.key} onClick={() => setTarget(t.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${target === t.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-[#8b735c]">{currentTarget.desc}</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept={currentTarget.accept} label="上传文件" sublabel="支持批量处理" />
      <input ref={inputRef} type="file" multiple className="hidden" accept={currentTarget.accept} onChange={e => handleFiles(e.target.files)} />

      {results.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6d5a47]">已处理 {results.length} 个文件</span>
            <button onClick={() => setResults([])} className="text-red-500 text-xs hover:underline">清空</button>
          </div>
          <div className="max-h-60 overflow-y-auto space-y-2">
            {results.map((r, i) => (
              <div key={i} className={`rounded-lg border p-3 ${r.cleaned ? 'border-green-300 bg-green-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="flex items-center gap-2 mb-1">
                  {r.cleaned ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}
                  <span className="text-sm font-medium text-[#6d5a47]">{r.name}</span>
                  <span className={`text-xs ${r.cleaned ? 'text-green-600' : 'text-amber-600'}`}>{r.cleaned ? '已清理' : '需注意'}</span>
                </div>
                <pre className="text-xs text-[#8b735c] whitespace-pre-wrap">{r.details}</pre>
                {r.downloadUrl && (
                  <button onClick={() => downloadResult(r)} className="mt-2 flex items-center gap-1 text-xs text-[#7a421b] hover:underline">
                    <Download className="w-3 h-3" />下载清理后文件
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default PrivacyCleaner;
