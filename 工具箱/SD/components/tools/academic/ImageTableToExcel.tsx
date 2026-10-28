import React, { useState, useRef, useCallback } from 'react';
import { Btn, copyToClipboard, formatFileSize } from '../shared';
import { UploadZone } from '../shared';
import { Table2, Download, Image, AlertTriangle, CheckCircle } from 'lucide-react';

interface TableCell {
  row: number;
  col: number;
  text: string;
  confidence: number;
}

interface TableResult {
  id: string;
  rows: number;
  cols: number;
  cells: TableCell[];
  preview: string;
}

const generateId = () => Math.random().toString(36).slice(2, 9);

const ImageTableToExcel: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tables, setTables] = useState<TableResult[]>([]);
  const [processing, setProcessing] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualRows, setManualRows] = useState(3);
  const [manualCols, setManualCols] = useState(3);
  const [manualData, setManualData] = useState<string[][]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const initManualData = (rows: number, cols: number) => {
    const data: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < cols; c++) {
        row.push(manualData[r]?.[c] || '');
      }
      data.push(row);
    }
    setManualData(data);
    setManualRows(rows);
    setManualCols(cols);
  };

  const updateManualCell = (row: number, col: number, value: string) => {
    setManualData(prev => {
      const newData = prev.map(r => [...r]);
      while (newData.length <= row) newData.push([]);
      while (newData[row].length <= col) newData[row].push('');
      newData[row][col] = value;
      return newData;
    });
  };

  const handleImage = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    setProcessing(true);
    try {
      const file = fl[0];
      const url = URL.createObjectURL(file);

      // Try to use tesseract.js for OCR
      try {
        const Tesseract = await import('tesseract.js');
        const worker = await Tesseract.createWorker('chi_sim+eng');
        const { data } = await worker.recognize(file);
        await worker.terminate();

        // Simple table extraction from OCR text
        const lines = data.lines || [];
        const cells: TableCell[] = [];
        let maxCols = 0;

        lines.forEach((line: any, rowIdx: number) => {
          const words = line.words || [];
          // Group words by x-position gaps into columns
          const groups: { text: string; x: number }[] = [];
          let currentGroup = '';
          let lastX = 0;

          words.forEach((word: any) => {
            const gap = word.bbox.x0 - lastX;
            if (gap > 50 && currentGroup) {
              groups.push({ text: currentGroup.trim(), x: lastX });
              currentGroup = word.text + ' ';
            } else {
              currentGroup += word.text + ' ';
            }
            lastX = word.bbox.x1;
          });
          if (currentGroup.trim()) {
            groups.push({ text: currentGroup.trim(), x: lastX });
          }

          maxCols = Math.max(maxCols, groups.length);
          groups.forEach((g, colIdx) => {
            cells.push({
              row: rowIdx,
              col: colIdx,
              text: g.text,
              confidence: line.confidence || 0,
            });
          });
        });

        if (cells.length > 0) {
          setTables(prev => [...prev, {
            id: generateId(),
            rows: lines.length,
            cols: maxCols,
            cells,
            preview: url,
          }]);
        }
      } catch {
        // tesseract.js not available - use manual mode
        setManualMode(true);
        URL.revokeObjectURL(url);
      }
    } finally {
      setProcessing(false);
    }
  }, []);

  const addManualTable = () => {
    const cells: TableCell[] = [];
    manualData.forEach((row, r) => {
      row.forEach((text, c) => {
        cells.push({ row: r, col: c, text, confidence: 100 });
      });
    });
    setTables(prev => [...prev, {
      id: generateId(),
      rows: manualRows,
      cols: manualCols,
      cells,
      preview: '',
    }]);
    setManualData([]);
  };

  const removeTable = (id: string) => {
    setTables(prev => prev.filter(t => t.id !== id));
  };

  const tableToCSV = (table: TableResult): string => {
    const grid: string[][] = [];
    for (let r = 0; r < table.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < table.cols; c++) {
        const cell = table.cells.find(cl => cl.row === r && cl.col === c);
        row.push(cell ? `"${cell.text.replace(/"/g, '""')}"` : '');
      }
      grid.push(row);
    }
    return grid.map(r => r.join(',')).join('\n');
  };

  const downloadCSV = (table: TableResult, index: number) => {
    const csv = '\uFEFF' + tableToCSV(table); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table_${index + 1}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadAllCSV = () => {
    const allCSV = tables.map((t, i) => {
      return `--- 表格 ${i + 1} ---\n${tableToCSV(t)}`;
    }).join('\n\n');
    const csv = '\uFEFF' + allCSV;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'all_tables.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyTableAsText = (table: TableResult) => {
    const grid: string[][] = [];
    for (let r = 0; r < table.rows; r++) {
      const row: string[] = [];
      for (let c = 0; c < table.cols; c++) {
        const cell = table.cells.find(cl => cl.row === r && cl.col === c);
        row.push(cell?.text || '');
      }
      grid.push(row);
    }
    copyToClipboard(grid.map(r => r.join('\t')).join('\n'));
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">从图片中识别表格数据，转换为可编辑的 CSV/Excel 格式</p>

      <div className="flex gap-2">
        <button onClick={() => setManualMode(false)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!manualMode ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
          <Image className="w-3 h-3 inline mr-1" />图片识别
        </button>
        <button onClick={() => setManualMode(true)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium ${manualMode ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714]'}`}>
          <Table2 className="w-3 h-3 inline mr-1" />手动录入
        </button>
      </div>

      {!manualMode ? (
        <>
          <UploadZone onUpload={() => inputRef.current?.click()} onDropFiles={handleImage} accept="image/*" label="上传表格图片" sublabel="支持 JPG/PNG" />
          <input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={e => handleImage(e.target.files)} />

          {processing && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-center">
              <div className="text-sm text-blue-700">正在识别图片中的表格...</div>
              <div className="text-xs text-blue-500 mt-1">这可能需要几秒钟</div>
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            <label className="text-xs text-[#6d5a47]">行数</label>
            <input type="number" value={manualRows} onChange={e => initManualData(parseInt(e.target.value) || 1, manualCols)}
              className="w-16 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" min={1} max={50} />
            <label className="text-xs text-[#6d5a47]">列数</label>
            <input type="number" value={manualCols} onChange={e => initManualData(manualRows, parseInt(e.target.value) || 1)}
              className="w-16 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" min={1} max={20} />
          </div>
          <div className="overflow-x-auto">
            <table className="border-collapse">
              <tbody>
                {Array.from({ length: manualRows }, (_, r) => (
                  <tr key={r}>
                    <td className="text-xs text-[#8b735c] pr-1">{r + 1}</td>
                    {Array.from({ length: manualCols }, (_, c) => (
                      <td key={c} className="p-0.5">
                        <input value={manualData[r]?.[c] || ''} onChange={e => updateManualCell(r, c, e.target.value)}
                          className="text-xs border border-[#ead0ad] rounded px-1 py-0.5 w-24 bg-white" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Btn onClick={addManualTable} disabled={manualData.length === 0}>添加表格</Btn>
        </div>
      )}

      {tables.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[#6f3714]">识别结果（{tables.length} 个表格）</span>
            <Btn onClick={downloadAllCSV} variant="secondary"><Download className="w-4 h-4 mr-1" />全部下载</Btn>
          </div>

          {tables.map((table, idx) => (
            <div key={table.id} className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#6f3714]">表格 {idx + 1}（{table.rows}×{table.cols}）</span>
                <div className="flex gap-2">
                  <button onClick={() => copyTableAsText(table)} className="text-xs text-[#7a421b] hover:underline">复制</button>
                  <button onClick={() => downloadCSV(table, idx)} className="text-xs text-[#7a421b] hover:underline">下载CSV</button>
                  <button onClick={() => removeTable(table.id)} className="text-xs text-red-500 hover:underline">删除</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="border-collapse w-full">
                  <tbody>
                    {Array.from({ length: table.rows }, (_, r) => (
                      <tr key={r}>
                        {Array.from({ length: table.cols }, (_, c) => {
                          const cell = table.cells.find(cl => cl.row === r && cl.col === c);
                          return (
                            <td key={c} className="border border-[#ead0ad] px-2 py-1 text-xs text-[#8b735c]">
                              {cell?.text || ''}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：图片识别需要 tesseract.js 库。如未安装，可使用手动录入模式。识别精度受图片质量影响，建议使用清晰、高对比度的表格图片。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default ImageTableToExcel;