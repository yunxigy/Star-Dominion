import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

function formatJs(code: string): string {
  let indent = 0;
  return code
    .replace(/\s*{\s*/g, ' {\n')
    .replace(/\s*}\s*/g, '\n}\n')
    .replace(/\s*;\s*/g, ';\n')
    .split('\n')
    .map(line => {
      line = line.trim();
      if (!line) return '';
      if (line === '}' || line.startsWith('}')) indent--;
      const formatted = '  '.repeat(Math.max(0, indent)) + line;
      if (line.endsWith('{')) indent++;
      return formatted;
    })
    .filter(Boolean)
    .join('\n');
}

const JsFormat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 JavaScript 代码..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={() => setOutput(formatJs(input))}>格式化</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {output && <ResultBox label="格式化结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default JsFormat;
