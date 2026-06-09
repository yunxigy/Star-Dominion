/**
 * 本地存储模块
 */
const Storage = {
  /**
   * 获取值
   */
  get(key, defaultValue = null) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  /**
   * 设置值
   */
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * 删除值
   */
  remove(key) {
    localStorage.removeItem(key);
  },

  /**
   * 清空所有
   */
  clear() {
    localStorage.clear();
  },

  /**
   * 获取字符串值
   */
  getString(key, defaultValue = '') {
    return localStorage.getItem(key) || defaultValue;
  },

  /**
   * 设置字符串值
   */
  setString(key, value) {
    localStorage.setItem(key, value);
  },

  /**
   * 获取布尔值
   */
  getBool(key, defaultValue = false) {
    const val = localStorage.getItem(key);
    if (val === null) return defaultValue;
    return val === 'true';
  },

  /**
   * 设置布尔值
   */
  setBool(key, value) {
    localStorage.setItem(key, value ? 'true' : 'false');
  },

  /**
   * 获取数值
   */
  getNumber(key, defaultValue = 0) {
    const val = localStorage.getItem(key);
    if (val === null) return defaultValue;
    const num = Number(val);
    return isNaN(num) ? defaultValue : num;
  },

  /**
   * 设置数值
   */
  setNumber(key, value) {
    localStorage.setItem(key, String(value));
  },
};

// 导出
window.Storage = Storage;
