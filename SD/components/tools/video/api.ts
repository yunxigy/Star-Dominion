import type {
  CreateDownloadResponse,
  ErrorEnvelope,
  HealthResponse,
  JobStatusResponse,
  ParseResponse,
  VideoApiErrorBody,
} from './types';

const API_ROOT = '/video-api';
const API_BASE = `${API_ROOT}/api/v1`;
const JOB_ID_PATTERN = /^[a-f0-9]{32}$/;

const DEPENDENCY_ERROR: VideoApiErrorBody = {
  code: 'DEPENDENCY_UNAVAILABLE',
  message: '视频服务暂时不可用，请稍后重试。',
  retryable: true,
};

export class VideoApiError extends Error implements VideoApiErrorBody {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(error: VideoApiErrorBody, status: number) {
    super(error.message);
    this.name = 'VideoApiError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.status = status;
  }
}

const isErrorEnvelope = (value: unknown): value is ErrorEnvelope => {
  if (!value || typeof value !== 'object' || !('error' in value)) return false;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return false;
  const body = error as Partial<VideoApiErrorBody>;
  return typeof body.code === 'string'
    && typeof body.message === 'string'
    && typeof body.retryable === 'boolean';
};

const dependencyFailure = (status = 0) => new VideoApiError(DEPENDENCY_ERROR, status);

async function requestJson<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof VideoApiError) throw error;
    throw dependencyFailure();
  }

  if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
    throw dependencyFailure(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw dependencyFailure(response.status);
  }

  if (!response.ok) {
    if (isErrorEnvelope(body)) {
      throw new VideoApiError(body.error, response.status);
    }
    throw dependencyFailure(response.status);
  }

  return body as T;
}

const jsonWrite = (method: 'POST', body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const requireJobId = (jobId: string): string => {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new VideoApiError(
      { code: 'JOB_NOT_FOUND', message: '任务编号无效。', retryable: false },
      400,
    );
  }
  return jobId;
};

export const getHealth = (): Promise<HealthResponse> => requestJson<HealthResponse>(
  `${API_ROOT}/health`,
  { method: 'GET' },
);

export const parseVideo = (url: string): Promise<ParseResponse> => requestJson<ParseResponse>(
  `${API_BASE}/parse`,
  jsonWrite('POST', { url }),
);

export const createDownload = (
  parseToken: string,
  qualityId: string,
): Promise<CreateDownloadResponse> => requestJson<CreateDownloadResponse>(
  `${API_BASE}/downloads`,
  jsonWrite('POST', { parseToken, qualityId }),
);

export const getDownload = (jobId: string): Promise<JobStatusResponse> => requestJson<JobStatusResponse>(
  `${API_BASE}/downloads/${requireJobId(jobId)}`,
  { method: 'GET' },
);

export const cancelDownload = (jobId: string): Promise<JobStatusResponse> => requestJson<JobStatusResponse>(
  `${API_BASE}/downloads/${requireJobId(jobId)}`,
  { method: 'DELETE' },
);

export const downloadFileUrl = (jobId: string): string => (
  `${API_BASE}/downloads/${requireJobId(jobId)}/file`
);
