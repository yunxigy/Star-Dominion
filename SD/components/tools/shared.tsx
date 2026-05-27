import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';

// ── 通用文件上传 Hook ──────────────────────────────────────

export function useFileUpload(accept: string = '*') {
  const [files, setFiles] = useState<File[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    setFiles(prev => [...prev, ...Array.from(newFiles)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearFiles = useCallback(() => setFiles([]), []);

  const triggerUpload = useCallback(() => inputRef.current?.click(), []);

  const inputProps = { ref: inputRef, type: 'file' as const, accept, multiple: true, className: 'hidden', onChange: (e: React.ChangeEvent<HTMLInputElement>) => handleFiles(e.target.files) };

  return { files, setFiles, handleFiles, removeFile, clearFiles, triggerUpload, inputRef, inputProps };
}

// ── 通用上传区域 ──────────────────────────────────────────

export const UploadZone: React.FC<{
  onUpload: () => void;
  onDropFiles?: (files: FileList) => void;
  accept?: string;
  label?: string;
  sublabel?: string;
}> = ({ onUpload, onDropFiles, accept, label = '拖拽或点击上传文件', sublabel }) => (
  <div
    className="border-2 border-dashed border-slate-700 rounded-xl p-10 text-center cursor-pointer hover:border-violet-500/50 transition-colors"
    onClick={onUpload}
    onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length && onDropFiles) onDropFiles(e.dataTransfer.files); }}
  >
    <div className="text-slate-600 mb-2">
      <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    </div>
    <p className="text-slate-400">{label}</p>
    {sublabel && <p className="text-xs text-slate-600 mt-1">{sublabel}</p>}
  </div>
);

// ── 通用按钮 ──────────────────────────────────────────────

export const Btn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost';
  children: React.ReactNode;
}> = ({ onClick, disabled, variant = 'primary', children }) => {
  const base = 'px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50';
  const styles = {
    primary: 'bg-violet-600 text-white hover:bg-violet-500',
    danger: 'bg-red-600/20 border border-red-500/30 text-red-400 hover:bg-red-600/30',
    ghost: 'bg-slate-800 text-slate-300 hover:bg-slate-700',
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]}`}>{children}</button>;
};

// ── 通用 textarea/input ───────────────────────────────────

export const TextArea: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
  readOnly?: boolean;
}> = ({ value, onChange, placeholder, rows = 6, className = '', readOnly }) => (
  <textarea
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    rows={rows}
    readOnly={readOnly}
    className={`w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 font-mono resize-y focus:outline-none focus:border-violet-500/50 ${className}`}
  />
);

export const TextInput: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}> = ({ value, onChange, placeholder, type = 'text', className = '' }) => (
  <input
    type={type}
    value={value}
    onChange={e => onChange(e.target.value)}
    placeholder={placeholder}
    className={`w-full bg-slate-800/50 border border-slate-700 rounded-lg p-3 text-sm text-slate-200 focus:outline-none focus:border-violet-500/50 ${className}`}
  />
);

// ── 通用结果展示 ──────────────────────────────────────────

export const ResultBox: React.FC<{
  label: string;
  value: string;
  onCopy?: () => void;
}> = ({ label, value, onCopy }) => (
  <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs text-slate-500">{label}</span>
      {onCopy && (
        <button onClick={onCopy} className="text-xs text-violet-400 hover:text-violet-300">复制</button>
      )}
    </div>
    <div className="text-sm text-slate-200 font-mono break-all">{value}</div>
  </div>
);

// ── Canvas 工具函数 ───────────────────────────────────────

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), type, quality);
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text);
}

// ── Object URL 内存安全工具 ──────────────────────────────

/** 自动管理 Object URL 生命周期：创建、替换、卸载时自动 revoke */
export function useObjectUrl(blob: Blob | null): string {
  const [url, setUrl] = useState('');
  const prevRef = useRef('');
  useEffect(() => {
    if (!blob) {
      if (prevRef.current) URL.revokeObjectURL(prevRef.current);
      prevRef.current = '';
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(blob);
    if (prevRef.current) URL.revokeObjectURL(prevRef.current);
    prevRef.current = next;
    setUrl(next);
    return () => { URL.revokeObjectURL(next); };
  }, [blob]);
  return url;
}

/** 从 File 创建 memoized Object URL，组件卸载时自动 revoke */
export function useFileObjectUrl(file: File | undefined): string {
  const url = useMemo(() => file ? URL.createObjectURL(file) : '', [file]);
  useEffect(() => {
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [url]);
  return url;
}

/** 加载图片后自动 revoke 中间 Object URL */
export async function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  try {
    return await loadImage(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 批量 revoke Object URL 数组（用于 unmount cleanup） */
export function revokeUrls(urls: string[]) {
  urls.forEach(u => { if (u) URL.revokeObjectURL(u); });
}
