import { CaseMode, convertCase, countText, TextStats } from '../../../utils/text';

const EMPTY_STATS: TextStats = {
  characters: 0,
  charactersNoSpaces: 0,
  words: 0,
  lines: 0,
  paragraphs: 0,
  chineseChars: 0,
  englishWords: 0,
  readingTime: 0,
};

Component({
  properties: {
    toolId: {
      type: String,
      value: 'word-count',
    },
  },

  data: {
    input: '',
    output: '',
    mode: 'upper' as CaseMode,
    stats: EMPTY_STATS,
  },

  methods: {
    onInput(event: WechatMiniprogram.TextareaInput) {
      const input = event.detail.value;
      this.setData({ input, stats: countText(input) });
    },

    onCaseMode(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const mode = String(event.currentTarget.dataset.mode) as CaseMode;
      const input = this.data.input as string;
      this.setData({ mode, output: convertCase(input, mode) });
    },

    copyCurrent() {
      const toolId = this.properties.toolId as string;
      const content = toolId === 'case-converter' ? this.data.output as string : this.data.input as string;
      if (!content) return;
      wx.setClipboardData({
        data: content,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    swapOutput() {
      const output = this.data.output as string;
      this.setData({ input: output, output: '', stats: countText(output) });
    },

    clear() {
      this.setData({ input: '', output: '', stats: EMPTY_STATS });
    },
  },
});
