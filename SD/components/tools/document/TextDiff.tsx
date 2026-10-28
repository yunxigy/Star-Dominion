import React, { useState, useMemo, useCallback } from 'react';
import { Copy, RotateCcw, GitCompare, ArrowRight } from 'lucide-react';

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  lineNum1?: number;
  lineNum2?: number;
}

export default function TextDiff({ onClose }: { onClose: () => void }) {
  const [text1, setText1] = useState('');
  const [text2, setText2] = useState('');

  const diffResult = useMemo(() => {
    if (!text1.trim() || !text2.trim()) return null;

    const lines1 = text1.split('\n');
    const lines2 = text2.split('\n');
    const result: DiffLine[] = [];

    // Simple line-by-line diff
    let i = 0;
    let j = 0;

    while (i < lines1.length || j < lines2.length) {
      if (i >= lines1.length) {
        // Remaining lines in text2 are added
        result.push({
          type: 'added',
          text: lines2[j],
          lineNum2: j + 1,
        });
        j++;
      } else if (j >= lines2.length) {
        // Remaining lines in text1 are removed
        result.push({
          type: 'removed',
          text: lines1[i],
          lineNum1: i + 1,
        });
        i++;
      } else if (lines1[i] === lines2[j]) {
        // Lines are the same
        result.push({
          type: 'unchanged',
          text: lines1[i],
          lineNum1: i + 1,
          lineNum2: j + 1,
        });
        i++;
        j++;
      } else {
        // Lines are different - try to find next match
        let found1 = -1;
        let found2 = -1;

        // Look ahead in text2 for current text1 line
        for (let k = j + 1; k < Math.min(j + 5, lines2.length); k++) {
          if (lines1[i] === lines2[k]) {
            found2 = k;
            break;
          }
        }

        // Look ahead in text1 for current text2 line
        for (let k = i + 1; k < Math.min(i + 5, lines1.length); k++) {
          if (lines1[k] === lines2[j]) {
            found1 = k;
            break;
          }
        }

        if (found2 !== -1) {
          // Lines in text2 were added
          while (j < found2) {
            result.push({
              type: 'added',
              text: lines2[j],
              lineNum2: j + 1,
            });
            j++;
          }
        } else if (found1 !== -1) {
          // Lines in text1 were removed
          while (i < found1) {
            result.push({
              type: 'removed',
              text: lines1[i],
              lineNum1: i + 1,
            });
            i++;
          }
        } else {
          // Both lines changed
          result.push({
            type: 'removed',
            text: lines1[i],
            lineNum1: i + 1,
          });
          result.push({
            type: 'added',
            text: lines2[j],
            lineNum2: j + 1,
          });
          i++;
          j++;
        }
      }
    }

    return result;
  }, [text1, text2]);

  const stats = useMemo(() => {
    if (!diffResult) return { added: 0, removed: 0, unchanged: 0 };

    return {
      added: diffResult.filter(l => l.type === 'added').length,
      removed: diffResult.filter(l => l.type === 'removed').length,
      unchanged: diffResult.filter(l => l.type === 'unchanged').length,
    };
  }, [diffResult]);

  const handleSwap = useCallback(() => {
    setText1(text2);
    setText2(text1);
  }, [text1, text2]);

  const handleReset = useCallback(() => {
    setText1('');
    setText2('');
  }, []);

  return (
    <div className="space-y-6">
      {/* Input Areas */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Text 1 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">原始文本</label>
            <span className="text-xs text-slate-500">{text1.split('\n').length} 行</span>
          </div>
          <textarea
            value={text1}
            onChange={(e) => setText1(e.target.value)}
            placeholder="请输入原始文本..."
            className="w-full h-48 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none font-mono text-sm"
          />
        </div>

        {/* Text 2 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">对比文本</label>
            <span className="text-xs text-slate-500">{text2.split('\n').length} 行</span>
          </div>
          <textarea
            value={text2}
            onChange={(e) => setText2(e.target.value)}
            placeholder="请输入对比文本..."
            className="w-full h-48 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none font-mono text-sm"
          />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSwap}
          className="flex-1 py-3 px-4 bg-white/5 border border-white/10 text-slate-300 rounded-xl hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
        >
          <ArrowRight className="w-5 h-5" />
          交换文本
        </button>
        <button
          onClick={handleReset}
          className="py-3 px-4 bg-white/5 border border-white/10 text-slate-300 rounded-xl hover:bg-white/10 transition-colors"
        >
          <RotateCcw className="w-5 h-5" />
        </button>
      </div>

      {/* Diff Result */}
      {diffResult && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="flex items-center gap-4 p-4 bg-white/5 rounded-xl">
            <GitCompare className="w-5 h-5 text-slate-400" />
            <div className="flex gap-4 text-sm">
              <span className="text-green-400">+{stats.added} 新增</span>
              <span className="text-red-400">-{stats.removed} 删除</span>
              <span className="text-slate-400">{stats.unchanged} 未变</span>
            </div>
          </div>

          {/* Diff Lines */}
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl overflow-x-auto">
            <pre className="font-mono text-sm">
              {diffResult.map((line, index) => (
                <div
                  key={index}
                  className={`py-0.5 px-2 ${
                    line.type === 'added'
                      ? 'bg-green-500/10 text-green-300'
                      : line.type === 'removed'
                      ? 'bg-red-500/10 text-red-300'
                      : 'text-slate-300'
                  }`}
                >
                  <span className="inline-block w-8 text-right mr-2 text-slate-500">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="inline-block w-8 text-right mr-2 text-slate-600">
                    {line.lineNum1 || line.lineNum2 || ''}
                  </span>
                  {line.text || ' '}
                </div>
              ))}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
