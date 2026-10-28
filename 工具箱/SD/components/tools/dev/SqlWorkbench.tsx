import React, { useState, useMemo, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Play, Copy, CheckCircle, Table2, Trash2, Plus, Download } from 'lucide-react';

type CellValue = string | number | null;

interface DataTable {
  name: string;
  columns: string[];
  rows: CellValue[][];
}

interface QueryResult {
  columns: string[];
  rows: CellValue[][];
  affected: number;
  type: 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'CREATE' | 'DROP' | 'ERROR' | 'OTHER';
  message: string;
}

const SAMPLE_TABLES: DataTable[] = [
  {
    name: 'users',
    columns: ['id', 'name', 'email', 'age', 'city'],
    rows: [
      [1, '张三', 'zhangsan@example.com', 28, '北京'],
      [2, '李四', 'lisi@example.com', 32, '上海'],
      [3, '王五', 'wangwu@example.com', 25, '广州'],
      [4, '赵六', 'zhaoliu@example.com', 35, '深圳'],
      [5, '钱七', 'qianqi@example.com', 29, '杭州'],
    ],
  },
  {
    name: 'orders',
    columns: ['id', 'user_id', 'product', 'amount', 'date'],
    rows: [
      [1, 1, '笔记本电脑', 5999, '2024-01-15'],
      [2, 2, '手机', 3999, '2024-01-16'],
      [3, 1, '耳机', 299, '2024-01-17'],
      [4, 3, '平板', 2999, '2024-01-18'],
      [5, 4, '键盘', 599, '2024-01-19'],
      [6, 2, '显示器', 1999, '2024-01-20'],
    ],
  },
  {
    name: 'products',
    columns: ['id', 'name', 'category', 'price', 'stock'],
    rows: [
      [1, '笔记本电脑', '电子产品', 5999, 50],
      [2, '手机', '电子产品', 3999, 100],
      [3, '耳机', '电子产品', 299, 200],
      [4, '平板', '电子产品', 2999, 30],
      [5, '键盘', '外设', 599, 150],
      [6, '显示器', '外设', 1999, 40],
    ],
  },
];

const parseSql = (sql: string): { type: string; table: string; columns: string[]; whereClause: string; rest: string } | null => {
  const trimmed = sql.trim().replace(/;$/, '');
  const upper = trimmed.toUpperCase();

  // SELECT
  const selectMatch = trimmed.match(/^select\s+(.+?)\s+from\s+(\w+)(?:\s+where\s+(.+))?/i);
  if (selectMatch) {
    return {
      type: 'SELECT',
      table: selectMatch[2],
      columns: selectMatch[1].split(',').map(c => c.trim()),
      whereClause: selectMatch[3] || '',
      rest: '',
    };
  }

  // INSERT
  const insertMatch = trimmed.match(/^insert\s+into\s+(\w+)\s*\((.+?)\)\s*values\s*\((.+?)\)/i);
  if (insertMatch) {
    return {
      type: 'INSERT',
      table: insertMatch[1],
      columns: insertMatch[2].split(',').map(c => c.trim()),
      whereClause: insertMatch[3],
      rest: '',
    };
  }

  // DELETE
  const deleteMatch = trimmed.match(/^delete\s+from\s+(\w+)(?:\s+where\s+(.+))?/i);
  if (deleteMatch) {
    return {
      type: 'DELETE',
      table: deleteMatch[1],
      columns: [],
      whereClause: deleteMatch[2] || '',
      rest: '',
    };
  }

  // UPDATE
  const updateMatch = trimmed.match(/^update\s+(\w+)\s+set\s+(.+?)(?:\s+where\s+(.+))?$/i);
  if (updateMatch) {
    return {
      type: 'UPDATE',
      table: updateMatch[1],
      columns: [],
      whereClause: updateMatch[3] || '',
      rest: updateMatch[2],
    };
  }

  // CREATE TABLE
  const createMatch = trimmed.match(/^create\s+table\s+(\w+)\s*\((.+)\)/i);
  if (createMatch) {
    return {
      type: 'CREATE',
      table: createMatch[1],
      columns: createMatch[2].split(',').map(c => c.trim()),
      whereClause: '',
      rest: '',
    };
  }

  // DROP TABLE
  const dropMatch = trimmed.match(/^drop\s+table\s+(\w+)/i);
  if (dropMatch) {
    return { type: 'DROP', table: dropMatch[1], columns: [], whereClause: '', rest: '' };
  }

  return null;
};

const evaluateWhere = (row: CellValue[], columns: string[], where: string): boolean => {
  if (!where) return true;
  try {
    const w = where.trim();
    // Simple column = value
    const eqMatch = w.match(/^(\w+)\s*=\s*'?(.+?)'?$/);
    if (eqMatch) {
      const colIdx = columns.indexOf(eqMatch[1]);
      if (colIdx === -1) return false;
      const val = String(row[colIdx]);
      return val === eqMatch[2];
    }
    // column > value
    const gtMatch = w.match(/^(\w+)\s*>\s*(\d+)$/);
    if (gtMatch) {
      const colIdx = columns.indexOf(gtMatch[1]);
      if (colIdx === -1) return false;
      return Number(row[colIdx]) > Number(gtMatch[2]);
    }
    // column < value
    const ltMatch = w.match(/^(\w+)\s*<\s*(\d+)$/);
    if (ltMatch) {
      const colIdx = columns.indexOf(ltMatch[1]);
      if (colIdx === -1) return false;
      return Number(row[colIdx]) < Number(ltMatch[2]);
    }
    return true;
  } catch { return true; }
};

const executeQuery = (tables: Map<string, DataTable>, sql: string): QueryResult => {
  const parsed = parseSql(sql);
  if (!parsed) {
    return { columns: [], rows: [], affected: 0, type: 'ERROR', message: '无法解析SQL语句（仅支持简单SELECT/INSERT/UPDATE/DELETE/CREATE/DROP）' };
  }

  const table = tables.get(parsed.table);

  switch (parsed.type) {
    case 'SELECT': {
      if (!table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 不存在` };
      const filtered = table.rows.filter(row => evaluateWhere(row, table.columns, parsed.whereClause));
      if (parsed.columns[0] === '*') {
        return { columns: table.columns, rows: filtered, affected: filtered.length, type: 'SELECT', message: `${filtered.length} 行` };
      }
      const colIndices = parsed.columns.map(c => {
        const idx = table.columns.indexOf(c);
        return idx;
      });
      if (colIndices.some(i => i === -1)) {
        return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `列不存在: ${parsed.columns.filter((c, i) => colIndices[i] === -1).join(', ')}` };
      }
      const resultRows = filtered.map(row => colIndices.map(i => row[i]));
      return { columns: parsed.columns, rows: resultRows, affected: resultRows.length, type: 'SELECT', message: `${resultRows.length} 行` };
    }

    case 'INSERT': {
      if (!table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 不存在` };
      const values = parsed.whereClause.split(',').map(v => {
        const trimmed = v.trim();
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
        return isNaN(Number(trimmed)) ? trimmed : Number(trimmed);
      });
      table.rows.push(values);
      return { columns: [], rows: [], affected: 1, type: 'INSERT', message: '插入 1 行' };
    }

    case 'DELETE': {
      if (!table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 不存在` };
      const before = table.rows.length;
      table.rows = table.rows.filter(row => !evaluateWhere(row, table.columns, parsed.whereClause));
      const deleted = before - table.rows.length;
      return { columns: [], rows: [], affected: deleted, type: 'DELETE', message: `删除 ${deleted} 行` };
    }

    case 'UPDATE': {
      if (!table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 不存在` };
      const setPairs = parsed.rest.split(',').map(p => {
        const [col, val] = p.split('=').map(s => s.trim());
        return { col, val: val.startsWith("'") && val.endsWith("'") ? val.slice(1, -1) : isNaN(Number(val)) ? val : Number(val) };
      });
      let updated = 0;
      table.rows.forEach(row => {
        if (evaluateWhere(row, table.columns, parsed.whereClause)) {
          setPairs.forEach(({ col, val }) => {
            const idx = table.columns.indexOf(col);
            if (idx !== -1) row[idx] = val;
          });
          updated++;
        }
      });
      return { columns: [], rows: [], affected: updated, type: 'UPDATE', message: `更新 ${updated} 行` };
    }

    case 'CREATE': {
      if (table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 已存在` };
      tables.set(parsed.table, { name: parsed.table, columns: parsed.columns, rows: [] });
      return { columns: [], rows: [], affected: 0, type: 'CREATE', message: `表 ${parsed.table} 已创建` };
    }

    case 'DROP': {
      if (!table) return { columns: [], rows: [], affected: 0, type: 'ERROR', message: `表 ${parsed.table} 不存在` };
      tables.delete(parsed.table);
      return { columns: [], rows: [], affected: 0, type: 'DROP', message: `表 ${parsed.table} 已删除` };
    }

    default:
      return { columns: [], rows: [], affected: 0, type: 'OTHER', message: '不支持的SQL语句' };
  }
};

const SAMPLE_QUERIES = [
  'SELECT * FROM users',
  'SELECT name, age FROM users WHERE age > 28',
  'SELECT * FROM orders WHERE user_id = 1',
  'SELECT * FROM products WHERE price > 1000',
  'INSERT INTO users (id, name, email, age, city) VALUES (6, \'孙八\', \'sunba@example.com\', 27, \'成都\')',
  'UPDATE users SET age = 30 WHERE name = \'张三\'',
  'DELETE FROM orders WHERE amount < 1000',
];

const SqlWorkbench: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [tables, setTables] = useState<Map<string, DataTable>>(() => {
    const m = new Map();
    SAMPLE_TABLES.forEach(t => m.set(t.name, { ...t, rows: [...t.rows.map(r => [...r])] }));
    return m;
  });
  const [sql, setSql] = useState('SELECT * FROM users');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [activeTable, setActiveTable] = useState('users');
  const [copied, setCopied] = useState(false);

  const handleExecute = () => {
    if (!sql.trim()) return;
    const res = executeQuery(tables, sql);
    setResult(res);
    setHistory(prev => [sql, ...prev.filter(h => h !== sql)].slice(0, 20));
  };

  const handleCopy = async () => {
    if (!result) return;
    const text = [result.columns.join('\t'), ...result.rows.map(r => r.join('\t'))].join('\n');
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    if (!result || result.rows.length === 0) return;
    const csv = [result.columns.join(','), ...result.rows.map(r => r.map(c => c === null ? '' : String(c).includes(',') ? `"${c}"` : String(c)).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'query-result.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    const m = new Map();
    SAMPLE_TABLES.forEach(t => m.set(t.name, { ...t, rows: [...t.rows.map(r => [...r])] }));
    setTables(m);
    setResult(null);
    setActiveTable('users');
  };

  const currentTable = tables.get(activeTable);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">SQL 数据工作台 — 纯前端模拟SQL查询，支持示例数据表</p>

      {/* Tables overview */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <div className="flex items-center gap-2 mb-2">
          <Table2 className="w-4 h-4 text-[#7a421b]" />
          <span className="text-xs font-medium text-[#6f3714]">数据表</span>
          <button onClick={handleReset} className="ml-auto text-[10px] text-[#8b735c] hover:text-[#7a421b]">重置数据</button>
        </div>
        <div className="flex flex-wrap gap-1">
          {[...tables.keys()].map(name => (
            <button key={name} onClick={() => setActiveTable(name)}
              className={`px-2 py-1 rounded text-xs border transition-all
                ${activeTable === name ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
              {name} ({tables.get(name)?.rows.length})
            </button>
          ))}
        </div>
        {currentTable && (
          <div className="mt-2 border border-[#ead0ad] rounded bg-white max-h-32 overflow-auto">
            <table className="w-full text-[10px] font-mono">
              <thead>
                <tr className="bg-[#f1dcc2]">
                  {currentTable.columns.map(c => <th key={c} className="px-2 py-1 text-left text-[#6f3714]">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {currentTable.rows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-t border-[#ead0ad]">
                    {row.map((cell, j) => <td key={j} className="px-2 py-0.5 text-[#6d5a47]">{cell === null ? 'NULL' : String(cell)}</td>)}
                  </tr>
                ))}
                {currentTable.rows.length > 10 && (
                  <tr><td colSpan={currentTable.columns.length} className="px-2 py-1 text-center text-[#8b735c]">... 共 {currentTable.rows.length} 行</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* SQL editor */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-[#6d5a47]">SQL 编辑器</label>
          <span className="text-[10px] text-[#8b735c]">支持简单 SELECT/INSERT/UPDATE/DELETE/CREATE/DROP</span>
        </div>
        <textarea value={sql} onChange={e => setSql(e.target.value)}
          className="w-full h-24 text-xs font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white resize-y focus:border-[#7a421b] focus:outline-none"
          placeholder="输入SQL语句..." />
        <div className="flex gap-2 mt-2">
          <Btn onClick={handleExecute}><Play className="w-3 h-3 mr-1" />执行</Btn>
          <button onClick={() => setSql('')} className="px-2 py-1 text-xs text-[#8b735c] hover:text-[#7a421b]">清空</button>
        </div>
      </div>

      {/* Sample queries */}
      <div>
        <span className="text-[10px] text-[#8b735c]">示例查询：</span>
        <div className="flex flex-wrap gap-1 mt-1">
          {SAMPLE_QUERIES.map((q, i) => (
            <button key={i} onClick={() => setSql(q)}
              className="px-2 py-0.5 text-[10px] font-mono bg-white border border-[#ead0ad] rounded hover:border-[#c79f72] text-[#6d5a47] truncate max-w-[200px]">
              {q.length > 30 ? q.slice(0, 30) + '...' : q}
            </button>
          ))}
        </div>
      </div>

      {/* Result */}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className={`text-xs font-medium ${result.type === 'ERROR' ? 'text-red-600' : 'text-[#6d5a47]'}`}>
              {result.type === 'ERROR' ? '错误' : '结果'}: {result.message}
            </span>
            {result.rows.length > 0 && (
              <div className="flex gap-1">
                <button onClick={handleCopy} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
                  {copied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                </button>
                <button onClick={handleExport} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
                  <Download className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
          {result.rows.length > 0 && (
            <div className="border border-[#ead0ad] rounded-lg max-h-48 overflow-auto bg-white">
              <table className="w-full text-xs font-mono">
                <thead>
                  <tr className="bg-[#f1dcc2]">
                    {result.columns.map(c => <th key={c} className="px-2 py-1 text-left text-[#6f3714]">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.slice(0, 100).map((row, i) => (
                    <tr key={i} className="border-t border-[#ead0ad]">
                      {row.map((cell, j) => <td key={j} className="px-2 py-0.5 text-[#6d5a47]">{cell === null ? <span className="text-[#c79f72]">NULL</span> : String(cell)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div>
          <span className="text-[10px] text-[#8b735c]">查询历史：</span>
          <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto">
            {history.map((h, i) => (
              <button key={i} onClick={() => setSql(h)}
                className="block w-full text-left text-[10px] font-mono text-[#6d5a47] hover:text-[#7a421b] hover:bg-[#fff4e6] px-2 py-0.5 rounded truncate">
                {h}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
        注意：此为纯前端SQL模拟，仅支持简单语法。不支持 JOIN、GROUP BY、子查询、聚合函数等高级特性。
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default SqlWorkbench;