import type { ReactNode } from 'react';

export interface ImageActionBarProps {
  status: ReactNode;
  error?: ReactNode;
  reset(): void;
  processSelected(): void | Promise<void>;
  processAll(): void | Promise<void>;
  downloadSelected(): void | Promise<void>;
  downloadZip(): void | Promise<void>;
  resetDisabled?: boolean;
  processSelectedDisabled?: boolean;
  processAllDisabled?: boolean;
  downloadSelectedDisabled?: boolean;
  downloadZipDisabled?: boolean;
}

export function ImageActionBar({
  status,
  error,
  reset,
  processSelected,
  processAll,
  downloadSelected,
  downloadZip,
  resetDisabled = false,
  processSelectedDisabled = false,
  processAllDisabled = false,
  downloadSelectedDisabled = false,
  downloadZipDisabled = false,
}: ImageActionBarProps) {
  return (
    <section className="image-workbench__action-bar" aria-label="图片处理操作">
      <div className="image-workbench__action-status" aria-live="polite">
        {status}
      </div>
      {error ? (
        <div className="image-workbench__action-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="image-workbench__action-buttons">
        <button
          type="button"
          className="image-workbench__button image-workbench__button--secondary"
          disabled={resetDisabled}
          onClick={reset}
        >
          重置
        </button>
        <button
          type="button"
          className="image-workbench__button image-workbench__button--primary"
          disabled={processSelectedDisabled}
          onClick={() => void processSelected()}
        >
          处理选中
        </button>
        <button
          type="button"
          className="image-workbench__button image-workbench__button--primary"
          disabled={processAllDisabled}
          onClick={() => void processAll()}
        >
          处理全部
        </button>
        <button
          type="button"
          className="image-workbench__button image-workbench__button--secondary"
          disabled={downloadSelectedDisabled}
          onClick={() => void downloadSelected()}
        >
          下载选中
        </button>
        <button
          type="button"
          className="image-workbench__button image-workbench__button--secondary"
          disabled={downloadZipDisabled}
          onClick={() => void downloadZip()}
        >
          打包下载 ZIP
        </button>
      </div>
    </section>
  );
}
