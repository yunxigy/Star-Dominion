import type { BatchItem, BatchItemStatus } from './types';

const STATUS_LABELS: Record<BatchItemStatus, string> = {
  queued: '等待处理',
  processing: '处理中',
  done: '已完成',
  error: '处理失败',
};

export interface ImageBatchQueueProps<P> {
  items: readonly BatchItem<P>[];
  selectedId: string | null;
  select(id: string): void;
  remove(id: string): void;
  retry(id: string): void | Promise<void>;
  move?(id: string, direction: 'up' | 'down'): void;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 || Number.isInteger(value)
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function ImageBatchQueue<P>({
  items,
  selectedId,
  select,
  remove,
  retry,
  move,
}: ImageBatchQueueProps<P>) {
  return (
    <section className="image-workbench__queue" aria-label="图片队列">
      {items.length === 0 ? (
        <p className="image-workbench__queue-empty">尚未添加图片</p>
      ) : (
        <ul className="image-workbench__queue-list">
          {items.map((item, index) => {
            const selected = item.id === selectedId;
            const bytes = item.metadata?.bytes ?? item.file.size;
            const mime = item.metadata?.mime || item.file.type;
            const format = mime === 'image/png'
              ? 'PNG'
              : mime === 'image/jpeg'
                ? 'JPEG'
                : mime || '未知格式';

            return (
              <li
                key={item.id}
                className={`image-workbench__queue-item${selected ? ' image-workbench__queue-item--selected' : ''}`}
              >
                <button
                  type="button"
                  className="image-workbench__queue-select"
                  aria-label={`选择 ${item.file.name}`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => select(item.id)}
                >
                  <img
                    className="image-workbench__queue-thumbnail"
                    src={item.sourceUrl}
                    alt={`${item.file.name} 缩略图`}
                  />
                  <span className="image-workbench__queue-details">
                    <span className="image-workbench__queue-name">{item.file.name}</span>
                    <span className="image-workbench__queue-metadata">
                      <span>{format}</span>
                      <span>{item.metadata ? `${item.metadata.width} × ${item.metadata.height}` : '尺寸读取中'}</span>
                      <span>{formatBytes(bytes)}</span>
                    </span>
                    <span
                      className={`image-workbench__queue-status image-workbench__queue-status--${item.status}`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                    {item.status === 'processing' ? (
                      <progress
                        className="image-workbench__queue-progress"
                        aria-label={`处理进度 ${item.file.name}`}
                        max={100}
                        value={item.progress}
                      />
                    ) : null}
                  </span>
                </button>

                {item.error ? (
                  <p className="image-workbench__queue-error" role="alert">
                    {item.error}
                  </p>
                ) : null}

                <div className="image-workbench__queue-actions">
                  {move ? (
                    <>
                      <button
                        type="button"
                        className="image-workbench__queue-action"
                        aria-label={`上移 ${item.file.name}`}
                        disabled={index === 0}
                        onClick={() => move(item.id, 'up')}
                      >
                        上移
                      </button>
                      <button
                        type="button"
                        className="image-workbench__queue-action"
                        aria-label={`下移 ${item.file.name}`}
                        disabled={index === items.length - 1}
                        onClick={() => move(item.id, 'down')}
                      >
                        下移
                      </button>
                    </>
                  ) : null}
                  {item.status === 'error' ? (
                    <button
                      type="button"
                      className="image-workbench__queue-action"
                      aria-label={`重试 ${item.file.name}`}
                      onClick={() => void retry(item.id)}
                    >
                      重试
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="image-workbench__queue-action image-workbench__queue-action--remove"
                    aria-label={`移除 ${item.file.name}`}
                    onClick={() => remove(item.id)}
                  >
                    移除
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
