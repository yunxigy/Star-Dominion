import React, { useState, useEffect } from 'react';
import { TextInput, Btn, ResultBox, copyToClipboard } from '../shared';

const TimestampConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));
  const [result, setResult] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const toDate = () => {
    const ts = input.length > 10 ? Number(input) : Number(input) * 1000;
    const d = new Date(ts);
    setResult(isNaN(d.getTime()) ? '无效时间戳' : d.toLocaleString('zh-CN') + '\n' + d.toISOString());
  };

  const toTimestamp = () => {
    const d = new Date(input);
    setResult(isNaN(d.getTime()) ? '无效日期' : `秒: ${Math.floor(d.getTime() / 1000)}\n毫秒: ${d.getTime()}`);
  };

  return (
    <div className="space-y-3">
      <ResultBox label="当前时间戳" value={`${now}`} onCopy={() => copyToClipboard(String(now))} />
      <TextInput value={input} onChange={setInput} placeholder="输入时间戳或日期字符串..." />
      <div className="flex gap-2">
        <Btn onClick={toDate}>时间戳 → 日期</Btn>
        <Btn onClick={toTimestamp}>日期 → 时间戳</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {result && <ResultBox label="转换结果" value={result} onCopy={() => copyToClipboard(result)} />}
    </div>
  );
};

export default TimestampConverter;
