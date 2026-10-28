import { drawUnique, generatePassword, pickRandom, randomInt, rollDice } from '../../../utils/random';

const FOODS = ['面条', '盖饭', '饺子', '炒饭', '火锅', '沙拉', '汉堡', '寿司'];
const NICKNAME_PREFIXES = ['安静的', '快乐的', '会发光的', '慢慢来的', '勇敢的', '好奇的'];
const NICKNAME_SUFFIXES = ['小鹿', '月亮', '云朵', '海盐', '松果', '旅人'];

function readNumber(value: string): number | null {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'random-number',
    },
  },

  data: {
    inputA: '1',
    inputB: '100',
    passwordLength: '16',
    diceCount: '1',
    diceSides: '6',
    entries: '',
    winnerCount: '1',
    result: '',
    resultList: [] as string[],
    error: '',
  },

  methods: {
    onInput(event: WechatMiniprogram.Input | WechatMiniprogram.TextareaInput) {
      const field = String(event.currentTarget.dataset.field ?? '');
      if (!field) return;
      this.setData({ [field]: event.detail.value, error: '', result: '', resultList: [] });
    },

    run() {
      const toolId = this.properties.toolId as string;
      const random = Math.random;
      let result = '';
      let resultList: string[] = [];
      let error = '';

      if (toolId === 'random-number') {
        const min = readNumber(this.data.inputA as string);
        const max = readNumber(this.data.inputB as string);
        if (min === null || max === null) error = '请输入有效的最小值和最大值';
        else result = String(randomInt(min, max, random));
      } else if (toolId === 'password-gen' || toolId === 'random-password') {
        const length = readNumber(this.data.passwordLength as string);
        if (length === null) error = '请输入有效的密码长度';
        else {
          const generated = generatePassword(length, { lowercase: true, uppercase: true, numbers: true, symbols: true }, random);
          if (generated.ok) result = generated.value;
          else error = generated.error;
        }
      } else if (toolId === 'dice-tool') {
        const count = readNumber(this.data.diceCount as string);
        const sides = readNumber(this.data.diceSides as string);
        if (count === null || sides === null) error = '请输入有效的骰子数量和面数';
        else {
          resultList = rollDice(count, sides, random).map(String);
          result = `总点数：${resultList.reduce((sum, value) => sum + Number(value), 0)}`;
        }
      } else if (toolId === 'lottery-tool' || toolId === 'random-picker') {
        const entries = (this.data.entries as string).split(/[\n,，]+/).map((entry) => entry.trim()).filter(Boolean);
        const requested = toolId === 'random-picker' ? 1 : readNumber(this.data.winnerCount as string);
        if (entries.length === 0) error = '请至少输入一个选项，每行一个';
        else if (requested === null || requested < 1) error = '请输入有效的抽取数量';
        else resultList = drawUnique(entries, requested, random);
      } else if (toolId === 'random-nickname') {
        const prefix = pickRandom(NICKNAME_PREFIXES, random);
        const suffix = pickRandom(NICKNAME_SUFFIXES, random);
        result = `${prefix ?? '神秘的'}${suffix ?? '旅人'}`;
      } else if (toolId === 'what-to-eat') {
        result = pickRandom(FOODS, random) ?? '今天吃点喜欢的';
      } else {
        error = '该趣味工具尚未配置。';
      }

      this.setData({ result, resultList, error });
    },

    copyResult() {
      const content = (this.data.resultList as string[]).length > 0
        ? (this.data.resultList as string[]).join('\n')
        : this.data.result as string;
      if (!content) return;
      wx.setClipboardData({
        data: content,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    clear() {
      this.setData({ result: '', resultList: [], error: '', entries: '' });
    },
  },
});
