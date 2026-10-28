import React, { useState, useRef, useCallback } from 'react';
import { Btn, ResultBox, copyToClipboard } from '../shared';
import { UploadZone } from '../shared';
import { ArrowLeftRight, Download, FileText, Code, Type } from 'lucide-react';

type Format = 'markdown' | 'html' | 'text';

const FormatConverter: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [inputFormat, setInputFormat] = useState<Format>('markdown');
  const [outputFormat, setOutputFormat] = useState<Format>('html');
  const [fileName, setFileName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (fl: FileList | null) => {
    if (!fl?.[0]) return;
    const file = fl[0];
    setFileName(file.name);
    const text = await file.text();
    setInput(text);
    setOutput('');
    // Auto-detect format from extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext === 'md' || ext === 'markdown') setInputFormat('markdown');
    else if (ext === 'html' || ext === 'htm') setInputFormat('html');
    else setInputFormat('text');
  }, []);

  // Markdown → HTML
  const mdToHtml = (md: string): string => {
    let html = md;
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // Bold & italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // Images
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
    // Lists
    html = html.replace(/^\s*[-*] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    // Ordered lists
    html = html.replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>');
    // Blockquotes
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // Horizontal rule
    html = html.replace(/^---$/gm, '<hr />');
    // Paragraphs
    html = html.replace(/^(?!<[hupob]|<li|<hr|<pre|<code)(.+)$/gm, '<p>$1</p>');
    // Line breaks
    html = html.replace(/\n{2,}/g, '\n');
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>Converted Document</title>\n<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}code{background:#f4f4f4;padding:2px 6px;border-radius:3px}pre{background:#f4f4f4;padding:16px;border-radius:6px;overflow-x:auto}blockquote{border-left:3px solid #ccc;padding-left:16px;color:#666}</style>\n</head>\n<body>\n${html}\n</body>\n</html>`;
  };

  // HTML → Markdown
  const htmlToMd = (html: string): string => {
    let md = html;
    // Remove style/script tags
    md = md.replace(/<style[\s\S]*?<\/style>/gi, '');
    md = md.replace(/<script[\s\S]*?<\/script>/gi, '');
    // Headers
    md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
    md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
    md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
    md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
    // Bold & italic
    md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
    // Links
    md = md.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    // Images
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
    md = md.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]($1)');
    // Code
    md = md.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '```\n$1\n```');
    md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    // Lists
    md = md.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    // Blockquotes
    md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n');
    // Paragraphs
    md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
    // Line breaks
    md = md.replace(/<br\s*\/?>/gi, '\n');
    // Horizontal rule
    md = md.replace(/<hr\s*\/?>/gi, '---\n\n');
    // Remove remaining tags
    md = md.replace(/<[^>]+>/g, '');
    // Decode entities
    md = md.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/&#39;/g, "'");
    // Clean up whitespace
    md = md.replace(/\n{3,}/g, '\n\n').trim();
    return md;
  };

  // Text → HTML
  const textToHtml = (text: string): string => {
    const escaped = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
    const paragraphs = escaped.split(/\n\n+/).map(p => `<p>${p.replace(/\n/g, '<br />')}</p>`).join('\n');
    return `<!DOCTYPE html>\n<html lang="zh-CN">\n<head>\n<meta charset="UTF-8">\n<title>Converted Document</title>\n<style>body{font-family:sans-serif;max-width:800px;margin:0 auto;padding:20px;line-height:1.6}</style>\n</head>\n<body>\n${paragraphs}\n</body>\n</html>`;
  };

  // HTML → Text
  const htmlToText = (html: string): string => {
    let text = html;
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    text = text.replace(/<\/li>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>').replace(/"/g, '"').replace(/&#39;/g, "'");
    text = text.replace(/\n{3,}/g, '\n\n').trim();
    return text;
  };

  // Markdown → Text
  const mdToText = (md: string): string => {
    let text = md;
    text = text.replace(/^#{1,6}\s+/gm, '');
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/`{3}[\s\S]*?`{3}/g, (m) => m.replace(/```\w*\n?/g, '').replace(/```/g, ''));
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/!\[[^\]]*\]\([^)]+\)/g, '');
    text = text.replace(/^[-*]\s+/gm, '• ');
    text = text.replace(/^\d+\.\s+/gm, '');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/^---$/gm, '');
    return text.trim();
  };

  // Text → Markdown
  const textToMd = (text: string): string => {
    const lines = text.split('\n');
    const result: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === '') {
        result.push('');
      } else if (trimmed.length < 40 && !trimmed.endsWith('。') && !trimmed.endsWith('，')) {
        result.push(`## ${trimmed}`);
      } else {
        result.push(trimmed);
      }
    }
    return result.join('\n');
  };

  const convert = () => {
    if (!input) return;
    let result = '';
    if (inputFormat === 'markdown' && outputFormat === 'html') result = mdToHtml(input);
    else if (inputFormat === 'html' && outputFormat === 'markdown') result = htmlToMd(input);
    else if (inputFormat === 'text' && outputFormat === 'html') result = textToHtml(input);
    else if (inputFormat === 'html' && outputFormat === 'text') result = htmlToText(input);
    else if (inputFormat === 'markdown' && outputFormat === 'text') result = mdToText(input);
    else if (inputFormat === 'text' && outputFormat === 'markdown') result = textToMd(input);
    else result = input; // Same format
    setOutput(result);
  };

  const downloadResult = () => {
    if (!output) return;
    const ext = outputFormat === 'html' ? 'html' : outputFormat === 'markdown' ? 'md' : 'txt';
    const mime = outputFormat === 'html' ? 'text/html' : 'text/plain';
    const blob = new Blob([output], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formats: { key: Format; label: string; icon: React.ReactNode }[] = [
    { key: 'markdown', label: 'Markdown', icon: <FileText className="w-4 h-4" /> },
    { key: 'html', label: 'HTML', icon: <Code className="w-4 h-4" /> },
    { key: 'text', label: '纯文本', icon: <Type className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">在 Markdown、HTML 和纯文本之间互相转换</p>

      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 border border-yellow-300 rounded-lg">
        <span className="px-1.5 py-0.5 text-[10px] font-bold bg-yellow-400 text-yellow-900 rounded">BETA</span>
        <span className="text-xs text-yellow-700">基础版：暂不支持 Word (.docx) 格式，仅支持 Markdown ↔ HTML ↔ 纯文本转换</span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label className="text-xs font-medium text-[#6d5a47] mb-1 block">输入格式</label>
          <div className="flex gap-1">
            {formats.map(f => (
              <button key={f.key} onClick={() => setInputFormat(f.key)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${inputFormat === f.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
                {f.icon}{f.label}
              </button>
            ))}
          </div>
        </div>
        <ArrowLeftRight className="w-5 h-5 text-[#8b735c] mt-5" />
        <div className="flex-1">
          <label className="text-xs font-medium text-[#6d5a47] mb-1 block">输出格式</label>
          <div className="flex gap-1">
            {formats.map(f => (
              <button key={f.key} onClick={() => setOutputFormat(f.key)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium ${outputFormat === f.key ? 'bg-[#7a421b] text-[#fff8ef]' : 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]'}`}>
                {f.icon}{f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#6d5a47]">输入</span>
            <div className="flex gap-2">
              <button onClick={() => inputRef.current?.click()} className="text-xs text-[#7a421b] hover:underline">上传文件</button>
              <button onClick={() => { setInput(''); setOutput(''); }} className="text-xs text-red-500 hover:underline">清空</button>
            </div>
          </div>
          <textarea value={input} onChange={e => { setInput(e.target.value); setOutput(''); }}
            className="w-full h-48 border border-[#ead0ad] rounded-lg p-2 text-xs font-mono text-[#6d5a47] bg-white resize-none focus:outline-none focus:border-[#7a421b]"
            placeholder="在此粘贴内容或上传文件..." />
          <input ref={inputRef} type="file" className="hidden" accept=".md,.html,.htm,.txt,.markdown" onChange={e => handleFile(e.target.files)} />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-[#6d5a47]">输出</span>
            {output && (
              <div className="flex gap-2">
                <button onClick={() => copyToClipboard(output)} className="text-xs text-[#7a421b] hover:underline">复制</button>
                <button onClick={downloadResult} className="text-xs text-[#7a421b] hover:underline">下载</button>
              </div>
            )}
          </div>
          <textarea value={output} readOnly
            className="w-full h-48 border border-[#ead0ad] rounded-lg p-2 text-xs font-mono text-[#6d5a47] bg-[#fff8ef] resize-none focus:outline-none"
            placeholder="转换结果将显示在这里..." />
        </div>
      </div>

      <div className="flex gap-2">
        <Btn onClick={convert} disabled={!input || inputFormat === outputFormat}>
          <ArrowLeftRight className="w-4 h-4 mr-1" />
          {inputFormat === outputFormat ? '请选择不同格式' : `转换 ${formats.find(f => f.key === inputFormat)?.label} → ${formats.find(f => f.key === outputFormat)?.label}`}
        </Btn>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
        <p className="text-xs text-amber-700">
          提示：Markdown → HTML 支持标题、粗体、斜体、代码块、链接、图片、列表等基本语法。
          Word (.docx) 格式转换需要后端支持，暂不支持。
        </p>
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default FormatConverter;