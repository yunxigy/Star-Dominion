import React, { useState } from 'react';
import { TextArea, Btn, ResultBox, copyToClipboard } from '../shared';

const SQL_KW = ['SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER',
  'ON', 'ORDER BY', 'GROUP BY', 'HAVING', 'LIMIT', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE'];

function formatSql(sql: string): string {
  let result = sql.replace(/\s+/g, ' ').trim();
  for (const kw of SQL_KW) {
    result = result.replace(new RegExp(`\\b${kw}\\b`, 'gi'), kw);
  }
  result = result
    .replace(/\b(SELECT|FROM|WHERE|AND|OR|JOIN|LEFT JOIN|RIGHT JOIN|INNER JOIN|ORDER BY|GROUP BY|HAVING|LIMIT|INSERT INTO|VALUES|UPDATE|SET|DELETE FROM)\b/g, '\n$1');
  return result.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

const SqlFormat: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');

  return (
    <div className="space-y-3">
      <TextArea value={input} onChange={setInput} placeholder="粘贴 SQL..." rows={8} />
      <div className="flex gap-2">
        <Btn onClick={() => setOutput(formatSql(input))}>格式化</Btn>
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
      {output && <ResultBox label="格式化结果" value={output} onCopy={() => copyToClipboard(output)} />}
    </div>
  );
};

export default SqlFormat;
