import { describe, expect, it } from 'vitest';
import {
  formatJson,
  minifyJson,
  validateJson,
} from '../xiaochengxu/miniprogram/utils/json';
import {
  base64Decode,
  base64Encode,
  urlDecode,
  urlEncode,
} from '../xiaochengxu/miniprogram/utils/encoding';
import {
  calculateAge,
  calculateBmi,
  calculateDateDifference,
  calculateDiscount,
  calculatePercentage,
  convertUnit,
} from '../xiaochengxu/miniprogram/utils/calculator';
import { convertCase, countText } from '../xiaochengxu/miniprogram/utils/text';

describe('native pure tool logic', () => {
  it('formats, minifies, and validates JSON with explicit errors', () => {
    expect(formatJson('{"name":"梦","items":[1,2]}')).toEqual({
      ok: true,
      value: '{\n  "name": "梦",\n  "items": [\n    1,\n    2\n  ]\n}',
    });
    expect(minifyJson('{ "ok": true, "count": 2 }')).toEqual({ ok: true, value: '{"ok":true,"count":2}' });
    expect(validateJson('{"ok":true}')).toEqual({ valid: true, message: 'JSON 格式有效' });
    expect(validateJson('{"ok":}').valid).toBe(false);
    expect(formatJson('')).toEqual({ ok: false, error: '请输入 JSON 内容' });
  });

  it('encodes URLs and round-trips UTF-8 text through Base64', () => {
    expect(urlEncode('梦 工具?x=1')).toBe('%E6%A2%A6%20%E5%B7%A5%E5%85%B7%3Fx%3D1');
    expect(urlDecode('%E6%A2%A6%20%E5%B7%A5%E5%85%B7')).toEqual({ ok: true, value: '梦 工具' });
    expect(base64Encode('你好，tool')).toBe('5L2g5aW977yMdG9vbA==');
    expect(base64Decode('5L2g5aW977yMdG9vbA==')).toEqual({ ok: true, value: '你好，tool' });
    expect(base64Decode('not base64!').ok).toBe(false);
  });

  it('calculates common numeric tools and rejects invalid input', () => {
    expect(calculateBmi('170', '65')).toEqual({ ok: true, value: { bmi: 22.49, category: '正常' } });
    expect(calculateBmi('', '65').ok).toBe(false);
    expect(calculatePercentage('200', '15', 'percent')).toEqual({ ok: true, value: 30 });
    expect(calculatePercentage('120', '100', 'ratio')).toEqual({ ok: true, value: 120 });
    expect(calculateDiscount('100', '80')).toEqual({
      ok: true,
      value: { finalPrice: 80, saved: 20, discountRate: 20 },
    });
    expect(convertUnit('1', 'km', 'm', 'length')).toEqual({ ok: true, value: 1000 });
    expect(convertUnit('32', 'F', 'C', 'temperature')).toEqual({ ok: true, value: 0 });
  });

  it('calculates age and date differences deterministically', () => {
    expect(calculateAge('2000-02-29', '2024-02-28')).toEqual({
      ok: true,
      value: { years: 23, months: 11, days: 30 },
    });
    expect(calculateDateDifference('2024-01-01', '2024-01-31')).toEqual({ ok: true, value: 30 });
    expect(calculateDateDifference('bad-date', '2024-01-31').ok).toBe(false);
  });

  it('counts text and converts letter case', () => {
    expect(countText('你好 hello\nworld')).toMatchObject({
      characters: 14,
      charactersNoSpaces: 12,
      words: 3,
      lines: 2,
      chineseChars: 2,
      englishWords: 2,
    });
    expect(convertCase('hello WORLD', 'upper')).toBe('HELLO WORLD');
    expect(convertCase('hello WORLD', 'lower')).toBe('hello world');
    expect(convertCase('hello world', 'capitalize')).toBe('Hello World');
    expect(convertCase('Hello World', 'toggle')).toBe('hELLO wORLD');
  });
});
