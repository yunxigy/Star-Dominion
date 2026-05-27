import React, { useState } from 'react';
import { TextInput, Btn, copyToClipboard } from '../shared';

const RandomPassword: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [length, setLength] = useState(16);
  const [count, setCount] = useState('5');
  const [opts, setOpts] = useState({ upper: true, lower: true, digits: true, symbols: true });
  const [passwords, setPasswords] = useState<string[]>([]);

  const toggle = (k: keyof typeof opts) => setOpts(p => ({ ...p, [k]: !p[k] }));

  const generate = () => {
    let chars = '';
    if (opts.upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (opts.lower) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (opts.digits) chars += '0123456789';
    if (opts.symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!chars) return;

    const n = Math.min(Math.max(Number(count) || 1, 1), 20);
    const results: string[] = [];
    for (let i = 0; i < n; i++) {
      const arr = new Uint32Array(length);
      crypto.getRandomValues(arr);
      results.push(Array.from(arr, v => chars[v % chars.length]).join(''));
    }
    setPasswords(results);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">长度: {length}</span>
        <input
          type="range"
          min={8}
          max={64}
          value={length}
          onChange={e => setLength(Number(e.target.value))}
          className="flex-1 accent-pink-400"
        />
        <span className="text-sm text-pink-400 font-mono w-8">{length}</span>
      </div>
      <div className="flex gap-3 flex-wrap">
        {([['upper', '大写'], ['lower', '小写'], ['digits', '数字'], ['symbols', '符号']] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-sm text-slate-300">
            <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} className="accent-pink-400" />
            {label}
          </label>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <TextInput value={count} onChange={setCount} placeholder="数量" type="number" className="w-20" />
        <Btn onClick={generate}>生成</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {passwords.length > 0 && (
        <div className="space-y-1">
          {passwords.map((pwd, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-800/50 border border-slate-700 rounded-lg px-3 py-2">
              <span className="text-sm font-mono text-slate-200 flex-1 break-all">{pwd}</span>
              <button onClick={() => copyToClipboard(pwd)} className="text-xs text-pink-400 hover:text-pink-300 shrink-0">复制</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RandomPassword;
