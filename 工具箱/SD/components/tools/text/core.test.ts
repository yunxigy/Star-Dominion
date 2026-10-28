import { describe, expect, it } from 'vitest';
import {
  addLineNumbers,
  analyzeText,
  dedupeLines,
  extractEntities,
  mergeTextDocuments,
  normalizeNewlines,
  removeBlankLines,
  removeLineNumbers,
  replaceText,
  sortLines,
  splitTextByLines,
} from './core';

describe('text line transforms', () => {
  it('normalizes Windows and old Mac newlines', () => {
    expect(normalizeNewlines('a\r\nb\rc')).toBe('a\nb\nc');
  });

  it('removes whitespace-only lines without trimming retained content', () => {
    expect(removeBlankLines(' first \n  \nsecond\n')).toBe(' first \nsecond');
  });

  it('deduplicates while preserving first occurrence and optional case sensitivity', () => {
    expect(dedupeLines('A\na\nA', false)).toBe('A');
    expect(dedupeLines('A\na\nA', true)).toBe('A\na');
  });

  it('sorts Chinese text with numeric ordering and supports descending order', () => {
    expect(sortLines('项目10\n项目2\n项目1', 'asc')).toBe('项目1\n项目2\n项目10');
    expect(sortLines('b\na', 'desc')).toBe('b\na');
  });
});

describe('text transforms and analysis', () => {
  it('performs literal and regular-expression replacement safely', () => {
    expect(replaceText('A.a', '.', '-', { regex: false, caseSensitive: true })).toBe('A-a');
    expect(replaceText('foo1 foo2', 'foo(\\d)', 'bar$1', { regex: true, caseSensitive: true })).toBe('bar1 bar2');
    expect(() => replaceText('x', '[', '', { regex: true, caseSensitive: true })).toThrow('正则表达式无效');
  });

  it('adds and removes line-number prefixes', () => {
    expect(addLineNumbers('a\nb', 1)).toBe('1. a\n2. b');
    expect(removeLineNumbers('1. a\n02) b\nnot numbered')).toBe('a\nb\nnot numbered');
  });

  it('calculates useful text metrics and frequencies', () => {
    expect(analyzeText('你好 world\n你好')).toMatchObject({ lines: 2, characters: 11, charactersNoWhitespace: 9, words: 3 });
    expect(analyzeText('你你a').frequencies[0]).toEqual({ token: '你', count: 2 });
  });

  it('extracts unique email, URL and IP values in encounter order', () => {
    expect(extractEntities('a@example.com https://example.com 8.8.8.8 a@example.com')).toEqual({
      emails: ['a@example.com'], urls: ['https://example.com'], ips: ['8.8.8.8'],
    });
  });

  it('merges named documents and splits text by line count', () => {
    expect(mergeTextDocuments([{ name: 'a.txt', text: 'A' }, { name: 'b.txt', text: 'B' }], true)).toContain('===== a.txt =====\nA');
    expect(splitTextByLines('1\n2\n3\n4\n5', 2)).toEqual(['1\n2', '3\n4', '5']);
    expect(() => splitTextByLines('x', 0)).toThrow('每份行数必须大于 0');
  });
});
