// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  collectNews: vi.fn(),
  getNewsItems: vi.fn(),
  getSocialEvents: vi.fn(),
  getLatestXEventReport: vi.fn(),
}));

vi.mock('@site-auth', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('../lib/researchReports', () => api);

import { NewsEventsPage } from './NewsEventsPage';

const xReport = {
  report: {
    id: 'report-1',
    status: 'published',
    modelProvider: 'google',
    modelName: 'gemini-2.5-flash',
    title: 'AI 圈大事：新模型与安全进展',
    summary: '多家实验室分享了模型能力与安全评估的最新进展。',
    events: [{
      title: 'OpenAI 发布新模型',
      summary: 'OpenAI 表示推出新的推理模型。',
      importance: 91,
      postIds: ['post-1'],
    }],
    risks: ['模型能力仍需要第三方验证。'],
    postIds: [{ provider: 'fxtwitter', externalId: 'post-1' }],
    receivedAt: '2026-09-25T10:00:00.000Z',
  },
  posts: [{
    provider: 'fxtwitter',
    externalId: 'post-1',
    author: 'OpenAI',
    username: 'OpenAI',
    text: 'We introduced a new reasoning model.',
    canonicalUrl: 'https://x.com/OpenAI/status/post-1',
    publishedAt: '2026-09-25T09:30:00.000Z',
    importance: 91,
  }],
};

describe('NewsEventsPage social-events tab', () => {
  beforeEach(() => {
    api.collectNews.mockResolvedValue({});
    api.getNewsItems.mockResolvedValue({
      items: [{
        id: 'news-1',
        sourceId: 'rss-1',
        canonicalUrl: 'https://news.example/ai',
        title: 'AI 新闻旧标题',
        summary: 'AI 新闻旧摘要',
        publishedAt: '2026-09-25T08:00:00.000Z',
        authorOrPublisher: 'Example News',
        topics: [],
        importanceScore: 80,
        status: 'candidate',
      }],
      nextCursor: null,
    });
    api.getSocialEvents.mockResolvedValue({ items: [], nextCursor: null });
    api.getLatestXEventReport.mockResolvedValue(xReport);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('keeps AI news on its existing endpoint', async () => {
    render(<NewsEventsPage />);

    expect(await screen.findByRole('heading', { name: /AI 新闻旧标题/ })).toBeTruthy();
    expect(api.getNewsItems).toHaveBeenCalledTimes(1);
    expect(api.getLatestXEventReport).not.toHaveBeenCalled();
  });

  it('shows the latest X summary, event, risk, importance, and source link', async () => {
    const user = userEvent.setup();
    render(<NewsEventsPage />);
    await user.click(screen.getByRole('button', { name: '社交大事' }));

    expect(await screen.findByRole('heading', { name: 'AI 圈大事：新模型与安全进展' })).toBeTruthy();
    expect(screen.getByText('多家实验室分享了模型能力与安全评估的最新进展。')).toBeTruthy();
    expect(screen.getByText('OpenAI 发布新模型')).toBeTruthy();
    expect(screen.getByText('模型能力仍需要第三方验证。')).toBeTruthy();
    expect(screen.getByText('We introduced a new reasoning model.')).toBeTruthy();
    expect(screen.getAllByText(/重要 · 91/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: /查看 X 原文/ }).getAttribute('href'))
      .toBe('https://x.com/OpenAI/status/post-1');
    expect(api.getLatestXEventReport).toHaveBeenCalledTimes(1);
    expect(api.getSocialEvents).not.toHaveBeenCalled();
  });

  it('shows an empty state when no X report has been received', async () => {
    api.getLatestXEventReport.mockResolvedValue({ report: null, posts: [] });
    const user = userEvent.setup();
    render(<NewsEventsPage />);
    await user.click(screen.getByRole('button', { name: '社交大事' }));

    expect(await screen.findByText('暂无 AI 圈社交大事')).toBeTruthy();
  });

  it('offers a retry action after a failed request', async () => {
    api.getLatestXEventReport
      .mockRejectedValueOnce(new Error('模拟请求失败'))
      .mockResolvedValueOnce(xReport);
    const user = userEvent.setup();
    render(<NewsEventsPage />);
    await user.click(screen.getByRole('button', { name: '社交大事' }));

    expect(await screen.findByText('模拟请求失败')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByRole('heading', { name: 'AI 圈大事：新模型与安全进展' })).toBeTruthy();
    expect(api.getLatestXEventReport).toHaveBeenCalledTimes(2);
  });
});
