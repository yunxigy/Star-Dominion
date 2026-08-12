import React, { useState, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Key, Copy, CheckCircle, RefreshCw, Shield, AlertTriangle } from 'lucide-react';

const CHARS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?/~`',
  ambiguous: '0O1lI',
};

const getStrength = (password: string): { level: string; score: number; color: string; tips: string[] } => {
  let score = 0;
  const tips: string[] = [];
  const len = password.length;

  if (len >= 8) score += 1; else tips.push('建议至少8个字符');
  if (len >= 12) score += 1;
  if (len >= 16) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  // Entropy estimate
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/\d/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;
  const entropy = poolSize > 0 ? len * Math.log2(poolSize) : 0;

  if (entropy < 28) { tips.push('熵值过低，极易被暴力破解'); }
  else if (entropy < 36) { tips.push('熵值较低，建议增加长度或字符种类'); }

  // Repetition check
  const uniqueChars = new Set(password.split('')).size;
  if (len > 3 && uniqueChars / len < 0.5) tips.push('字符重复率过高');

  if (score <= 3) return { level: '弱', score, color: 'red', tips };
  if (score <= 5) return { level: '中等', score, color: 'amber', tips };
  if (score <= 7) return { level: '强', score, color: 'green', tips };
  return { level: '非常强', score, color: 'green', tips };
};

const generatePassword = (length: number, charsets: string[], excludeAmbiguous: boolean): string => {
  let pool = charsets.join('');
  if (excludeAmbiguous) {
    pool = pool.split('').filter(c => !CHARS.ambiguous.includes(c)).join('');
  }
  if (pool.length === 0) pool = CHARS.lower;

  const array = new Uint32Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, v => pool[v % pool.length]).join('');
};

const PasswordGen: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [length, setLength] = useState(16);
  const [count, setCount] = useState(5);
  const [useUpper, setUseUpper] = useState(true);
  const [useLower, setUseLower] = useState(true);
  const [useDigits, setUseDigits] = useState(true);
  const [useSymbols, setUseSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [passwords, setPasswords] = useState<string[]>([]);
  const [copied, setCopied] = useState(-1);
  const [customChars, setCustomChars] = useState('');

  const charsets = [
    useUpper ? CHARS.upper : '',
    useLower ? CHARS.lower : '',
    useDigits ? CHARS.digits : '',
    useSymbols ? CHARS.symbols : '',
    customChars,
  ].filter(Boolean);

  const handleGenerate = useCallback(() => {
    const result: string[] = [];
    for (let i = 0; i < Math.min(count, 50); i++) {
      result.push(generatePassword(length, charsets, excludeAmbiguous));
    }
    setPasswords(result);
  }, [length, count, charsets, excludeAmbiguous]);

  const handleCopy = async (text: string, idx: number) => {
    await copyToClipboard(text);
    setCopied(idx);
    setTimeout(() => setCopied(-1), 2000);
  };

  const handleCopyAll = async () => {
    await copyToClipboard(passwords.join('\n'));
    setCopied(-2);
    setTimeout(() => setCopied(-1), 2000);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">密码生成器 — 安全随机密码、强度评估、批量生成</p>

      {/* Settings */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3 space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-[#6d5a47]">密码长度: {length}</label>
            <span className="text-[10px] text-[#8b735c]">建议 ≥ 12</span>
          </div>
          <input type="range" min="4" max="64" value={length} onChange={e => setLength(+e.target.value)}
            className="w-full h-1.5 accent-[#7a421b]" />
          <div className="flex justify-between text-[10px] text-[#8b735c]">
            <span>4</span><span>16</span><span>32</span><span>64</span>
          </div>
        </div>

        <div>
          <label className="text-xs text-[#6d5a47] mb-1 block">生成数量</label>
          <input type="number" min="1" max="50" value={count} onChange={e => setCount(Math.max(1, Math.min(50, +e.target.value || 1)))}
            className="w-20 text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white text-center" />
        </div>

        <div className="grid grid-cols-2 gap-2">
          {[
            { label: '大写字母 A-Z', checked: useUpper, set: setUseUpper },
            { label: '小写字母 a-z', checked: useLower, set: setUseLower },
            { label: '数字 0-9', checked: useDigits, set: setUseDigits },
            { label: '特殊符号 !@#$', checked: useSymbols, set: setUseSymbols },
          ].map(opt => (
            <label key={opt.label} className="flex items-center gap-1.5 text-xs text-[#6d5a47] cursor-pointer">
              <input type="checkbox" checked={opt.checked} onChange={e => opt.set(e.target.checked)}
                className="accent-[#7a421b] rounded" />
              {opt.label}
            </label>
          ))}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-1.5 text-xs text-[#6d5a47] cursor-pointer">
            <input type="checkbox" checked={excludeAmbiguous} onChange={e => setExcludeAmbiguous(e.target.checked)}
              className="accent-[#7a421b] rounded" />
            排除易混淆字符 (0O1lI)
          </label>
          <div>
            <label className="text-[10px] text-[#8b735c]">自定义字符</label>
            <input value={customChars} onChange={e => setCustomChars(e.target.value)}
              className="w-full text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white font-mono"
              placeholder="额外添加的字符..." />
          </div>
        </div>
      </div>

      {/* Generate button */}
      <Btn onClick={handleGenerate} className="w-full flex items-center justify-center gap-2">
        <Key className="w-4 h-4" /> 生成密码
      </Btn>

      {/* Results */}
      {passwords.length > 0 && (
        <div className="border border-[#ead0ad] rounded-lg p-3 bg-white space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#6f3714]">生成结果</span>
            <button onClick={handleCopyAll} className="flex items-center gap-1 text-[10px] text-[#7a421b] hover:text-[#6f3714]">
              {copied === -2 ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              复制全部
            </button>
          </div>
          <div className="space-y-1.5">
            {passwords.map((pw, i) => {
              const strength = getStrength(pw);
              return (
                <div key={i} className="flex items-center gap-2 group">
                  <code className="flex-1 text-xs font-mono bg-[#fff4e6] rounded px-2 py-1.5 break-all text-[#6d5a47] select-all">{pw}</code>
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    strength.color === 'red' ? 'bg-red-500' : strength.color === 'amber' ? 'bg-amber-500' : 'bg-green-500'
                  }`} title={strength.level} />
                  <button onClick={() => handleCopy(pw, i)} className="p-1 text-[#7a421b] hover:text-[#6f3714] opacity-0 group-hover:opacity-100 transition-opacity">
                    {copied === i ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Strength guide */}
      <div className="border border-[#ead0ad] rounded-lg p-3">
        <div className="text-xs font-medium text-[#6f3714] mb-2">密码强度参考</div>
        <div className="grid grid-cols-4 gap-1 text-center text-[10px]">
          <div className="bg-red-50 text-red-700 rounded p-1 border border-red-200">弱</div>
          <div className="bg-amber-50 text-amber-700 rounded p-1 border border-amber-200">中等</div>
          <div className="bg-green-50 text-green-700 rounded p-1 border border-green-200">强</div>
          <div className="bg-green-50 text-green-800 rounded p-1 border border-green-300">非常强</div>
        </div>
        <div className="mt-2 space-y-1 text-[10px] text-[#8b735c]">
          <div className="flex items-center gap-1"><Shield className="w-3 h-3" /> 使用 crypto.getRandomValues 安全随机</div>
          <div className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> 所有生成在浏览器本地完成，不会上传</div>
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default PasswordGen;