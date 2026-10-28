import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildRankingUrl, getLatestXEventReport, getNewsItems } from './researchReports';


describe('research reports API client', () => {
  it('encodes combined ranking filters', () => {
    expect(buildRankingUrl('issue-1', {
      category: 'typescript',
      query: 'agent kit',
      status: 'new',
      license: 'MIT',
    })).toBe('/issues/issue-1/rankings?category=typescript&query=agent+kit&status=new&license=MIT');
  });

  it('omits empty filters', () => {
    expect(buildRankingUrl('issue-1', { category: 'all', query: '  ' }))
      .toBe('/issues/issue-1/rankings?category=all');
  });

  it('loads the latest X event report from its dedicated endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ report: null, posts: [] })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(getLatestXEventReport()).resolves.toEqual({ report: null, posts: [] });

    expect(fetchMock).toHaveBeenCalledWith('/reports-api/api/v1/x-events/latest', expect.objectContaining({
      credentials: 'include',
    }));
  });

  it('keeps the existing AI news endpoint unchanged', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal('fetch', fetchMock);

    await getNewsItems();

    expect(fetchMock).toHaveBeenCalledWith('/reports-api/api/v1/news?window=24h', expect.anything());
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});
