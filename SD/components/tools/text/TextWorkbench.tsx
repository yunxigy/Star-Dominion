import React, { useRef, useState } from 'react';
import { Btn, TextArea } from '../shared';
import { analyzeText } from './core';

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 20;

export type TextWorkbenchProps = {
  title: string;
  description: string;
  process: (input: string) => string;
  controls?: React.ReactNode;
  acceptFiles?: boolean;
  initialValue?: string;
  onClose?: () => void;
};

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const element = document.createElement('textarea');
  element.value = value;
  element.style.position = 'fixed';
  element.style.opacity = '0';
  document.body.appendChild(element);
  element.select();
  document.execCommand('copy');
  element.remove();
};

export const TextWorkbench: React.FC<TextWorkbenchProps> = ({
  title,
  description,
  process,
  controls,
  acceptFiles = false,
  initialValue = '',
  onClose,
}) => {
  const [input, setInput] = useState(initialValue);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputMetrics = analyzeText(input);
  const outputMetrics = analyzeText(output);

  const run = () => {
    setError('');
    setStatus('');
    try {
      setOutput(process(input));
      setStatus('处理完成');
    } catch (processingError) {
      setOutput('');
      setError(processingError instanceof Error ? processingError.message : '处理失败，请检查输入');
    }
  };

  const loadFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError('');
    const selected = Array.from(files).slice(0, MAX_FILES);
    if (files.length > MAX_FILES) setStatus(`仅读取前 ${MAX_FILES} 个文件`);
    try {
      const documents: string[] = [];
      for (const file of selected) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`文件“${file.name}”超过 5 MiB 限制`);
        documents.push(await file.text());
      }
      setInput(documents.join('\n\n'));
    } catch (fileError) {
      setError(fileError instanceof Error ? fileError.message : '文件读取失败');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'text-result'}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-[#5f3214]">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[#6d5a47]">{description}</p>
        <p className="mt-1 text-xs text-[#5f6f42]">本地处理：文本不会上传到服务器。</p>
      </div>

      {acceptFiles && (
        <div className="flex flex-wrap items-center gap-2">
          <Btn onClick={() => inputRef.current?.click()} variant="secondary">读取文本文件</Btn>
          <span className="text-xs text-[#8b735c]">最多 20 个文件，单个不超过 5 MiB</span>
          <input ref={inputRef} type="file" accept=".txt,.md,.markdown,.csv,.log,.json,.xml,.html,.htm" multiple className="hidden" onChange={(event) => { void loadFiles(event.target.files); event.currentTarget.value = ''; }} />
        </div>
      )}

      {controls && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#ead0ad] bg-[#fff8ef] p-3">{controls}</div>}

      <div className="grid gap-4 xl:grid-cols-2">
        <label className="block text-sm font-medium text-[#5f3214]">
          输入文本
          <TextArea ariaLabel="输入文本" value={input} onChange={setInput} rows={14} className="mt-2 min-h-[280px]" placeholder="在这里粘贴或输入内容…" />
          <span className="mt-1 block text-xs font-normal text-[#8b735c]">{inputMetrics.characters} 字符 · {inputMetrics.lines} 行</span>
        </label>
        <label className="block text-sm font-medium text-[#5f3214]">
          处理结果
          <TextArea ariaLabel="处理结果" value={output} onChange={setOutput} rows={14} className="mt-2 min-h-[280px]" placeholder="处理结果会显示在这里" readOnly={false} />
          <span className="mt-1 block text-xs font-normal text-[#8b735c]">{outputMetrics.characters} 字符 · {outputMetrics.lines} 行</span>
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={run}>开始处理</Btn>
        <Btn onClick={() => { setInput(''); setOutput(''); setError(''); setStatus(''); }} variant="secondary">清空</Btn>
        <Btn onClick={() => setInput(output)} variant="ghost" disabled={!output}>结果作为输入</Btn>
        <Btn onClick={() => { void copyText(output).then(() => setStatus('结果已复制')).catch(() => setError('复制失败，请手动选择文本')); }} variant="ghost" disabled={!output}>复制结果</Btn>
        <Btn onClick={download} variant="ghost" disabled={!output}>下载 TXT</Btn>
        {onClose && <Btn onClick={onClose} variant="ghost">关闭</Btn>}
      </div>
      {status && <p role="status" className="text-sm text-[#5f6f42]">{status}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  );
};

export default TextWorkbench;
