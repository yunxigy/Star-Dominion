import React, { useState } from 'react';
import { TextArea, TextInput, Btn } from '../shared';

const RegexTester: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [pattern, setPattern] = useState('');
  const [flags, setFlags] = useState('g');
  const [testStr, setTestStr] = useState('');
  const [matches, setMatches] = useState<{ match: string; index: number }[]>([]);
  const [error, setError] = useState('');

  const test = () => {
    try {
      const regex = new RegExp(pattern, flags);
      const found: { match: string; index: number }[] = [];
      let m: RegExpExecArray | null;
      if (flags.includes('g')) {
        while ((m = regex.exec(testStr)) !== null) {
          found.push({ match: m[0], index: m.index });
          if (!m[0]) regex.lastIndex++;
        }
      } else {
        m = regex.exec(testStr);
        if (m) found.push({ match: m[0], index: m.index });
      }
      setMatches(found);
      setError('');
    } catch (e: any) {
      setError(e.message);
      setMatches([]);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <TextInput value={pattern} onChange={setPattern} placeholder="正则表达式" className="flex-1" />
        <TextInput value={flags} onChange={setFlags} placeholder="flags" className="w-20" />
      </div>
      <TextArea value={testStr} onChange={setTestStr} placeholder="测试文本..." rows={6} />
      <div className="flex gap-2">
        <Btn onClick={test}>测试</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {matches.length > 0 && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-2">找到 {matches.length} 个匹配</p>
          {matches.map((m, i) => (
            <div key={i} className="text-sm font-mono text-slate-200">
              <span className="text-violet-400">[{m.index}]</span> {m.match}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default RegexTester;
