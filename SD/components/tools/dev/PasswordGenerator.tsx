import React, { useState } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';

const PasswordGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [length, setLength] = useState(16);
  const [opts, setOpts] = useState({ upper: true, lower: true, digits: true, symbols: true });
  const [pwd, setPwd] = useState('');

  const toggle = (k: keyof typeof opts) => setOpts(p => ({ ...p, [k]: !p[k] }));

  const generate = () => {
    let chars = '';
    if (opts.upper) chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (opts.lower) chars += 'abcdefghijklmnopqrstuvwxyz';
    if (opts.digits) chars += '0123456789';
    if (opts.symbols) chars += '!@#$%^&*()_+-=[]{}|;:,.<>?';
    if (!chars) return;
    const arr = new Uint32Array(length);
    crypto.getRandomValues(arr);
    setPwd(Array.from(arr, v => chars[v % chars.length]).join(''));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-400">长度: {length}</span>
        <input type="range" min={4} max={64} value={length} onChange={e => setLength(Number(e.target.value))} className="flex-1 accent-violet-500" />
      </div>
      <div className="flex gap-3 flex-wrap">
        {([['upper', '大写'], ['lower', '小写'], ['digits', '数字'], ['symbols', '符号']] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-1 text-sm text-slate-300">
            <input type="checkbox" checked={opts[k]} onChange={() => toggle(k)} className="accent-violet-500" />
            {label}
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <Btn onClick={generate}>生成密码</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {pwd && <ResultBox label="生成的密码" value={pwd} onCopy={() => copyToClipboard(pwd)} />}
    </div>
  );
};

export default PasswordGenerator;
