import { describe, expect, it } from 'vitest';
import {
  detectCsvDelimiter,
  diffTableRows,
  formatCitation,
  markdownToHtml,
  parseCsv,
  parsePageRange,
  pickPrivacyFields,
} from '../xiaochengxu/miniprogram/services/document';

describe('native document, data, and academic logic', () => {
  it('parses safe PDF page ranges and rejects invalid pages', () => {
    expect(parsePageRange('1-3, 5, 7-6', 8)).toEqual({ ok: true, value: [1, 2, 3, 5, 6, 7] });
    expect(parsePageRange('0,2', 8).ok).toBe(false);
    expect(parsePageRange('1-20', 8).ok).toBe(false);
  });

  it('detects CSV delimiters, parses rows, and reports keyed table differences', () => {
    expect(detectCsvDelimiter('name,age\nA,1')).toBe(',');
    expect(detectCsvDelimiter('name\tage\nA\t1')).toBe('\t');
    expect(parseCsv('name,age\nA,1\nB,2')).toEqual({
      headers: ['name', 'age'],
      rows: [['A', '1'], ['B', '2']],
    });
    expect(diffTableRows(
      [{ id: '1', value: 'old' }, { id: '2', value: 'same' }],
      [{ id: '2', value: 'same' }, { id: '3', value: 'new' }],
      'id',
    )).toEqual({ added: ['3'], removed: ['1'], changed: [] });
  });

  it('converts Markdown and formats a citation without leaking extra fields', () => {
    expect(markdownToHtml('# 标题\n\n**重点**')).toContain('<h1>标题</h1>');
    expect(formatCitation({ author: '张三', title: '工具研究', year: '2026', source: '逐梦' }, 'gbt7714'))
      .toBe('张三. 工具研究[M]. 逐梦, 2026.');
    expect(pickPrivacyFields({ name: 'A', email: 'a@example.com', secret: 'x' }, ['name', 'email']))
      .toEqual({ name: 'A', email: 'a@example.com' });
  });
});
