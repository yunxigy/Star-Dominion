/** 守岸人 API 客户端：统一使用全站 HttpOnly Cookie 和 CSRF。 */
const API = {
  baseUrl: '',

  readCsrfCookie() {
    const item = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('sd_csrf='));
    return item ? decodeURIComponent(item.slice('sd_csrf='.length)) : null;
  },

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const method = (options.method || 'GET').toUpperCase();
    const headers = { ...options.headers };
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      const csrf = this.readCsrfCookie();
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    try {
      const response = await fetch(url, {
        ...options,
        method,
        headers,
        credentials: 'include',
      });
      if (response.status === 401) {
        window.location.href = Auth.loginUrl(
          `${window.location.pathname}${window.location.search}${window.location.hash}`,
        );
      }
      return response;
    } catch (error) {
      if (window.Toast) Toast.error('网络请求失败，请检查网络连接');
      throw error;
    }
  },

  async parse(response) {
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    if (response.status === 204) return null;
    return response.json();
  },

  async get(endpoint) {
    return this.parse(await this.request(endpoint, { method: 'GET' }));
  },
  async post(endpoint, body) {
    return this.parse(await this.request(endpoint, { method: 'POST', body }));
  },
  async put(endpoint, body) {
    return this.parse(await this.request(endpoint, { method: 'PUT', body }));
  },
  async del(endpoint) {
    return this.parse(await this.request(endpoint, { method: 'DELETE' }));
  },
  async postForm(endpoint, body) {
    return this.parse(await this.request(endpoint, { method: 'POST', body }));
  },
  async putForm(endpoint, body) {
    return this.parse(await this.request(endpoint, { method: 'PUT', body }));
  },
};

window.API = API;
