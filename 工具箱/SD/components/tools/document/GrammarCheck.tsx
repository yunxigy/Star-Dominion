import React, { useState, useCallback } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Copy, RotateCcw } from 'lucide-react';

interface GrammarError {
  message: string;
  replacements: string[];
  offset: number;
  length: number;
  context: string;
}

export default function GrammarCheck({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<GrammarError[]>([]);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('zh-CN');
  const [checked, setChecked] = useState(false);

  const handleCheck = useCallback(async () => {
    if (!text.trim()) return;

    setLoading(true);
    setErrors([]);
    setChecked(false);

    try {
      const response = await fetch('https://api.languagetool.org/v2/check', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `text=${encodeURIComponent(text)}&language=${language}`,
      });

      if (!response.ok) {
        throw new Error('检查失败，请重试');
      }

      const data = await response.json();
      const formattedErrors: GrammarError[] = data.matches.map((match: any) => ({
        message: match.message,
        replacements: match.replacements?.map((r: any) => r.value) || [],
        offset: match.offset,
        length: match.length,
        context: text.substring(match.offset, match.offset + match.length),
      }));

      setErrors(formattedErrors);
      setChecked(true);
    } catch (err) {
      console.error('Grammar check failed:', err);
      setErrors([{
        message: '检查失败，请稍后重试',
        replacements: [],
        offset: 0,
        length: 0,
        context: '',
      }]);
    } finally {
      setLoading(false);
    }
  }, [text, language]);

  const handleApplyReplacement = useCallback((error: GrammarError, replacement: string) => {
    const newText = text.substring(0, error.offset) + replacement + text.substring(error.offset + error.length);
    setText(newText);
    setErrors([]);
    setChecked(false);
  }, [text]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text);
  }, [text]);

  const handleReset = useCallback(() => {
    setText('');
    setErrors([]);
    setChecked(false);
  }, []);

  const highlightText = useCallback(() => {
    if (errors.length === 0) return text;

    let result = '';
    let lastIndex = 0;

    const sortedErrors = [...errors].sort((a, b) => a.offset - b.offset);

    sortedErrors.forEach((error, index) => {
      result += text.substring(lastIndex, error.offset);
      result += `<mark class="bg-red-500/30 text-red-300 px-0.5 rounded">${text.substring(error.offset, error.offset + error.length)}</mark>`;
      lastIndex = error.offset + error.length;
    });

    result += text.substring(lastIndex);
    return result;
  }, [text, errors]);

  return (
    <div className="space-y-6">
      {/* Language Selection */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">检查语言</label>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/20"
        >
          <option value="zh-CN">中文</option>
          <option value="en-US">英文 (美式)</option>
          <option value="en-GB">英文 (英式)</option>
          <option value="ja">日文</option>
          <option value="ko">韩文</option>
        </select>
      </div>

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
          onChange={(e) => { setText(e.target.value); setChecked(false); setErrors([]); }}
          placeholder="请输入要检查语法的文本..."
          className="w-full h-40 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
      </div>

      {/* Check Button */}
      <button
        onClick={handleCheck}
        disabled={loading || !text.trim()}
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            检查中...
          </>
        ) : (
          '检查语法'
        )}
      </button>

      {/* Results */}
      {checked && (
        <div className="space-y-4">
          {/* Summary */}
          <div className={`flex items-center gap-2 p-4 rounded-xl ${
            errors.length === 0
              ? 'bg-green-500/10 border border-green-500/30 text-green-400'
              : 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
          }`}>
            {errors.length === 0 ? (
              <>
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span className="text-sm">没有发现语法错误</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span className="text-sm">发现 {errors.length} 个可能的问题</span>
              </>
            )}
          </div>

          {/* Highlighted Text */}
          {errors.length > 0 && (
            <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
              <div className="text-sm font-medium text-slate-300 mb-2">文本预览</div>
              <div
                className="text-white whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: highlightText() }}
              />
            </div>
          )}

          {/* Error List */}
          {errors.map((error, index) => (
            <div key={index} className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm text-white">{error.message}</p>
                  {error.context && (
                    <p className="text-xs text-slate-400 mt-1">
                      上下文: "...{error.context}..."
                    </p>
                  )}
                </div>
              </div>

              {error.replacements.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className="text-xs text-slate-500">建议修改:</span>
                  {error.replacements.slice(0, 5).map((replacement, i) => (
                    <button
                      key={i}
                      onClick={() => handleApplyReplacement(error, replacement)}
                      className="px-2 py-1 bg-green-500/10 border border-green-500/30 rounded text-xs text-green-400 hover:bg-green-500/20 transition-colors"
                    >
                      {replacement}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
