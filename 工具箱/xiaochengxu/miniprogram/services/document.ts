import { ToolResult } from '../utils/result';

export function parsePageRange(input: string, maxPages: number): ToolResult<number[]> {
  if (!Number.isInteger(maxPages) || maxPages < 1) return { ok: false, error: 'PDF 页数无效' };
  const tokens = input.split(/[，,]+/).map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return { ok: false, error: '请输入页码范围' };

  const pages = new Set<number>();
  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?$/.exec(token);
    if (!match) return { ok: false, error: `页码格式无效：${token}` };
    const first = Number(match[1]);
    const last = match[2] ? Number(match[2]) : first;
    const start = Math.min(first, last);
    const end = Math.max(first, last);
    if (start < 1 || end > maxPages) return { ok: false, error: `页码必须在 1 到 ${maxPages} 之间` };
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return { ok: true, value: [...pages].sort((left, right) => left - right) };
}

export function detectCsvDelimiter(input: string): ',' | '\t' | ';' {
  const line = input.split(/\r?\n/).find((item) => item.trim()) ?? '';
  const candidates: Array<',' | '\t' | ';'> = [',', '\t', ';'];
  return candidates.reduce((best, candidate) => (
    line.split(candidate).length > line.split(best).length ? candidate : best
  ), ',');
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value.trim());
  return values;
}

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
}

export function parseCsv(input: string, delimiter = detectCsvDelimiter(input)): ParsedCsv {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0], delimiter);
  return { headers, rows: lines.slice(1).map((line) => parseCsvLine(line, delimiter)) };
}

export interface TableDiff {
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffTableRows<T extends Record<string, string | number>>(
  left: readonly T[],
  right: readonly T[],
  key: keyof T,
): TableDiff {
  const leftMap = new Map(left.map((row) => [String(row[key]), row]));
  const rightMap = new Map(right.map((row) => [String(row[key]), row]));
  const added = [...rightMap.keys()].filter((rowKey) => !leftMap.has(rowKey)).sort();
  const removed = [...leftMap.keys()].filter((rowKey) => !rightMap.has(rowKey)).sort();
  const changed = [...rightMap.keys()]
    .filter((rowKey) => leftMap.has(rowKey) && JSON.stringify(leftMap.get(rowKey)) !== JSON.stringify(rightMap.get(rowKey)))
    .sort();
  return { added, removed, changed };
}

function escapeHtml(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function markdownToHtml(input: string): string {
  const escaped = escapeHtml(input.trim());
  const lines = escaped.split(/\r?\n/);
  const rendered = lines.map((line) => {
    if (/^### /.test(line)) return `<h3>${line.slice(4)}</h3>`;
    if (/^## /.test(line)) return `<h2>${line.slice(3)}</h2>`;
    if (/^# /.test(line)) return `<h1>${line.slice(2)}</h1>`;
    if (/^- /.test(line)) return `<li>${line.slice(2)}</li>`;
    return line
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
  });
  return rendered.join('<br />');
}

export function htmlToPlainText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>(\s*)/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim();
}

export interface CitationInput {
  author: string;
  title: string;
  year: string;
  source: string;
}

export type CitationStyle = 'gbt7714' | 'apa' | 'mla';

export function formatCitation(input: CitationInput, style: CitationStyle): string {
  const author = input.author.trim();
  const title = input.title.trim();
  const year = input.year.trim();
  const source = input.source.trim();
  if (style === 'apa') return `${author} (${year}). ${title}. ${source}.`;
  if (style === 'mla') return `${author}. ${title}. ${source}, ${year}.`;
  return `${author}. ${title}[M]. ${source}, ${year}.`;
}

export function pickPrivacyFields(
  input: Record<string, unknown>,
  allowedFields: readonly string[],
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) output[field] = input[field];
  }
  return output;
}
