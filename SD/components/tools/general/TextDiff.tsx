import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { GitCompare, Copy, CheckCircle, Columns, AlignLeft } from 'lucide-react';

interface DiffLine {
  type: 'same' | 'added' | 'removed' | 'modified';
  left: string;
  right: string;
  lineNum: number;
}

const computeDiff = (left: string, right: string): DiffLine[] => {
  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const result: DiffLine[] = [];

  // Simple LCS-based diff
  const m = leftLines.length;
  const n = rightLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (leftLines[i - 1] === rightLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to find diff
  const diffs: { type: 'same' | 'added' | 'removed'; left?: string; right?: string; lineNum: number }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && leftLines[i - 1] === rightLines[j - 1]) {
      diffs.unshift({ type: 'same', left: leftLines[i - 1], right: rightLines[j - 1], lineNum: i });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffs.unshift({ type: 'added', right: rightLines[j - 1], lineNum: j });
      j--;
    } else if (i > 0) {
      diffs.unshift({ type: 'removed', left: leftLines[i - 1], lineNum: i });
      i--;
    }
  }

  // Merge adjacent removed+added into modified
  let lineNum = 0;
  for (let k = 0; k < diffs.length; k++) {
    lineNum++;
    if (diffs[k].type === 'removed' && k + 1 < diffs.length && diffs[k + 1].type === 'added') {
      result.push({ type: 'modified', left: diffs[k].left || '', right: diffs[k + 1].right || '', lineNum });
      k++;
    } else {
      result.push({
        type: diffs[k].type,
        left: diffs[k].left || '',
        right: diffs[k].right || '',
        lineNum,
      });
    }
  }

  return result;
};

const highlightCharDiff = (left: string, right: string): { leftHtml: string; rightHtml: string } => {
  // Simple character-level diff for modified lines
  let leftHtml = '';
  let rightHtml = '';
  const lChars = left.split('');
  const rChars = right.split('');

  // Find common prefix
  let prefixLen = 0;
  while (prefixLen < lChars.length && prefixLen < rChars.length && lChars[prefixLen] === rChars[prefixLen]) prefixLen++;

  // Find common suffix
  let suffixLen = 0;
  while (suffixLen < lChars.length - prefixLen && suffixLen < rChars.length - prefixLen &&
    lChars[lChars.length - 1 - suffixLen] === rChars[rChars.length - 1 - suffixLen]) suffixLen++;

  leftHtml = escapeHtml(left.slice(0, prefixLen)) +
    '<span class="bg-red-200 text-red-800">' + escapeHtml(left.slice(prefixLen, left.length - suffixLen)) + '</span>' +
    escapeHtml(left.slice(left.length - suffixLen));
  rightHtml = escapeHtml(right.slice(0, prefixLen)) +
    '<span class="bg-green-200 text-green-800">' + escapeHtml(right.slice(prefixLen, right.length - suffixLen)) + '</span>' +
    escapeHtml(right.slice(right.length - suffixLen));

  return { leftHtml, rightHtml };
};

const escapeHtml = (s: string) => s.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');

const TextDiff: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [showDiff, setShowDiff] = useState(false);
  const [filter, setFilter] = useState<'all' | 'changed' | 'added' | 'removed'>('all');
  const [copied, setCopied] = useState(false);

  const diff = useMemo(() => {
    if (!showDiff) return [];
    return computeDiff(leftText, rightText);
  }, [leftText, rightText, showDiff]);

  const filteredDiff = useMemo(() => {
    if (filter === 'all') return diff;
    return diff.filter(d => {
      if (filter === 'changed') return d.type === 'modified';
      if (filter === 'added') return d.type === 'added';
      if (filter === 'removed') return d.type === 'removed';
      return true;
    });
  }, [diff, filter]);

  const stats = useMemo(() => {
    const added = diff.filter(d => d.type === 'added').length;
    const removed = diff.filter(d => d.type === 'removed').length;
    const modified = diff.filter(d => d.type === 'modified').length;
    const same = diff.filter(d => d.type === 'same').length;
    return { added, removed, modified, same, total: diff.length };
  }, [diff]);

  const handleCopyDiff = async () => {
    const text = filteredDiff.map(d => {
      const prefix = d.type === 'added' ? '+ ' : d.type === 'removed' ? '- ' : d.type === 'modified' ? '~ ' : '  ';
      return prefix + (d.type === 'added' ? d.right : d.left);
    }).join('\n');
    await copyToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">文本差异对比 — 双栏输入、行级差异高亮</p>

      {/* Input */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-[#6d5a47] mb-1 block">原始文本</label>
          <textarea value={leftText} onChange={e => setLeftText(e.target.value)}
            className="w-full h-40 text-xs border border-[#ead0ad] rounded-lg px-3 py-2 bg-white font-mono resize-y focus:border-[#7a421b] focus:outline-none"
            placeholder="粘贴原始文本..." />
        </div>
        <div>
          <label className="text-xs text-[#6d5a47] mb-1 block">修改后文本</label>
          <textarea value={rightText} onChange={e => setRightText(e.target.value)}
            className="w-full h-40 text-xs border border-[#ead0ad] rounded-lg px-3 py-2 bg-white font-mono resize-y focus:border-[#7a421b] focus:outline-none"
            placeholder="粘贴修改后文本..." />
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Btn onClick={() => setShowDiff(true)} className="flex items-center gap-1">
          <GitCompare className="w-4 h-4" /> 对比
        </Btn>
        {showDiff && (
          <>
            <div className="flex border border-[#ead0ad] rounded overflow-hidden">
              <button onClick={() => setViewMode('split')}
                className={`p-1.5 ${viewMode === 'split' ? 'bg-[#7a421b] text-white' : 'bg-white text-[#6d5a47]'}`}>
                <Columns className="w-3 h-3" />
              </button>
              <button onClick={() => setViewMode('unified')}
                className={`p-1.5 ${viewMode === 'unified' ? 'bg-[#7a421b] text-white' : 'bg-white text-[#6d5a47]'}`}>
                <AlignLeft className="w-3 h-3" />
              </button>
            </div>
            <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
              className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
              <option value="all">全部</option>
              <option value="changed">仅修改</option>
              <option value="added">仅新增</option>
              <option value="removed">仅删除</option>
            </select>
            <button onClick={handleCopyDiff} className="p-1 text-[#7a421b] hover:text-[#6f3714]">
              {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </>
        )}
      </div>

      {/* Stats */}
      {showDiff && diff.length > 0 && (
        <div className="grid grid-cols-4 gap-2 text-center">
          <div className="bg-green-50 border border-green-200 rounded p-1.5">
            <div className="text-lg font-bold text-green-700">{stats.added}</div>
            <div className="text-[10px] text-green-600">新增行</div>
          </div>
          <div className="bg-red-50 border border-red-200 rounded p-1.5">
            <div className="text-lg font-bold text-red-700">{stats.removed}</div>
            <div className="text-[10px] text-red-600">删除行</div>
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded p-1.5">
            <div className="text-lg font-bold text-amber-700">{stats.modified}</div>
            <div className="text-[10px] text-amber-600">修改行</div>
          </div>
          <div className="bg-white border border-[#ead0ad] rounded p-1.5">
            <div className="text-lg font-bold text-[#7a421b]">{stats.same}</div>
            <div className="text-[10px] text-[#8b735c]">相同行</div>
          </div>
        </div>
      )}

      {/* Diff output */}
      {showDiff && filteredDiff.length > 0 && (
        <div className="border border-[#ead0ad] rounded-lg overflow-hidden">
          {viewMode === 'split' ? (
            <div className="grid grid-cols-2 divide-x divide-[#ead0ad]">
              <div className="bg-white">
                <div className="bg-[#fff4e6] text-[10px] text-[#8b735c] text-center py-1 border-b border-[#ead0ad]">原始</div>
                {filteredDiff.map((d, i) => (
                  <div key={i} className={`flex text-xs font-mono border-b border-[#ead0ad] last:border-0
                    ${d.type === 'removed' ? 'bg-red-50' : d.type === 'modified' ? 'bg-amber-50' : d.type === 'added' ? 'bg-gray-50' : ''}`}>
                    <span className="w-8 shrink-0 text-right pr-1 text-[10px] text-[#c79f72] select-none border-r border-[#ead0ad]">{d.lineNum}</span>
                    <span className="px-2 py-0.5 flex-1 whitespace-pre-wrap break-all"
                      dangerouslySetInnerHTML={{
                        __html: d.type === 'modified' ? highlightCharDiff(d.left, d.right).leftHtml : escapeHtml(d.left)
                      }} />
                  </div>
                ))}
              </div>
              <div className="bg-white">
                <div className="bg-[#fff4e6] text-[10px] text-[#8b735c] text-center py-1 border-b border-[#ead0ad]">修改后</div>
                {filteredDiff.map((d, i) => (
                  <div key={i} className={`flex text-xs font-mono border-b border-[#ead0ad] last:border-0
                    ${d.type === 'added' ? 'bg-green-50' : d.type === 'modified' ? 'bg-amber-50' : d.type === 'removed' ? 'bg-gray-50' : ''}`}>
                    <span className="w-8 shrink-0 text-right pr-1 text-[10px] text-[#c79f72] select-none border-r border-[#ead0ad]">{d.lineNum}</span>
                    <span className="px-2 py-0.5 flex-1 whitespace-pre-wrap break-all"
                      dangerouslySetInnerHTML={{
                        __html: d.type === 'modified' ? highlightCharDiff(d.left, d.right).rightHtml : escapeHtml(d.right)
                      }} />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="bg-white max-h-80 overflow-y-auto">
              {filteredDiff.map((d, i) => (
                <div key={i} className={`flex text-xs font-mono border-b border-[#ead0ad] last:border-0
                  ${d.type === 'added' ? 'bg-green-50' : d.type === 'removed' ? 'bg-red-50' : d.type === 'modified' ? 'bg-amber-50' : ''}`}>
                  <span className="w-8 shrink-0 text-right pr-1 text-[10px] text-[#c79f72] select-none border-r border-[#ead0ad]">{d.lineNum}</span>
                  <span className="w-5 shrink-0 text-center text-[10px] select-none border-r border-[#ead0ad]
                    ${d.type === 'added' ? 'text-green-600' : d.type === 'removed' ? 'text-red-600' : d.type === 'modified' ? 'text-amber-600' : 'text-[#c79f72]'}">
                    {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : d.type === 'modified' ? '~' : ' '}
                  </span>
                  <span className="px-2 py-0.5 flex-1 whitespace-pre-wrap break-all">{d.type === 'added' ? d.right : d.left}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showDiff && diff.length === 0 && (
        <div className="text-center text-xs text-[#8b735c] py-4">两段文本完全相同</div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default TextDiff;