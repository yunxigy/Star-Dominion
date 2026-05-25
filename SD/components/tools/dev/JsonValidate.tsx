import React, { useState } from 'react';
import { TextArea, Btn } from '../shared';

const JsonValidate: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<{ valid: boolean; message: string } | null>(null);

  const validate = () => {
    try {
      JSON.parse(input);
      setResult({ valid: true, message: 'JSON 格式有效' });
    } catch (e: any) {
      setResult({ valid: false, message: e.message });
    }
  };

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 JSON..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={validate}>验证</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {result && (
        <div className={`rounded-lg p-3 text-sm ${result.valid ? 'bg-green-900/30 border border-green-500/30 text-green-400' : 'bg-red-900/30 border border-red-500/30 text-red-400'}`}>
          {result.message}
        </div>
      )}
    </div>
  );
};

export default JsonValidate;
