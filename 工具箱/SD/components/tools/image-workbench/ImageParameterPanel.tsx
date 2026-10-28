import { useId } from 'react';
import type { ReactNode } from 'react';

export interface ImageParameterPanelProps {
  title: ReactNode;
  children: ReactNode;
  description?: ReactNode;
  applyAll?: () => void;
  applyAllDisabled?: boolean;
}

export function ImageParameterPanel({
  title,
  children,
  description,
  applyAll,
  applyAllDisabled = false,
}: ImageParameterPanelProps) {
  const generatedId = useId();
  const titleId = `image-workbench-parameters-${generatedId}`;
  const descriptionId = `${titleId}-description`;

  return (
    <section
      className="image-workbench__parameter-panel"
      aria-labelledby={titleId}
      aria-describedby={description !== undefined ? descriptionId : undefined}
    >
      <header className="image-workbench__parameter-header">
        <h2 id={titleId} className="image-workbench__parameter-title">
          {title}
        </h2>
        {applyAll !== undefined ? (
          <button
            className="image-workbench__apply-all"
            type="button"
            disabled={applyAllDisabled}
            onClick={applyAll}
          >
            应用到全部
          </button>
        ) : null}
      </header>

      {description !== undefined ? (
        <p id={descriptionId} className="image-workbench__parameter-description">
          {description}
        </p>
      ) : null}

      <div className="image-workbench__parameter-controls">{children}</div>
    </section>
  );
}
