import React, { useState } from 'react';
import { TextArea, Btn } from '../shared';

const QrCodeGenerator: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [generated, setGenerated] = useState(false);

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="输入要生成二维码的文本..." rows={4} />
      <div className="flex gap-2">
        <Btn onClick={() => setGenerated(!!input)}>生成</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {generated && (
        <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-4 text-center">
          <div className="w-48 h-48 mx-auto bg-white rounded-lg flex items-center justify-center">
            <p className="text-slate-500 text-sm px-4">需要安装 qrcode 依赖包才能生成二维码</p>
          </div>
          <p className="text-xs text-slate-500 mt-2">npm install qrcode @types/qrcode</p>
        </div>
      )}
    </div>
  );
};

export default QrCodeGenerator;
