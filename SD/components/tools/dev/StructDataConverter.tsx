import React, { useState, useCallback } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { ArrowRightLeft, Upload, Download, AlertCircle, CheckCircle } from 'lucide-react';

type DataFormat = 'json' | 'yaml' | 'toml' | 'csv';

const FORMAT_LABELS: Record<DataFormat, string> = {
  json: 'JSON',
  yaml: 'YAML',
  toml: 'TOML',
  csv: 'CSV',
};

const FORMAT_PLACEHOLDERS: Record<DataFormat, string> = {
  json: '{\n  "name": "example",\n  "version": "1.0.0",\n  "items": ["a", "b"]\n}',
  yaml: 'name: example\nversion: 1.0.0\nitems:\n  - a\n  - b',
  toml: 'name = "example"\nversion = "1.0.0"\nitems = ["a", "b"]',
  csv: 'name,version,items\nexample,1.0.0,"a"\nexample,1.0.0,"b"',
};

// Simple JSON parser/serializer
const parseJson = (input: string): unknown => JSON.parse(input);
const toJson = (data: unknown, indent = 2): string => JSON.stringify(data, null, indent);

// Simple YAML parser (handles basic structures)
const parseYaml = (input: string): unknown => {
  const lines = input.split('\n').filter(l => !l.startsWith('#') && l.trim());
  const result: Record<string, unknown> = {};
  let currentKey = '';
  let currentArray: unknown[] | null = null;

  for (const line of lines) {
    const indent = line.search(/\S/);
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      if (currentArray !== null) {
        const val = trimmed.slice(2).trim();
        (currentArray as unknown[]).push(val.startsWith('"') || val.startsWith("'") ? val.slice(1, -1) : isNaN(Number(val)) ? val : Number(val));
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    let value: unknown = trimmed.slice(colonIdx + 1).trim();

    if (value === '' || value === '|' || value === '>') {
      currentKey = key;
      currentArray = null;
      if (value === '') {
        // Check next lines for array or object
        continue;
      }
    } else {
      currentArray = null;
      // Parse value
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (value === 'null') value = null;
      else if (typeof value === 'string' && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (typeof value === 'string' && value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else if (typeof value === 'string' && !isNaN(Number(value))) value = Number(value);

      result[key] = value;
    }
  }

  // Handle arrays
  for (const line of lines) {
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const val = trimmed.slice(colonIdx + 1).trim();
    if (val === '') {
      // Check if next lines are array items
      const arr: unknown[] = [];
      const lineIdx = lines.indexOf(line);
      for (let i = lineIdx + 1; i < lines.length; i++) {
        const nextTrimmed = lines[i].trim();
        if (nextTrimmed.startsWith('- ')) {
          const item = nextTrimmed.slice(2).trim();
          arr.push(item.startsWith('"') || item.startsWith("'") ? item.slice(1, -1) : isNaN(Number(item)) ? item : Number(item));
        } else {
          break;
        }
      }
      if (arr.length > 0) result[key] = arr;
    }
  }

  return result;
};

const toYaml = (data: unknown, indent = 0): string => {
  const prefix = '  '.repeat(indent);
  if (data === null || data === undefined) return 'null';
  if (typeof data === 'string') return data.includes(':') || data.includes('#') ? `"${data}"` : data;
  if (typeof data === 'number' || typeof data === 'boolean') return String(data);

  if (Array.isArray(data)) {
    return data.map(item => {
      const val = toYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        return `${prefix}- ${val.trim()}`;
      }
      return `${prefix}- ${val}`;
    }).join('\n');
  }

  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>)
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          const items = value.map(item => `${prefix}  - ${toYaml(item, 0)}`).join('\n');
          return `${prefix}${key}:\n${items}`;
        }
        if (typeof value === 'object' && value !== null) {
          return `${prefix}${key}:\n${toYaml(value, indent + 1)}`;
        }
        return `${prefix}${key}: ${toYaml(value, 0)}`;
      }).join('\n');
  }

  return String(data);
};

// Simple TOML parser
const parseToml = (input: string): unknown => {
  const result: Record<string, unknown> = {};
  const lines = input.split('\n').filter(l => !l.startsWith('#') && l.trim());

  for (const line of lines) {
    if (line.startsWith('[')) continue; // Skip section headers for simplicity
    const eqIdx = line.indexOf('=');
    if (eqIdx === -1) continue;

    const key = line.slice(0, eqIdx).trim();
    let value: unknown = line.slice(eqIdx + 1).trim();

    if (typeof value === 'string') {
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      else if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value))) value = Number(value);
      else if (value.startsWith('[')) {
        try { value = JSON.parse(value.replace(/'/g, '"')); } catch { /* keep as string */ }
      }
    }

    result[key] = value;
  }

  return result;
};

const toToml = (data: unknown): string => {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return '# TOML format requires key-value pairs at the top level';
  }

  const lines: string[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (typeof value === 'string') lines.push(`${key} = "${value}"`);
    else if (typeof value === 'number') lines.push(`${key} = ${value}`);
    else if (typeof value === 'boolean') lines.push(`${key} = ${value}`);
    else if (Array.isArray(value)) lines.push(`${key} = ${JSON.stringify(value)}`);
    else if (typeof value === 'object' && value !== null) {
      lines.push(`[${key}]`);
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'string') lines.push(`${k} = "${v}"`);
        else if (typeof v === 'number') lines.push(`${k} = ${v}`);
        else if (typeof v === 'boolean') lines.push(`${k} = ${v}`);
        else if (Array.isArray(v)) lines.push(`${k} = ${JSON.stringify(v)}`);
        else lines.push(`${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  return lines.join('\n');
};

// CSV parser
const parseCsv = (input: string): unknown => {
  const lines = input.trim().split('\n');
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const result: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());

    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    result.push(obj);
  }

  return result;
};

const toCsv = (data: unknown): string => {
  if (!Array.isArray(data)) return '# CSV format requires array of objects';

  if (data.length === 0) return '';
  const headers = Object.keys(data[0] as Record<string, unknown>);
  const lines = [headers.join(',')];

  for (const item of data) {
    const values = headers.map(h => {
      const val = String((item as Record<string, unknown>)[h] ?? '');
      return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val.replace(/"/g, '""')}"` : val;
    });
    lines.push(values.join(','));
  }

  return lines.join('\n');
};

const PARSERS: Record<DataFormat, (input: string) => unknown> = {
  json: parseJson,
  yaml: parseYaml,
  toml: parseToml,
  csv: parseCsv,
};

const SERIALIZERS: Record<DataFormat, (data: unknown) => string> = {
  json: (d) => toJson(d),
  yaml: (d) => toYaml(d),
  toml: (d) => toToml(d),
  csv: (d) => toCsv(d),
};

const StructDataConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [inputFormat, setInputFormat] = useState<DataFormat>('json');
  const [outputFormat, setOutputFormat] = useState<DataFormat>('yaml');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const handleConvert = useCallback(() => {
    setError('');
    setCopied(false);
    if (!input.trim()) {
      setOutput('');
      return;
    }

    try {
      const parsed = PARSERS[inputFormat](input);
      const result = SERIALIZERS[outputFormat](parsed);
      setOutput(result);
    } catch (e) {
      setError(`解析失败: ${(e as Error).message}`);
      setOutput('');
    }
  }, [input, inputFormat, outputFormat]);

  const handleSwap = () => {
    const tmpFormat = inputFormat;
    setInputFormat(outputFormat);
    setOutputFormat(tmpFormat);
    if (output) {
      setInput(output);
      setOutput('');
    }
  };

  const handleCopy = async () => {
    await copyToClipboard(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = outputFormat;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setInput(text);
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'json') setInputFormat('json');
    else if (ext === 'yaml' || ext === 'yml') setInputFormat('yaml');
    else if (ext === 'toml') setInputFormat('toml');
    else if (ext === 'csv') setInputFormat('csv');
    setError('');
    setOutput('');
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">JSON / YAML / TOML / CSV 格式互转，支持文件上传和下载</p>

      {/* Format selectors */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <label className="text-xs text-[#8b735c] mb-1 block">输入格式</label>
          <div className="flex gap-1">
            {(Object.keys(FORMAT_LABELS) as DataFormat[]).map(fmt => (
              <button key={fmt} onClick={() => { setInputFormat(fmt); setError(''); setOutput(''); }}
                className={`px-2 py-1 text-xs rounded border transition-colors ${inputFormat === fmt ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>
        </div>

        <button onClick={handleSwap} className="mt-5 p-1.5 rounded border border-[#ead0ad] hover:bg-[#f1dcc2] transition-colors" title="交换输入输出">
          <ArrowRightLeft className="w-4 h-4 text-[#7a421b]" />
        </button>

        <div className="flex-1">
          <label className="text-xs text-[#8b735c] mb-1 block">输出格式</label>
          <div className="flex gap-1">
            {(Object.keys(FORMAT_LABELS) as DataFormat[]).map(fmt => (
              <button key={fmt} onClick={() => { setOutputFormat(fmt); setError(''); setOutput(''); }}
                className={`px-2 py-1 text-xs rounded border transition-colors ${outputFormat === fmt ? 'bg-[#7a421b] text-white border-[#7a421b]' : 'bg-white text-[#6d5a47] border-[#ead0ad] hover:border-[#c79f72]'}`}>
                {FORMAT_LABELS[fmt]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input area */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-[#8b735c]">输入 ({FORMAT_LABELS[inputFormat]})</label>
          <label className="text-xs text-[#7a421b] hover:underline cursor-pointer flex items-center gap-1">
            <Upload className="w-3 h-3" />上传文件
            <input type="file" className="hidden" accept=".json,.yaml,.yml,.toml,.csv" onChange={handleFileUpload} />
          </label>
        </div>
        <textarea value={input} onChange={e => { setInput(e.target.value); setError(''); setOutput(''); }}
          className="w-full h-40 text-xs font-mono border border-[#ead0ad] rounded-lg p-3 bg-white focus:border-[#7a421b] focus:outline-none resize-y"
          placeholder={FORMAT_PLACEHOLDERS[inputFormat]} />
      </div>

      {/* Convert button */}
      <Btn onClick={handleConvert} disabled={!input.trim()}>
        <ArrowRightLeft className="w-4 h-4 mr-1" />
        转换为 {FORMAT_LABELS[outputFormat]}
      </Btn>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Output area */}
      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-[#8b735c]">输出 ({FORMAT_LABELS[outputFormat]})</label>
            <div className="flex gap-2">
              <button onClick={handleCopy} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
                {copied ? <CheckCircle className="w-3 h-3" /> : null}复制
              </button>
              <button onClick={handleDownload} className="text-xs text-[#7a421b] hover:underline flex items-center gap-1">
                <Download className="w-3 h-3" />下载
              </button>
            </div>
          </div>
          <pre className="w-full h-40 text-xs font-mono border border-[#ead0ad] rounded-lg p-3 bg-[#fff8f0] overflow-auto whitespace-pre-wrap">
            {output}
          </pre>
        </div>
      )}

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：YAML/TOML 解析器支持基本结构（键值对、数组、嵌套对象）。复杂结构（多文档、锚点别名等）建议使用专业工具验证。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default StructDataConverter;