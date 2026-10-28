export type Platform = 'douyin' | 'bilibili';

export type JobStage =
  | 'queued'
  | 'extracting'
  | 'downloading'
  | 'merging'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type VideoErrorCode =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PLATFORM'
  | 'MULTIPLE_URLS_NOT_SUPPORTED'
  | 'PLAYLIST_NOT_SUPPORTED'
  | 'PRIVATE_OR_UNAVAILABLE'
  | 'COOKIE_REQUIRED'
  | 'DURATION_LIMIT'
  | 'FILE_SIZE_LIMIT'
  | 'RATE_LIMITED'
  | 'QUEUE_FULL'
  | 'EXTRACTOR_TEMPORARILY_UNAVAILABLE'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'MERGE_FAILED'
  | 'DOWNLOAD_FAILED'
  | 'JOB_NOT_FOUND'
  | 'JOB_EXPIRED'
  | (string & {});

export interface VideoApiErrorBody {
  code: VideoErrorCode;
  message: string;
  retryable: boolean;
}

export interface ErrorEnvelope {
  error: VideoApiErrorBody;
}

export interface HealthCapabilities {
  ytDlp: boolean;
  ffmpeg: boolean;
  douyinCookie: 'configured' | 'missing' | 'invalid';
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  capabilities: HealthCapabilities;
}

export interface QualityOption {
  id: string;
  label: string;
  height: number;
  extension: string;
  estimatedBytes: number | null;
  requiresMerge: boolean;
  hasAudio: boolean;
}

export interface ParsedVideo {
  platform: Platform;
  id: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  qualities: QualityOption[];
}

export interface ParseResponse {
  parseToken: string;
  expiresAt: string;
  video: ParsedVideo;
}

export interface CreateDownloadResponse {
  jobId: string;
  status: 'queued';
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStage;
  stage: JobStage;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  error: VideoApiErrorBody | null;
}
