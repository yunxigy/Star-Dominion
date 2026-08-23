export type BatchItemStatus = 'queued' | 'processing' | 'done' | 'error';
export type ProcessorMode = 'per-file' | 'group';

export interface ImageMetadata {
  width: number;
  height: number;
  mime: string;
  bytes: number;
}

export interface ProcessedAsset {
  name: string;
  blob: Blob;
  width?: number;
  height?: number;
  metrics?: readonly AssetMetric[];
}

export interface AssetMetric {
  label: string;
  value: string;
}

export interface OutputAsset extends ProcessedAsset {
  id: string;
  url: string;
}

export interface BatchItem<P> {
  id: string;
  file: File;
  sourceUrl: string;
  metadata: ImageMetadata | null;
  params: P;
  status: BatchItemStatus;
  progress: number;
  outputs: OutputAsset[];
  error: string | null;
  stale: boolean;
}

export interface ProcessorContext {
  preview: boolean;
  signal: AbortSignal;
}

export interface ImageProcessor<P> {
  accept: string;
  mode: ProcessorMode;
  defaultParams: P;
  maxFiles?: number;
  concurrency?: number;
  process(
    files: readonly File[],
    params: P,
    context: ProcessorContext,
  ): Promise<ProcessedAsset[]>;
}

export interface ImageQueueState<P> {
  items: BatchItem<P>[];
  selectedId: string | null;
}
