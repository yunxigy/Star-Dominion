import React, { useState } from 'react';
import { Btn, TextArea } from '../shared';

export type WebmasterWorkbenchProps = {
  title: string;
  description: string;
  process: (input: string) => string | Promise<string>;
  controls?: React.ReactNode;
  inputLabel?: string;
  outputLabel?: string;
  initialInput?: string;
  local?: boolean;
  actionLabel?: string;
  onClose: () => void;
};

const copy = async (value: string) => {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(value);
};

export const WebmasterWorkbench: React.FC<WebmasterWorkbenchProps> = ({ title, description, process, controls, inputLabel = '输入内容', outputLabel = '处理结果', initialInput = '', local = true, actionLabel = '生成', onClose }) => {
  const [input, setInput] = useState(initialInput);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const run = async () => {
    setBusy(true); setError(''); setStatus('');
    try { setOutput(await process(input)); setStatus('处理完成'); } catch (processingError) { setOutput(''); setError(processingError instanceof Error ? processingError.message : '处理失败'); } finally { setBusy(false); }
  };
  const download = () => { const url = URL.createObjectURL(new Blob([output], { type: 'text/plain;charset=utf-8' })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${title.replace(/[^\p{L}\p{N}_-]+/gu, '-') || 'webmaster-result'}.txt`; anchor.click(); URL.revokeObjectURL(url); };
  return <div className="space-y-5">
    <div><h2 className="text-lg font-semibold text-[#5f3214]">{title}</h2><p className="mt-1 text-sm leading-6 text-[#6d5a47]">{description}</p><p className={`mt-1 text-xs ${local ? 'text-[#5f6f42]' : 'text-[#9a5a28]'}`}>{local ? '本地处理：输入不会上传。' : '受控网络检测：不会转发 Cookie、Authorization 或自定义请求头。'}</p></div>
    {controls && <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[#ead0ad] bg-[#fff8ef] p-3">{controls}</div>}
    <div className="grid gap-4 xl:grid-cols-2"><label className="block text-sm font-medium text-[#5f3214]">{inputLabel}<TextArea ariaLabel={inputLabel} value={input} onChange={setInput} rows={12} className="mt-2 min-h-[240px]" placeholder="输入内容…" /></label><label className="block text-sm font-medium text-[#5f3214]">{outputLabel}<TextArea ariaLabel={outputLabel} value={output} onChange={setOutput} rows={12} className="mt-2 min-h-[240px]" placeholder="结果会显示在这里" /></label></div>
    <div className="flex flex-wrap gap-2"><Btn onClick={() => { void run(); }} disabled={busy}>{busy ? '处理中…' : actionLabel}</Btn><Btn onClick={() => { setInput(''); setOutput(''); setError(''); setStatus(''); }} variant="secondary">清空</Btn><Btn onClick={() => { void copy(output).then(() => setStatus('结果已复制')); }} variant="ghost" disabled={!output}>复制结果</Btn><Btn onClick={download} variant="ghost" disabled={!output}>下载 TXT</Btn><Btn onClick={onClose} variant="ghost">关闭</Btn></div>
    {status && <p role="status" className="text-sm text-[#5f6f42]">{status}</p>}{error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
};

export default WebmasterWorkbench;
