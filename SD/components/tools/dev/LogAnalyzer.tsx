import React, { useState, useMemo, useRef } from 'react';
import { Btn, ResultBox, copyToClipboard, UploadZone } from '../shared';
import { Search, Filter, BarChart3, Download, Copy, CheckCircle, AlertTriangle, Info, AlertOctagon } from 'lucide-react';

type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE' | 'FATAL' | 'UNKNOWN';

interface LogEntry {
  raw: string;
  level: LogLevel;
  timestamp: string;
  message: string;
  lineNum: number;
}

const LEVEL_PATTERNS: [LogLevel, RegExp][] = [
  ['FATAL', /\b(FATAL|CRITICAL|SEVERE)\b/i],
  ['ERROR', /\b(ERROR|ERR|EXCEPTION|FAILED)\b/i],
  ['WARN', /\b(WARN|WARNING|CAUTION)\b/i],
  ['INFO', /\b(INFO|NOTICE|STATUS)\b/i],
  ['DEBUG', /\b(DEBUG|DBG|VERBOSE)\b/i],
  ['TRACE', /\b(TRACE|FINEST)\b/i],
];

const TIMESTAMP_PATTERNS = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/,
  /\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}:\d{2}/,
  /\[\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\]/,
  /\w{3}\s+\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4}/,
  /\d{2}:\d{2}:\d{2}\.\d{3}/,
];

const detectLevel = (line: string): LogLevel => {
  for (const [level, pattern] of LEVEL_PATTERNS) {
    if (pattern.test(line)) return level;
  }
  return 'UNKNOWN';
};

const extractTimestamp = (line: string): string => {
  for (const pattern of TIMESTAMP_PATTERNS) {
    const match = line.match(pattern);
    if (match) return match[0];
  }
  return '';
};

const parseLogs = (content: string): LogEntry[] => {
  return content.split('\n').filter(Boolean).map((raw, i) => ({
    raw,
    level: detectLevel(raw),
    timestamp: extractTimestamp(raw),
    message: raw.length > 200 ? raw.slice(0, 200) + '...' : raw,
    lineNum: i + 1,
  }));
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  FATAL: 'text-red-700 bg-red-100',
  ERROR: 'text-red-600 bg-red-50',
  WARN: 'text-amber-600 bg-amber-50',
  INFO: 'text-blue-600 bg-blue-50',
  DEBUG: 'text-gray-600 bg-gray-50',
  TRACE: 'text-gray-400 bg-gray-50',
  UNKNOWN: 'text-[#8b735c] bg-[#fff4e6]',
};

const LEVEL_ICONS: Record<LogLevel, React.ReactNode> = {
  FATAL: <AlertOctagon className="w-3 h-3" />,
  ERROR: <AlertOctagon className="w-3 h-3" />,
  WARN: <AlertTriangle className="w-3 h-3" />,
  INFO: <Info className="w-3 h-3" />,
  DEBUG: <Search className="w-3 h-3" />,
  TRACE: <Search className="w-3 h-3" />,
  UNKNOWN: <Info className="w-3 h-3" />,
};

const LogAnalyzer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<Set<LogLevel>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [regexMode, setRegexMode] = useState(false);
  const [regexError, setRegexError] = useState('');
  const [timeStart, setTimeStart] = useState('');
  const [timeEnd, setTimeEnd] = useState('');
  const [copied, setCopied] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fileInputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    let result = logs;

    if (levelFilter.size > 0) {
      result = result.filter(e => levelFilter.has(e.level));
    }

    if (searchText) {
      if (regexMode) {
        try {
          const regex = new RegExp(searchText, 'i');
          setRegexError('');
          result = result.filter(e => regex.test(e.raw));
        } catch {
          setRegexError('正则表达式语法错误');
          return result;
        }
      } else {
        const lower = searchText.toLowerCase();
        result = result.filter(e => e.raw.toLowerCase().includes(lower));
      }
    } else {
      setRegexError('');
    }

    if (timeStart) {
      result = result.filter(e => e.timestamp && e.timestamp >= timeStart);
    }
    if (timeEnd) {
      result = result.filter(e => e.timestamp && e.timestamp <= timeEnd);
    }

    return result;
  }, [logs, levelFilter, searchText, regexMode, timeStart, timeEnd]);

  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    logs.forEach(e => { counts[e.level] = (counts[e.level] || 0) + 1; });
    return counts;
  }, [logs]);

  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const toggleLevel = (level: LogLevel) => {
    const next = new Set(levelFilter);
    if (next.has(level)) next.delete(level); else next.add(level);
    setLevelFilter(next);
  };

  const handleCopy = async () => {
    await copyToClipboard(filtered.map(e => e.raw).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExport = () => {
    const blob = new Blob([filtered.map(e => e.raw).join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'filtered-logs.txt'; a.click();
    URL.revokeObjectURL(url);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setLogs(parseLogs(text));
        setPage(0);
      }
    } catch { /* clipboard denied */ }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">日志分析器 — 级别筛选、正则搜索、统计面板、导出过滤结果</p>

      {/* Input */}
      <div className="flex gap-2">
        <UploadZone onUpload={() => fileInputRef.current?.click()} accept=".log,.txt,.csv" />
        <input ref={fileInputRef} type="file" accept=".log,.txt,.csv" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { const r = new FileReader(); r.onload = () => { setLogs(parseLogs(r.result as string)); setPage(0); }; r.readAsText(file); } }} />
        <Btn onClick={handlePaste} variant="secondary">粘贴日志</Btn>
      </div>

      {logs.length === 0 ? (
        <div className="text-center text-sm text-[#8b735c] py-8">上传或粘贴日志文件开始分析</div>
      ) : (<>
        {/* Stats */}
        <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <BarChart3 className="w-4 h-4 text-[#7a421b]" />
            <span className="text-xs font-medium text-[#6f3714]">统计概览</span>
            <span className="text-[10px] text-[#8b735c]">共 {logs.length} 条</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(stats) as [LogLevel, number][]).sort((a, b) => b[1] - a[1]).map(([level, count]) => (
              <button key={level} onClick={() => toggleLevel(level)}
                className={`px-2 py-1 rounded text-xs flex items-center gap-1 border transition-all
                  ${levelFilter.has(level) ? 'ring-2 ring-[#7a421b] ring-offset-1' : 'opacity-70'}
                  ${LEVEL_COLORS[level]}`}>
                {LEVEL_ICONS[level]}
                <span className="font-medium">{level}</span>
                <span className="opacity-70">{count}</span>
              </button>
            ))}
          </div>
          {levelFilter.size > 0 && (
            <button onClick={() => setLevelFilter(new Set())}
              className="text-[10px] text-[#7a421b] mt-1 hover:underline">清除筛选</button>
          )}
        </div>

        {/* Search */}
        <div className="space-y-1">
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-[#c79f72]" />
              <input value={searchText} onChange={e => { setSearchText(e.target.value); setPage(0); }}
                className="w-full text-xs border border-[#ead0ad] rounded-lg pl-7 pr-3 py-1.5 bg-white focus:border-[#7a421b] focus:outline-none"
                placeholder="搜索日志内容..." />
            </div>
            <button onClick={() => setRegexMode(!regexMode)}
              className={`px-2 py-1 text-xs rounded border ${regexMode ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#8b735c] border-[#ead0ad]'}`}>
              .*
            </button>
          </div>
          {regexError && <div className="text-[10px] text-red-500">{regexError}</div>}
          <div className="flex gap-2">
            <input value={timeStart} onChange={e => { setTimeStart(e.target.value); setPage(0); }}
              className="flex-1 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" placeholder="起始时间 (如 2024-01-01)" />
            <input value={timeEnd} onChange={e => { setTimeEnd(e.target.value); setPage(0); }}
              className="flex-1 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white" placeholder="结束时间" />
          </div>
        </div>

        {/* Results count */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-[#8b735c]">匹配 {filtered.length} 条</span>
          <div className="flex gap-1">
            <button onClick={handleCopy} className="p-1 text-[#7a421b] hover:text-[#6f3714]" title="复制">
              {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            <button onClick={handleExport} className="p-1 text-[#7a421b] hover:text-[#6f3714]" title="导出">
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Log entries */}
        <div className="border border-[#ead0ad] rounded-lg max-h-80 overflow-y-auto bg-white">
          {paged.map((entry, i) => (
            <div key={i} className={`flex items-start gap-2 px-3 py-1.5 text-xs border-b border-[#ead0ad] last:border-0 hover:bg-[#fff4e6] ${LEVEL_COLORS[entry.level]}`}>
              <span className="text-[10px] text-[#c79f72] w-8 shrink-0 text-right">{entry.lineNum}</span>
              <span className={`shrink-0 px-1 rounded text-[10px] font-medium ${LEVEL_COLORS[entry.level]}`}>
                {entry.level}
              </span>
              {entry.timestamp && <span className="text-[10px] text-[#8b735c] shrink-0">{entry.timestamp}</span>}
              <span className="font-mono text-[#6d5a47] break-all flex-1">{entry.message}</span>
            </div>
          ))}
          {paged.length === 0 && (
            <div className="text-center text-xs text-[#8b735c] py-4">无匹配日志</div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 text-xs border border-[#ead0ad] rounded disabled:opacity-30">上一页</button>
            <span className="text-xs text-[#8b735c]">{page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-2 py-1 text-xs border border-[#ead0ad] rounded disabled:opacity-30">下一页</button>
          </div>
        )}
      </>)}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default LogAnalyzer;