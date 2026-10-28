import { describe, expect, it } from 'vitest';
import { buildApiUrl, validatePublicUrl } from '../xiaochengxu/miniprogram/services/http';

describe('native request and public-url boundaries', () => {
  it('keeps native requests on the public HTTPS origin', () => {
    expect(buildApiUrl('/webmaster-api/api/v1/http')).toBe('https://zhumenggy.top/webmaster-api/api/v1/http');
    expect(buildApiUrl('/video-api/api/v1/parse')).toBe('https://zhumenggy.top/video-api/api/v1/parse');
    expect(() => buildApiUrl('http://127.0.0.1:8012/api')).toThrow('仅允许使用线上 HTTPS 接口');
    expect(() => buildApiUrl('http://localhost:8000/api')).toThrow('仅允许使用线上 HTTPS 接口');
  });

  it('accepts public URLs and rejects local or private network targets', () => {
    expect(validatePublicUrl('https://example.com')).toEqual({ ok: true, value: 'https://example.com/' });
    expect(validatePublicUrl('wss://example.com/socket')).toEqual({ ok: true, value: 'wss://example.com/socket' });
    expect(validatePublicUrl('http://localhost:8012')).toEqual({ ok: false, error: '不允许检测本机或内网地址' });
    expect(validatePublicUrl('https://192.168.1.2')).toEqual({ ok: false, error: '不允许检测本机或内网地址' });
    expect(validatePublicUrl('ftp://example.com')).toEqual({ ok: false, error: '仅支持 HTTP(S) 或 WS(S) 地址' });
  });

  it('does not expose development backend ports through public request helpers', async () => {
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../xiaochengxu/miniprogram/services/http.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('8012');
    expect(source).not.toContain('8000');
    expect(source).not.toContain('new URL(');
    expect(source).not.toContain('URLSearchParams');
  });
});
