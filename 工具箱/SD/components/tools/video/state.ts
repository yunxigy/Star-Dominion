import type {
  JobStage,
  JobStatusResponse,
  ParseResponse,
  ParsedVideo,
  Platform,
  VideoApiErrorBody,
} from './types';

export type VideoDownloadPhase = 'idle' | 'parsing' | 'ready' | 'downloading' | 'completed' | 'error';

export interface VideoDownloadState {
  phase: VideoDownloadPhase;
  parseToken: string | null;
  expiresAt: string | null;
  video: ParsedVideo | null;
  selectedQualityId: string | null;
  jobId: string | null;
  job: JobStatusResponse | null;
  error: VideoApiErrorBody | null;
}

export const initialVideoDownloadState: VideoDownloadState = {
  phase: 'idle',
  parseToken: null,
  expiresAt: null,
  video: null,
  selectedQualityId: null,
  jobId: null,
  job: null,
  error: null,
};

export type VideoDownloadAction =
  | { type: 'parseStarted' }
  | { type: 'parseSucceeded'; payload: ParseResponse }
  | { type: 'parseFailed'; error: VideoApiErrorBody }
  | { type: 'qualitySelected'; qualityId: string }
  | { type: 'jobCreated'; jobId: string }
  | { type: 'jobUpdated'; payload: JobStatusResponse }
  | { type: 'jobFailed'; error: VideoApiErrorBody }
  | { type: 'reset' };

const phaseForJob = (stage: JobStage): VideoDownloadPhase => {
  if (stage === 'completed') return 'completed';
  if (stage === 'failed' || stage === 'cancelled' || stage === 'expired') return 'ready';
  return 'downloading';
};

export function videoDownloadReducer(
  state: VideoDownloadState,
  action: VideoDownloadAction,
): VideoDownloadState {
  switch (action.type) {
    case 'parseStarted':
      return { ...initialVideoDownloadState, phase: 'parsing' };
    case 'parseSucceeded':
      return {
        ...initialVideoDownloadState,
        phase: 'ready',
        parseToken: action.payload.parseToken,
        expiresAt: action.payload.expiresAt,
        video: action.payload.video,
        selectedQualityId: action.payload.video.qualities[0]?.id ?? null,
      };
    case 'parseFailed':
      return { ...initialVideoDownloadState, phase: 'error', error: action.error };
    case 'qualitySelected':
      if (!state.video?.qualities.some((quality) => quality.id === action.qualityId)) return state;
      return { ...state, selectedQualityId: action.qualityId, error: null };
    case 'jobCreated':
      return {
        ...state,
        phase: 'downloading',
        jobId: action.jobId,
        job: null,
        error: null,
      };
    case 'jobUpdated':
      return {
        ...state,
        phase: phaseForJob(action.payload.stage),
        jobId: action.payload.jobId,
        job: action.payload,
        error: action.payload.error,
      };
    case 'jobFailed':
      return {
        ...state,
        phase: state.video ? 'ready' : 'error',
        jobId: null,
        job: null,
        error: action.error,
      };
    case 'reset':
      return initialVideoDownloadState;
    default:
      return state;
  }
}

export const detectPlatform = (value: string): Platform | null => {
  const normalized = value.toLowerCase();
  if (/(?:^|[\s/])(?:v\.)?douyin\.com(?:[\s/:]|$)/.test(normalized)) return 'douyin';
  if (/(?:^|[\s/])(?:www\.)?bilibili\.com(?:[\s/:]|$)/.test(normalized)
    || /(?:^|[\s/])b23\.tv(?:[\s/:]|$)/.test(normalized)) return 'bilibili';
  return null;
};

export const formatBytes = (bytes: number | null): string => {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return '大小未知';
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${Number(value.toFixed(precision))} ${units[unitIndex]}`;
};

export const formatDuration = (seconds: number): string => {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const minuteText = String(minutes).padStart(2, '0');
  const secondText = String(remainingSeconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${minuteText}:${secondText}` : `${minuteText}:${secondText}`;
};

const STAGE_LABELS: Record<JobStage, string> = {
  queued: '正在排队',
  extracting: '正在准备下载',
  downloading: '正在下载视频',
  merging: '正在合并音视频',
  completed: '下载准备完成',
  failed: '下载失败',
  cancelled: '已取消下载',
  expired: '下载已过期',
};

export const stageLabel = (stage: JobStage): string => STAGE_LABELS[stage];

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_URL: '请输入有效的抖音或 B 站公开视频链接。',
  UNSUPPORTED_PLATFORM: '目前仅支持抖音和哔哩哔哩公开视频。',
  MULTIPLE_URLS_NOT_SUPPORTED: '一次只能解析一个视频链接。',
  PLAYLIST_NOT_SUPPORTED: '暂不支持合集、播放列表或多 P 视频。',
  PRIVATE_OR_UNAVAILABLE: '视频不可访问，可能已删除、设为私密或需要登录。',
  COOKIE_REQUIRED: '抖音解析暂不可用，请联系管理员检查服务器解析凭据。',
  DURATION_LIMIT: '视频时长超过本站允许的范围。',
  FILE_SIZE_LIMIT: '该视频文件过大，请选择较低清晰度。',
  RATE_LIMITED: '请求过于频繁，请稍后再试。',
  QUEUE_FULL: '当前下载任务较多，请稍后重试。',
  EXTRACTOR_TEMPORARILY_UNAVAILABLE: '平台解析暂时不可用，请稍后重试。',
  DEPENDENCY_UNAVAILABLE: '视频服务暂时不可用，请稍后重试。',
  MERGE_FAILED: '音视频合并失败，请尝试其他清晰度。',
  DOWNLOAD_FAILED: '视频下载失败，请稍后重试。',
  JOB_NOT_FOUND: '下载任务不存在或无权访问。',
  JOB_EXPIRED: '下载任务已过期，请重新解析。',
};

export const errorMessage = (error: VideoApiErrorBody): string => (
  ERROR_MESSAGES[error.code] ?? '处理失败，请稍后重试。'
);
