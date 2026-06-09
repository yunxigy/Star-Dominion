import React, { useState, useCallback } from 'react';
import { Copy, RotateCcw, Type } from 'lucide-react';

type CaseType = 'upper' | 'lower' | 'capitalize' | 'sentence' | 'toggle';

export default function CaseConverter({ onClose }: { onClose: () => void }) {
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [activeCase, setActiveCase] = useState<CaseType>('upper');

  const convertCase = useCallback((type: CaseType) => {
    setActiveCase(type);
    let result = '';

    switch (type) {
      case 'upper':
        result = inputText.toUpperCase();
        break;
      case 'lower':
        result = inputText.toLowerCase();
        break;
      case 'capitalize':
        result = inputText.replace(/\b\w/g, (char) => char.toUpperCase());
        break;
      case 'sentence':
        result = inputText
          .split('. ')
          .map((sentence) => {
            if (sentence.length === 0) return '';
            return sentence.charAt(0).toUpperCase() + sentence.slice(1).toLowerCase();
          })
          .join('. ');
        break;
      case 'toggle':
        result = inputText
          .split('')
          .map((char) => {
            if (char === char.toUpperCase()) {
              return char.toLowerCase();
            }
            return char.toUpperCase();
          })
          .join('');
        break;
    }

    setOutputText(result);
  }, [inputText]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(outputText);
  }, [outputText]);

  const handleReset = useCallback(() => {
    setInputText('');
    setOutputText('');
  }, []);

  const handleSwap = useCallback(() => {
    setInputText(outputText);
    setOutputText('');
  }, [outputText]);

  return (
    <div className="space-y-6">
      {/* Input Text */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="block text-sm font-medium text-slate-300">输入文本</label>
          <button
            onClick={handleReset}
            className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
            title="清空"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="请输入要转换的文本..."
          className="w-full h-32 p-4 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-400 focus:outline-none focus:border-white/20 resize-none"
        />
      </div>

      {/* Case Buttons */}
      <div className="space-y-2">
        <label className="block text-sm font-medium text-slate-300">转换类型</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => convertCase('upper')}
            className={`py-3 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeCase === 'upper'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
            全部大写
          </button>
          <button
            onClick={() => convertCase('lower')}
            className={`py-3 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeCase === 'lower'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
            全部小写
          </button>
          <button
            onClick={() => convertCase('capitalize')}
            className={`py-3 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeCase === 'capitalize'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
            首字母大写
          </button>
          <button
            onClick={() => convertCase('sentence')}
            className={`py-3 px-4 rounded-xl text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeCase === 'sentence'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
            句首大写
          </button>
          <button
            onClick={() => convertCase('toggle')}
            className={`py-3 px-4 rounded-xl text-sm font-medium transition-all col-span-2 flex items-center justify-center gap-2 ${
              activeCase === 'toggle'
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
            大小写反转
          </button>
        </div>
      </div>

      {/* Output Text */}
      {outputText && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-300">转换结果</label>
            <div className="flex gap-2">
              <button
                onClick={handleCopy}
                className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                title="复制"
              >
                <Copy className="w-4 h-4" />
              </button>
              <button
                onClick={handleSwap}
                className="p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors text-slate-400 hover:text-white"
                title="替换输入"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl">
            <p className="text-white whitespace-pre-wrap">{outputText}</p>
          </div>
        </div>
      )}
    </div>
  );
}
