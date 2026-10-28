import {
  buildMetaTags,
  buildRobotsTxt,
  buildSitemapXml,
  buildUtmUrl,
  parseUrl,
  parseUserAgent,
  slugify,
} from '../../../services/webmaster';

type WebmasterLocalMode = 'meta' | 'robots' | 'sitemap' | 'utm' | 'url' | 'slug' | 'ua';

const MODE_BY_TOOL: Record<string, WebmasterLocalMode> = {
  'meta-tag-generator': 'meta',
  'open-graph-preview': 'meta',
  'robots-txt-generator': 'robots',
  'sitemap-generator': 'sitemap',
  'url-parser': 'url',
  'utm-builder': 'utm',
  'slug-generator': 'slug',
  'user-agent-parser': 'ua',
};

const DEFAULT_INPUT_BY_MODE: Record<WebmasterLocalMode, string> = {
  meta: 'https://example.com/',
  robots: 'https://example.com/sitemap.xml',
  sitemap: 'https://example.com/\nhttps://example.com/about',
  utm: 'https://example.com/?ref=home',
  url: 'https://example.com:8443/path?tag=a&tag=b#part',
  slug: '你好，World 2026',
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile Safari/604.1',
};

const LABEL_BY_MODE: Record<WebmasterLocalMode, string> = {
  meta: 'Canonical URL',
  robots: 'Sitemap URL',
  sitemap: 'URL 列表（每行一条）',
  utm: '原始链接',
  url: 'URL 地址',
  slug: '标题或文本',
  ua: 'User-Agent 字符串',
};

function outputFor(mode: WebmasterLocalMode, data: Record<string, string>): string {
  if (mode === 'meta') {
    return buildMetaTags({
      title: data.title,
      description: data.description,
      url: data.input,
      image: data.image || undefined,
    });
  }
  if (mode === 'robots') {
    return buildRobotsTxt({ sitemap: data.input, disallow: data.secondaryInput.split(/\r?\n/).filter(Boolean) });
  }
  if (mode === 'sitemap') {
    return buildSitemapXml(data.input.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).map((url) => ({ url, changefreq: 'weekly', priority: 0.8 })));
  }
  if (mode === 'utm') {
    return buildUtmUrl(data.input, {
      source: data.source,
      medium: data.medium,
      campaign: data.campaign,
      term: data.term,
      content: data.content,
    });
  }
  if (mode === 'url') return JSON.stringify(parseUrl(data.input), null, 2);
  if (mode === 'slug') return slugify(data.input);
  return JSON.stringify(parseUserAgent(data.input), null, 2);
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'meta-tag-generator',
    },
  },

  data: {
    mode: 'meta' as WebmasterLocalMode,
    input: '',
    secondaryInput: '/private\n/admin',
    title: '我的网站',
    description: '网站描述',
    image: '',
    source: 'wechat',
    medium: 'social',
    campaign: 'summer',
    term: '',
    content: '',
    output: '',
    error: '',
    label: 'Canonical URL',
    inputPlaceholder: 'https://example.com/',
    hasSecondary: false,
    hasMetaFields: true,
    hasUtmFields: false,
  },

  lifetimes: {
    attached() {
      const mode = MODE_BY_TOOL[this.properties.toolId as string] ?? 'url';
      this.setData({
        mode,
        input: DEFAULT_INPUT_BY_MODE[mode],
        label: LABEL_BY_MODE[mode],
        inputPlaceholder: DEFAULT_INPUT_BY_MODE[mode].split('\n')[0],
        hasSecondary: mode === 'robots',
        hasMetaFields: mode === 'meta',
        hasUtmFields: mode === 'utm',
      });
    },
  },

  methods: {
    onInput(event: WechatMiniprogram.Input | WechatMiniprogram.TextareaInput) {
      const field = String(event.currentTarget.dataset.field ?? 'input');
      this.setData({ [field]: event.detail.value, error: '', output: '' });
    },

    run() {
      const data = {
        input: String(this.data.input ?? ''),
        secondaryInput: String(this.data.secondaryInput ?? ''),
        title: String(this.data.title ?? ''),
        description: String(this.data.description ?? ''),
        image: String(this.data.image ?? ''),
        source: String(this.data.source ?? ''),
        medium: String(this.data.medium ?? ''),
        campaign: String(this.data.campaign ?? ''),
        term: String(this.data.term ?? ''),
        content: String(this.data.content ?? ''),
      };
      try {
        const output = outputFor(this.data.mode as WebmasterLocalMode, data);
        this.setData({ output, error: '' });
      } catch (error: unknown) {
        this.setData({ output: '', error: error instanceof Error ? error.message : '生成失败，请检查输入' });
      }
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
      this.setData({ input: '', secondaryInput: '', output: '', error: '' });
    },
  },
});
