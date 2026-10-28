const TITLE_BY_TOOL: Record<string, string> = {
  'audio-converter': '音频格式转换',
  'ncm-converter': 'NCM 转换器',
  'voice-changer': '音频变声器',
};

const DETAIL_BY_TOOL: Record<string, string> = {
  'audio-converter': '微信小程序当前没有稳定的本地音频编码链路，直接转换可能损坏文件。',
  'ncm-converter': 'NCM 解密涉及本地二进制解析与密钥处理，暂不在个人主体小程序中运行。',
  'voice-changer': '浏览器版依赖 Web Audio/MediaRecorder，原生小程序需要单独的音频服务才能保持效果一致。',
};

Component({
  properties: {
    toolId: {
      type: String,
      value: 'audio-converter',
    },
  },

  data: {
    title: '音频工具',
    detail: '',
  },

  lifetimes: {
    attached() {
      const id = this.properties.toolId as string;
      this.setData({ title: TITLE_BY_TOOL[id] ?? '音频工具', detail: DETAIL_BY_TOOL[id] ?? '该工具需要桌面端音频能力。' });
    },
  },

  methods: {
    copyHint() {
      const detail = this.data.detail as string;
      wx.setClipboardData({ data: detail, success: () => wx.showToast({ title: '已复制说明', icon: 'success' }) });
    },
  },
});
