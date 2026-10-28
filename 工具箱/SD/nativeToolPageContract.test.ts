import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { API_BASE_URL, buildApiUrl } from '../xiaochengxu/miniprogram/services/http';

const miniRoot = resolve(fileURLToPath(new URL('../xiaochengxu/miniprogram/', import.meta.url)));
const read = (relativePath: string) => readFileSync(resolve(miniRoot, relativePath), 'utf8');

describe('native tool page shell', () => {
  it('resolves a tool id and exposes back and migration states', () => {
    const page = read('pages/tool/index.ts');
    const markup = read('pages/tool/index.wxml');

    expect(page).toContain('options.id');
    expect(page).toContain('wx.navigateBack');
    expect(markup).toContain('status === \'ready\'');
    expect(markup).toContain('status === \'adapting\'');
    expect(markup).toContain('暂不支持此工具');
  });

  it('uses one HTTPS public API base and rejects absolute or internal URLs', () => {
    expect(API_BASE_URL).toBe('https://zhumenggy.top');
    expect(buildApiUrl('/api/example')).toBe('https://zhumenggy.top/api/example');
    expect(() => buildApiUrl('http://localhost:8000/api')).toThrow('仅允许使用线上 HTTPS 接口');
    expect(() => buildApiUrl('https://127.0.0.1/api')).toThrow('仅允许使用线上 HTTPS 接口');
    expect(() => buildApiUrl('https://zhumenggy.top:8012/api')).toThrow('仅允许使用线上 HTTPS 接口');
  });
});
