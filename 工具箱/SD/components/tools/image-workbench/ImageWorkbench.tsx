import type { ReactNode } from 'react';

export interface ImageWorkbenchProps {
  upload: ReactNode;
  controls: ReactNode;
  queue?: ReactNode;
  preview: ReactNode;
  actions: ReactNode;
  notice?: ReactNode;
}

export function ImageWorkbench({
  upload,
  controls,
  queue,
  preview,
  actions,
  notice,
}: ImageWorkbenchProps) {
  return (
    <section className="image-workbench" aria-label="图片处理工作台">
      <div className="image-workbench__sidebar">
        <section className="image-workbench__upload" aria-label="图片上传">
          {upload}
        </section>

        {queue !== undefined ? (
          <section className="image-workbench__queue-slot" aria-label="待处理图片">
            {queue}
          </section>
        ) : null}

        <section className="image-workbench__controls" aria-label="图片处理参数">
          {controls}
        </section>
      </div>

      <section className="image-workbench__preview" aria-label="图片预览">
        {preview}
      </section>

      {notice !== undefined ? (
        <div className="image-workbench__notice" aria-live="polite">
          {notice}
        </div>
      ) : null}

      <footer className="image-workbench__actions" aria-live="polite">
        {actions}
      </footer>
    </section>
  );
}
