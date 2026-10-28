import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const Md5Generator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [hash, setHash] = useState('');

  const generate = async () => {
    const data = new TextEncoder().encode(input);
    const buf = await crypto.subtle.digest('SHA-256', data);
    setHash(Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join(''));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-yellow-400/80">注意: 浏览器不支持 MD5，使用 SHA-256 作为替代</p>
      <TextArea value={input} onChange={setInput} placeholder="输入文本..." rows={6} />
      <div className="flex gap-2">
        <Btn onClick={generate}>生成 SHA-256</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {hash && <ResultBox label="SHA-256" value={hash} onCopy={() => copyToClipboard(hash)} />}
    </div>
  );
};

export default Md5Generator;
