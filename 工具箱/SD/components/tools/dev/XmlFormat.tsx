import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

function formatXml(xml: string): string {
  let indent = 0;
  const lines = xml.replace(/>\s*</g, '>\n<').split('\n');
  return lines.map(line => {
    line = line.trim();
    if (!line) return '';
    if (line.match(/^<\/\w/)) indent--;
    const formatted = '  '.repeat(Math.max(0, indent)) + line;
    if (line.match(/^<\w[^>]*[^/]>$/) && !line.match(/^<\?/)) indent++;
    return formatted;
  }).filter(Boolean).join('\n');
}

const XmlFormat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 XML..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={() => setOutput(formatXml(input))}>格式化</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {output && <ResultBox label="格式化结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default XmlFormat;
