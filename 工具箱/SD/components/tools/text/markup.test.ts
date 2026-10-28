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
