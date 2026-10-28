import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectHttp } from './api';

describe('webmaster API client', () => {
  afterEach(() => { vi.restoreAllMocks(); });
  it('posts only JSON content type and maps successful responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: 200 }), { status: 200 })));
    await inspectHttp('https://example.com');
    expect(fetch).toHaveBeenCalledWith('/webmaster-api/api/v1/http', expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://example.com' }), credentials: 'same-origin' }));
  });
  it('maps rate limits and unavailable services to stable messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(inspectHttp('https://example.com')).rejects.toThrow('请求过于频繁，请稍后再试');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(inspectHttp('https://example.com')).rejects.toThrow('站长检测服务未连接');
  });
});
