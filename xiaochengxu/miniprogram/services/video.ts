import { buildApiUrl, HttpRequestError, requestJson, validatePublicUrl } from './http';

export type VideoPlatform = 'douyin' | 'bilibili';
export type VideoJobStage = 'queued' | 'extracting' | 'downloading' | 'merging' | 'completed' | 'failed' | 'cancelled' | 'expired';

export interface VideoErrorBody {
  code: string;
  message: string;
  retryable: boolean;
}

export interface VideoQuality {
  id: string;
  label: string;
  height: number;
  extension: string;
  estimatedBytes: number | null;
  requiresMerge: boolean;
  hasAudio: boolean;
}

export interface ParsedVideo {
  platform: VideoPlatform;
  id: string;
  title: string;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number;
  qualities: VideoQuality[];
}

export interface VideoParseResponse {
  parseToken: string;
  expiresAt: string;
  video: ParsedVideo;
}

export interface VideoCreateDownloadResponse {
  jobId: string;
  status: 'queued';
}

export interface VideoJobResponse {
  jobId: string;
  status: VideoJobStage;
  stage: VideoJobStage;
  progress: number;
  downloadedBytes: number;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  error: VideoErrorBody | null;
}

export interface VideoHealthResponse {
  status: 'ok' | 'degraded';
  capabilities?: { ytDlp?: boolean; ffmpeg?: boolean; douyinCookie?: string };
}

export class VideoServiceError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(error: VideoErrorBody, status: number) {
    super(error.message);
    this.name = 'VideoServiceError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.status = status;
  }
}

const API_ROOT = '/video-api';
const API_BASE = `${API_ROOT}/api/v1`;
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/u;

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_URL: '请输入有效的抖音或 B 站公开视频链接。',
  UNSUPPORTED_PLATFORM: '目前仅支持抖音和哔哩哔哩公开视频。',
  MULTIPLE_URLS_NOT_SUPPORTED: '一次只能解析一个链接。',
  PLAYLIST_NOT_SUPPORTED: '暂不支持合集、播放列表或多 P 视频。',
  PRIVATE_OR_UNAVAILABLE: '视频不可访问，可能已删除、设为私密或需要登录。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
  QUEUE_FULL: '当前下载任务较多，请稍后重试。',
  DEPENDENCY_UNAVAILABLE: '视频服务暂时不可用，请稍后重试。',
  MERGE_FAILED: '音视频合并失败，请尝试其他清晰度。',
  DOWNLOAD_FAILED: '视频下载失败，请稍后重试。',
  JOB_NOT_FOUND: '任务编号无效或下载任务已过期。',
  JOB_EXPIRED: '下载任务已过期，请重新解析。',
};

export function detectVideoPlatform(value: string): VideoPlatform | null {
  const normalized = value.toLocaleLowerCase();
  if (/(?:^|[\s/])(?:v\.)?douyin\.com(?:[\s/:]|$)/u.test(normalized)) return 'douyin';
  if (/(?:^|[\s/])(?:www\.)?bilibili\.com(?:[\s/:]|$)/u.test(normalized) || /(?:^|[\s/])b23\.tv(?:[\s/:]|$)/u.test(normalized)) return 'bilibili';
  return null;
}

function assertVideoUrl(value: string): string {
  const result = validatePublicUrl(value);
  if (!result.ok || !/^https?:/iu.test(result.value) || !detectVideoPlatform(result.value)) throw new VideoServiceError({ code: 'INVALID_URL', message: ERROR_MESSAGES.INVALID_URL, retryable: false }, 400);
  return result.value;
}

function videoErrorFrom(error: unknown): VideoServiceError {
  if (error instanceof VideoServiceError) return error;
  if (error instanceof HttpRequestError) {
    const body = error.body as { error?: Partial<VideoErrorBody> } | null;
    if (body?.error && typeof body.error.code === 'string') {
      return new VideoServiceError({
        code: body.error.code,
        message: typeof body.error.message === 'string' ? body.error.message : ERROR_MESSAGES[body.error.code] ?? '视频服务请求失败。',
        retryable: Boolean(body.error.retryable),
      }, error.status);
    }
    return new VideoServiceError({ code: 'DEPENDENCY_UNAVAILABLE', message: ERROR_MESSAGES.DEPENDENCY_UNAVAILABLE, retryable: true }, error.status);
  }
  return new VideoServiceError({ code: 'DEPENDENCY_UNAVAILABLE', message: ERROR_MESSAGES.DEPENDENCY_UNAVAILABLE, retryable: true }, 0);
}

export function videoErrorMessage(error: unknown): string {
  const failure = videoErrorFrom(error);
  return (ERROR_MESSAGES[failure.code] ?? failure.message) || '视频处理失败，请稍后重试。';
}

export function getVideoHealth(): Promise<VideoHealthResponse> {
  return requestJson<VideoHealthResponse>(`${API_ROOT}/health`).catch((error: unknown) => {
    throw videoErrorFrom(error);
  });
}

export function parseVideo(value: string): Promise<VideoParseResponse> {
  const url = assertVideoUrl(value);
  return requestJson<VideoParseResponse>(`${API_BASE}/parse`, { method: 'POST', data: { url } }).catch((error: unknown) => {
    throw videoErrorFrom(error);
  });
}

export function createVideoDownload(parseToken: string, qualityId: string): Promise<VideoCreateDownloadResponse> {
  if (!parseToken.trim() || !qualityId.trim()) throw new Error('请选择视频清晰度');
  return requestJson<VideoCreateDownloadResponse>(`${API_BASE}/downloads`, { method: 'POST', data: { parseToken, qualityId } }).catch((error: unknown) => {
    throw videoErrorFrom(error);
  });
}

function requireJobId(jobId: string): string {
  if (!JOB_ID_PATTERN.test(jobId)) throw new VideoServiceError({ code: 'JOB_NOT_FOUND', message: ERROR_MESSAGES.JOB_NOT_FOUND, retryable: false }, 400);
  return jobId;
}

export function getVideoDownload(jobId: string): Promise<VideoJobResponse> {
  return requestJson<VideoJobResponse>(`${API_BASE}/downloads/${requireJobId(jobId)}`).catch((error: unknown) => {
    throw videoErrorFrom(error);
  });
}

export function cancelVideoDownload(jobId: string): Promise<VideoJobResponse> {
  return requestJson<VideoJobResponse>(`${API_BASE}/downloads/${requireJobId(jobId)}`, { method: 'DELETE' }).catch((error: unknown) => {
    throw videoErrorFrom(error);
  });
}

export function videoDownloadFilePath(jobId: string): string {
  return `${API_BASE}/downloads/${requireJobId(jobId)}/file`;
}

export function videoDownloadFileUrl(jobId: string): string {
  return buildApiUrl(videoDownloadFilePath(jobId));
}

export function formatVideoBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${Number(value.toFixed(value >= 10 || index === 0 ? 0 : 1))} ${units[index]}`;
}

export function formatVideoDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = total % 60;
  const minutesText = String(minutes).padStart(2, '0');
  const secondsText = String(remaining).padStart(2, '0');
  return hours > 0 ? `${hours}:${minutesText}:${secondsText}` : `${minutesText}:${secondsText}`;
}

const STAGE_LABELS: Record<VideoJobStage, string> = {
  queued: '正在排队',
  extracting: '正在准备下载',
  downloading: '正在下载视频',
  merging: '正在合并音视频',
  completed: '下载准备完成',
  failed: '下载失败',
  cancelled: '已取消下载',
  expired: '下载已过期',
};

export function stageLabel(stage: VideoJobStage): string {
  return STAGE_LABELS[stage];
}
