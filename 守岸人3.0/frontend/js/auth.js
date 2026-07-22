/** 全站统一认证适配层：身份由 HttpOnly Cookie 管理。 */
const nativeFetch = window.fetch.bind(window);

function readSiteCsrf() {
  const item = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('sd_csrf='));
  return item ? decodeURIComponent(item.slice('sd_csrf='.length)) : null;
}

window.fetch = function siteAuthenticatedFetch(input, init = {}) {
  const target = new URL(typeof input === 'string' ? input : input.url, window.location.href);
  if (target.origin !== window.location.origin) return nativeFetch(input, init);
  const method = (init.method || (typeof input !== 'string' ? input.method : 'GET')).toUpperCase();
  const headers = new Headers(init.headers || (typeof input !== 'string' ? input.headers : undefined));
  // Authentication is exclusively carried by the site's HttpOnly session cookie.
  // Strip legacy browser bearer headers so they can never shadow central auth.
  headers.delete('Authorization');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = readSiteCsrf();
    if (csrf) headers.set('X-CSRF-Token', csrf);
  }
  return nativeFetch(input, { ...init, headers, credentials: 'include' });
};

const Auth = {
  user: null,

  getUser() {
    return this.user;
  },

  isLoggedIn() {
    return Boolean(this.user);
  },

  isAdmin() {
    return this.user?.role === 'admin';
  },

  loginUrl(next = '/wuwa/') {
    return `/auth/login?next=${encodeURIComponent(next)}`;
  },

  async loadUser() {
    const response = await fetch('/auth-api/api/v1/session/me', {
      credentials: 'include',
    });
    if (response.status === 401) {
      this.user = null;
      return null;
    }
    if (!response.ok) throw new Error('无法确认登录状态');
    this.user = await response.json();
    return this.user;
  },

  async logout() {
    const csrf = readSiteCsrf();
    await fetch('/auth-api/api/v1/session/logout', {
      method: 'POST',
      credentials: 'include',
      headers: csrf ? { 'X-CSRF-Token': csrf } : {},
    });
    this.user = null;
    window.location.href = '/';
  },

  requireLogin() {
    if (!this.user) {
      window.location.href = this.loginUrl(
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      return false;
    }
    return true;
  },

  async initPage() {
    const user = await this.loadUser();
    if (!user) {
      window.location.href = this.loginUrl();
      return null;
    }
    const userSection = document.getElementById('user-section');
    const loginSection = document.getElementById('login-section');
    const usernameEl = document.getElementById('sidebar-username') || document.getElementById('username');
    const adminLink = document.getElementById('admin-link');
    if (userSection) userSection.style.display = 'block';
    if (loginSection) loginSection.style.display = 'none';
    if (usernameEl) usernameEl.textContent = user.username;
    if (adminLink && user.role === 'admin') adminLink.style.display = 'block';
    return user;
  },
};

window.Auth = Auth;
