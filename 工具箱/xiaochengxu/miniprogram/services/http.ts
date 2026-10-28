/// <reference path="../types/wechat-globals.ts" />

import { parseWebUrl, serializeWebUrl, WebUrlParts } from '../utils/web-url';

export const API_BASE_URL = 'https://zhumenggy.top';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface RequestJsonOptions {
  method?: HttpMethod;
  data?: WechatMiniprogram.IAnyObject | string | ArrayBuffer;
  header?: Record<string, string>;
  timeout?: number;
}

export interface PublicUrlSuccess {
  ok: true;
  value: string;
}

export interface PublicUrlFailure {
  ok: false;
  error: string;
}

export type PublicUrlResult = PublicUrlSuccess | PublicUrlFailure;

export class HttpRequestError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown = null) {
    super(message);
    this.name = 'HttpRequestError';
    this.status = status;
    this.retryable = status === 0 || status === 408 || status === 429 || status >= 500;
    this.body = body;
  }
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0
    || first === 10
    || first === 127
    || (first === 100 && second >= 64 && second <= 127)
    || (first === 169 && second === 254)
    || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168);
}

function isPrivateHost(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase().replace(/^\[|\]$/g, '');
  if (!normalized || normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.local')) return true;
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) return true;
  return isPrivateIpv4(normalized);
}

export function validatePublicUrl(value: string): PublicUrlResult {
  const input = value.trim();
  let parsed: WebUrlParts;
  try {
    parsed = parseWebUrl(input);
  } catch {
    return { ok: false, error: '请输入有效的网络地址' };
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
    return { ok: false, error: '仅支持 HTTP(S) 或 WS(S) 地址' };
  }
  if (parsed.username || parsed.password || isPrivateHost(parsed.hostname)) {
    return { ok: false, error: '不允许检测本机或内网地址' };
  }
  return { ok: true, value: serializeWebUrl(parsed) };
}

export function buildApiUrl(path: string): string {
  if (!path || /^https?:\/\//i.test(path) || path.includes('localhost') || path.includes('127.0.0.1')) {
    throw new Error('仅允许使用线上 HTTPS 接口');
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (/:\d{2,5}(?:\/|$)/u.test(normalizedPath)) {
    throw new Error('仅允许使用线上 HTTPS 接口');
  }

  return `${API_BASE_URL}${normalizedPath}`;
}

export function requestJson<T>(path: string, options: RequestJsonOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    wx.request({
      url: buildApiUrl(path),
      method: options.method ?? 'GET',
      data: options.data,
      header: {
        'content-type': 'application/json',
        ...(options.header ?? {}),
      },
      timeout: options.timeout ?? 15000,
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data as T);
          return;
        }
        const payload = response.data as { message?: unknown; detail?: unknown; error?: { message?: unknown } } | undefined;
        const message = typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.detail === 'string'
            ? payload.detail
            : typeof payload?.error?.message === 'string'
              ? payload.error.message
              : `服务请求失败（${response.statusCode}）`;
        reject(new HttpRequestError(message, response.statusCode, response.data));
      },
      fail(error) {
        reject(new HttpRequestError(error.errMsg || '网络请求失败，请稍后重试', 0));
      },
    });
  });
}
