import {
  calculateAge,
  calculateBmi,
  calculateDateDifference,
  calculateDiscount,
  calculatePercentage,
  convertUnit,
  PercentageMode,
  UnitFamily,
} from '../../../utils/calculator';

interface UnitConfig {
  family: UnitFamily;
  options: string[];
}

const UNIT_CONFIGS: Record<string, UnitConfig> = {
  'length-converter': { family: 'length', options: ['mm', 'cm', 'm', 'km', 'in', 'ft', 'yd', 'mi'] },
  'weight-converter': { family: 'weight', options: ['mg', 'g', 'kg', 't', 'oz', 'lb'] },
  'temperature-converter': { family: 'temperature', options: ['C', 'F', 'K'] },
  'area-converter': { family: 'area', options: ['sqm', 'sqkm', 'hectare', 'mu', 'sqft'] },
  'speed-converter': { family: 'speed', options: ['mps', 'kph', 'mph'] },
  'time-converter': { family: 'time', options: ['ms', 's', 'min', 'h', 'day'] },
};

function todayString(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

Component({
  properties: {
    toolId: {
      type: String,
      value: 'bmi-calculator',
    },
  },

  data: {
    inputA: '',
    inputB: '',
    birthDate: '',
    targetDate: todayString(),
    startDate: '',
    endDate: '',
    percentageMode: 'ratio' as PercentageMode,
    unitFamily: 'length' as UnitFamily,
    unitOptions: [] as string[],
    fromUnit: '',
    toUnit: '',
    fromIndex: 0,
    toIndex: 1,
    isBmi: false,
    isPercentage: false,
    isDiscount: false,
    isAge: false,
    isDateDiff: false,
    isUnit: false,
    resultVisible: false,
    resultTitle: '计算结果',
    resultText: '',
    error: '',
  },

  lifetimes: {
    attached() {
      const toolId = this.properties.toolId as string;
      const unitConfig = UNIT_CONFIGS[toolId];
      this.setData({
        isBmi: toolId === 'bmi-calculator',
        isPercentage: toolId === 'percentage-calculator',
        isDiscount: toolId === 'discount-calculator',
        isAge: toolId === 'age-calculator',
        isDateDiff: toolId === 'date-diff',
        isUnit: Boolean(unitConfig),
        unitFamily: unitConfig?.family ?? 'length',
        unitOptions: unitConfig?.options ?? [],
        fromUnit: unitConfig?.options[0] ?? '',
        toUnit: unitConfig?.options[1] ?? '',
      });
    },
  },

  methods: {
    onFieldInput(event: WechatMiniprogram.Input) {
      const field = String(event.currentTarget.dataset.field ?? '');
      if (!field) return;
      this.setData({ [field]: event.detail.value, error: '' });
    },

    onPercentageMode(event: WechatMiniprogram.CustomEvent<WechatMiniprogram.IAnyObject>) {
      const mode = String(event.currentTarget.dataset.mode) as PercentageMode;
      this.setData({ percentageMode: mode, resultVisible: false, error: '' });
    },

    onFromUnitChange(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value);
      const unitOptions = this.data.unitOptions as string[];
      this.setData({ fromIndex: index, fromUnit: unitOptions[index], error: '' });
    },

    onToUnitChange(event: WechatMiniprogram.PickerChange) {
      const index = Number(event.detail.value);
      const unitOptions = this.data.unitOptions as string[];
      this.setData({ toIndex: index, toUnit: unitOptions[index], error: '' });
    },

    showError(error: string) {
      this.setData({ error, resultVisible: false });
    },

    showResult(title: string, text: string) {
      this.setData({ resultTitle: title, resultText: text, resultVisible: true, error: '' });
    },

    calculate() {
      const toolId = this.properties.toolId as string;
      const inputA = this.data.inputA as string;
      const inputB = this.data.inputB as string;

      if (toolId === 'bmi-calculator') {
        const result = calculateBmi(inputA, inputB);
        if (!result.ok) return this.showError(result.error);
        return this.showResult('BMI 结果', `${result.value.bmi} · ${result.value.category}`);
      }

      if (toolId === 'percentage-calculator') {
        const result = calculatePercentage(inputA, inputB, this.data.percentageMode as PercentageMode);
        if (!result.ok) return this.showError(result.error);
        const suffix = this.data.percentageMode === 'ratio' ? '%' : '';
        return this.showResult('计算结果', `${result.value}${suffix}`);
      }

      if (toolId === 'discount-calculator') {
        const result = calculateDiscount(inputA, inputB);
        if (!result.ok) return this.showError(result.error);
        return this.showResult('折扣结果', `折后价：${result.value.finalPrice}\n节省：${result.value.saved}\n实际折扣：${result.value.discountRate}%`);
      }

      if (toolId === 'age-calculator') {
        const result = calculateAge(this.data.birthDate as string, this.data.targetDate as string);
        if (!result.ok) return this.showError(result.error);
        return this.showResult('年龄结果', `${result.value.years} 岁 ${result.value.months} 个月 ${result.value.days} 天`);
      }

      if (toolId === 'date-diff') {
        const result = calculateDateDifference(this.data.startDate as string, this.data.endDate as string);
        if (!result.ok) return this.showError(result.error);
        return this.showResult('日期间隔', `${result.value} 天`);
      }

      if (this.data.isUnit) {
        const result = convertUnit(inputA, this.data.fromUnit as string, this.data.toUnit as string, this.data.unitFamily as UnitFamily);
        if (!result.ok) return this.showError(result.error);
        return this.showResult('换算结果', `${result.value} ${this.data.toUnit}`);
      }

      this.showError('该计算工具尚未配置。');
    },

    copyResult() {
      const resultText = this.data.resultText as string;
      if (!resultText) return;
      wx.setClipboardData({
        data: resultText,
        success: () => wx.showToast({ title: '已复制', icon: 'success' }),
      });
    },

    clear() {
      this.setData({
        inputA: '',
        inputB: '',
        birthDate: '',
        startDate: '',
        endDate: '',
        resultVisible: false,
        resultText: '',
        error: '',
      });
    },
  },
});
