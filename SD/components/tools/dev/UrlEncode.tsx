import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const UrlEncode: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="输入文本..." rows={6} />
      <div className="flex gap-2">
        <Btn onClick={() => setOutput(encodeURIComponent(input))}>编码</Btn>
        <Btn onClick={() => { try { setOutput(decodeURIComponent(input)); } catch { setOutput('解码失败'); } }}>解码</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {output && <ResultBox label="结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default UrlEncode;
