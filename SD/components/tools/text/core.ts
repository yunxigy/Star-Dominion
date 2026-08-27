export type SortDirection = 'asc' | 'desc';

export function normalizeNewlines(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

export function removeBlankLines(input: string): string {
  return normalizeNewlines(input).split('\n').filter((line) => line.trim().length > 0).join('\n');
}

export function dedupeLines(input: string, caseSensitive = false): string {
  const seen = new Set<string>();
  return normalizeNewlines(input).split('\n').filter((line) => {
    const key = caseSensitive ? line : line.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n');
}

export function sortLines(input: string, direction: SortDirection = 'asc'): string {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const sorted = normalizeNewlines(input).split('\n').sort((a, b) => collator.compare(a, b));
  return (direction === 'desc' ? sorted.reverse() : sorted).join('\n');
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function replaceText(
  input: string,
  search: string,
  replacement: string,
  options: { regex: boolean; caseSensitive: boolean },
): string {
  if (!search) return input;
  try {
    const expression = new RegExp(options.regex ? search : escapeRegExp(search), options.caseSensitive ? 'g' : 'gi');
    return input.replace(expression, replacement);
  } catch {
    throw new Error('正则表达式无效');
  }
}

export function addLineNumbers(input: string, start = 1): string {
  if (!Number.isInteger(start) || start < 1) throw new Error('起始行号必须是正整数');
  return normalizeNewlines(input).split('\n').map((line, index) => `${start + index}. ${line}`).join('\n');
}

export function removeLineNumbers(input: string): string {
  return normalizeNewlines(input).split('\n').map((line) => line.replace(/^\s*\d+[.)、:]\s*/, '')).join('\n');
}

export type TextFrequency = { token: string; count: number };

export function analyzeText(input: string): {
  lines: number;
  characters: number;
  charactersNoWhitespace: number;
  words: number;
  frequencies: TextFrequency[];
} {
  const normalized = normalizeNewlines(input);
  const wordTokens = normalized.match(/[\p{Script=Han}]+|[\p{L}\p{N}_]+/gu) ?? [];
  const frequencyTokens = normalized.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? [];
  const counts = new Map<string, number>();
  frequencyTokens.forEach((token) => counts.set(token, (counts.get(token) ?? 0) + 1));
  return {
    lines: normalized.length ? normalized.split('\n').length : 0,
    characters: [...normalized].length,
    charactersNoWhitespace: [...normalized.replace(/\s/gu, '')].length,
    words: wordTokens.length,
    frequencies: [...counts].map(([token, count]) => ({ token, count }))
      .sort((a, b) => b.count - a.count || a.token.localeCompare(b.token, 'zh-CN')),
  };
}

const unique = (values: string[]) => [...new Set(values)];
const trimUrlPunctuation = (value: string) => value.replace(/[),.;!?，。；！？]+$/u, '');

const isIpv4 = (value: string) => {
  const octets = value.split('.');
  return octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

const isIpv6 = (value: string) => {
  if (!value.includes(':') || !/^[0-9a-f:]+$/i.test(value)) return false;
  try {
    // URL gives us a strict check for compressed and full IPv6 forms.
    new URL(`http://[${value}]/`);
    return true;
  } catch {
    return false;
  }
};

export function extractEntities(input: string): { emails: string[]; urls: string[]; ips: string[] } {
  const emails = unique(input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []);
  const urls = unique((input.match(/https?:\/\/[^\s<>"']+/giu) ?? []).map(trimUrlPunctuation));
  const ipCandidates = input.match(/(?:\b(?:\d{1,3}\.){3}\d{1,3}\b)|(?:\b[0-9a-f]*:[0-9a-f:]+\b)/giu) ?? [];
  const ips = unique(ipCandidates.filter((value) => value.includes('.') ? isIpv4(value) : isIpv6(value)));
  return { emails, urls, ips };
}

export function mergeTextDocuments(documents: Array<{ name: string; text: string }>, includeHeadings = true): string {
  return documents.map((document) => includeHeadings
    ? `===== ${document.name} =====\n${document.text}`
    : document.text).join('\n\n');
}

export function splitTextByLines(input: string, linesPerPart: number): string[] {
  if (!Number.isInteger(linesPerPart) || linesPerPart <= 0) throw new Error('每份行数必须大于 0');
  const lines = normalizeNewlines(input).split('\n');
  const parts: string[] = [];
  for (let index = 0; index < lines.length; index += linesPerPart) {
    parts.push(lines.slice(index, index + linesPerPart).join('\n'));
  }
  return parts;
}
