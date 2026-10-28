import React, { useState, useCallback } from 'react';
import { Copy, Download, BarChart3, FileText } from 'lucide-react';

export default function TextSummarize({ onClose }: { onClose: () => void }) {
  const [inputText, setInputText] = useState('');
  const [summary, setSummary] = useState('');
  const [ratio, setRatio] = useState(30);
  const [stats, setStats] = useState({ original: 0, summary: 0, reduction: 0 });

  const handleSummarize = useCallback(() => {
    if (!inputText.trim()) return;

    // Simple extractive summarization based on sentence scoring
    const sentences = inputText
      .replace(/([。！？.!?])\s*/g, '$1\n')
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.length > 0);

    if (sentences.length === 0) {
      setSummary('无法提取有效句子');
      return;
    }

    // Calculate word frequency
    const words: Record<string, number> = {};
    sentences.forEach(sentence => {
      const chars = sentence.split('');
      for (let i = 0; i < chars.length; i++) {
        const char = chars[i];
        if (/[一-龥]/.test(char)) {
          words[char] = (words[char] || 0) + 1;
        }
      }
    });

    // Score sentences
    const scored = sentences.map((sentence, index) => {
      let score = 0;
      const chars = sentence.split('');
      chars.forEach(char => {
        if (words[char]) {
          score += words[char];
        }
      });
      // Normalize by length
      score = score / Math.max(chars.length, 1);
      // Bonus for position
      if (index < 3) score *= 1.5;
      return { sentence, score, index };
    });

    // Sort by score and take top percentage
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    const count = Math.max(1, Math.ceil(sentences.length * (ratio / 100)));
    const selected = sorted.slice(0, count);

    // Sort by original position
    selected.sort((a, b) => a.index - b.index);

    const result = selected.map(s => s.sentence).join('。') + '。';
    setSummary(result);
    setStats({
      original: inputText.length,
      summary: result.length,
      reduction: Math.round((1 - result.length / inputText.length) * 100),
    });
  }, [inputText, ratio]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(summary);
  }, [summary]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([summary], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'summary.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [summary]);

  return (
    <div className="space-y-6">
      {/* Ratio Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">摘要比例</label>
        <div className="flex gap-2">
          {[20, 30, 50].map(r => (
            <button
              key={r}
              onClick={() => setRatio(r)}
              className={`flex-1 py-2 px-4 rounded-xl text-sm font-medium transition-all ${
                ratio === r
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {r}%
            </button>
          ))}
        </div>
      </div>

      {/* Input Text */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">输入文本</label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="请输入要提取摘要的文本..."
          className="w-full h-40 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
        <div className="text-xs text-slate-500 text-right">
          {inputText.length} 字
        </div>
      </div>

      {/* Summarize Button */}
      <button
        onClick={handleSummarize}
        disabled={!inputText.trim()}
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <BarChart3 className="w-5 h-5" />
        生成摘要
      </button>

      {/* Summary Result */}
      {summary && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 bg-white/5 rounded-xl text-center">
              <div className="text-xs text-slate-400">原文</div>
              <div className="text-lg font-bold text-white">{stats.original}</div>
              <div className="text-xs text-slate-500">字</div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl text-center">
              <div className="text-xs text-slate-400">摘要</div>
              <div className="text-lg font-bold text-white">{stats.summary}</div>
              <div className="text-xs text-slate-500">字</div>
            </div>
            <div className="p-3 bg-white/5 rounded-xl text-center">
              <div className="text-xs text-slate-400">压缩率</div>
              <div className="text-lg font-bold text-green-400">{stats.reduction}%</div>
              <div className="text-xs text-slate-500">减少</div>
            </div>
          </div>

          {/* Summary Text */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-slate-300">摘要结果</label>
              <div className="flex gap-2">
                <button
                  onClick={handleCopy}
                  className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                  title="复制"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={handleDownload}
                  className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                  title="下载"
                >
                  <Download className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
              <p className="text-white whitespace-pre-wrap">{summary}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
