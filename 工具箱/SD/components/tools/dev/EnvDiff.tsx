import React, { useState, useMemo, useRef } from 'react';
import { Btn, copyToClipboard, UploadZone } from '../shared';
import { Copy, CheckCircle, ArrowRight, ArrowLeft, ArrowLeftRight, Plus, Minus, Equal } from 'lucide-react';

interface EnvVar {
  key: string;
  value: string;
  comment: string;
  lineNum: number;
}

type DiffType = 'added' | 'removed' | 'changed' | 'unchanged';

interface DiffEntry {
  key: string;
  leftVal: string;
  rightVal: string;
  leftComment: string;
  rightComment: string;
  diffType: DiffType;
}

const parseEnv = (content: string): EnvVar[] => {
  const vars: EnvVar[] = [];
  const lines = content.split('\n');
  let currentComment = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) {
      currentComment = line.startsWith('#') ? line.slice(1).trim() : '';
      continue;
    }

    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value = line.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    vars.push({ key, value, comment: currentComment, lineNum: i + 1 });
    currentComment = '';
  }

  return vars;
};

const diffEnvs = (left: EnvVar[], right: EnvVar[]): DiffEntry[] => {
  const leftMap = new Map(left.map(v => [v.key, v]));
  const rightMap = new Map(right.map(v => [v.key, v]));
  const allKeys = new Set([...leftMap.keys(), ...rightMap.keys()]);

  const diffs: DiffEntry[] = [];
  for (const key of allKeys) {
    const l = leftMap.get(key);
    const r = rightMap.get(key);

    if (l && !r) {
      diffs.push({ key, leftVal: l.value, rightVal: '', leftComment: l.comment, rightComment: '', diffType: 'removed' });
    } else if (!l && r) {
      diffs.push({ key, leftVal: '', rightVal: r.value, leftComment: '', rightComment: r.comment, diffType: 'added' });
    } else if (l && r) {
      const changed = l.value !== r.value;
      diffs.push({
        key,
        leftVal: l.value,
        rightVal: r!.value,
        leftComment: l.comment,
        rightComment: r!.comment,
        diffType: changed ? 'changed' : 'unchanged',
      });
    }
  }

  // Sort: removed first, then added, then changed, then unchanged
  const order: Record<DiffType, number> = { removed: 0, added: 1, changed: 2, unchanged: 3 };
  diffs.sort((a, b) => order[a.diffType] - order[b.diffType] || a.key.localeCompare(b.key));

  return diffs;
};

const toEnvFormat = (vars: { key: string; value: string }[]): string => {
  return vars.map(v => {
    const needsQuotes = v.value.includes(' ') || v.value.includes('#') || v.value.includes('$');
    return `${v.key}=${needsQuotes ? `"${v.value}"` : v.value}`;
  }).join('\n');
};

const EnvDiff: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [leftText, setLeftText] = useState('');
  const [rightText, setRightText] = useState('');
  const [copied, setCopied] = useState('');
  const [filter, setFilter] = useState<DiffType | 'all'>('all');
  const [showUnchanged, setShowUnchanged] = useState(false);
  const leftFileRef = useRef<HTMLInputElement>(null);

  const leftVars = useMemo(() => parseEnv(leftText), [leftText]);
  const rightVars = useMemo(() => parseEnv(rightText), [rightText]);

  const diffs = useMemo(() => diffEnvs(leftVars, rightVars), [leftVars, rightVars]);

  const filteredDiffs = useMemo(() => {
    if (filter === 'all') return diffs.filter(d => showUnchanged || d.diffType !== 'unchanged');
    return diffs.filter(d => d.diffType === filter);
  }, [diffs, filter, showUnchanged]);

  const stats = useMemo(() => {
    const s = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    diffs.forEach(d => s[d.diffType]++);
    return s;
  }, [diffs]);

  const handleCopy = async (text: string, field: string) => {
    await copyToClipboard(text);
    setCopied(field);
    setTimeout(() => setCopied(''), 2000);
  };

  const handleMergeLeft = () => {
    const merged = new Map(leftVars.map(v => [v.key, v]));
    for (const r of rightVars) {
      if (!merged.has(r.key)) merged.set(r.key, r);
    }
    const result = toEnvFormat([...merged.entries()].map(([key, value]) => ({ key, value: value.value })));
    setLeftText(result);
  };

  const handleMergeRight = () => {
    const merged = new Map(rightVars.map(v => [v.key, v]));
    for (const l of leftVars) {
      if (!merged.has(l.key)) merged.set(l.key, l);
    }
    const result = toEnvFormat([...merged.entries()].map(([key, value]) => ({ key, value: value.value })));
    setRightText(result);
  };

  const handleExportDiff = () => {
    const lines = filteredDiffs.map(d => {
      const prefix = d.diffType === 'added' ? '+' : d.diffType === 'removed' ? '-' : d.diffType === 'changed' ? '~' : ' ';
      return `${prefix} ${d.key}=${d.diffType === 'removed' ? d.leftVal : d.rightVal}`;
    });
    handleCopy(lines.join('\n'), 'export');
  };

  const DIFF_STYLES: Record<DiffType, { bg: string; border: string; icon: React.ReactNode; label: string }> = {
    added: { bg: 'bg-green-50', border: 'border-green-300', icon: <Plus className="w-3 h-3 text-green-600" />, label: '新增' },
    removed: { bg: 'bg-red-50', border: 'border-red-300', icon: <Minus className="w-3 h-3 text-red-600" />, label: '删除' },
    changed: { bg: 'bg-amber-50', border: 'border-amber-300', icon: <ArrowLeftRight className="w-3 h-3 text-amber-600" />, label: '变更' },
    unchanged: { bg: 'bg-gray-50', border: 'border-gray-200', icon: <Equal className="w-3 h-3 text-gray-400" />, label: '相同' },
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">环境变量对比 — 两份 .env 文件差异分析、合并导出</p>

      {/* Input areas */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[#6d5a47]">文件 A（基准）</label>
            <span className="text-[10px] text-[#8b735c]">{leftVars.length} 个变量</span>
          </div>
          <textarea value={leftText} onChange={e => setLeftText(e.target.value)}
            className="w-full h-32 text-xs font-mono border border-[#ead0ad] rounded-lg px-2 py-1.5 bg-white resize-y focus:border-[#7a421b] focus:outline-none"
            placeholder="粘贴 .env 内容或 KEY=VALUE 格式" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[#6d5a47]">文件 B（对比）</label>
            <span className="text-[10px] text-[#8b735c]">{rightVars.length} 个变量</span>
          </div>
          <textarea value={rightText} onChange={e => setRightText(e.target.value)}
            className="w-full h-32 text-xs font-mono border border-[#ead0ad] rounded-lg px-2 py-1.5 bg-white resize-y focus:border-[#7a421b] focus:outline-none"
            placeholder="粘贴 .env 内容或 KEY=VALUE 格式" />
        </div>
      </div>

      <div className="flex gap-2">
        <UploadZone onUpload={() => leftFileRef.current?.click()} accept=".env,.txt" />
        <input ref={leftFileRef} type="file" accept=".env,.txt" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) { const r = new FileReader(); r.onload = () => setLeftText(r.result as string); r.readAsText(file); } }} />
        <Btn onClick={handleMergeLeft} variant="secondary" disabled={!leftText && !rightText}>
          <ArrowLeft className="w-3 h-3 mr-1" />合并到A
        </Btn>
        <Btn onClick={handleMergeRight} variant="secondary" disabled={!leftText && !rightText}>
          合并到B<ArrowRight className="w-3 h-3 ml-1" />
        </Btn>
      </div>

      {/* Stats */}
      {diffs.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap">
          {(['added', 'removed', 'changed', 'unchanged'] as DiffType[]).map(type => (
            <button key={type} onClick={() => setFilter(filter === type ? 'all' : type)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-all
                ${filter === type ? 'ring-2 ring-[#7a421b] ring-offset-1' : 'opacity-70'}
                ${DIFF_STYLES[type].bg} ${DIFF_STYLES[type].border}`}>
              {DIFF_STYLES[type].icon}
              <span>{DIFF_STYLES[type].label}</span>
              <span className="font-mono font-bold">{stats[type]}</span>
            </button>
          ))}
          <label className="flex items-center gap-1 text-xs text-[#8b735c] ml-auto">
            <input type="checkbox" checked={showUnchanged} onChange={e => setShowUnchanged(e.target.checked)}
              className="rounded border-[#ead0ad]" />
            显示相同项
          </label>
        </div>
      )}

      {/* Diff results */}
      {filteredDiffs.length > 0 && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#8b735c]">差异详情 ({filteredDiffs.length})</span>
            <button onClick={() => handleExportDiff()} className="flex items-center gap-1 text-xs text-[#7a421b] hover:text-[#6f3714]">
              <Copy className="w-3 h-3" />复制差异
            </button>
          </div>
          <div className="border border-[#ead0ad] rounded-lg max-h-60 overflow-y-auto">
            {filteredDiffs.map((d, i) => {
              const style = DIFF_STYLES[d.diffType];
              return (
                <div key={i} className={`flex items-start gap-2 px-3 py-1.5 text-xs border-b last:border-0 ${style.bg} ${style.border}`}>
                  <span className="mt-0.5 shrink-0">{style.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-[#6d5a47]">{d.key}</span>
                      <span className="text-[10px] px-1 rounded bg-white/50 text-[#8b735c]">{style.label}</span>
                    </div>
                    {d.diffType === 'changed' && (
                      <div className="mt-0.5 space-y-0.5">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-red-500">A:</span>
                          <span className="font-mono text-red-600 line-through truncate">{d.leftVal}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-green-600">B:</span>
                          <span className="font-mono text-green-700 truncate">{d.rightVal}</span>
                        </div>
                      </div>
                    )}
                    {d.diffType === 'added' && (
                      <span className="font-mono text-green-700 truncate block">{d.rightVal}</span>
                    )}
                    {d.diffType === 'removed' && (
                      <span className="font-mono text-red-600 line-through truncate block">{d.leftVal}</span>
                    )}
                    {d.diffType === 'unchanged' && (
                      <span className="font-mono text-[#8b735c] truncate block">{d.leftVal}</span>
                    )}
                  </div>
                  <button onClick={() => handleCopy(`${d.key}=${d.diffType === 'removed' ? d.leftVal : d.rightVal}`, `copy-${i}`)}
                    className="shrink-0 text-[#c79f72] hover:text-[#7a421b]">
                    {copied === `copy-${i}` ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {leftText && rightText && filteredDiffs.length === 0 && (
        <div className="text-center text-sm text-[#8b735c] py-4">两份文件完全相同</div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default EnvDiff;