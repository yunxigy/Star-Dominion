import { HttpRequestError, requestJson } from '../../../services/http';
import { buildWebmasterRequest, WebmasterRequestKind } from '../../../services/webmaster';

const KIND_BY_TOOL: Record<string, WebmasterRequestKind> = {
  'http-status-checker': 'http',
  'dns-lookup': 'dns',
  'ssl-checker': 'ssl',
  'websocket-tester': 'websocket',
};

const LABEL_BY_KIND: Record<WebmasterRequestKind, string> = {
  http: 'HTTP(S) 地址',
  dns: '域名',
  ssl: '域名',
  websocket: 'WS(S) 地址',
};

const PLACEHOLDER_BY_KIND: Record<WebmasterRequestKind, string> = {
  http: 'https://example.com/',
  dns: 'example.com',
  ssl: 'example.com',
  websocket: 'wss://example.com/socket',
};

const TITLE_BY_KIND: Record<WebmasterRequestKind, string> = {
  http: 'HTTP 状态与响应检查',
  dns: 'DNS 查询结果',
  ssl: 'SSL 证书检查结果',
  websocket: 'WebSocket 握手结果',
};

function formatResult(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readableError(error: unknown): string {
  if (error instanceof HttpRequestError) {
    if (error.status === 429) return '请求过于频繁，请稍后再试';
    if (error.status >= 500 || error.status === 0) return '服务暂时不可用，请稍后重试';
    return error.message;
  }
  return error instanceof Error ? error.message : '检测失败，请稍后重试';
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'http-status-checker',
    },
  },

  data: {
    input: '',
    output: '',
    error: '',
    busy: false,
    label: '检测地址',
    placeholder: '请输入地址',
    resultTitle: '检测结果',
    kind: 'http' as WebmasterRequestKind,
  },

  lifetimes: {
    attached() {
      const kind = KIND_BY_TOOL[this.properties.toolId as string] ?? 'http';
      this.setData({
        kind,
        label: LABEL_BY_KIND[kind],
        placeholder: PLACEHOLDER_BY_KIND[kind],
        resultTitle: TITLE_BY_KIND[kind],
        input: PLACEHOLDER_BY_KIND[kind],
      });
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.Input) {
      this.setData({ input: event.detail.value, error: '' });
    },

    async run() {
      const kind = this.data.kind as WebmasterRequestKind;
      const input = String(this.data.input ?? '').trim();
      if (!input) {
        this.setData({ error: `请输入${this.data.label}` });
        return;
      }
      this.setData({ busy: true, error: '', output: '' });
      try {
        const request = buildWebmasterRequest(kind, input);
        const result = await requestJson<unknown>(request.path, { method: 'POST', data: request.data });
        this.setData({ output: formatResult(result) });
      } catch (error: unknown) {
        this.setData({ error: readableError(error) });
      } finally {
        this.setData({ busy: false });
      }
    },

    retry() {
      void this.run();
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
      this.setData({ input: '', output: '', error: '' });
    },
  },
});
