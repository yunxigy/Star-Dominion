Component({
  properties: {
    value: {
      type: String,
      value: '',
    },
    placeholder: {
      type: String,
      value: '搜索工具名称或关键词',
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.Input) {
      this.triggerEvent('change', { value: event.detail.value });
    },
  },
});
