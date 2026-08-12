import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';

// ── 通用文件上传 Hook ──────────────────────────────────────

// ── 文件大小限制 ──────────────────────────────────────────

export const FILE_SIZE_LIMITS = {
  pdf: 100 * 1024 * 1024,      // 100MB
  image: 50 * 1024 * 1024,     // 50MB
  audio: 25 * 1024 * 1024,     // 25MB
  default: 100 * 1024 * 1024,  // 100MB
} as const;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export function checkFileSize(file: File, limit: number): string | null {
  if (file.size > limit) {
    return `文件 "${file.name}" (${formatFileSize(file.size)}) 超过大小限制 (${formatFileSize(limit)})`;
  }
  return null;
}

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
  compact?: boolean;
}> = ({ onUpload, onDropFiles, accept, label = '拖拽或点击上传文件', sublabel, compact }) => (
  <div
    className={`border-2 border-dashed border-[#c79f72] bg-[#fff4e6]/70 rounded-xl text-center cursor-pointer hover:border-[#9a5a28] hover:bg-[#f1dcc2]/70 transition-colors ${compact ? 'p-4' : 'p-10'}`}
    onClick={onUpload}
    onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
    onDrop={e => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files.length && onDropFiles) onDropFiles(e.dataTransfer.files); }}
  >
    <div className="text-[#8b735c] mb-2">
      <svg className="w-10 h-10 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
      </svg>
    </div>
    <p className="text-[#6d5a47]">{label}</p>
    {sublabel && <p className="text-xs text-[#8b735c] mt-1">{sublabel}</p>}
  </div>
);

// ── 通用按钮 ──────────────────────────────────────────────

export const Btn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger' | 'ghost' | 'secondary';
  children: React.ReactNode;
  className?: string;
}> = ({ onClick, disabled, variant = 'primary', children, className = '' }) => {
  const base = 'px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50';
  const styles = {
    primary: 'bg-[#7a421b] text-[#fff8ef] hover:bg-[#5f3214]',
    danger: 'bg-red-600/15 border border-red-500/30 text-red-700 hover:bg-red-600/25',
    ghost: 'bg-[#f1dcc2] text-[#6f3714] hover:bg-[#ead0ad]',
    secondary: 'bg-[#ead0ad] text-[#5f3214] hover:bg-[#d8b58e]',
  };
  return <button onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>{children}</button>;
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
    className={`w-full bg-[#fff4e6] border border-[#d8b58e] rounded-lg p-3 text-sm text-[#2f241b] font-mono resize-y focus:outline-none focus:border-[#9a5a28] ${className}`}
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
    className={`w-full bg-[#fff4e6] border border-[#d8b58e] rounded-lg p-3 text-sm text-[#2f241b] focus:outline-none focus:border-[#9a5a28] ${className}`}
  />
);

// ── 通用结果展示 ──────────────────────────────────────────

export const ResultBox: React.FC<{
  label: string;
  value: string;
  onCopy?: () => void;
}> = ({ label, value, onCopy }) => (
  <div className="bg-[#fff4e6] border border-[#d8b58e] rounded-lg p-3">
    <div className="flex justify-between items-center mb-1">
      <span className="text-xs text-[#8b735c]">{label}</span>
      {onCopy && (
        <button onClick={onCopy} className="text-xs text-[#8a4b1f] hover:text-[#5f3214]">复制</button>
      )}
    </div>
    <div className="text-sm text-[#2f241b] font-mono break-all">{value}</div>
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

// ── 进度条组件 ──────────────────────────────────────────

export const ProgressBar: React.FC<{
  value: number;       // 0-100
  label?: string;
  showPercent?: boolean;
  color?: string;      // tailwind color class
}> = ({ value, label, showPercent = true, color = 'bg-violet-500' }) => (
  <div className="space-y-1">
    {(label || showPercent) && (
      <div className="flex justify-between text-xs text-[#6d5a47]">
        {label && <span>{label}</span>}
        {showPercent && <span>{Math.round(value)}%</span>}
      </div>
    )}
    <div className="w-full h-2 bg-[#ead0ad] rounded-full overflow-hidden">
      <div
        className={`h-full ${color} rounded-full transition-all duration-300`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  </div>
);

export const StatusMessage: React.FC<{
  status: string;
  type?: 'info' | 'success' | 'error' | 'warning';
}> = ({ status, type = 'info' }) => {
  const colors = {
    info: 'text-[#6d5a47]',
    success: 'text-[#5f6f42]',
    error: 'text-red-700',
    warning: 'text-[#9a5a28]',
  };
  if (!status) return null;
  return <p className={`text-sm ${colors[type]} mt-2`}>{status}</p>;
};
