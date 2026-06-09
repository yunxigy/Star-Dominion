/**
 * API 模块 - 统一管理 API 调用
 */
const API = {
  baseUrl: '',
  _refreshPromise: null,  // 防止并发刷新

  /**
   * 发起 API 请求
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const token = Auth.getToken();

    const headers = { ...options.headers };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 如果 body 不是 FormData，设置 Content-Type
    if (options.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const method = options.method || 'GET';

    try {
      const res = await fetch(url, { ...options, method, headers });

      // Token 过期，尝试刷新
      if (res.status === 401 && Auth.getRefreshToken()) {
        try {
          // 防止并发刷新
          if (!this._refreshPromise) {
            this._refreshPromise = Auth.refreshToken();
          }
          await this._refreshPromise;
          this._refreshPromise = null;

          // 重试请求（只重试一次）
          headers['Authorization'] = `Bearer ${Auth.getToken()}`;
          return await fetch(url, { ...options, method, headers });
        } catch {
          this._refreshPromise = null;
          Auth.logout();
          throw new Error('认证失败，请重新登录');
        }
      }

      return res;
    } catch (e) {
      Toast.error('网络请求失败，请检查网络连接');
      throw e;
    }
  },

  /**
   * GET 请求
   */
  async get(endpoint) {
    const res = await this.request(endpoint, { method: 'GET' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },

  /**
   * POST 请求
   */
  async post(endpoint, body) {
    const res = await this.request(endpoint, {
      method: 'POST',
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },

  /**
   * PUT 请求
   */
  async put(endpoint, body) {
    const res = await this.request(endpoint, {
      method: 'PUT',
      body,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },

  /**
   * DELETE 请求
   */
  async del(endpoint) {
    const res = await this.request(endpoint, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },

  /**
   * POST FormData
   */
  async postForm(endpoint, formData) {
    const res = await this.request(endpoint, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },

  /**
   * PUT FormData
   */
  async putForm(endpoint, formData) {
    const res = await this.request(endpoint, {
      method: 'PUT',
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || '请求失败');
    }
    return res.json();
  },
};

// 导出
window.API = API;
