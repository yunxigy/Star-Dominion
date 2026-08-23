import { describe, expect, it } from 'vitest';

import {
  detectPlatform,
  errorMessage,
  formatBytes,
  formatDuration,
  initialVideoDownloadState,
  stageLabel,
  videoDownloadReducer,
} from './state';
import type { JobStatusResponse, ParseResponse } from './types';

const parsed: ParseResponse = {
  parseToken: 'signed-token',
  expiresAt: '2026-08-24T00:00:00Z',
  video: {
    platform: 'bilibili',
    id: 'BV1demo',
    title: '演示视频',
    author: '演示作者',
    thumbnailUrl: null,
    durationSeconds: 125,
    qualities: [{
      id: 'q_12345678',
      label: '720P',
      height: 720,
      extension: 'mp4',
      estimatedBytes: 1_048_576,
      requiresMerge: false,
      hasAudio: true,
    }],
  },
};

const downloadingJob: JobStatusResponse = {
  jobId: 'a'.repeat(32),
  status: 'downloading',
  stage: 'downloading',
  progress: 42,
  downloadedBytes: 420,
  totalBytes: 1000,
  speedBytesPerSecond: 20,
  error: null,
};

describe('video downloader presentation helpers', () => {
  it('detects supported platforms in shared text', () => {
    expect(detectPlatform('复制 https://v.douyin.com/abc')).toBe('douyin');
    expect(detectPlatform('https://www.bilibili.com/video/BV1')).toBe('bilibili');
    expect(detectPlatform('https://example.com/video')).toBeNull();
  });

  it('formats byte counts and durations without misleading precision', () => {
    expect(formatBytes(null)).toBe('大小未知');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1_048_576)).toBe('1 MB');
    expect(formatDuration(0)).toBe('00:00');
    expect(formatDuration(65)).toBe('01:05');
    expect(formatDuration(3661)).toBe('1:01:01');
  });

  it('uses stable Chinese labels for every job stage', () => {
    expect(stageLabel('queued')).toBe('正在排队');
    expect(stageLabel('extracting')).toBe('正在准备下载');
    expect(stageLabel('downloading')).toBe('正在下载视频');
    expect(stageLabel('merging')).toBe('正在合并音视频');
    expect(stageLabel('completed')).toBe('下载准备完成');
    expect(stageLabel('failed')).toBe('下载失败');
    expect(stageLabel('cancelled')).toBe('已取消下载');
    expect(stageLabel('expired')).toBe('下载已过期');
  });

  it('maps known server errors to safe site copy', () => {
    expect(errorMessage({ code: 'COOKIE_REQUIRED', message: '', retryable: true }))
      .toContain('服务器解析凭据');
    expect(errorMessage({ code: 'RATE_LIMITED', message: '<b>unsafe</b>', retryable: true }))
      .not.toContain('<b>');
    expect(errorMessage({ code: 'UNKNOWN', message: '<script>alert(1)</script>', retryable: false }))
      .toBe('处理失败，请稍后重试。');
  });
});

describe('video download reducer', () => {
  it('clears stale parse data when parsing begins or fails', () => {
    const ready = videoDownloadReducer(initialVideoDownloadState, {
      type: 'parseSucceeded',
      payload: parsed,
    });

    const parsing = videoDownloadReducer(ready, { type: 'parseStarted' });
    expect(parsing).toMatchObject({ phase: 'parsing', parseToken: null, video: null, job: null });

    const failed = videoDownloadReducer(ready, {
      type: 'parseFailed',
      error: { code: 'INVALID_URL', message: '', retryable: false },
    });
    expect(failed).toMatchObject({ phase: 'error', parseToken: null, video: null, job: null });
  });

  it('stores parsed metadata and defaults to the first quality', () => {
    const state = videoDownloadReducer(initialVideoDownloadState, {
      type: 'parseSucceeded',
      payload: parsed,
    });

    expect(state).toMatchObject({
      phase: 'ready',
      parseToken: 'signed-token',
      video: parsed.video,
      selectedQualityId: 'q_12345678',
      error: null,
    });
  });

  it('tracks job creation and progress', () => {
    const ready = videoDownloadReducer(initialVideoDownloadState, {
      type: 'parseSucceeded',
      payload: parsed,
    });
    const queued = videoDownloadReducer(ready, {
      type: 'jobCreated',
      jobId: downloadingJob.jobId,
    });
    const downloading = videoDownloadReducer(queued, {
      type: 'jobUpdated',
      payload: downloadingJob,
    });

    expect(queued).toMatchObject({ phase: 'downloading', jobId: downloadingJob.jobId });
    expect(downloading).toMatchObject({ phase: 'downloading', job: downloadingJob });

    const completed = videoDownloadReducer(downloading, {
      type: 'jobUpdated',
      payload: { ...downloadingJob, status: 'completed', stage: 'completed', progress: 100 },
    });
    expect(completed.phase).toBe('completed');
  });

  it('keeps parsed video after a job failure so the user can retry', () => {
    const ready = videoDownloadReducer(initialVideoDownloadState, {
      type: 'parseSucceeded',
      payload: parsed,
    });
    const failed = videoDownloadReducer(ready, {
      type: 'jobFailed',
      error: { code: 'DOWNLOAD_FAILED', message: '', retryable: true },
    });

    expect(failed.phase).toBe('ready');
    expect(failed.video).toEqual(parsed.video);
    expect(failed.parseToken).toBe('signed-token');
    expect(failed.error?.code).toBe('DOWNLOAD_FAILED');
  });

  it('resets the complete flow', () => {
    const ready = videoDownloadReducer(initialVideoDownloadState, {
      type: 'parseSucceeded',
      payload: parsed,
    });

    expect(videoDownloadReducer(ready, { type: 'reset' })).toEqual(initialVideoDownloadState);
  });
});
