import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const Sha256Generator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [hash, setHash] = useState('');

  const generate = async () => {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    setHash(Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
  };

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="输入文本..." rows={6} />
      <div className="flex gap-2">
        <Btn onClick={generate}>生成 SHA-256</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {hash && <ResultBox label="SHA-256 哈希" value={hash} onCopy={() => copyToClipboard(hash)} />}
    </div>
  );
};

export default Sha256Generator;
