export interface SiteUser {
  id: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
}

const AUTH_BASE = '/auth-api/api/v1';

export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  if (value.includes('\\') || /[\u0000-\u001f]/.test(value)) return '/';
  return value;
}

function readCookie(name: string): string | null {
  const prefix = `${encodeURIComponent(name)}=`;
  for (const part of document.cookie.split(';')) {
    const candidate = part.trim();
    if (candidate.startsWith(prefix)) {
      return decodeURIComponent(candidate.slice(prefix.length));
    }
  }
  return null;
}

async function authRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readCookie('sd_csrf');
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return fetch(`${AUTH_BASE}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });
}

export async function getCurrentUser(): Promise<SiteUser | null> {
  const response = await authRequest('/session/me');
  if (response.status === 401) return null;
  if (!response.ok) throw new Error('无法获取登录状态');
  return response.json() as Promise<SiteUser>;
}

export async function loginSiteUser(identity: string, password: string): Promise<SiteUser> {
  const response = await authRequest('/session/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity, password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { detail?: string } | null;
    throw new Error(payload?.detail || '登录失败');
  }
  const user = await getCurrentUser();
  if (!user) throw new Error('登录会话创建失败');
  return user;
}

export async function logoutSiteUser(): Promise<void> {
  const response = await authRequest('/session/logout', { method: 'POST' });
  if (!response.ok && response.status !== 401) {
    throw new Error('退出失败，请稍后重试');
  }
}

export function currentRelativeUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function loginUrl(next = currentRelativeUrl()): string {
  return `/auth/login?next=${encodeURIComponent(safeNextPath(next))}`;
}
