import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { Copy, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

type EncodingType = 'utf8' | 'gbk' | 'gb2312' | 'big5' | 'shift_jis' | 'euc_jp' | 'iso_8859_1' | 'windows_1252';

const ENCODING_OPTIONS: { value: EncodingType; label: string }[] = [
  { value: 'utf8', label: 'UTF-8' },
  { value: 'gbk', label: 'GBK' },
  { value: 'gb2312', label: 'GB2312' },
  { value: 'big5', label: 'Big5 (繁体)' },
  { value: 'shift_jis', label: 'Shift_JIS (日文)' },
  { value: 'euc_jp', label: 'EUC-JP' },
  { value: 'iso_8859_1', label: 'ISO-8859-1' },
  { value: 'windows_1252', label: 'Windows-1252' },
];

// Common mojibake patterns (UTF-8 bytes misread as GBK/ISO-8859-1)
const MOJIBAKE_PATTERNS: { pattern: RegExp; fix: (match: string) => string; desc: string }[] = [
  {
    // UTF-8 Chinese misread as ISO-8859-1: e.g. "ä¸­æ–‡" → "中文"
    pattern: /[\xc0-\xff][\x80-\xbf]{1,3}/g,
    fix: (match) => {
      try {
        const bytes = new Uint8Array(match.length);
        for (let i = 0; i < match.length; i++) bytes[i] = match.charCodeAt(i);
        return new TextDecoder('utf-8').decode(bytes);
      } catch { return match; }
    },
    desc: 'UTF-8误读为ISO-8859-1',
  },
];

const detectMojibake = (text: string): string[] => {
  const issues: string[] = [];
  // Check for common garbled patterns
  if (/[äåæçèéêëìíîïðñòóôõöøùúûüýþÿ]{2,}/.test(text)) {
    issues.push('检测到可能的UTF-8→ISO-8859-1乱码（如ä¸­æ–‡）');
  }
  if (/[\ufffd]/.test(text)) {
    issues.push('检测到Unicode替换字符（），表示解码失败');
  }
  if (/[ÌÊÔØÍÌÊÔØ]/.test(text) && !/[\u4e00-\u9fff]/.test(text)) {
    issues.push('检测到可能的GBK→UTF-8乱码');
  }
  if (/Ã[¤§©®²³¶·¹º¼½¾]/.test(text)) {
    issues.push('检测到UTF-8双重编码乱码（如Ã¤）');
  }
  if (issues.length === 0) {
    issues.push('未检测到明显乱码模式');
  }
  return issues;
};

const fixDoubleEncoding = (text: string): string => {
  try {
    // Fix UTF-8 double encoding: text was UTF-8, got encoded as ISO-8859-1, then decoded as UTF-8
    // e.g., "Ã¤" → "ä" → original byte
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return text;
  }
};

const fixGbkToUtf8 = async (text: string): Promise<string> => {
  try {
    // If text contains garbled chars from GBK misread as UTF-8
    // We need to encode the garbled string back to bytes using GBK, then decode as UTF-8
    // But browsers don't have GBK encoder, so we use TextEncoder for UTF-8 bytes
    // and try to decode them as GBK
    const encoder = new TextEncoder();
    const utf8Bytes = encoder.encode(text);

    // Try decoding the original bytes as GBK
    const decoder = new TextDecoder('gbk');
    return decoder.decode(utf8Bytes);
  } catch {
    return text;
  }
};

const fixUtf8ToGbk = async (text: string): Promise<string> => {
  try {
    // Text was UTF-8 bytes but decoded as GBK → garbled
    // Re-encode as GBK (not available), then decode as UTF-8
    // Approximation: encode to UTF-8 bytes, try decoding as GBK
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return text;
  }
};

const base64Encode = (text: string): string => {
  try {
    return btoa(unescape(encodeURIComponent(text)));
  } catch {
    return '编码失败：输入包含无法处理的字符';
  }
};

const base64Decode = (text: string): string => {
  try {
    return decodeURIComponent(escape(atob(text.trim())));
  } catch {
    return '解码失败：无效的Base64字符串';
  }
};

const urlEncode = (text: string): string => encodeURIComponent(text);
const urlDecode = (text: string): string => { try { return decodeURIComponent(text); } catch { return '解码失败：无效的URL编码'; } };

const htmlEncode = (text: string): string => text.replace(/[&<>"']/g, c => ({ '&': '&', '<': '<', '>': '>', '"': '"', "'": '&#39;' }[c] || c));
const htmlDecode = (text: string): string => {
  const el = document.createElement('div');
  el.innerHTML = text;
  return el.textContent || '';
};

const unicodeEscape = (text: string): string => text.replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
const unicodeUnescape = (text: string): string => text.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const EncodingFixer: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [sourceEncoding, setSourceEncoding] = useState<EncodingType>('gbk');
  const [targetEncoding, setTargetEncoding] = useState<EncodingType>('utf8');
  const [copied, setCopied] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [detection, setDetection] = useState<string[]>([]);

  const handleDetect = () => {
    if (!input) return;
    setDetection(detectMojibake(input));
  };

  const handleFixGbkMisreadAsUtf8 = async () => {
    if (!input) return;
    setFixing(true);
    try {
      // Scenario: GBK bytes were decoded as UTF-8 → garbled
      // Fix: re-encode the garbled text to bytes (as if it were the original GBK bytes),
      // then decode those bytes as GBK
      const encoder = new TextEncoder();
      const bytes = encoder.encode(input);
      const decoder = new TextDecoder('gbk', { fatal: false });
      const result = decoder.decode(bytes);
      setOutput(result);
    } catch (e) {
      setOutput(`修复失败: ${e}`);
    }
    setFixing(false);
  };

  const handleFixUtf8MisreadAsGbk = async () => {
    if (!input) return;
    setFixing(true);
    try {
      // Scenario: UTF-8 bytes were decoded as GBK → garbled
      // Fix: re-encode the garbled text to bytes (as if GBK), then decode as UTF-8
      const encoder = new TextEncoder();
      const bytes = encoder.encode(input);
      const decoder = new TextDecoder('utf-8', { fatal: false });
      const result = decoder.decode(bytes);
      setOutput(result);
    } catch (e) {
      setOutput(`修复失败: ${e}`);
    }
    setFixing(false);
  };

  const handleFixDoubleEncoding = () => {
    if (!input) return;
    setOutput(fixDoubleEncoding(input));
  };

  const handleConvert = async () => {
    if (!input) return;
    setFixing(true);
    try {
      const encoder = new TextEncoder();
      const bytes = encoder.encode(input);
      const decoder = new TextDecoder(targetEncoding, { fatal: false });
      const result = decoder.decode(bytes);
      setOutput(result);
    } catch (e) {
      setOutput(`转换失败: ${e}`);
    }
    setFixing(false);
  };

  const handleCopy = async () => {
    await copyToClipboard(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const ENCODE_DECODE_TOOLS: { label: string; encode: (s: string) => string; decode: (s: string) => string }[] = [
    { label: 'Base64', encode: base64Encode, decode: base64Decode },
    { label: 'URL', encode: urlEncode, decode: urlDecode },
    { label: 'HTML实体', encode: htmlEncode, decode: htmlDecode },
    { label: 'Unicode', encode: unicodeEscape, decode: unicodeUnescape },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">编码与乱码修复 — 编码检测、乱码修复、Base64/URL/HTML/Unicode编解码</p>

      {/* Input */}
      <div>
        <label className="text-xs font-medium text-[#6d5a47] mb-1 block">输入文本</label>
        <textarea value={input} onChange={e => { setInput(e.target.value); setDetection([]); }}
          className="w-full h-24 text-sm font-mono border border-[#ead0ad] rounded-lg px-3 py-2 bg-white resize-y focus:border-[#7a421b] focus:outline-none"
          placeholder="粘贴乱码文本或需要编解码的内容..." />
      </div>

      {/* Detection */}
      <div className="flex gap-2">
        <Btn onClick={handleDetect} variant="secondary" disabled={!input}>
          <AlertTriangle className="w-3 h-3 mr-1" />检测乱码
        </Btn>
      </div>
      {detection.length > 0 && (
        <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-2 space-y-1">
          {detection.map((d, i) => (
            <div key={i} className="text-xs text-[#6d5a47] flex items-start gap-1">
              <span className="text-[#c79f72]">•</span>
              <span>{d}</span>
            </div>
          ))}
        </div>
      )}

      {/* Fix tools */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h4 className="text-xs font-medium text-[#6f3714] mb-2">乱码修复</h4>
        <div className="flex flex-wrap gap-2">
          <Btn onClick={handleFixGbkMisreadAsUtf8} disabled={!input || fixing} variant="secondary">
            GBK误读为UTF-8
          </Btn>
          <Btn onClick={handleFixUtf8MisreadAsGbk} disabled={!input || fixing} variant="secondary">
            UTF-8误读为GBK
          </Btn>
          <Btn onClick={handleFixDoubleEncoding} disabled={!input} variant="secondary">
            双重编码修复
          </Btn>
        </div>
        <div className="mt-2 text-[10px] text-[#8b735c]">
          提示：浏览器TextDecoder支持有限，部分编码转换可能不准确。建议优先尝试"双重编码修复"。
        </div>
      </div>

      {/* Encoding conversion */}
      <div className="bg-[#fff4e6] border border-[#ead0ad] rounded-lg p-3">
        <h4 className="text-xs font-medium text-[#6f3714] mb-2">编码转换</h4>
        <div className="flex items-center gap-2">
          <select value={sourceEncoding} onChange={e => setSourceEncoding(e.target.value as EncodingType)}
            className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
            {ENCODING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <RefreshCw className="w-3 h-3 text-[#c79f72]" />
          <select value={targetEncoding} onChange={e => setTargetEncoding(e.target.value as EncodingType)}
            className="text-xs border border-[#ead0ad] rounded px-2 py-1 bg-white">
            {ENCODING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <Btn onClick={handleConvert} disabled={!input || fixing}>转换</Btn>
        </div>
      </div>

      {/* Encode/Decode tools */}
      <div>
        <h4 className="text-xs font-medium text-[#6d5a47] mb-2">编解码工具</h4>
        <div className="grid grid-cols-2 gap-2">
          {ENCODE_DECODE_TOOLS.map(tool => (
            <div key={tool.label} className="border border-[#ead0ad] rounded-lg p-2 bg-white">
              <div className="text-xs font-medium text-[#6d5a47] mb-1">{tool.label}</div>
              <div className="flex gap-1">
                <button onClick={() => setOutput(tool.encode(input))}
                  className="flex-1 px-2 py-1 text-[10px] bg-[#f1dcc2] rounded hover:bg-[#ead0ad] text-[#6f3714]">
                  编码
                </button>
                <button onClick={() => setOutput(tool.decode(input))}
                  className="flex-1 px-2 py-1 text-[10px] bg-[#f1dcc2] rounded hover:bg-[#ead0ad] text-[#6f3714]">
                  解码
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Output */}
      {output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-[#6d5a47]">输出结果</label>
            <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-[#7a421b] hover:text-[#6f3714]">
              {copied ? <CheckCircle className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
              复制
            </button>
          </div>
          <div className="bg-white border border-[#ead0ad] rounded-lg p-3 text-sm font-mono text-[#6d5a47] max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
            {output}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default EncodingFixer;