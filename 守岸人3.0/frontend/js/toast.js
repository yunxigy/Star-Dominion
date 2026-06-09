/**
 * Toast 提示模块
 */
const Toast = {
  container: null,

  /**
   * 初始化容器
   */
  init() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      display: flex;
      flex-direction: column;
      gap: 10px;
    `;
    document.body.appendChild(this.container);
  },

  /**
   * 显示提示
   */
  show(message, type = 'info', duration = 3000) {
    this.init();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: toastIn 0.3s ease;
      max-width: 300px;
      word-break: break-word;
    `;

    // 根据类型设置背景色
    const colors = {
      info: '#0077b6',
      success: '#4caf50',
      warning: '#ff9800',
      error: '#f44336',
    };
    toast.style.background = colors[type] || colors.info;

    toast.textContent = message;
    this.container.appendChild(toast);

    // 自动移除
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * 信息提示
   */
  info(message, duration) {
    this.show(message, 'info', duration);
  },

  /**
   * 成功提示
   */
  success(message, duration) {
    this.show(message, 'success', duration);
  },

  /**
   * 警告提示
   */
  warning(message, duration) {
    this.show(message, 'warning', duration);
  },

  /**
   * 错误提示
   */
  error(message, duration) {
    this.show(message, 'error', duration);
  },

  /**
   * 确认对话框
   */
  confirm(message) {
    return window.confirm(message);
  },
};

// 添加动画样式
const style = document.createElement('style');
style.textContent = `
  @keyframes toastIn {
    from { opacity: 0; transform: translateX(100%); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes toastOut {
    from { opacity: 1; transform: translateX(0); }
    to { opacity: 0; transform: translateX(100%); }
  }
`;
document.head.appendChild(style);

// 导出
window.Toast = Toast;
