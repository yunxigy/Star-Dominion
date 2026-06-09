/**
 * 认证模块 - 统一管理登录态
 */
const Auth = {
  TOKEN_KEY: 'token',
  REFRESH_TOKEN_KEY: 'refresh_token',
  USER_KEY: 'user',

  /**
   * 获取当前用户
   */
  getUser() {
    try {
      const data = localStorage.getItem(this.USER_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  /**
   * 获取 Token
   */
  getToken() {
    return localStorage.getItem(this.TOKEN_KEY);
  },

  /**
   * 获取 Refresh Token
   */
  getRefreshToken() {
    return localStorage.getItem(this.REFRESH_TOKEN_KEY);
  },

  /**
   * 保存登录信息
   */
  setAuth(token, refreshToken, user) {
    localStorage.setItem(this.TOKEN_KEY, token);
    if (refreshToken) {
      localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
    }
    if (user) {
      localStorage.setItem(this.USER_KEY, JSON.stringify(user));
    }
  },

  /**
   * 清除登录信息
   */
  clearAuth() {
    localStorage.removeItem(this.TOKEN_KEY);
    localStorage.removeItem(this.REFRESH_TOKEN_KEY);
    localStorage.removeItem(this.USER_KEY);
  },

  /**
   * 是否已登录
   */
  isLoggedIn() {
    return !!this.getToken();
  },

  /**
   * 是否是管理员
   */
  isAdmin() {
    const user = this.getUser();
    return user && user.role === 'admin';
  },

  /**
   * 登出
   */
  logout() {
    this.clearAuth();
    window.location.href = '/login.html';
  },

  /**
   * 要求登录，未登录则跳转
   */
  requireLogin() {
    if (!this.isLoggedIn()) {
      window.location.href = '/login.html';
      return false;
    }
    return true;
  },

  /**
   * 刷新 Token
   */
  async refreshToken() {
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) {
      throw new Error('No refresh token');
    }

    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });

      if (res.ok) {
        const data = await res.json();
        this.setAuth(data.access_token, data.refresh_token, null);
        return data.access_token;
      } else {
        this.clearAuth();
        throw new Error('Refresh failed');
      }
    } catch (e) {
      this.clearAuth();
      throw e;
    }
  },

  /**
   * 初始化页面认证状态
   */
  initPage() {
    const user = this.getUser();
    const userSection = document.getElementById('user-section');
    const loginSection = document.getElementById('login-section');
    const usernameEl = document.getElementById('sidebar-username') || document.getElementById('username');
    const adminLink = document.getElementById('admin-link');

    if (user) {
      if (userSection) userSection.style.display = 'block';
      if (loginSection) loginSection.style.display = 'none';
      if (usernameEl) usernameEl.textContent = user.username;
      if (adminLink && user.role === 'admin') {
        adminLink.style.display = 'block';
      }
    } else {
      if (userSection) userSection.style.display = 'none';
      if (loginSection) loginSection.style.display = 'block';
    }

    return user;
  },
};

// 导出
window.Auth = Auth;
