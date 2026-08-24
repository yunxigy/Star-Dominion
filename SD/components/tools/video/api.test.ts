import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  VideoApiError,
  cancelDownload,
  createDownload,
  downloadFileUrl,
  getDownload,
  getHealth,
  parseVideo,
} from './api';

afterEach(() => {
  vi.unstubAllGlobals();
});

const jsonResponse = (body: unknown, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { 'Content-Type': 'application/json' } },
);

describe('video downloader API client', () => {
  it('uses the same-origin private API without exposing direct media URLs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      parseToken: 'signed-token',
      expiresAt: '2026-08-24T00:00:00Z',
      video: {
        platform: 'bilibili',
        id: 'BV1',
        title: '标题',
        author: '作者',
        thumbnailUrl: null,
        durationSeconds: 10,
        qualities: [{
          id: 'q_12345678',
          label: '720P',
          height: 720,
          extension: 'mp4',
          estimatedBytes: null,
          requiresMerge: false,
          hasAudio: true,
        }],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await parseVideo('https://b23.tv/demo');

    expect(result.video.title).toBe('标题');
    expect(fetchMock).toHaveBeenCalledWith('/video-api/api/v1/parse', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ url: 'https://b23.tv/demo' }),
      headers: expect.objectContaining({
        Accept: 'application/json',
        'Content-Type': 'application/json',
      }),
    }));
    expect(JSON.stringify(result)).not.toContain('http');
  });

  it('raises a typed error from the stable backend envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      error: { code: 'RATE_LIMITED', message: '请求过于频繁', retryable: true },
    }, 429)));

    await expect(createDownload('token', 'q_12345678')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
      status: 429,
    });
  });

  it('requests health outside the versioned API prefix', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      status: 'ok',
      capabilities: { ytDlp: true, ffmpeg: true, douyinCookie: 'configured' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await getHealth();

    expect(fetchMock).toHaveBeenCalledWith('/video-api/health', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('creates and polls a job without putting the parse token in the URL', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ jobId: 'a'.repeat(32), status: 'queued' }, 202))
      .mockResolvedValueOnce(jsonResponse({
        jobId: 'a'.repeat(32),
        status: 'downloading',
        stage: 'downloading',
        progress: 42,
        downloadedBytes: 420,
        totalBytes: 1000,
        speedBytesPerSecond: 20,
        error: null,
      }));
    vi.stubGlobal('fetch', fetchMock);

    await createDownload('private-signed-token', 'q_12345678');
    await getDownload('a'.repeat(32));

    const [createUrl, createInit] = fetchMock.mock.calls[0];
    expect(createUrl).toBe('/video-api/api/v1/downloads');
    expect(createUrl).not.toContain('private-signed-token');
    expect(createInit).toEqual(expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ parseToken: 'private-signed-token', qualityId: 'q_12345678' }),
    }));
    expect(fetchMock.mock.calls[1]).toEqual([
      `/video-api/api/v1/downloads/${'a'.repeat(32)}`,
      expect.objectContaining({ method: 'GET' }),
    ]);
  });

  it('cancels a job with DELETE', async () => {
    const jobId = 'b'.repeat(32);
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      jobId,
      status: 'cancelled',
      stage: 'cancelled',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: null,
      speedBytesPerSecond: null,
      error: null,
    }));
    vi.stubGlobal('fetch', fetchMock);

    await cancelDownload(jobId);

    expect(fetchMock).toHaveBeenCalledWith(
      `/video-api/api/v1/downloads/${jobId}`,
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('builds a same-origin file URL only for a valid opaque job id', () => {
    const jobId = '0123456789abcdef0123456789abcdef';

    expect(downloadFileUrl(jobId)).toBe(`/video-api/api/v1/downloads/${jobId}/file`);
    expect(() => downloadFileUrl('../secrets')).toThrow(VideoApiError);
    expect(() => downloadFileUrl('not-a-job-id')).toThrow(/任务编号/);
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('offline'))],
    ['a non-JSON response', () => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 }))],
  ])('normalizes %s to a dependency error', async (_label, responseFactory) => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(responseFactory));

    await expect(getHealth()).rejects.toMatchObject({
      code: 'DEPENDENCY_UNAVAILABLE',
      retryable: true,
    });
  });

  it('preserves AbortError so component cleanup cannot overwrite fresh health state', async () => {
    const aborted = new DOMException('cancelled', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(aborted));

    await expect(getHealth(new AbortController().signal)).rejects.toBe(aborted);
  });
});
