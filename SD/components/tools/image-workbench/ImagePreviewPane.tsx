export interface ImagePreviewAsset {
  id: string;
  src: string;
  name: string;
  alt: string;
  metrics?: readonly { label: string; value: string }[];
}

export interface ImagePreviewPaneProps {
  source?: ImagePreviewAsset;
  outputs?: readonly ImagePreviewAsset[];
  selectedOutputId?: string | null;
  selectOutput?(id: string): void;
}

export function ImagePreviewPane({
  source,
  outputs = [],
  selectedOutputId,
  selectOutput,
}: ImagePreviewPaneProps) {
  const selectedOutput = outputs.find((output) => output.id === selectedOutputId)
    ?? outputs[0];

  if (!source && !selectedOutput) {
    return (
      <section className="image-workbench__preview-pane" aria-label="图片预览">
        <p className="image-workbench__preview-empty">
          上传图片后可在这里查看预览
        </p>
      </section>
    );
  }

  return (
    <section className="image-workbench__preview-pane" aria-label="图片预览">
      <div className="image-workbench__preview-comparison">
        <figure className="image-workbench__preview-card">
          <figcaption className="image-workbench__preview-title">原图</figcaption>
          {source ? (
            <img
              className="image-workbench__preview-image"
              src={source.src}
              alt={source.alt}
            />
          ) : (
            <p className="image-workbench__preview-empty">暂无原图预览</p>
          )}
          {source ? (
            <span className="image-workbench__preview-name">{source.name}</span>
          ) : null}
        </figure>

        <figure className="image-workbench__preview-card">
          <figcaption className="image-workbench__preview-title">处理结果</figcaption>
          {selectedOutput ? (
            <img
              className="image-workbench__preview-image"
              src={selectedOutput.src}
              alt={selectedOutput.alt}
            />
          ) : (
            <p className="image-workbench__preview-empty">
              处理后结果会显示在这里
            </p>
          )}
          {selectedOutput ? (
            <span className="image-workbench__preview-name">{selectedOutput.name}</span>
          ) : null}
          {selectedOutput?.metrics?.length ? (
            <dl className="image-workbench__preview-metrics">
              {selectedOutput.metrics.map((metric) => (
                <div key={`${metric.label}-${metric.value}`}>
                  <dt>{metric.label}</dt>
                  <dd>{metric.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </figure>
      </div>

      {outputs.length > 0 ? (
        <div className="image-workbench__output-list" aria-label="处理结果列表">
          {outputs.map((output) => {
            const selected = output.id === selectedOutput?.id;
            return (
              <button
                key={output.id}
                type="button"
                className={`image-workbench__output-option${selected ? ' image-workbench__output-option--selected' : ''}`}
                aria-label={`选择输出 ${output.name}`}
                aria-pressed={selected}
                onClick={() => selectOutput?.(output.id)}
              >
                <img
                  className="image-workbench__output-thumbnail"
                  src={output.src}
                  alt=""
                />
                <span className="image-workbench__output-name">{output.name}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
