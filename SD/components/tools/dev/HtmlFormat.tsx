import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

function formatHtml(html: string): string {
  let indent = 0;
  const selfClose = /^<(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)\b/i;
  const lines = html.replace(/>\s*</g, '>\n<').split('\n');
  return lines.map(line => {
    line = line.trim();
    if (!line) return '';
    if (/^<\//.test(line)) indent = Math.max(0, indent - 1);
    const formatted = '  '.repeat(indent) + line;
    if (/^<\w/.test(line) && !selfClose.test(line) && !/<\/\w/.test(line) && !/\/>$/.test(line)) indent++;
    return formatted;
  }).filter(Boolean).join('\n');
}

const HtmlFormat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 HTML..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={() => setOutput(formatHtml(input))}>格式化</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {output && <ResultBox label="格式化结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default HtmlFormat;
