import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { Sparkles, Download, AlertTriangle, CheckCircle, Eraser } from 'lucide-react';

interface CleanOption {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
}

interface CleanResult {
  originalRows: number;
  cleanedRows: number;
  removedDuplicates: number;
  removedEmpty: number;
  trimmed: number;
  normalized: number;
  fixedNumbers: number;
  output: string;
}

const SmartCleaner: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [rawData, setRawData] = useState<string[][]>([]);
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<CleanResult | null>(null);
  const [options, setOptions] = useState<CleanOption[]>([
    { key: 'trim', label: '去除空格', desc: '去除单元格前后空格', enabled: true },
    { key: 'empty', label: '删除空行', desc: '删除全为空的行', enabled: true },
    { key: 'duplicate', label: '去重', desc: '删除完全重复的行', enabled: true },
    { key: 'normalize', label: '统一格式', desc: '统一日期/电话号码格式', enabled: false },
    { key: 'number', label: '修复数字', desc: '修复千分位、百分号等数字格式', enabled: false },
  ]);
  const inputRef = useRef<HTMLInputElement>(null);

  const parseCSV = (text: string): string[][] => {
    const rows: string[][] = [];
    let current = '';
    let inQuotes = false;
    let row: string[] = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"' && text[i + 1] === '"') { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === ',') { row.push(current); current = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(current);
          if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
          row = []; current = '';
        } else { current += ch; }
      }
    }
    row.push(current);
    if (row.some(c => c.trim() !== '')) rows.push(row.map(c => c.trim()));
    return rows;
  };

  const toCSV = (rows: string[][]): string => {
    return rows.map(row => row.map(cell => {
      if (cell.includes(',') || cell.includes('"') || cell.includes('\n')) {
        return `"${cell.replace(/"/g, '""')}"`;
      }
      return cell;
    }).join(',')).join('\n');
  };

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const text = await fl[0].text();
    setRawData(parseCSV(text));
    setFileName(fl[0].name);
    setResult(null);
  }, []);

  const toggleOption = (key: string) => {
    setOptions(prev => prev.map(o => o.key === key ? { ...o, enabled: !o.enabled } : o));
  };

  const clean = () => {
    if (rawData.length < 2) return;
    const header = rawData[0];
    let rows = rawData.slice(1);
    const stats = { removedDuplicates: 0, removedEmpty: 0, trimmed: 0, normalized: 0, fixedNumbers: 0 };
    const enabled = new Set(options.filter(o => o.enabled).map(o => o.key));

    // Trim spaces
    if (enabled.has('trim')) {
      let trimCount = 0;
      rows = rows.map(row => row.map(cell => {
        const trimmed = cell.trim();
        if (trimmed !== cell) trimCount++;
        return trimmed;
      }));
      stats.trimmed = trimCount;
    }

    // Remove empty rows
    if (enabled.has('empty')) {
      const before = rows.length;
      rows = rows.filter(row => row.some(cell => cell !== ''));
      stats.removedEmpty = before - rows.length;
    }

    // Remove duplicates
    if (enabled.has('duplicate')) {
      const before = rows.length;
      const seen = new Set<string>();
      rows = rows.filter(row => {
        const key = row.join('|||');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      stats.removedDuplicates = before - rows.length;
    }

    // Normalize formats
    if (enabled.has('normalize')) {
      let normCount = 0;
      rows = rows.map(row => row.map(cell => {
        // Phone: 1xx-xxxx-xxxx → 1xxxxxxxxxx
        let result = cell.replace(/1\d{2}[-\s]\d{4}[-\s]\d{4}/g, (m) => {
          normCount++;
          return m.replace(/[-\s]/g, '');
        });
        // Date: 2024/1/1 → 2024-01-01
        result = result.replace(/\d{4}\/\d{1,2}\/\d{1,2}/g, (m) => {
          normCount++;
          const parts = m.split('/');
          return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
        });
        return result;
      }));
      stats.normalized = normCount;
    }

    // Fix numbers
    if (enabled.has('number')) {
      let numCount = 0;
      rows = rows.map(row => row.map(cell => {
        // Remove thousand separators: 1,234.56 → 1234.56
        if (/^-?[\d,]+\.?\d*$/.test(cell) && cell.includes(',')) {
          numCount++;
          return cell.replace(/,/g, '');
        }
        // Percentage: 50% → 0.5
        if (/^-?\d+\.?\d*%$/.test(cell)) {
          numCount++;
          return (parseFloat(cell) / 100).toString();
        }
        return cell;
      }));
      stats.fixedNumbers = numCount;
    }

    const output = toCSV([header, ...rows]);
    setResult({
      originalRows: rawData.length - 1,
      cleanedRows: rows.length,
      ...stats,
      output,
    });
  };

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([result.output], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cleaned_${fileName || 'data.csv'}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">智能清洗 CSV/表格数据：去重、去空行、修空格、统一格式、修复数字</p>

      <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleFile} accept=".csv,.txt" label="上传 CSV 文件" sublabel="支持 .csv 和 .txt" />
      <input ref={inputRef} type="file" className="hidden" accept=".csv,.txt" onChange={e => handleFile(e.target.files)} />

      {rawData.length > 0 && (
        <div className="text-sm text-[#6d5a47]">
          已加载 <span className="font-medium">{fileName}</span>（{rawData.length - 1} 行数据，{rawData[0]?.length} 列）
        </div>
      )}

      <div className="space-y-2">
        <span className="text-xs font-medium text-[#6d5a47]">清洗选项:</span>
        <div className="grid grid-cols-2 gap-2">
          {options.map(opt => (
            <label key={opt.key} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${opt.enabled ? 'border-[#7a421b] bg-[#fff8ef]' : 'border-[#ead0ad] bg-white'}`}>
              <input type="checkbox" checked={opt.enabled} onChange={() => toggleOption(opt.key)} className="mt-0.5 accent-[#7a421b]" />
              <div>
                <div className="text-xs font-medium text-[#6d5a47]">{opt.label}</div>
                <div className="text-xs text-[#8b735c]">{opt.desc}</div>
              </div>
            </label>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={clean} disabled={rawData.length < 2}>
          <Sparkles className="w-4 h-4 mr-1" />开始清洗
        </Btn>
        {result && (
          <Btn onClick={downloadResult} variant="ghost">
            <Download className="w-4 h-4 mr-1" />下载结果
          </Btn>
        )}
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-green-600">{result.cleanedRows}</div>
              <div className="text-xs text-green-700">清洗后行数</div>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-red-600">{result.removedDuplicates}</div>
              <div className="text-xs text-red-700">删除重复</div>
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
              <div className="text-lg font-bold text-amber-600">{result.removedEmpty}</div>
              <div className="text-xs text-amber-700">删除空行</div>
            </div>
          </div>

          <div className="bg-[#fff8ef] border border-[#ead0ad] rounded-lg p-3 space-y-1">
            {result.trimmed > 0 && <div className="text-xs text-[#6d5a47] flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" />去除空格: {result.trimmed} 处</div>}
            {result.normalized > 0 && <div className="text-xs text-[#6d5a47] flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" />格式统一: {result.normalized} 处</div>}
            {result.fixedNumbers > 0 && <div className="text-xs text-[#6d5a47] flex items-center gap-1"><CheckCircle className="w-3 h-3 text-green-500" />数字修复: {result.fixedNumbers} 处</div>}
            {result.originalRows === result.cleanedRows && result.removedDuplicates === 0 && result.removedEmpty === 0 && (
              <div className="text-xs text-[#8b735c] flex items-center gap-1"><Eraser className="w-3 h-3" />数据已经很干净，无需清洗</div>
            )}
          </div>

          <details className="border border-[#ead0ad] rounded-lg">
            <summary className="px-3 py-2 text-xs text-[#7a421b] cursor-pointer hover:bg-[#f1dcc2]">预览清洗结果（前 20 行）</summary>
            <pre className="p-3 text-xs text-[#6d5a47] overflow-x-auto max-h-60">{result.output.split('\n').slice(0, 21).join('\n')}</pre>
          </details>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default SmartCleaner;
