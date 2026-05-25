import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const Base64Codec: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const encode = () => {
    try {
      setOutput(btoa(unescape(encodeURIComponent(input))));
      setError('');
    } catch (e: any) { setError(e.message); }
  };

  const decode = () => {
    try {
      setOutput(decodeURIComponent(escape(atob(input))));
      setError('');
    } catch (e: any) { setError('解码失败: 无效 Base64'); }
  };

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="输入文本..." rows={6} />
      <div className="flex gap-2">
        <Btn onClick={encode}>编码</Btn>
        <Btn onClick={decode}>解码</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {output && <ResultBox label="结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default Base64Codec;
