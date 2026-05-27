import React, { useState } from 'react';
import { TextArea, TextInput, Btn } from '../shared';

const LotteryTool: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [names, setNames] = useState('');
  const [count, setCount] = useState('1');
  const [winners, setWinners] = useState<string[]>([]);
  const [removeDup, setRemoveDup] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState('');

  const startLottery = () => {
    const lines = names.split('\n').map(s => s.trim()).filter(Boolean);
    if (lines.length === 0) return;
    const pool = removeDup ? [...new Set(lines)] : lines;
    const n = Math.min(Math.max(Number(count) || 1, 1), pool.length);

    setSpinning(true);
    setWinners([]);

    let tick = 0;
    const totalTicks = 20;
    const interval = setInterval(() => {
      setDisplay(pool[Math.floor(Math.random() * pool.length)]);
      tick++;
      if (tick >= totalTicks) {
        clearInterval(interval);
        // pick final winners
        const shuffled = [...pool].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, n);
        setWinners(picked);
        setDisplay('');
        setSpinning(false);
      }
    }, 100);
  };

  return (
    <div className="space-y-3">
      <TextArea
        value={names}
        onChange={setNames}
        placeholder={'输入名单，每行一个\n例如：\n张三\n李四\n王五'}
        rows={6}
      />
      <div className="flex gap-2 items-center flex-wrap">
        <TextInput value={count} onChange={setCount} placeholder="抽取人数" type="number" className="w-24" />
        <label className="flex items-center gap-1 text-sm text-slate-300">
          <input type="checkbox" checked={removeDup} onChange={() => setRemoveDup(!removeDup)} className="accent-pink-400" />
          去重
        </label>
        <Btn onClick={startLottery} disabled={spinning}>
          {spinning ? '抽奖中...' : '开始抽奖'}
        </Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>

      {spinning && (
        <div className="text-center py-6">
          <div className="text-3xl font-bold text-pink-400 animate-pulse">{display}</div>
        </div>
      )}

      {winners.length > 0 && !spinning && (
        <div className="space-y-2">
          <div className="text-sm text-slate-400">🎉 中奖名单</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {winners.map((w, i) => (
              <div
                key={i}
                className="bg-pink-400/10 border border-pink-400/30 rounded-lg p-3 text-center"
              >
                <div className="text-xs text-slate-500 mb-1">第 {i + 1} 名</div>
                <div className="text-lg font-bold text-pink-400">{w}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default LotteryTool;
