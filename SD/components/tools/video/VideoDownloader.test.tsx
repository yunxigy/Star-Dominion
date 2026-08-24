// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VideoDownloader from './VideoDownloader';
import type { JobStatusResponse, ParseResponse } from './types';

const apiMocks = vi.hoisted(() => ({
  getHealth: vi.fn(),
  parseVideo: vi.fn(),
  createDownload: vi.fn(),
  getDownload: vi.fn(),
  cancelDownload: vi.fn(),
}));

vi.mock('./api', () => ({
  ...apiMocks,
  downloadFileUrl: (jobId: string) => `/video-api/api/v1/downloads/${jobId}/file`,
}));

const jobId = 'a'.repeat(32);

const parsedVideo: ParseResponse = {
  parseToken: 'signed-token',
  expiresAt: '2026-08-24T00:00:00Z',
  video: {
    platform: 'bilibili',
    id: 'BV1demo',
    title: '演示视频标题',
    author: '演示作者',
    thumbnailUrl: 'https://i0.hdslb.com/demo.jpg',
    durationSeconds: 125,
    qualities: [
      {
        id: 'q_72000000',
        label: '720P',
        height: 720,
        extension: 'mp4',
        estimatedBytes: null,
        requiresMerge: false,
        hasAudio: true,
      },
      {
        id: 'q_10800000',
        label: '1080P',
        height: 1080,
        extension: 'mp4',
        estimatedBytes: 10_485_760,
        requiresMerge: true,
        hasAudio: false,
      },
    ],
  },
};

const job = (stage: JobStatusResponse['stage'], progress: number): JobStatusResponse => ({
  jobId,
  status: stage,
  stage,
  progress,
  downloadedBytes: progress * 1024,
  totalBytes: 102_400,
  speedBytesPerSecond: stage === 'downloading' ? 2048 : null,
  error: null,
});

beforeEach(() => {
  apiMocks.getHealth.mockReset().mockResolvedValue({
    status: 'ok',
    capabilities: { ytDlp: true, ffmpeg: true, douyinCookie: 'configured' },
  });
  apiMocks.parseVideo.mockReset().mockResolvedValue(parsedVideo);
  apiMocks.createDownload.mockReset().mockResolvedValue({ jobId, status: 'queued' });
  apiMocks.getDownload.mockReset().mockResolvedValue(job('queued', 0));
  apiMocks.cancelDownload.mockReset().mockResolvedValue(job('cancelled', 0));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('VideoDownloader', () => {
  it('renders the approved initial hierarchy and compliance boundary', () => {
    render(<VideoDownloader onClose={() => undefined} />);

    expect(screen.getByRole('heading', { name: '视频解析下载', level: 2 })).toBeTruthy();
    expect(screen.getByLabelText('抖音或 B 站视频链接')).toBeTruthy();
    expect(screen.getByRole('button', { name: '粘贴' })).toBeTruthy();
    const parseButton = screen.getByRole('button', { name: '解析视频' });
    expect(parseButton).toBeTruthy();
    expect(parseButton.className).toContain('text-[#fff8ef]');
    expect(parseButton.className).toContain('whitespace-nowrap');
    expect(screen.getByText('无需登录')).toBeTruthy();
    expect(screen.getByText('实际清晰度')).toBeTruthy();
    expect(screen.getByText('临时处理')).toBeTruthy();
    expect(screen.getByText('快速下载')).toBeTruthy();
    expect(screen.getByText('复制视频链接')).toBeTruthy();
    expect(screen.getByText('粘贴并解析')).toBeTruthy();
    expect(screen.getByText('选择清晰度下载')).toBeTruthy();
    expect(screen.getByText(/仅下载你拥有权利或已获授权的公开视频/)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  });

  it('rejects an empty submission without calling the API', async () => {
    const user = userEvent.setup();
    render(<VideoDownloader onClose={() => undefined} />);

    await user.click(screen.getByRole('button', { name: '解析视频' }));

    expect(apiMocks.parseVideo).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('请输入');
    expect(document.activeElement).toBe(screen.getByLabelText('抖音或 B 站视频链接'));
  });

  it('submits with Enter, disables parsing, then renders real video metadata and qualities', async () => {
    let resolveParse: (value: ParseResponse) => void = () => undefined;
    apiMocks.parseVideo.mockReturnValue(new Promise((resolve) => { resolveParse = resolve; }));
    const user = userEvent.setup();
    render(<VideoDownloader onClose={() => undefined} />);

    const input = screen.getByLabelText('抖音或 B 站视频链接');
    await user.type(input, 'https://www.bilibili.com/video/BV1demo{Enter}');

    expect(apiMocks.parseVideo).toHaveBeenCalledWith(
      'https://www.bilibili.com/video/BV1demo',
      expect.any(AbortSignal),
    );
    expect((screen.getByRole('button', { name: '正在解析' }) as HTMLButtonElement).disabled).toBe(true);

    resolveParse(parsedVideo);

    expect(await screen.findByRole('heading', { name: '演示视频标题' })).toBeTruthy();
    expect(screen.getByText('演示作者')).toBeTruthy();
    expect(screen.getByText('02:05')).toBeTruthy();
    expect(screen.getByRole('img', { name: '演示视频标题的视频封面' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /720P · MP4 · 大小未知/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /1080P · MP4 · 10 MB/ })).toBeTruthy();
    expect(screen.getByText('需要合并音视频')).toBeTruthy();
    expect(screen.getByText('该源不含音频')).toBeTruthy();
    expect(screen.queryByText('复制视频链接')).toBeNull();
  });

  it('disables unavailable parsing and merge-only qualities from health capabilities', async () => {
    apiMocks.getHealth.mockResolvedValueOnce({
      status: 'degraded',
      capabilities: { ytDlp: false, ffmpeg: false, douyinCookie: 'missing' },
    });
    const { unmount } = render(<VideoDownloader onClose={() => undefined} />);

    await waitFor(() => expect(
      (screen.getByRole('button', { name: '解析服务暂不可用' }) as HTMLButtonElement).disabled,
    ).toBe(true));
    unmount();

    apiMocks.getHealth.mockResolvedValueOnce({
      status: 'degraded',
      capabilities: { ytDlp: true, ffmpeg: false, douyinCookie: 'configured' },
    });
    render(<VideoDownloader onClose={() => undefined} />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('抖音或 B 站视频链接'), 'https://b23.tv/demo');
    await user.click(screen.getByRole('button', { name: '解析视频' }));

    const mergeQuality = await screen.findByRole('button', { name: /1080P · MP4 · 10 MB/ });
    expect((mergeQuality as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /720P · MP4 · 大小未知/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('polls a created job through each server stage and exposes a same-origin download link', async () => {
    apiMocks.getDownload
      .mockResolvedValueOnce(job('queued', 0))
      .mockResolvedValueOnce(job('extracting', 5))
      .mockResolvedValueOnce(job('downloading', 48))
      .mockResolvedValueOnce(job('merging', 92))
      .mockResolvedValueOnce(job('completed', 100));
    const user = userEvent.setup();
    render(<VideoDownloader onClose={() => undefined} />);

    await user.type(screen.getByLabelText('抖音或 B 站视频链接'), 'https://b23.tv/demo');
    await user.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByRole('heading', { name: '演示视频标题' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getAllByText('正在排队').length).toBeGreaterThan(0);
    for (const label of ['正在准备下载', '正在下载视频', '正在合并音视频', '下载准备完成']) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }

    const link = screen.getByRole('link', { name: '保存视频' });
    expect(link.getAttribute('href')).toBe(`/video-api/api/v1/downloads/${jobId}/file`);
    expect(link.hasAttribute('download')).toBe(true);
  });

  it('cancels a running job and keeps the parsed result available', async () => {
    const user = userEvent.setup();
    render(<VideoDownloader onClose={() => undefined} />);

    await user.type(screen.getByLabelText('抖音或 B 站视频链接'), 'https://b23.tv/demo');
    await user.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByRole('heading', { name: '演示视频标题' });
    await user.click(screen.getByRole('button', { name: '开始下载' }));
    await waitFor(() => expect(screen.getAllByText('正在排队').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: '取消下载' }));

    expect(apiMocks.cancelDownload).toHaveBeenCalledWith(jobId, expect.any(AbortSignal));
    await waitFor(() => expect(screen.getAllByText('已取消下载').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: '演示视频标题' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '开始下载' })).toBeTruthy();
  });

  it('aborts active requests and clears the polling timeout when unmounted', async () => {
    let pollSignal: AbortSignal | undefined;
    apiMocks.getDownload.mockImplementation(async (_id: string, signal?: AbortSignal) => {
      pollSignal = signal;
      return job('queued', 0);
    });
    const user = userEvent.setup();
    const view = render(<VideoDownloader onClose={() => undefined} />);

    await user.type(screen.getByLabelText('抖音或 B 站视频链接'), 'https://b23.tv/demo');
    await user.click(screen.getByRole('button', { name: '解析视频' }));
    await screen.findByRole('heading', { name: '演示视频标题' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: '开始下载' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(apiMocks.getDownload).toHaveBeenCalledTimes(1);

    view.unmount();
    expect(pollSignal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(apiMocks.getDownload).toHaveBeenCalledTimes(1);
  });

  it('reads the clipboard and keeps existing input when clipboard permission is denied', async () => {
    const user = userEvent.setup();
    const readText = vi.spyOn(navigator.clipboard, 'readText');
    readText.mockResolvedValueOnce('https://v.douyin.com/demo');
    render(<VideoDownloader onClose={() => undefined} />);

    const input = screen.getByLabelText('抖音或 B 站视频链接');
    await user.click(screen.getByRole('button', { name: '粘贴' }));
    expect((input as HTMLInputElement).value).toBe('https://v.douyin.com/demo');

    await user.clear(input);
    await user.type(input, '已有内容');
    readText.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    await user.click(screen.getByRole('button', { name: '粘贴' }));

    expect((input as HTMLInputElement).value).toBe('已有内容');
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole('alert').textContent).toContain('请手动粘贴');
  });

  it('protects thumbnail privacy and replaces failed images with a platform fallback', async () => {
    const user = userEvent.setup();
    render(<VideoDownloader onClose={() => undefined} />);

    await user.type(screen.getByLabelText('抖音或 B 站视频链接'), 'https://b23.tv/demo');
    await user.click(screen.getByRole('button', { name: '解析视频' }));
    const image = await screen.findByRole('img', { name: '演示视频标题的视频封面' });

    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.error(image);
    expect(screen.getByText('B站封面暂不可用')).toBeTruthy();
    expect(screen.queryByRole('img', { name: '演示视频标题的视频封面' })).toBeNull();
  });
});
