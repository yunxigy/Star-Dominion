/** 全站统一认证适配层：身份由 HttpOnly Cookie 管理。 */

/**
 * 自动检测基础路径前缀（如 /wuwa）。
 * 当通过站点网关（/wuwa/ 前缀）访问时，所有页面内导航需带上此前缀。
 */
const BASE_PATH = (function () {
  const path = window.location.pathname;
  // 匹配 /wuwa/ 或 /wuwa/index.html 等
  const m = path.match(/^\/(wuwa)\//);
  return m ? '/' + m[1] : '';
})();

/**
 * 将绝对路径转换为带 BASE_PATH 前缀的路径。
 * 例: navigateUrl('/characters.html') → '/wuwa/characters.html'（在 /wuwa 下访问时）
 */
function navigateUrl(href) {
  if (!href || href.startsWith('#') || href.startsWith('javascript:')) return href;
  // 已经包含 BASE_PATH
  if (BASE_PATH && href.startsWith(BASE_PATH + '/')) return href;
  // 绝对路径：/xxx → /wuwa/xxx
  if (href.startsWith('/')) return BASE_PATH + href;
  // 相对路径：原样返回
  return href;
}

/**
 * DOM 加载后自动修补所有 <a href="/..."> 链接，加上 BASE_PATH 前缀。
 */
function patchLinks() {
  if (!BASE_PATH) return;
  document.querySelectorAll('a[href^="/"]').forEach((a) => {
    const orig = a.getAttribute('href');
    if (orig && !orig.startsWith(BASE_PATH + '/')) {
      a.setAttribute('href', BASE_PATH + orig);
    }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', patchLinks);
} else {
  patchLinks();
}
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
    // next 默认值也应走 BASE_PATH
    if (next === '/wuwa/' && BASE_PATH) {
      next = BASE_PATH + '/';
    }
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
    window.location.href = BASE_PATH + '/';
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
