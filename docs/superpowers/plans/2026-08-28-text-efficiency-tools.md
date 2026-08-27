# Text Efficiency Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a focused text-tools category with nine searchable local tools backed by one tested transformation core and one consistent workbench.

**Architecture:** Keep all deterministic text operations in pure functions, expose each search intent as a named tool mode, and render those modes through a shared two-pane workbench. Registry entries remain independent URLs while sharing one lazy-loaded implementation chunk. Files are read locally with explicit size limits and are never uploaded.

**Tech Stack:** React 18, TypeScript, Vitest, Testing Library, browser File APIs, existing tool registry and design tokens

---

## File map

- Create `SD/components/tools/text/core.ts`: line transforms, replacement, metrics, extraction, merge and split.
- Create `SD/components/tools/text/core.test.ts`: deterministic edge-case coverage.
- Create `SD/components/tools/text/markup.ts`: Markdown/HTML/plain conversion helpers.
- Create `SD/components/tools/text/markup.test.ts`: escaping and conversion tests.
- Create `SD/components/tools/text/TextWorkbench.tsx`: shared editor, controls, copy/download and file loading.
- Create `SD/components/tools/text/TextWorkbench.test.tsx`: user-flow test.
- Create `SD/components/tools/text/TextTools.tsx`: nine named route components.
- Modify `SD/tools/registry.tsx`: text category and nine tool definitions.
- Modify `SD/seo/categoryContent.ts`: literal text-category search content.
- Modify `SD/tools/registryMetadata.test.ts`: text category registration contract.
- Modify `SD/lib/iconMap.tsx`: only if the selected existing `FileText` icon is absent.

### Task 1: Implement line cleanup and sorting with TDD

**Files:**
- Create: `SD/components/tools/text/core.ts`
- Create: `SD/components/tools/text/core.test.ts`

- [ ] **Step 1: Write failing tests for newline normalization, blank removal, dedupe, and sorting**

```ts
import { describe, expect, it } from 'vitest';
import { dedupeLines, normalizeNewlines, removeBlankLines, sortLines } from './core';

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
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: FAIL because `core.ts` does not exist.

- [ ] **Step 3: Implement the four functions**

```ts
export const normalizeNewlines = (input: string): string => input.replace(/\r\n?/g, '\n');

export function removeBlankLines(input: string): string {
  return normalizeNewlines(input).split('\n').filter(line => line.trim().length > 0).join('\n');
}

export function dedupeLines(input: string, caseSensitive: boolean): string {
  const seen = new Set<string>();
  return normalizeNewlines(input).split('\n').filter(line => {
    const key = caseSensitive ? line : line.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join('\n');
}

export function sortLines(input: string, direction: 'asc' | 'desc'): string {
  const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
  const sorted = normalizeNewlines(input).split('\n').sort(collator.compare);
  return (direction === 'desc' ? sorted.reverse() : sorted).join('\n');
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/core.ts SD/components/tools/text/core.test.ts
git commit -m "feat: add tested text line transforms"
```

### Task 2: Add replacement, line numbering, and text metrics

**Files:**
- Modify: `SD/components/tools/text/core.ts`
- Modify: `SD/components/tools/text/core.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { addLineNumbers, analyzeText, removeLineNumbers, replaceText } from './core';

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
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement replacement and analysis**

```ts
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function replaceText(input: string, search: string, replacement: string, options: { regex: boolean; caseSensitive: boolean }): string {
  if (!search) return input;
  try {
    const expression = new RegExp(options.regex ? search : escapeRegExp(search), options.caseSensitive ? 'g' : 'gi');
    return input.replace(expression, replacement);
  } catch {
    throw new Error('正则表达式无效');
  }
}

export function addLineNumbers(input: string, start = 1): string {
  return normalizeNewlines(input).split('\n').map((line, index) => `${start + index}. ${line}`).join('\n');
}

export function removeLineNumbers(input: string): string {
  return normalizeNewlines(input).split('\n').map(line => line.replace(/^\s*\d+[.)、:]\s*/, '')).join('\n');
}

export function analyzeText(input: string) {
  const normalized = normalizeNewlines(input);
  const tokens = normalized.match(/[\p{Script=Han}]|[\p{L}\p{N}_]+/gu) ?? [];
  const counts = new Map<string, number>();
  tokens.forEach(token => counts.set(token, (counts.get(token) ?? 0) + 1));
  return {
    lines: normalized.length ? normalized.split('\n').length : 0,
    characters: [...normalized].length,
    charactersNoWhitespace: [...normalized.replace(/\s/gu, '')].length,
    words: tokens.length,
    frequencies: [...counts].map(([token, count]) => ({ token, count })).sort((a, b) => b.count - a.count || a.token.localeCompare(b.token, 'zh-CN')),
  };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/core.ts SD/components/tools/text/core.test.ts
git commit -m "feat: add text replacement numbering and metrics"
```

### Task 3: Add entity extraction and file merge/split

**Files:**
- Modify: `SD/components/tools/text/core.ts`
- Modify: `SD/components/tools/text/core.test.ts`

- [ ] **Step 1: Write failing extraction and split tests**

```ts
import { extractEntities, mergeTextDocuments, splitTextByLines } from './core';

it('extracts unique email, URL, IPv4 and IPv6 values in encounter order', () => {
  expect(extractEntities('a@example.com https://example.com 8.8.8.8 a@example.com')).toEqual({
    emails: ['a@example.com'],
    urls: ['https://example.com'],
    ips: ['8.8.8.8'],
  });
});

it('merges named documents and splits text by line count', () => {
  expect(mergeTextDocuments([{ name: 'a.txt', text: 'A' }, { name: 'b.txt', text: 'B' }], true)).toContain('===== a.txt =====\nA');
  expect(splitTextByLines('1\n2\n3\n4\n5', 2)).toEqual(['1\n2', '3\n4', '5']);
  expect(() => splitTextByLines('x', 0)).toThrow('每份行数必须大于 0');
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement extraction, merge, and split**

Use global Unicode-safe patterns for email and HTTP(S) URLs. Validate IPv4 candidates by four integer octets in `0..255`; validate IPv6 candidates with the URL parser. Deduplicate with a stable `Set`.

```ts
const unique = (values: string[]) => [...new Set(values)];
const trimUrlPunctuation = (value: string) => value.replace(/[),.;!?，。；！？]+$/u, '');

const isIpv4 = (value: string) => {
  const octets = value.split('.');
  return octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
};

const isIpv6 = (value: string) => {
  if (!value.includes(':') || !/^[0-9a-f:]+$/i.test(value)) return false;
  try { new URL(`http://[${value}]/`); return true; } catch { return false; }
};

export function extractEntities(input: string): { emails: string[]; urls: string[]; ips: string[] } {
  const emails = unique(input.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu) ?? []);
  const urls = unique((input.match(/https?:\/\/[^\s<>"']+/giu) ?? []).map(trimUrlPunctuation));
  const ipCandidates = input.match(/(?:\b(?:\d{1,3}\.){3}\d{1,3}\b)|(?:\b[0-9a-f]*:[0-9a-f:]+\b)/giu) ?? [];
  const ips = unique(ipCandidates.filter(value => value.includes('.') ? isIpv4(value) : isIpv6(value)));
  return { emails, urls, ips };
}

export function mergeTextDocuments(documents: Array<{ name: string; text: string }>, includeHeadings: boolean): string {
  return documents.map(document => includeHeadings ? `===== ${document.name} =====\n${document.text}` : document.text).join('\n\n');
}

export function splitTextByLines(input: string, linesPerPart: number): string[] {
  if (!Number.isInteger(linesPerPart) || linesPerPart <= 0) throw new Error('每份行数必须大于 0');
  const lines = normalizeNewlines(input).split('\n');
  const parts: string[] = [];
  for (let index = 0; index < lines.length; index += linesPerPart) parts.push(lines.slice(index, index + linesPerPart).join('\n'));
  return parts;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/core.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/core.ts SD/components/tools/text/core.test.ts
git commit -m "feat: add local text extraction and file batching"
```

### Task 4: Implement safe markup conversion

**Files:**
- Create: `SD/components/tools/text/markup.ts`
- Create: `SD/components/tools/text/markup.test.ts`

- [ ] **Step 1: Write failing markup tests**

```ts
import { describe, expect, it } from 'vitest';
import { htmlToPlainText, markdownToHtml, plainTextToHtml } from './markup';

describe('text markup conversion', () => {
  it('escapes raw HTML before applying supported Markdown syntax', () => {
    expect(markdownToHtml('# 标题\n\n**粗体** <script>')).toContain('<h1>标题</h1>');
    expect(markdownToHtml('# 标题\n\n**粗体** <script>')).toContain('<strong>粗体</strong> &lt;script&gt;');
  });

  it('converts plain text and HTML without executing markup', () => {
    expect(plainTextToHtml('a\nb')).toBe('<p>a<br>b</p>');
    expect(htmlToPlainText('<h1>A</h1><script>alert(1)</script><p>B</p>')).toBe('A\nB');
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `cd SD && npm test -- components/tools/text/markup.test.ts`

Expected: FAIL because `markup.ts` does not exist.

- [ ] **Step 3: Implement conversion helpers**

`markdownToHtml` must HTML-escape first, then support headings `#`–`######`, unordered list lines, fenced code blocks, bold, emphasis, inline code, paragraphs, and line breaks. `plainTextToHtml` escapes then wraps paragraphs. `htmlToPlainText` uses `DOMParser`, removes `script`, `style`, `iframe`, `object`, and `template`, inserts newlines after block elements, returns normalized trimmed text, and never assigns parsed content to the live document.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/markup.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/markup.ts SD/components/tools/text/markup.test.ts
git commit -m "feat: add safe text markup conversion"
```

### Task 5: Build the shared text workbench

**Files:**
- Create: `SD/components/tools/text/TextWorkbench.tsx`
- Create: `SD/components/tools/text/TextWorkbench.test.tsx`

- [ ] **Step 1: Write the failing user-flow test**

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TextWorkbench } from './TextWorkbench';

describe('TextWorkbench', () => {
  it('processes input, reports counts and supports swapping output back to input', () => {
    render(<TextWorkbench title="文本去空行" description="删除空白行" process={value => value.split('\n').filter(Boolean).join('\n')} />);
    fireEvent.change(screen.getByLabelText('输入文本'), { target: { value: 'a\n\nb' } });
    fireEvent.click(screen.getByRole('button', { name: '开始处理' }));
    expect(screen.getByLabelText('处理结果')).toHaveValue('a\nb');
    fireEvent.click(screen.getByRole('button', { name: '结果作为输入' }));
    expect(screen.getByLabelText('输入文本')).toHaveValue('a\nb');
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `cd SD && npm test -- components/tools/text/TextWorkbench.test.tsx`

Expected: FAIL because the workbench does not exist.

- [ ] **Step 3: Implement the workbench**

The component accepts `title`, `description`, `process(input): string`, optional `controls`, and optional `acceptFiles`. Render labelled input/output textareas, character and line counts, Process, Clear, Swap Result to Input, Copy, and Download TXT buttons. Catch processing errors and show `<p role="alert">`. File loading accepts at most 20 UTF-8 text files, rejects a single file over 5 MiB, and revokes download object URLs immediately after click.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/TextWorkbench.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/TextWorkbench.tsx SD/components/tools/text/TextWorkbench.test.tsx
git commit -m "feat: add shared local text workbench"
```

### Task 6: Expose nine independent tool modes

**Files:**
- Create: `SD/components/tools/text/TextTools.tsx`
- Create: `SD/components/tools/text/TextTools.test.tsx`

- [ ] **Step 1: Write the failing export contract**

Render and assert headings for these named exports: `RemoveBlankLinesTool`, `DedupeLinesTool`, `SortLinesTool`, `BatchReplaceTool`, `LineNumberTool`, `CharacterFrequencyTool`, `EntityExtractorTool`, `TextFileBatchTool`, and `MarkupConverterTool`.

- [ ] **Step 2: Run the export test and verify RED**

Run: `cd SD && npm test -- components/tools/text/TextTools.test.tsx`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement mode components**

Each named export has the standard `{ onClose: () => void }` prop and renders `TextWorkbench` or a focused extension of it. Wire modes exactly as follows:

- `RemoveBlankLinesTool` → `removeBlankLines`.
- `DedupeLinesTool` → `dedupeLines` with a case-sensitive checkbox.
- `SortLinesTool` → `sortLines` with ascending/descending select.
- `BatchReplaceTool` → `replaceText` with search, replacement, regex, and case controls.
- `LineNumberTool` → add/remove toggle and positive start number.
- `CharacterFrequencyTool` → `analyzeText`, with metrics and top 100 frequency rows.
- `EntityExtractorTool` → `extractEntities`, with tabs for email, URL, and IP output.
- `TextFileBatchTool` → file merge mode and line-count split mode; split downloads a ZIP using the existing `jszip` dependency.
- `MarkupConverterTool` → source and target selects for Markdown, HTML, and plain text; reject identical formats.

Every mode includes a visible Close button calling `onClose`; no mode uploads data.

- [ ] **Step 4: Run the export test and verify GREEN**

Run: `cd SD && npm test -- components/tools/text/TextTools.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add SD/components/tools/text/TextTools.tsx SD/components/tools/text/TextTools.test.tsx
git commit -m "feat: expose nine text efficiency tools"
```

### Task 7: Register the text category and search pages

**Files:**
- Modify: `SD/tools/registry.tsx`
- Modify: `SD/seo/categoryContent.ts`
- Modify: `SD/tools/registryMetadata.test.ts`

- [ ] **Step 1: Write the failing registry contract**

Add a test asserting category `text` exists and the exact tool IDs are:

```ts
[
  'remove-blank-lines',
  'dedupe-lines',
  'sort-lines',
  'batch-text-replace',
  'line-number-tool',
  'character-frequency',
  'entity-extractor',
  'text-file-batch',
  'markup-converter',
]
```

Assert every entry has `privacy: 'local'`, `status: 'stable'`, and at least four Chinese/pinyin/English tags.

- [ ] **Step 2: Run the registry test and verify RED**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts`

Expected: FAIL because the category and tools are absent.

- [ ] **Step 3: Extend the category union and lazy exports**

Add `'text'` to `ToolDef['category']`. Add one `React.lazy` per named export using `import('../components/tools/text/TextTools').then(module => ({ default: module.RemoveBlankLinesTool }))` and the corresponding export name for all nine modes.

- [ ] **Step 4: Register the category and tools**

Add category `{ id: 'text', name: '文本工具', description: '文本清理、提取、替换与文件整理', icon: 'FileText', gradient: 'from-sky-600 to-cyan-600' }`. Register the exact IDs from Step 1 with clear Chinese names/descriptions, unique icons, `color: 'cyan'`, the same sky/cyan gradient, local privacy, stable status, and intent-specific tags.

- [ ] **Step 5: Add literal category SEO content**

```ts
text: {
  description: '提供文本去空行、去重、排序、批量替换、行号、词频统计、信息提取和文本文件整理。所有内容在浏览器本地处理，适合数据清洗、内容编辑与开发前处理。',
  features: ['批量文本清理', '本地文件处理', '结果复制与下载'],
  faq: [
    { question: '输入的文本会上传吗？', answer: '不会，文本转换与文件读取都在当前浏览器中完成。' },
    { question: '可以处理多大的文本？', answer: '单个文本文件限制为 5 MiB，批量最多选择 20 个文件，以避免浏览器内存不足。' },
  ],
},
```

- [ ] **Step 6: Run registry, content, and static generation tests**

Run: `cd SD && npm test -- tools/registryMetadata.test.ts seo/categoryContent.test.ts seo/pageMetadata.test.ts scripts/generate-static-pages.test.ts`

Expected: PASS.

- [ ] **Step 7: Build and verify generated text routes**

Run: `cd SD && npm run build`

Expected: exit 0; `dist/category/text/index.html` and all nine `dist/tool/<id>/index.html` files exist.

- [ ] **Step 8: Commit**

```bash
git add SD/tools/registry.tsx SD/seo/categoryContent.ts SD/tools/registryMetadata.test.ts SD/public/sitemap.xml
git commit -m "feat: register searchable text tools category"
```

### Task 8: Full verification for text tools

**Files:**
- Modify: `SD/components/tools/text/core.ts`
- Modify: `SD/components/tools/text/markup.ts`
- Modify: `SD/components/tools/text/TextWorkbench.tsx`
- Modify: `SD/components/tools/text/TextTools.tsx`
- Modify: `SD/tools/registry.tsx`
- Modify: `SD/seo/categoryContent.ts`

- [ ] **Step 1: Run all text tests**

Run: `cd SD && npm test -- components/tools/text`

Expected: all text tests pass.

- [ ] **Step 2: Run complete frontend verification**

Run: `cd SD && npm test && npm run lint && npm run validate && npm run build`

Expected: all commands exit 0.

- [ ] **Step 3: Browser-check representative modes**

Open `/tool/remove-blank-lines`, `/tool/batch-text-replace`, `/tool/entity-extractor`, and `/tool/text-file-batch` at desktop and 390×844 mobile widths. Verify labels, overflow, errors, copy/download, and local privacy copy.

- [ ] **Step 4: Commit concrete verification fixes**

```bash
git add SD/components/tools/text SD/tools/registry.tsx SD/seo/categoryContent.ts SD/public/sitemap.xml
git commit -m "fix: resolve text tools verification findings"
```

Do not create an empty commit when no fixes were required.
