import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const JsonMinify: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');

  const minify = () => {
    try {
      setOutput(JSON.stringify(JSON.parse(input)));
      setError('');
    } catch (e: any) {
      setError(e.message);
      setOutput('');
    }
  };

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 JSON..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={minify}>压缩</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {output && <ResultBox label="压缩结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default JsonMinify;
