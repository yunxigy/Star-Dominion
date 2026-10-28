import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { FileText, Download, FolderOpen, Tag, Calendar, Hash } from 'lucide-react';
import { localOcrOptions, parseInvoiceText, withTimeout } from '../featureSupport';

const OCR_TIMEOUT_MS = 60_000;

interface InvoiceInfo {
  fileName: string;
  fileSize: number;
  detectedType: string;
  suggestedName: string;
  category: string;
  date?: string;
  amount?: string;
  tax?: string;
  invoiceNumber?: string;
}

const InvoiceOrganizer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [invoices, setInvoices] = useState<InvoiceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [organizeBy, setOrganizeBy] = useState<'type' | 'date' | 'amount'>('type');
  const inputRef = useRef<HTMLInputElement>(null);

  const detectInvoiceType = (name: string, content = ''): { type: string; category: string } => {
    const lower = `${name} ${content}`.toLowerCase();
    if (lower.includes('增值税') || lower.includes('vat')) return { type: '增值税发票', category: 'tax' };
    if (lower.includes('电子发票') || lower.includes('electronic')) return { type: '电子发票', category: 'electronic' };
    if (lower.includes('收据') || lower.includes('receipt')) return { type: '收据', category: 'receipt' };
    if (lower.includes('报销') || lower.includes('reimburse')) return { type: '报销单', category: 'reimburse' };
    if (lower.includes('行程') || lower.includes('itinerary')) return { type: '行程单', category: 'travel' };
    if (lower.includes('火车') || lower.includes('rail')) return { type: '火车票', category: 'travel' };
    if (lower.includes('机票') || lower.includes('flight')) return { type: '机票', category: 'travel' };
    if (lower.includes('酒店') || lower.includes('hotel')) return { type: '酒店发票', category: 'travel' };
    if (lower.includes('餐饮') || lower.includes('meal')) return { type: '餐饮发票', category: 'meal' };
    if (lower.includes('出租') || lower.includes('taxi')) return { type: '出租车票', category: 'transport' };
    if (lower.endsWith('.pdf')) return { type: 'PDF发票', category: 'other' };
    if (lower.endsWith('.jpg') || lower.endsWith('.png') || lower.endsWith('.jpeg')) return { type: '图片发票', category: 'other' };
    return { type: '其他', category: 'other' };
  };

  const generateSuggestedName = (
    file: File,
    info: { type: string; category: string },
    date?: string,
    invoiceNumber?: string,
  ): string => {
    const ext = file.name.split('.').pop() || '';
    const dateStr = (date || '日期未知').replace(/-/g, '');
    const number = invoiceNumber ? `_${invoiceNumber}` : '';
    return `${info.type}_${dateStr}${number}.${ext}`;
  };

  const extractInvoiceText = async (file: File): Promise<string> => {
    const Tesseract = await import('tesseract.js');
    const worker = await withTimeout(
      Tesseract.createWorker('chi_sim+eng', 1, localOcrOptions()),
      OCR_TIMEOUT_MS,
      'OCR 模型加载超时，请检查本地模型资源',
    );
    try {
      if (file.type.startsWith('image/')) {
        const result = await withTimeout(worker.recognize(file), OCR_TIMEOUT_MS, '发票 OCR 识别超时');
        return result.data.text;
      }
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const pdfJsLib = await import('pdfjs-dist');
        const pdf = await pdfJsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const pageTexts: string[] = [];
        for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, 2); pageNumber += 1) {
          const page = await pdf.getPage(pageNumber);
          const content = await page.getTextContent();
          const embeddedText = content.items
            .map(item => ('str' in item ? item.str : ''))
            .join(' ')
            .trim();
          if (embeddedText.length >= 30) {
            pageTexts.push(embeddedText);
            continue;
          }
          const viewport = page.getViewport({ scale: 1.8 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('浏览器无法创建 OCR 画布');
          await page.render({ canvasContext: context, viewport, canvas } as any).promise;
          const result = await withTimeout(worker.recognize(canvas), OCR_TIMEOUT_MS, `第 ${pageNumber} 页发票 OCR 超时`);
          pageTexts.push(result.data.text);
          canvas.width = 0;
          canvas.height = 0;
        }
        return pageTexts.join('\n');
      }
      throw new Error('仅支持 PDF、JPG 和 PNG 发票');
    } finally {
      await worker.terminate();
    }
  };

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList) return;
    setLoading(true);
    try {
      const newInvoices: InvoiceInfo[] = [];
      const files = Array.from(fileList);
      for (const [index, file] of files.entries()) {
        setProgress(`正在识别 ${index + 1}/${files.length}：${file.name}`);
        const text = await extractInvoiceText(file);
        const fields = parseInvoiceText(text);
        const detected = detectInvoiceType(file.name, text);
        newInvoices.push({
          fileName: file.name,
          fileSize: file.size,
          detectedType: detected.type,
          suggestedName: generateSuggestedName(file, detected, fields.date, fields.invoiceNumber),
          category: detected.category,
          ...fields,
        });
      }
      setInvoices(prev => [...prev, ...newInvoices]);
    } catch (error) {
      setProgress(`识别失败：${(error as Error).message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setProgress(''), 4000);
    }
  }, []);

  const getGroupedInvoices = () => {
    const groups: Record<string, InvoiceInfo[]> = {};
    for (const inv of invoices) {
      let key: string;
      switch (organizeBy) {
        case 'type': key = inv.detectedType; break;
        case 'date': key = inv.date || '未知日期'; break;
        case 'amount': key = inv.amount || '未知金额'; break;
        default: key = inv.detectedType;
      }
      if (!groups[key]) groups[key] = [];
      groups[key].push(inv);
    }
    return groups;
  };

  const categoryLabels: Record<string, string> = {
    tax: '税务发票', electronic: '电子发票', receipt: '收据',
    reimburse: '报销单', travel: '差旅', meal: '餐饮',
    transport: '交通', other: '其他',
  };

  const exportList = () => {
    const quote = (value: string | undefined) => `"${(value || '').replace(/"/g, '""')}"`;
    const rows = invoices.map(inv => [
      inv.fileName,
      inv.detectedType,
      categoryLabels[inv.category] || inv.category,
      inv.invoiceNumber,
      inv.date,
      inv.amount,
      inv.tax,
      inv.suggestedName,
    ].map(quote).join(','));
    const header = '原文件名,类型,分类,发票号码,开票日期,价税合计,税额,建议文件名\n';
    const blob = new Blob([`\uFEFF${header}${rows.join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `发票清单_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const grouped = getGroupedInvoices();

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">批量上传发票文件，自动识别类型、分类整理、生成统一命名方案</p>

      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg">
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-400 text-yellow-900 rounded">BETA</span>
        <span className="text-xs text-yellow-700">本地 OCR 提取发票号码、日期、价税合计和税额；识别结果请在报销前人工核对</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['type', 'date', 'amount'] as const).map(mode => (
          <button key={mode} onClick={() => setOrganizeBy(mode)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${organizeBy === mode ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {mode === 'type' ? '按类型' : mode === 'date' ? '按日期' : '按金额'}
          </button>
        ))}
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFiles} accept=".pdf,.jpg,.jpeg,.png" label="上传发票文件" sublabel="支持 PDF、JPG、PNG" />
      <input ref={inputRef} type="file" multiple className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={e => handleFiles(e.target.files)} />
      {progress && <div className="rounded-lg border border-[#ead0ad] bg-[#fff4e6] p-2 text-xs text-[#6d5a47]">{progress}</div>}

      {invoices.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-[#6d5a47]">已识别 {invoices.length} 个发票文件</span>
            <div className="flex gap-2">
              <button onClick={exportList} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
                <Download className="w-3 h-3" />导出 CSV
              </button>
              <button onClick={() => setInvoices([])} className="text-xs text-red-500 hover:underline">清空</button>
            </div>
          </div>

          {Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="border border-[#ead0ad] rounded-lg overflow-hidden">
              <div className="bg-[#f1dcc2] px-3 py-2 flex items-center gap-2">
                <FolderOpen className="w-4 h-4 text-[#7a421b]" />
                <span className="text-sm font-medium text-[#6f3714]">{group}</span>
                <span className="text-xs text-[#8b735c]">({items.length} 个)</span>
              </div>
              <div className="divide-y divide-[#ead0ad]">
                {items.map((inv, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-[#6d5a47] truncate">{inv.fileName}</div>
                      <div className="text-xs text-[#8b735c]">
                        <Tag className="w-3 h-3 inline mr-1" />{categoryLabels[inv.category] || inv.category}
                        <span className="ml-3">{formatFileSize(inv.fileSize)}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-[#8b735c]">
                        号码：{inv.invoiceNumber || '未识别'} · 日期：{inv.date || '未识别'} · 金额：{inv.amount ? `¥${inv.amount}` : '未识别'}
                      </div>
                    </div>
                    <div className="text-xs text-[#7a421b] ml-2 max-w-[200px] truncate" title={inv.suggestedName}>
                      → {inv.suggestedName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：识别在浏览器本地完成，工具不会上传发票。OCR 结果可能受版式、清晰度和语言模型影响；
          CSV 仅用于整理，税务与报销信息请以原始发票为准。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default InvoiceOrganizer;
