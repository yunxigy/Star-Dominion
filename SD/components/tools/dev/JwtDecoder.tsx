import React, { useState } from 'react';
import { TextArea, Btn, copyToClipboard } from '../shared';

const JwtDecoder: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [header, setHeader] = useState('');
  const [payload, setPayload] = useState('');
  const [error, setError] = useState('');

  const decode = () => {
    try {
      const parts = input.trim().split('.');
      if (parts.length < 2) throw new Error('无效的 JWT 格式');
      const dec = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
      setHeader(JSON.stringify(JSON.parse(dec(parts[0])), null, 2));
      setPayload(JSON.stringify(JSON.parse(dec(parts[1])), null, 2));
      setError('');
    } catch (e: any) {
      setError(e.message);
      setHeader('');
      setPayload('');
    }
  };

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 JWT Token..." rows={4} />
      <div className="flex gap-2">
        <Btn onClick={decode}>解码</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {header && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-500">Header</span>
            <button onClick={() => copyToClipboard(header)} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
          </div>
          <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap">{header}</pre>
        </div>
      )}
      {payload && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs text-slate-500">Payload</span>
            <button onClick={() => copyToClipboard(payload)} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
          </div>
          <pre className="text-sm text-slate-200 font-mono whitespace-pre-wrap">{payload}</pre>
        </div>
      )}
    </div>
  );
};

export default JwtDecoder;
