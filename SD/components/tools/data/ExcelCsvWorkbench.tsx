import React, { useState, useCallback, useRef } from 'react';
import { UploadZone, Btn, ResultBox, copyToClipboard, useFileUpload, formatFileSize, checkFileSize, FILE_SIZE_LIMITS } from '../shared';
import { Table, Download, Trash2, Filter, Merge, Scissors, Search, AlertCircle, CheckCircle } from 'lucide-react';

type OperationMode = 'merge' | 'split' | 'dedup' | 'filter' | 'column-map' | 'format' | 'anomaly';

interface CsvRow {
  [key: string]: string | number;
}

const ExcelCsvWorkbench: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [mode, setMode] = useState<OperationMode>('merge');
  const [files, setFiles] = useState<File[]>([]);
  const [data, setData] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [dedupColumn, setDedupColumn] = useState('');
  const [result, setResult] = useState<string>('');
  const [error, setError] = useState<string>('');
  const inputRef = useRef<HTMLInputElement>(null);

  const parseCsv = (text: string): { headers: string[]; rows: CsvRow[] } => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return { headers: [], rows: [] };
    const hs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows: CsvRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
      const row: CsvRow = { _index: i };
      hs.forEach((h, idx) => { row[h] = vals[idx] || ''; });
      rows.push(row);
    }
    return { headers: hs, rows };
  };

  const toCsv = (hs: string[], rows: CsvRow[]): string => {
    const headerLine = hs.join(',');
    const dataLines = rows.map(r => hs.map(h => `"${(String(r[h] || '')).replace(/"/g, '""')}"`).join(','));
    return [headerLine, ...dataLines].join('\n');
  };

  const handleFileLoad = useCallback(async () => {
    setError('');
    setResult('');
    if (files.length === 0) return;
    try {
      const allHeaders: string[] = [];
      const allRows: CsvRow[] = [];
      for (const file of files) {
        const text = await file.text();
        const { headers, rows } = parseCsv(text);
        headers.forEach(h => { if (!allHeaders.includes(h)) allHeaders.push(h); });
        allRows.push(...rows);
      }
      setHeaders(allHeaders);
      setData(allRows);
    } catch (e: any) {
      setError('文件解析失败: ' + e.message);
    }
  }, [files]);

  const handleMerge = () => {
    if (data.length === 0) return;
    const csv = toCsv(headers, data);
    setResult(csv);
  };

  const handleSplit = () => {
    if (data.length === 0) return;
    const mid = Math.ceil(data.length / 2);
    const csv1 = toCsv(headers, data.slice(0, mid));
    const csv2 = toCsv(headers, data.slice(mid));
    setResult(`=== 文件1 (${mid}行) ===\n${csv1}\n\n=== 文件2 (${data.length - mid}行) ===\n${csv2}`);
  };

  const handleDedup = () => {
    if (data.length === 0) return;
    const col = dedupColumn || headers[0];
    const seen = new Set<string>();
    const unique = data.filter(r => {
      const val = String(r[col] || '');
      if (seen.has(val)) return false;
      seen.add(val);
      return true;
    });
    const removed = data.length - unique.length;
    setResult(`去重完成: 原始 ${data.length} 行 → 去重后 ${unique.length} 行 (移除 ${removed} 行重复)\n\n${toCsv(headers, unique)}`);
  };

  const handleFilter = () => {
    if (data.length === 0 || !filterColumn || !filterValue) return;
    const filtered = data.filter(r => String(r[filterColumn] || '').includes(filterValue));
    setResult(`筛选完成: ${data.length} 行 → ${filtered.length} 行 (列"${filterColumn}"包含"${filterValue}")\n\n${toCsv(headers, filtered)}`);
  };

  const handleAnomaly = () => {
    if (data.length === 0) return;
    const issues: string[] = [];
    headers.forEach(h => {
      const vals = data.map(r => String(r[h] || ''));
      const emptyCount = vals.filter(v => !v.trim()).length;
      if (emptyCount > 0) issues.push(`列"${h}": ${emptyCount} 个空值`);
      const numVals = vals.filter(v => v.trim() && !isNaN(Number(v)));
      if (numVals.length > vals.length * 0.5 && numVals.length < vals.length * 0.95) {
        const nonNum = vals.filter(v => v.trim() && isNaN(Number(v)));
        if (nonNum.length > 0) issues.push(`列"${h}": 混合类型，${nonNum.length} 个非数值 (${nonNum.slice(0, 3).join(', ')}...)`);
      }
    });
    if (issues.length === 0) setResult('未发现异常值');
    else setResult(`发现 ${issues.length} 个问题:\n${issues.join('\n')}`);
  };

  const handleFormat = () => {
    if (data.length === 0) return;
    const formatted = data.map(r => {
      const nr = { ...r };
      headers.forEach(h => {
        if (nr[h]) nr[h] = String(nr[h]).trim().replace(/\s+/g, ' ');
      });
      return nr;
    });
    setResult(`格式统一完成: ${formatted.length} 行\n\n${toCsv(headers, formatted)}`);
  };

  const handleColumnMap = () => {
    if (data.length === 0) return;
    const mapping = headers.reduce((acc, h) => {
      acc[h] = h.trim().toLowerCase().replace(/\s+/g, '_');
      return acc;
    }, {} as Record<string, string>);
    const newHeaders = headers.map(h => mapping[h]);
    const newData = data.map(r => {
      const nr: CsvRow = { _index: r._index };
      headers.forEach((h, i) => { nr[newHeaders[i]] = r[h]; });
      return nr;
    });
    setResult(`列名映射:\n${headers.map((h, i) => `${h} → ${newHeaders[i]}`).join('\n')}\n\n${toCsv(newHeaders, newData)}`);
  };

  const executeOperation = () => {
    switch (mode) {
      case 'merge': handleMerge(); break;
      case 'split': handleSplit(); break;
      case 'dedup': handleDedup(); break;
      case 'filter': handleFilter(); break;
      case 'column-map': handleColumnMap(); break;
      case 'format': handleFormat(); break;
      case 'anomaly': handleAnomaly(); break;
    }
  };

  const modes: { key: OperationMode; label: string; icon: React.ReactNode }[] = [
    { key: 'merge', label: '合并', icon: <Merge className="w-4 h-4" /> },
    { key: 'split', label: '拆分', icon: <Scissors className="w-4 h-4" /> },
    { key: 'dedup', label: '去重', icon: <CheckCircle className="w-4 h-4" /> },
    { key: 'filter', label: '筛选', icon: <Filter className="w-4 h-4" /> },
    { key: 'column-map', label: '列映射', icon: <Table className="w-4 h-4" /> },
    { key: 'format', label: '格式统一', icon: <Search className="w-4 h-4" /> },
    { key: 'anomaly', label: '异常检查', icon: <AlertCircle className="w-4 h-4" /> },
  ];

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {modes.map(m => (
          <button key={m.key} onClick={() => setMode(m.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${mode === m.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
            {m.icon}{m.label}
          </button>
        ))}
      </div>

      <UploadZone onUpload={() => inputRef.current?.click()} accept=".csv,.txt" label="上传 CSV 文件" sublabel="支持多文件合并" />
      <input ref={inputRef} type="file" accept=".csv,.txt" multiple className="hidden"
        onChange={e => { if (e.target.files) setFiles(Array.from(e.target.files)); }} />

      {files.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[#6d5a47]">已选择 {files.length} 个文件:</p>
          {files.map((f, i) => (
            <div key={i} className="flex items-center justify-between bg-[#fff4e6] rounded-lg px-3 py-2">
              <span className="text-sm text-[#6d5a47]">{f.name} ({formatFileSize(f.size)})</span>
              <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
            </div>
          ))}
          <Btn onClick={handleFileLoad}>加载数据</Btn>
        </div>
      )}

      {data.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-[#6d5a47]">已加载 {data.length} 行数据，{headers.length} 列: {headers.join(', ')}</p>
          {mode === 'filter' && (
            <div className="flex gap-2">
              <select value={filterColumn} onChange={e => setFilterColumn(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm">
                <option value="">选择列</option>
                {headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
              <input value={filterValue} onChange={e => setFilterValue(e.target.value)} placeholder="筛选值" className="flex-1 px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm" />
            </div>
          )}
          {mode === 'dedup' && (
            <select value={dedupColumn} onChange={e => setDedupColumn(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-[#c79f72] bg-white text-sm">
              <option value="">按第一列去重</option>
              {headers.map(h => <option key={h} value={h}>{h}</option>)}
            </select>
          )}
          <div className="flex gap-2">
            <Btn onClick={executeOperation}>执行操作</Btn>
            <Btn onClick={onClose} variant="ghost">关闭</Btn>
          </div>
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}
      {result && (
        <div className="space-y-2">
          <ResultBox label="结果" value={result.slice(0, 5000)} onCopy={() => copyToClipboard(result)} />
          <Btn onClick={downloadResult} variant="ghost"><Download className="w-4 h-4 inline mr-1" />导出 CSV</Btn>
        </div>
      )}
    </div>
  );
};

export default ExcelCsvWorkbench;