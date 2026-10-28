import { useId, useRef, useState } from 'react';
import type {
  ChangeEvent,
  DragEvent,
  KeyboardEvent,
  ReactNode,
} from 'react';

export interface ImageDropzoneProps {
  accept?: string;
  disabled?: boolean;
  maxFiles?: number;
  maxFileSizeBytes?: number;
  multiple?: boolean;
  onFiles: (files: readonly File[]) => void | Promise<void>;
  title?: string;
  description?: ReactNode;
  privacyNotice?: ReactNode;
  error?: ReactNode;
}

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB'] as const;

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    SIZE_UNITS.length - 1,
  );
  const size = bytes / 1024 ** unitIndex;
  const formatted = Number.isInteger(size) ? String(size) : size.toFixed(1);
  return `${formatted} ${SIZE_UNITS[unitIndex]}`;
}

function formatAccept(accept: string): string {
  return accept
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      if (item.startsWith('image/')) return item.slice('image/'.length).toUpperCase();
      return item.toUpperCase();
    })
    .join('、');
}

export function ImageDropzone({
  accept = 'image/*',
  disabled = false,
  maxFiles,
  maxFileSizeBytes,
  multiple = true,
  onFiles,
  title = '选择或拖入图片',
  description,
  privacyNotice = '图片仅在浏览器本地处理，不会上传到服务器。',
  error,
}: ImageDropzoneProps) {
  const generatedId = useId();
  const inputId = `image-workbench-upload-${generatedId}`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const submitFiles = (files: FileList | readonly File[] | null) => {
    if (disabled || !files || files.length === 0) return;
    void onFiles(Array.from(files));
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    submitFiles(event.currentTarget.files);
    event.currentTarget.value = '';
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLLabelElement>) => {
    if (disabled || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    inputRef.current?.click();
  };

  const handleDragOver = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    if (!disabled) setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsDragging(false);
    submitFiles(event.dataTransfer.files);
  };

  const className = [
    'image-workbench__dropzone',
    isDragging ? 'image-workbench__dropzone--dragging' : '',
    disabled ? 'image-workbench__dropzone--disabled' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="image-workbench__dropzone-group">
      <label
        className={className}
        htmlFor={inputId}
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled}
        aria-describedby={`${helpId}${error !== undefined ? ` ${errorId}` : ''}`}
        onKeyDown={handleKeyDown}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          id={inputId}
          className="image-workbench__dropzone-input"
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          onChange={handleChange}
        />
        <span className="image-workbench__dropzone-title">{title}</span>
        <span id={helpId} className="image-workbench__dropzone-help">
          {description ?? (
            <>
              <span>支持格式：{formatAccept(accept)}</span>
              {maxFiles !== undefined ? <span>最多 {maxFiles} 张</span> : null}
              {maxFileSizeBytes !== undefined ? (
                <span>单张不超过 {formatFileSize(maxFileSizeBytes)}</span>
              ) : null}
            </>
          )}
        </span>
        {privacyNotice !== null ? (
          <span className="image-workbench__dropzone-privacy">{privacyNotice}</span>
        ) : null}
      </label>

      {error !== undefined ? (
        <div id={errorId} className="image-workbench__dropzone-error" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
