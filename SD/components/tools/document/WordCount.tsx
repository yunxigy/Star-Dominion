import React, { useState, useMemo, useCallback } from 'react';
import { Copy, RotateCcw, FileText, BarChart3 } from 'lucide-react';

export default function WordCount({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');

  const stats = useMemo(() => {
    if (!text.trim()) {
      return {
        characters: 0,
        charactersNoSpaces: 0,
        words: 0,
        lines: 0,
        paragraphs: 0,
        chineseChars: 0,
        readingTime: 0,
      };
    }

    const characters = text.length;
    const charactersNoSpaces = text.replace(/\s/g, '').length;
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length;
    const lines = text.split('\n').length;
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0).length;
    const chineseChars = (text.match(/[一-龥]/g) || []).length;
    const englishWords = text.match(/[a-zA-Z]+/g)?.length || 0;
    const readingTime = Math.ceil((chineseChars / 400) + (englishWords / 200));

    return {
      characters,
      charactersNoSpaces,
      words,
      lines,
      paragraphs,
      chineseChars,
      readingTime,
    };
  }, [text]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);

  const handleReset = useCallback(() => {
    setText('');
  }, []);

  return (
    <div className="space-y-6">
      {/* Input Text */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-slate-300">输入文本</label>
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
              title="复制"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={handleReset}
              className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
              title="清空"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="请输入或粘贴文本..."
          className="w-full h-48 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
      </div>

      {/* Statistics */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300">
          <BarChart3 className="w-4 h-4" />
          统计结果
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.characters}</div>
            <div className="text-xs text-slate-400 mt-1">总字符数</div>
          </div>
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.charactersNoSpaces}</div>
            <div className="text-xs text-slate-400 mt-1">不含空格</div>
          </div>
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.words}</div>
            <div className="text-xs text-slate-400 mt-1">单词数</div>
          </div>
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.chineseChars}</div>
            <div className="text-xs text-slate-400 mt-1">中文字符</div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.lines}</div>
            <div className="text-xs text-slate-400 mt-1">行数</div>
          </div>
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-white">{stats.paragraphs}</div>
            <div className="text-xs text-slate-400 mt-1">段落数</div>
          </div>
          <div className="p-4 bg-white/5 rounded-xl text-center">
            <div className="text-2xl font-bold text-blue-400">{stats.readingTime}</div>
            <div className="text-xs text-slate-400 mt-1">分钟阅读</div>
          </div>
        </div>
      </div>

      {/* Reading Time Info */}
      <div className="p-4 bg-blue-500/10 border border-blue-500/30 rounded-xl">
        <div className="flex items-start gap-2">
          <FileText className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
          <div className="text-sm text-blue-300">
            <p>阅读时间估算：</p>
            <ul className="mt-1 space-y-1 text-xs text-blue-400">
              <li>• 中文：400 字/分钟</li>
              <li>• 英文：200 词/分钟</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
