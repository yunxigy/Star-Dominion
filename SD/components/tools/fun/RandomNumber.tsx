import React, { useState } from 'react';

const RandomNumber: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [min, setMin] = useState('1');
  const [max, setMax] = useState('100');
  const [count, setCount] = useState('1');
  const [results, setResults] = useState<number[]>([]);
  const [unique, setUnique] = useState(false);
  const [history, setHistory] = useState<number[][]>([]);

  const generate = () => {
    const lo = Number(min);
    const hi = Number(max);
    const n = Math.min(Math.max(Number(count) || 1, 1), 100);
    if (isNaN(lo) || isNaN(hi) || lo >= hi) return;

    if (unique && n > (hi - lo + 1)) {
      alert('范围内的数字数量不足以生成不重复的随机数');
      return;
    }

    const nums: number[] = [];
    const used = new Set<number>();

    for (let i = 0; i < n; i++) {
      let num: number;
      do {
        num = Math.floor(Math.random() * (hi - lo + 1)) + lo;
      } while (unique && used.has(num));
      used.add(num);
      nums.push(num);
    }

    setResults(nums);
    setHistory(prev => [nums, ...prev].slice(0, 5));
  };

  const clearHistory = () => {
    setHistory([]);
    setResults([]);
  };

  const sum = results.reduce((a, b) => a + b, 0);
  const avg = results.length > 0 ? (sum / results.length).toFixed(2) : '0';
  const maxResult = results.length > 0 ? Math.max(...results) : 0;
  const minResult = results.length > 0 ? Math.min(...results) : 0;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-pink-400 mb-3">随机数生成器</h2>
        <p className="text-lg text-slate-400">生成指定范围内的随机数</p>
      </div>

      {/* Settings */}
      <div className="bg-slate-800/50 border border-slate-700 rounded-2xl p-6 space-y-6">
        <h3 className="text-lg font-semibold text-white">参数设置</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <label className="text-sm text-slate-400">最小值</label>
            <input
              type="number"
              value={min}
              onChange={(e) => setMin(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-lg focus:outline-none focus:border-pink-500 transition-colors"
              placeholder="最小值"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">最大值</label>
            <input
              type="number"
              value={max}
              onChange={(e) => setMax(e.target.value)}
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-lg focus:outline-none focus:border-pink-500 transition-colors"
              placeholder="最大值"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm text-slate-400">数量</label>
            <input
              type="number"
              value={count}
              onChange={(e) => setCount(e.target.value)}
              min="1"
              max="100"
              className="w-full px-4 py-3 bg-slate-700/50 border border-slate-600 rounded-xl text-white text-lg focus:outline-none focus:border-pink-500 transition-colors"
              placeholder="数量"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="unique"
            checked={unique}
            onChange={(e) => setUnique(e.target.checked)}
            className="w-5 h-5 rounded border-slate-600 text-pink-500 focus:ring-pink-500"
          />
          <label htmlFor="unique" className="text-slate-300">
            生成不重复的数字
          </label>
        </div>

        <button
          onClick={generate}
          className="w-full py-4 bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-400 hover:to-rose-400 text-white text-lg font-bold rounded-xl transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-pink-500/30"
        >
          生成随机数
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="space-y-6">
          {/* Result Numbers */}
          <div className="bg-gradient-to-br from-pink-500/20 to-rose-500/20 border border-pink-500/30 rounded-2xl p-6">
            <h3 className="text-lg font-semibold text-white mb-4 text-center">生成结果</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {results.map((num, i) => (
                <div
                  key={i}
                  className="bg-pink-500/10 border border-pink-500/20 rounded-xl p-4 text-center"
                >
                  <div className="text-3xl font-bold text-pink-400 font-mono">{num}</div>
                  <div className="text-xs text-slate-500 mt-1">#{i + 1}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Statistics */}
          {results.length > 1 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-pink-400">{sum}</div>
                <div className="text-sm text-slate-400">总和</div>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-pink-400">{avg}</div>
                <div className="text-sm text-slate-400">平均值</div>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-pink-400">{maxResult}</div>
                <div className="text-sm text-slate-400">最大值</div>
              </div>
              <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 text-center">
                <div className="text-2xl font-bold text-pink-400">{minResult}</div>
                <div className="text-sm text-slate-400">最小值</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">历史记录</h3>
            <button
              onClick={clearHistory}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white bg-slate-800/50 border border-slate-700 rounded-lg hover:border-slate-600 transition-colors"
            >
              清空记录
            </button>
          </div>
          <div className="space-y-3">
            {history.map((nums, idx) => (
              <div
                key={idx}
                className="bg-slate-800/30 border border-slate-700 rounded-xl p-4"
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-slate-500">第 {idx + 1} 次</span>
                  <span className="text-xs text-slate-600">|</span>
                  <span className="text-xs text-slate-500">{nums.length} 个数字</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {nums.slice(0, 10).map((num, i) => (
                    <span
                      key={i}
                      className="px-3 py-1 bg-pink-500/10 border border-pink-500/20 rounded-full text-pink-400 text-sm font-mono"
                    >
                      {num}
                    </span>
                  ))}
                  {nums.length > 10 && (
                    <span className="px-3 py-1 text-slate-500 text-sm">
                      +{nums.length - 10} 更多
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-slate-800/30 border border-slate-700 rounded-2xl p-6 space-y-4">
        <h3 className="text-lg font-semibold text-white">快速生成</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: '骰子', min: 1, max: 6, count: 1 },
            { label: '双骰', min: 1, max: 6, count: 2 },
            { label: '扑克', min: 1, max: 54, count: 1 },
            { label: '彩票', min: 1, max: 49, count: 6 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setMin(String(preset.min));
                setMax(String(preset.max));
                setCount(String(preset.count));
                setUnique(preset.label === '彩票');
                setTimeout(() => {
                  const nums: number[] = [];
                  const used = new Set<number>();
                  for (let i = 0; i < preset.count; i++) {
                    let num: number;
                    do {
                      num = Math.floor(Math.random() * (preset.max - preset.min + 1)) + preset.min;
                    } while (preset.label === '彩票' && used.has(num));
                    used.add(num);
                    nums.push(num);
                  }
                  setResults(nums);
                  setHistory(prev => [nums, ...prev].slice(0, 5));
                }, 100);
              }}
              className="p-4 bg-slate-700/50 border border-slate-600 rounded-xl hover:bg-pink-500/10 hover:border-pink-500/30 transition-all text-center"
            >
              <div className="text-2xl mb-1">
                {preset.label === '骰子' ? '🎲' : preset.label === '双骰' ? '🎲🎲' : preset.label === '扑克' ? '🃏' : '🎰'}
              </div>
              <div className="text-sm text-slate-300">{preset.label}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default RandomNumber;
