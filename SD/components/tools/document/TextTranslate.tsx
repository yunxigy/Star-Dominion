import React, { useState, useCallback } from 'react';
import { Loader2, Copy, ArrowRightLeft, Globe } from 'lucide-react';

const LANGUAGE_PAIRS = [
  { source: 'zh-CN', target: 'en', label: '中文 → 英文' },
  { source: 'en', target: 'zh-CN', label: '英文 → 中文' },
  { source: 'zh-CN', target: 'ja', label: '中文 → 日文' },
  { source: 'ja', target: 'zh-CN', label: '日文 → 中文' },
  { source: 'zh-CN', target: 'ko', label: '中文 → 韩文' },
  { source: 'ko', target: 'zh-CN', label: '韩文 → 中文' },
  { source: 'en', target: 'ja', label: '英文 → 日文' },
  { source: 'ja', target: 'en', label: '日文 → 英文' },
];

export default function TextTranslate({ onClose }: { onClose: () => void }) {
  const [sourceText, setSourceText] = useState('');
  const [translatedText, setTranslatedText] = useState('');
  const [loading, setLoading] = useState(false);
  const [languagePair, setLanguagePair] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleTranslate = useCallback(async () => {
    if (!sourceText.trim()) return;

    setLoading(true);
    setError(null);
    setTranslatedText('');

    try {
      const pair = LANGUAGE_PAIRS[languagePair];
      const response = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(sourceText)}&langpair=${pair.source}|${pair.target}`
      );

      if (!response.ok) {
        throw new Error('翻译失败，请重试');
      }

      const data = await response.json();
      if (data.responseStatus === 200) {
        setTranslatedText(data.responseData.translatedText);
      } else {
        throw new Error(data.responseDetails || '翻译失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '翻译失败');
    } finally {
      setLoading(false);
    }
  }, [sourceText, languagePair]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(translatedText);
  }, [translatedText]);

  const handleSwap = useCallback(() => {
    const pair = LANGUAGE_PAIRS[languagePair];
    const newIndex = LANGUAGE_PAIRS.findIndex(
      p => p.source === pair.target && p.target === pair.source
    );
    if (newIndex !== -1) {
      setLanguagePair(newIndex);
      setSourceText(translatedText);
      setTranslatedText(sourceText);
    }
  }, [languagePair, sourceText, translatedText]);

  return (
    <div className="space-y-6">
      {/* Language Selection */}
      <div className="flex items-center gap-3">
        <select
          value={languagePair}
          onChange={(e) => setLanguagePair(Number(e.target.value))}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:border-white/20"
        >
          {LANGUAGE_PAIRS.map((pair, index) => (
            <option key={index} value={index}>{pair.label}</option>
          ))}
        </select>
        <button
          onClick={handleSwap}
          className="p-2 bg-white/5 border border-white/10 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          title="交换语言"
        >
          <ArrowRightLeft className="w-5 h-5" />
        </button>
      </div>

      {/* Source Text */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">源文本</label>
        <textarea
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="请输入要翻译的文本..."
          className="w-full h-32 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
      </div>

      {/* Translate Button */}
      <button
        onClick={handleTranslate}
        disabled={loading || !sourceText.trim()}
        className="w-full py-3 px-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-medium hover:from-indigo-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <Loader2 className="w-5 h-5 animate-spin" />
            翻译中...
          </>
        ) : (
          <>
            <Globe className="w-5 h-5" />
            翻译
          </>
        )}
      </button>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Translated Text */}
      {translatedText && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">翻译结果</label>
            <button
              onClick={handleCopy}
              className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
              title="复制"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <p className="text-white whitespace-pre-wrap">{translatedText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
