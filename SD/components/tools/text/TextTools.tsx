import React, { useRef, useState } from 'react';
import JSZip from 'jszip';
import { Btn, TextArea } from '../shared';
import { addLineNumbers, analyzeText, dedupeLines, extractEntities, mergeTextDocuments, removeBlankLines, removeLineNumbers, replaceText, sortLines, splitTextByLines } from './core';
import { htmlToPlainText, markdownToHtml, plainTextToHtml } from './markup';
import { TextWorkbench } from './TextWorkbench';

type ToolProps = { onClose: () => void };
const inputClass = 'rounded-lg border border-[#d8b58e] bg-[#fff4e6] px-3 py-2 text-sm text-[#2f241b] focus:border-[#9a5a28] focus:outline-none';

const SelectControl: React.FC<{ label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }> = ({ label, value, onChange, children }) => (
  <label className="text-xs font-medium text-[#6d5a47]">{label}<select className={`mt-1 block ${inputClass}`} value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>
);

const CheckboxControl: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <label className="flex items-center gap-2 pb-2 text-sm text-[#6d5a47]"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>
);

export const RemoveBlankLinesTool: React.FC<ToolProps> = ({ onClose }) => (
  <TextWorkbench onClose={onClose} title="文本去空行" description="删除空白行，保留非空行中的原始缩进与内容。" process={removeBlankLines} />
);

export const DedupeLinesTool: React.FC<ToolProps> = ({ onClose }) => {
  const [caseSensitive, setCaseSensitive] = useState(false);
  return <TextWorkbench onClose={onClose} title="文本行去重" description="稳定保留每一行第一次出现的内容，可选择是否区分大小写。" process={(value) => dedupeLines(value, caseSensitive)} controls={<CheckboxControl label="区分大小写" checked={caseSensitive} onChange={setCaseSensitive} />} />;
};

export const SortLinesTool: React.FC<ToolProps> = ({ onClose }) => {
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  return <TextWorkbench onClose={onClose} title="文本行排序" description="按中文、字母和数字自然顺序排序文本行。" process={(value) => sortLines(value, direction)} controls={<SelectControl label="排序方向" value={direction} onChange={(value) => setDirection(value as 'asc' | 'desc')}><option value="asc">升序</option><option value="desc">降序</option></SelectControl>} />;
};

export const BatchReplaceTool: React.FC<ToolProps> = ({ onClose }) => {
  const [search, setSearch] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const controls = <>
    <label className="text-xs font-medium text-[#6d5a47]">查找<input aria-label="查找内容" className={`mt-1 block ${inputClass}`} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
    <label className="text-xs font-medium text-[#6d5a47]">替换为<input aria-label="替换内容" className={`mt-1 block ${inputClass}`} value={replacement} onChange={(event) => setReplacement(event.target.value)} /></label>
    <CheckboxControl label="正则表达式" checked={regex} onChange={setRegex} />
    <CheckboxControl label="区分大小写" checked={caseSensitive} onChange={setCaseSensitive} />
  </>;
  return <TextWorkbench onClose={onClose} title="批量文本替换" description="一次替换所有匹配文本，支持字面量或正则表达式。" process={(value) => replaceText(value, search, replacement, { regex, caseSensitive })} controls={controls} />;
};

export const LineNumberTool: React.FC<ToolProps> = ({ onClose }) => {
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [start, setStart] = useState('1');
  return <TextWorkbench onClose={onClose} title="文本行号工具" description="为文本添加连续行号，或移除已有的数字行号前缀。" process={(value) => mode === 'add' ? addLineNumbers(value, Number(start) || 1) : removeLineNumbers(value)} controls={<><SelectControl label="操作" value={mode} onChange={(value) => setMode(value as 'add' | 'remove')}><option value="add">添加行号</option><option value="remove">移除行号</option></SelectControl>{mode === 'add' && <label className="text-xs font-medium text-[#6d5a47]">起始行号<input type="number" min="1" className={`mt-1 block w-24 ${inputClass}`} value={start} onChange={(event) => setStart(event.target.value)} /></label>}</>} />;
};

export const CharacterFrequencyTool: React.FC<ToolProps> = ({ onClose }) => (
  <TextWorkbench onClose={onClose} title="字符与词频统计" description="统计字符、词数、行数，并按出现次数列出前 100 个 token。" process={(value) => {
    const metrics = analyzeText(value);
    const rows = metrics.frequencies.slice(0, 100).map((item, index) => `${index + 1}. ${item.token}  × ${item.count}`);
    return [`行数：${metrics.lines}`, `字符数：${metrics.characters}`, `去空白字符：${metrics.charactersNoWhitespace}`, `词数：${metrics.words}`, '', ...rows].join('\n');
  }} />
);

export const EntityExtractorTool: React.FC<ToolProps> = ({ onClose }) => (
  <TextWorkbench onClose={onClose} title="文本信息提取" description="提取并去重邮箱、HTTP(S) 链接和 IPv4/IPv6 地址。" process={(value) => {
    const result = extractEntities(value);
    return [`邮箱（${result.emails.length}）`, ...result.emails, '', `链接（${result.urls.length}）`, ...result.urls, '', `IP（${result.ips.length}）`, ...result.ips].join('\n');
  }} />
);

export const TextFileBatchTool: React.FC<ToolProps> = ({ onClose }) => {
  const [files, setFiles] = useState<File[]>([]);
  const [mode, setMode] = useState<'merge' | 'split'>('merge');
  const [linesPerPart, setLinesPerPart] = useState('100');
  const [includeHeadings, setIncludeHeadings] = useState(true);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const readFiles = (list: FileList | null) => {
    if (!list) return;
    const selected = Array.from(list).slice(0, 20);
    const invalid = selected.find((file) => file.size > 5 * 1024 * 1024);
    if (invalid) { setError(`文件“${invalid.name}”超过 5 MiB 限制`); return; }
    setError(''); setFiles(selected);
  };
  const processFiles = async () => {
    if (!files.length) { setError('请先选择文本文件'); return; }
    try {
      const documents = await Promise.all(files.map(async (file) => ({ name: file.name, text: await file.text() })));
      if (mode === 'merge') {
        setResult(mergeTextDocuments(documents, includeHeadings));
        return;
      }
      const parts = splitTextByLines(documents.map((item) => item.text).join('\n'), Number(linesPerPart));
      const zip = new JSZip();
      parts.forEach((part, index) => zip.file(`part-${String(index + 1).padStart(3, '0')}.txt`, part));
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'text-parts.zip'; anchor.click(); URL.revokeObjectURL(url);
      setResult(`已生成 ${parts.length} 个分片并下载 ZIP`);
    } catch (processingError) { setError(processingError instanceof Error ? processingError.message : '处理失败'); }
  };
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold text-[#5f3214]">文本文件批处理</h2><p className="mt-1 text-sm leading-6 text-[#6d5a47]">合并多个文本文件，或按行数切分并下载 ZIP。文件只在本地浏览器处理。</p></div>
    <div className="flex flex-wrap gap-3 rounded-lg border border-[#ead0ad] bg-[#fff8ef] p-3"><Btn onClick={() => inputRef.current?.click()} variant="secondary">选择文本文件</Btn><span className="self-center text-xs text-[#8b735c]">最多 20 个，单个不超过 5 MiB</span><input ref={inputRef} type="file" multiple accept=".txt,.md,.csv,.log,.json,.xml,.html" className="hidden" onChange={(event) => { readFiles(event.target.files); event.currentTarget.value = ''; }} /></div>
    {files.length > 0 && <p className="text-sm text-[#6d5a47]">已选择：{files.map((file) => file.name).join('、')}</p>}
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#ead0ad] bg-[#fff8ef] p-3"><SelectControl label="处理方式" value={mode} onChange={(value) => setMode(value as 'merge' | 'split')}><option value="merge">合并文件</option><option value="split">按行数切分</option></SelectControl>{mode === 'merge' ? <CheckboxControl label="插入文件名标题" checked={includeHeadings} onChange={setIncludeHeadings} /> : <label className="text-xs font-medium text-[#6d5a47]">每份行数<input type="number" min="1" className={`mt-1 block w-28 ${inputClass}`} value={linesPerPart} onChange={(event) => setLinesPerPart(event.target.value)} /></label>}<Btn onClick={() => { void processFiles(); }}>开始处理</Btn><Btn onClick={onClose} variant="ghost">关闭</Btn></div>
    <TextArea value={result} onChange={setResult} rows={12} readOnly={false} placeholder="处理结果或下载状态" />
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
};

export const MarkupConverterTool: React.FC<ToolProps> = ({ onClose }) => {
  const [source, setSource] = useState<'markdown' | 'html' | 'plain'>('markdown');
  const [target, setTarget] = useState<'markdown' | 'html' | 'plain'>('html');
  const convert = (value: string) => {
    if (source === target) throw new Error('源格式和目标格式不能相同');
    if (source === 'markdown' && target === 'html') return markdownToHtml(value);
    if (source === 'markdown' && target === 'plain') return htmlToPlainText(markdownToHtml(value));
    if (source === 'html' && target === 'plain') return htmlToPlainText(value);
    if (source === 'html' && target === 'markdown') return htmlToPlainText(value);
    if (source === 'plain' && target === 'html') return plainTextToHtml(value);
    return value;
  };
  const format = (value: string) => value === 'markdown' ? 'Markdown' : value === 'html' ? 'HTML' : '纯文本';
  return <TextWorkbench onClose={onClose} title="Markdown / HTML / 纯文本转换" description="在常见标记格式之间转换，输入会先经过安全转义与脚本过滤。" process={convert} controls={<><SelectControl label="源格式" value={source} onChange={(value) => setSource(value as typeof source)}>{(['markdown', 'html', 'plain'] as const).map((value) => <option key={value} value={value}>{format(value)}</option>)}</SelectControl><SelectControl label="目标格式" value={target} onChange={(value) => setTarget(value as typeof target)}>{(['markdown', 'html', 'plain'] as const).map((value) => <option key={value} value={value}>{format(value)}</option>)}</SelectControl></>} />;
};

