import { ToolResult } from './result';

type NumberInput = string | number;

function readNumber(value: NumberInput, label: string): ToolResult<number> {
  const number = typeof value === 'number' ? value : Number(value.trim());
  if (!Number.isFinite(number)) return { ok: false, error: `${label}必须是有效数字` };
  return { ok: true, value: number };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export interface BmiValue {
  bmi: number;
  category: string;
}

export function calculateBmi(heightCm: NumberInput, weightKg: NumberInput): ToolResult<BmiValue> {
  const height = readNumber(heightCm, '身高');
  const weight = readNumber(weightKg, '体重');
  if (!height.ok) return height;
  if (!weight.ok) return weight;
  if (height.value <= 0 || weight.value <= 0) return { ok: false, error: '身高和体重必须大于 0' };

  const bmi = weight.value / ((height.value / 100) ** 2);
  let category = '肥胖';
  if (bmi < 18.5) category = '偏瘦';
  else if (bmi < 24) category = '正常';
  else if (bmi < 28) category = '偏胖';
  return { ok: true, value: { bmi: round(bmi), category } };
}

export type PercentageMode = 'ratio' | 'percent' | 'increase' | 'decrease';

export function calculatePercentage(
  aInput: NumberInput,
  bInput: NumberInput,
  mode: PercentageMode,
): ToolResult<number> {
  const a = readNumber(aInput, 'A');
  const b = readNumber(bInput, mode === 'ratio' ? 'B' : '百分比');
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (mode === 'ratio' && b.value === 0) return { ok: false, error: 'B 不能为 0' };

  let result: number;
  switch (mode) {
    case 'ratio':
      result = (a.value / b.value) * 100;
      break;
    case 'percent':
      result = (a.value * b.value) / 100;
      break;
    case 'increase':
      result = a.value * (1 + b.value / 100);
      break;
    case 'decrease':
      result = a.value * (1 - b.value / 100);
      break;
  }
  return { ok: true, value: round(result) };
}

export interface DiscountValue {
  finalPrice: number;
  saved: number;
  discountRate: number;
}

export function calculateDiscount(
  priceInput: NumberInput,
  discountInput: NumberInput,
): ToolResult<DiscountValue> {
  const price = readNumber(priceInput, '原价');
  const discount = readNumber(discountInput, '折扣');
  if (!price.ok) return price;
  if (!discount.ok) return discount;
  if (price.value <= 0) return { ok: false, error: '原价必须大于 0' };
  if (discount.value < 0 || discount.value > 100) return { ok: false, error: '折扣必须在 0 到 100 之间' };

  const finalPrice = price.value * (discount.value / 100);
  return {
    ok: true,
    value: {
      finalPrice: round(finalPrice),
      saved: round(price.value - finalPrice),
      discountRate: round(100 - discount.value),
    },
  };
}

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDate(input: string | Date): ToolResult<CalendarDate> {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return { ok: false, error: '日期格式无效' };
    return {
      ok: true,
      value: {
        year: input.getUTCFullYear(),
        month: input.getUTCMonth() + 1,
        day: input.getUTCDate(),
      },
    };
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  if (!match) return { ok: false, error: '日期格式应为 YYYY-MM-DD' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return { ok: false, error: '日期不存在' };
  }
  return { ok: true, value: { year, month, day } };
}

function dateToUtc(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

export interface AgeValue {
  years: number;
  months: number;
  days: number;
}

export function calculateAge(
  birthDateInput: string,
  todayInput: string | Date = new Date(),
): ToolResult<AgeValue> {
  const birth = parseDate(birthDateInput);
  const today = parseDate(todayInput);
  if (!birth.ok) return birth;
  if (!today.ok) return today;
  if (dateToUtc(today.value) < dateToUtc(birth.value)) return { ok: false, error: '出生日期不能晚于目标日期' };

  let years = today.value.year - birth.value.year;
  let months = today.value.month - birth.value.month;
  let days = today.value.day - birth.value.day;
  if (days < 0) {
    months -= 1;
    const previousMonth = today.value.month === 1 ? 12 : today.value.month - 1;
    const previousYear = today.value.month === 1 ? today.value.year - 1 : today.value.year;
    days += daysInMonth(previousYear, previousMonth);
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { ok: true, value: { years, months, days } };
}

export function calculateDateDifference(
  startInput: string,
  endInput: string,
): ToolResult<number> {
  const start = parseDate(startInput);
  const end = parseDate(endInput);
  if (!start.ok) return start;
  if (!end.ok) return end;
  return { ok: true, value: Math.abs(dateToUtc(end.value) - dateToUtc(start.value)) / 86400000 };
}

export type UnitFamily = 'length' | 'weight' | 'temperature' | 'area' | 'speed' | 'time';

const UNIT_FACTORS: Record<Exclude<UnitFamily, 'temperature'>, Record<string, number>> = {
  length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  weight: { mg: 0.000001, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237 },
  area: { sqm: 1, sqkm: 1000000, hectare: 10000, mu: 666.6666666667, sqft: 0.09290304 },
  speed: { mps: 1, kph: 0.2777777778, mph: 0.44704 },
  time: { ms: 0.001, s: 1, min: 60, h: 3600, day: 86400 },
};

function convertTemperature(value: number, from: string, to: string): ToolResult<number> {
  if (!['C', 'F', 'K'].includes(from) || !['C', 'F', 'K'].includes(to)) {
    return { ok: false, error: '温度单位必须是 C、F 或 K' };
  }
  let celsius = value;
  if (from === 'F') celsius = (value - 32) * (5 / 9);
  if (from === 'K') celsius = value - 273.15;
  if (to === 'F') return { ok: true, value: round(celsius * (9 / 5) + 32) };
  if (to === 'K') return { ok: true, value: round(celsius + 273.15) };
  return { ok: true, value: round(celsius) };
}

export function convertUnit(
  valueInput: NumberInput,
  from: string,
  to: string,
  family: UnitFamily,
): ToolResult<number> {
  const value = readNumber(valueInput, '数值');
  if (!value.ok) return value;
  if (family === 'temperature') return convertTemperature(value.value, from, to);
  const factors = UNIT_FACTORS[family];
  if (!factors || factors[from] === undefined || factors[to] === undefined) {
    return { ok: false, error: '换算单位不受支持' };
  }
  return { ok: true, value: round((value.value * factors[from]) / factors[to]) };
}
