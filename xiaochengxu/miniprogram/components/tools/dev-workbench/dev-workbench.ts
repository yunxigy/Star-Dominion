import { base64Decode, base64Encode, urlDecode, urlEncode } from '../../../utils/encoding';
import { formatJson, minifyJson, validateJson } from '../../../utils/json';

type DevMode = 'encode' | 'decode';

Component({
  properties: {
    toolId: {
      type: String,
      value: 'json-format',
    },
  },

  data: {
    input: '',
    output: '',
    error: '',
    valid: false,
    mode: 'encode' as DevMode,
  },

  lifetimes: {
    attached() {
      const toolId = this.properties.toolId as string;
      if (toolId === 'url-encode' || toolId === 'base64-codec') {
        this.setData({ mode: 'encode' });
      }
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.TextareaInput) {
      this.setData({ input: event.detail.value, error: '', valid: false });
    },

    onMode(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const mode = String(event.currentTarget.dataset.mode) as DevMode;
      this.setData({ mode, output: '', error: '', valid: false });
    },

    run() {
      const toolId = this.properties.toolId as string;
      const input = this.data.input as string;
      let output = '';
      let error = '';
      let valid = false;

      if (toolId === 'json-format') {
        const result = formatJson(input);
        if (result.ok) output = result.value;
        else error = result.error;
      } else if (toolId === 'json-minify') {
        const result = minifyJson(input);
        if (result.ok) output = result.value;
        else error = result.error;
      } else if (toolId === 'json-validate') {
        const result = validateJson(input);
        valid = result.valid;
        if (result.valid) output = result.message;
        else error = result.error ?? result.message;
      } else if (toolId === 'url-encode') {
        const result = this.data.mode === 'decode' ? urlDecode(input) : { ok: true as const, value: urlEncode(input) };
        if (result.ok) output = result.value;
        else error = result.error;
      } else if (toolId === 'base64-codec') {
        const result = this.data.mode === 'decode' ? base64Decode(input) : { ok: true as const, value: base64Encode(input) };
        if (result.ok) output = result.value;
        else error = result.error;
      } else {
        error = '该开发者工具尚未配置操作。';
      }

      this.setData({ output, error, valid });
    },

    copyOutput() {
      const output = this.data.output as string;
      if (!output) return;
      wx.setClipboardData({
        data: output,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    clear() {
      this.setData({ input: '', output: '', error: '', valid: false });
    },
  },
});
