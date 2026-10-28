import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Btn, ResultBox, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { GitCompare, ArrowRight, CheckCircle, XCircle, AlertCircle, Download } from 'lucide-react';

interface DiffRow {
  row: number;
  type: 'added' | 'removed' | 'changed' | 'unchanged';
  colA?: string;
  colB?: string;
  details?: string;
}

const SpreadsheetDiff: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [dataA, setDataA] = useState<string[][]>([]);
  const [dataB, setDataB] = useState<string[][]>([]);
  const [fileNameA, setFileNameA] = useState('');
  const [fileNameB, setFileNameB] = useState('');
  const [keyCol, setKeyCol] = useState(0);
  const [diffs, setDiffs] = useState<DiffRow[]>([]);
  const [compared, setCompared] = useState(false);
  const inputRefA = useRef<HTMLInputElement>(null);
  const inputRefB = useRef<HTMLInputElement>(null);

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
        else if (ch === ',') { row.push(current.trim()); current = ''; }
        else if (ch === '\n' || ch === '\r') {
          if (ch === '\r' && text[i + 1] === '\n') i++;
          row.push(current.trim());
          if (row.some(c => c !== '')) rows.push(row);
          row = []; current = '';
        } else { current += ch; }
      }
    }
    row.push(current.trim());
    if (row.some(c => c !== '')) rows.push(row);
    return rows;
  };

  const loadFile = useCallback(async (file: File, side: 'A' | 'B') => {
    const text = await file.text();
    const data = parseCSV(text);
    if (side === 'A') { setDataA(data); setFileNameA(file.name); }
    else { setDataB(data); setFileNameB(file.name); }
    setCompared(false);
    setDiffs([]);
  }, []);

  const handleFileA = useCallback(async (fl: FileList | null) => { if (fl?.[0]) await loadFile(fl[0], 'A'); }, [loadFile]);
  const handleFileB = useCallback(async (fl: FileList | null) => { if (fl?.[0]) await loadFile(fl[0], 'B'); }, [loadFile]);

  const headers = useMemo(() => {
    const h = dataA[0] || dataB[0] || [];
    return h;
  }, [dataA, dataB]);

  const compare = () => {
    if (dataA.length < 2 || dataB.length < 2) return;
    const rowsA = dataA.slice(1);
    const rowsB = dataB.slice(1);
    const mapA = new Map<string, string[]>();
    const mapB = new Map<string, string[]>();

    rowsA.forEach(row => {
      const key = row[keyCol] || '';
      if (key) mapA.set(key, row);
    });
    rowsB.forEach(row => {
      const key = row[keyCol] || '';
      if (key) mapB.set(key, row);
    });

    const result: DiffRow[] = [];
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    let rowIdx = 1;

    for (const key of allKeys) {
      const a = mapA.get(key);
      const b = mapB.get(key);
      if (a && !b) {
        result.push({ row: rowIdx++, type: 'removed', colA: key, details: '仅在 A 中存在' });
      } else if (!a && b) {
        result.push({ row: rowIdx++, type: 'added', colB: key, details: '仅在 B 中存在' });
      } else if (a && b) {
        const maxLen = Math.max(a.length, b.length);
        let changed = false;
        const changes: string[] = [];
        for (let i = 0; i < maxLen; i++) {
          if (i !== keyCol && a[i] !== b[i]) {
            changed = true;
            changes.push(`列${i + 1}: "${a[i] || ''}" → "${b[i] || ''}"`);
          }
        }
        if (changed) {
          result.push({ row: rowIdx++, type: 'changed', colA: key, colB: key, details: changes.join('; ') });
        } else {
          result.push({ row: rowIdx++, type: 'unchanged', colA: key, colB: key });
        }
      }
    }

    setDiffs(result);
    setCompared(true);
  };

  const stats = useMemo(() => {
    if (!compared) return null;
    return {
      added: diffs.filter(d => d.type === 'added').length,
      removed: diffs.filter(d => d.type === 'removed').length,
      changed: diffs.filter(d => d.type === 'changed').length,
      unchanged: diffs.filter(d => d.type === 'unchanged').length,
    };
  }, [compared, diffs]);

  const exportDiff = () => {
    const lines = diffs
      .filter(d => d.type !== 'unchanged')
      .map(d => `${d.type === 'added' ? '+' : d.type === 'removed' ? '-' : '~'}\t${d.colA || d.colB}\t${d.details || ''}`);
    copyToClipboard('类型\t关键字\t差异\n' + lines.join('\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">对比两个 CSV/表格文件，找出新增、删除和修改的行</p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-[#6d5a47] mb-1 block">文件 A（旧）</label>
          {fileNameA ? (
            <div className="text-sm text-[#7a421b] bg-[#f1dcc2] rounded px-2 py-1 truncate">{fileNameA} ({dataA.length - 1} 行)</div>
          ) : (
            <button onClick={() => inputRefA.current?.click()} className="w-full border-2 border-dashed border-[#ead0ad] rounded-lg p-3 text-xs text-[#8b735c] hover:border-[#7a421b]">
              上传 CSV 文件
            </button>
          )}
          <input ref={inputRefA} type="file" className="hidden" accept=".csv,.txt" onChange={e => handleFileA(e.target.files)} />
        </div>
        <div>
          <label className="text-xs font-medium text-[#6d5a47] mb-1 block">文件 B（新）</label>
          {fileNameB ? (
            <div className="text-sm text-[#7a421b] bg-[#f1dcc2] rounded px-2 py-1 truncate">{fileNameB} ({dataB.length - 1} 行)</div>
          ) : (
            <button onClick={() => inputRefB.current?.click()} className="w-full border-2 border-dashed border-[#ead0ad] rounded-lg p-3 text-xs text-[#8b735c] hover:border-[#7a421b]">
              上传 CSV 文件
            </button>
          )}
          <input ref={inputRefB} type="file" className="hidden" accept=".csv,.txt" onChange={e => handleFileB(e.target.files)} />
        </div>
      </div>

      {headers.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#6d5a47]">对比键列:</span>
          <select value={keyCol} onChange={e => setKeyCol(Number(e.target.value))}
            className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
            {headers.map((h, i) => (
              <option key={i} value={i}>{h || `列 ${i + 1}`}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={compare} disabled={dataA.length < 2 || dataB.length < 2}>
          <GitCompare className="w-4 h-4 mr-1" />开始对比
        </Btn>
        {compared && (
          <Btn onClick={exportDiff} variant="ghost">
            <Download className="w-4 h-4 mr-1" />导出差异
          </Btn>
        )}
      </div>

      {stats && (
        <div className="grid grid-cols-4 gap-2">
          <div className="bg-green-50 border border-green-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-green-600">{stats.added}</div>
            <div className="text-xs text-green-700">新增</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-red-600">{stats.removed}</div>
            <div className="text-xs text-red-700">删除</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-amber-600">{stats.changed}</div>
            <div className="text-xs text-amber-700">修改</div>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-2 text-center">
            <div className="text-lg font-bold text-gray-600">{stats.unchanged}</div>
            <div className="text-xs text-gray-700">未变</div>
          </div>
        </div>
      )}

      {compared && (
        <div className="max-h-80 overflow-y-auto border border-[#ead0ad] rounded-lg">
          <table className="w-full text-xs">
            <thead className="bg-[#f1dcc2] sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left text-[#6f3714]">状态</th>
                <th className="px-2 py-1 text-left text-[#6f3714]">关键字</th>
                <th className="px-2 py-1 text-left text-[#6f3714]">差异详情</th>
              </tr>
            </thead>
            <tbody>
              {diffs.map((d, i) => (
                <tr key={i} className={d.type === 'added' ? 'bg-green-50' : d.type === 'removed' ? 'bg-red-50' : d.type === 'changed' ? 'bg-amber-50' : ''}>
                  <td className="px-2 py-1">
                    {d.type === 'added' && <span className="text-green-600">+ 新增</span>}
                    {d.type === 'removed' && <span className="text-red-600">- 删除</span>}
                    {d.type === 'changed' && <span className="text-amber-600">~ 修改</span>}
                    {d.type === 'unchanged' && <span className="text-gray-400">= 相同</span>}
                  </td>
                  <td className="px-2 py-1 text-[#6d5a47]">{d.colA || d.colB}</td>
                  <td className="px-2 py-1 text-[#8b735c]">{d.details || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default SpreadsheetDiff;