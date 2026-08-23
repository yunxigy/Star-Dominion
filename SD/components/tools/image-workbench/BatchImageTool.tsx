import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { downloadOutput, downloadOutputsAsZip } from './download';
import { ImageActionBar } from './ImageActionBar';
import { ImageBatchQueue } from './ImageBatchQueue';
import { ImageDropzone } from './ImageDropzone';
import { ImageParameterPanel } from './ImageParameterPanel';
import { ImagePreviewPane } from './ImagePreviewPane';
import { ImageWorkbench } from './ImageWorkbench';
import type { ImageProcessor, OutputAsset } from './types';
import { useImageBatch } from './useImageBatch';

export interface BatchImageToolControlContext<P> {
  selectedParams: P;
  setSelectedParams(params: P): void;
  applyParamsToAll(params: P): void;
}

export interface BatchImageToolProps<P> {
  processor: ImageProcessor<P>;
  parameterTitle: ReactNode;
  parameterDescription?: ReactNode;
  renderControls(context: BatchImageToolControlContext<P>): ReactNode;
  notice?: ReactNode;
  zipFilename?: string;
  maxFileSizeBytes?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 ** 2)} MB`;
}

function formatOperationError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return '操作失败，请重试。';
}

function getStatus<P>(
  items: ReturnType<typeof useImageBatch<P>>['items'],
  isProcessing: boolean,
  outputCount: number,
): string {
  if (isProcessing) return '正在处理图片，请稍候…';
  if (items.length === 0) return '尚未添加图片';

  const failedCount = items.filter((item) => item.status === 'error').length;
  if (failedCount > 0) return `${failedCount} 张图片处理失败，可在队列中重试`;

  const doneCount = items.filter((item) => item.status === 'done').length;
  if (doneCount > 0) {
    return `已完成 ${doneCount}/${items.length} 张，共生成 ${outputCount} 个结果`;
  }
  return `已添加 ${items.length} 张图片，等待处理`;
}

export function BatchImageTool<P>({
  processor,
  parameterTitle,
  parameterDescription,
  renderControls,
  notice,
  zipFilename = 'processed-images.zip',
  maxFileSizeBytes,
}: BatchImageToolProps<P>) {
  const batch = useImageBatch(processor);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [selectedOutputIds, setSelectedOutputIds] = useState<
    Record<string, string>
  >({});

  const selectedParams = batch.selected?.params ?? processor.defaultParams;
  const selectedOutputs = batch.selected?.outputs ?? [];
  const rememberedOutputId = batch.selected
    ? selectedOutputIds[batch.selected.id]
    : undefined;
  const selectedOutput = selectedOutputs.find(
    (output) => output.id === rememberedOutputId,
  ) ?? selectedOutputs[0] ?? null;

  const controlContext = useMemo<BatchImageToolControlContext<P>>(() => ({
    selectedParams,
    setSelectedParams: batch.setSelectedParams,
    applyParamsToAll: batch.applyParamsToAll,
  }), [
    batch.applyParamsToAll,
    batch.setSelectedParams,
    selectedParams,
  ]);

  const addFiles = async (files: readonly File[]): Promise<void> => {
    setOperationError(null);
    const withinSizeLimit = maxFileSizeBytes === undefined
      ? files
      : files.filter((file) => file.size <= maxFileSizeBytes);
    const oversized = maxFileSizeBytes === undefined
      ? []
      : files.filter((file) => file.size > maxFileSizeBytes);
    const remainingSlots = processor.maxFiles === undefined
      ? withinSizeLimit.length
      : Math.max(0, processor.maxFiles - batch.items.length);
    const accepted = withinSizeLimit.slice(0, remainingSlots);
    const overLimit = withinSizeLimit.slice(remainingSlots);
    const uploadErrors: string[] = [];

    if (oversized.length > 0 && maxFileSizeBytes !== undefined) {
      uploadErrors.push(
        `${oversized.map((file) => file.name).join('、')} 超过单张 ${formatFileSize(maxFileSizeBytes)} 的限制，已跳过。`,
      );
    }
    if (overLimit.length > 0 && processor.maxFiles !== undefined) {
      uploadErrors.push(
        `${overLimit.map((file) => file.name).join('、')} 未加入：队列最多 ${processor.maxFiles} 张。`,
      );
    }
    setUploadError(uploadErrors.length > 0 ? uploadErrors.join(' ') : null);

    if (accepted.length === 0) return;

    try {
      await batch.addFiles(accepted);
    } catch (error) {
      setUploadError(formatOperationError(error));
    }
  };

  const removeItem = (id: string): void => {
    batch.removeItem(id);
    setSelectedOutputIds((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const selectOutput = (id: string): void => {
    if (!batch.selected) return;
    setSelectedOutputIds((current) => ({
      ...current,
      [batch.selected!.id]: id,
    }));
  };

  const run = async (operation: () => Promise<void>): Promise<void> => {
    setOperationError(null);
    try {
      await operation();
    } catch (error) {
      setOperationError(formatOperationError(error));
    }
  };

  const retryItem = async (id: string): Promise<void> => {
    await run(() => batch.retryItem(id));
  };

  const reset = (): void => {
    batch.reset();
    setUploadError(null);
    setOperationError(null);
    setSelectedOutputIds({});
  };

  const downloadSelected = (): void => {
    if (!selectedOutput) return;
    setOperationError(null);
    try {
      downloadOutput(selectedOutput);
    } catch (error) {
      setOperationError(formatOperationError(error));
    }
  };

  const downloadZip = async (): Promise<void> => {
    if (batch.allOutputs.length === 0) return;
    setOperationError(null);
    try {
      await downloadOutputsAsZip(batch.allOutputs, zipFilename);
    } catch (error) {
      setOperationError(formatOperationError(error));
    }
  };

  const previewOutputs = selectedOutputs.map((output) => ({
    id: output.id,
    src: output.url,
    name: output.name,
    alt: `${output.name} 处理结果预览`,
  }));
  const maxFilesReached = processor.maxFiles !== undefined
    && batch.items.length >= processor.maxFiles;
  const actionError = operationError ?? batch.selected?.error ?? uploadError;
  const status = getStatus(batch.items, batch.isProcessing, batch.allOutputs.length);

  return (
    <ImageWorkbench
      upload={(
        <ImageDropzone
          accept={processor.accept}
          disabled={maxFilesReached}
          maxFiles={processor.maxFiles}
          maxFileSizeBytes={maxFileSizeBytes}
          multiple={processor.maxFiles !== 1}
          onFiles={addFiles}
          error={uploadError ?? undefined}
        />
      )}
      queue={(
        <ImageBatchQueue
          items={batch.items}
          selectedId={batch.selected?.id ?? null}
          select={batch.selectItem}
          remove={removeItem}
          retry={retryItem}
        />
      )}
      controls={(
        <ImageParameterPanel
          title={parameterTitle}
          description={parameterDescription}
          applyAll={() => batch.applyParamsToAll(selectedParams)}
          applyAllDisabled={batch.items.length < 2 || batch.isProcessing}
        >
          {renderControls(controlContext)}
        </ImageParameterPanel>
      )}
      preview={(
        <ImagePreviewPane
          source={batch.selected ? {
            id: batch.selected.id,
            src: batch.selected.sourceUrl,
            name: batch.selected.file.name,
            alt: `${batch.selected.file.name} 原图预览`,
          } : undefined}
          outputs={previewOutputs}
          selectedOutputId={selectedOutput?.id ?? null}
          selectOutput={selectOutput}
        />
      )}
      actions={(
        <ImageActionBar
          status={status}
          error={actionError ?? undefined}
          reset={reset}
          processSelected={() => run(batch.processSelected)}
          processAll={() => run(batch.processAll)}
          downloadSelected={downloadSelected}
          downloadZip={downloadZip}
          resetDisabled={batch.items.length === 0 && !uploadError}
          processSelectedDisabled={!batch.selected || batch.isProcessing}
          processAllDisabled={batch.items.length === 0 || batch.isProcessing}
          downloadSelectedDisabled={!selectedOutput || batch.isProcessing}
          downloadZipDisabled={batch.allOutputs.length === 0 || batch.isProcessing}
        />
      )}
      notice={notice}
    />
  );
}

export type { OutputAsset };
