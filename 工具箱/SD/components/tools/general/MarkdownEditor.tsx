import React, { useState, useMemo } from 'react';
import { Btn, copyToClipboard } from '../shared';
import { FileText, Copy, CheckCircle, Eye, Edit3, Download } from 'lucide-react';

const markdownToHtml = (md: string): string => {
  let html = md;

  // Code blocks (must be before inline code)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&').replace(/</g, '<').replace(/>/g, '>');
    return `<pre class="bg-gray-800 text-green-200 rounded p-3 my-2 overflow-x-auto text-xs"><code class="language-${lang}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-red-600 px-1 rounded text-xs">$1</code>');

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, '<h6 class="text-xs font-bold mt-3 mb-1 text-[#6d5a47]">$1</h6>');
  html = html.replace(/^#####\s+(.+)$/gm, '<h5 class="text-sm font-bold mt-3 mb-1 text-[#6d5a47]">$1</h5>');
  html = html.replace(/^####\s+(.+)$/gm, '<h4 class="text-base font-bold mt-3 mb-1 text-[#6f3714]">$1</h4>');
  html = html.replace(/^###\s+(.+)$/gm, '<h3 class="text-lg font-bold mt-3 mb-1 text-[#6f3714]">$1</h3>');
  html = html.replace(/^##\s+(.+)$/gm, '<h2 class="text-xl font-bold mt-4 mb-2 text-[#7a421b] border-b border-[#ead0ad] pb-1">$1</h2>');
  html = html.replace(/^#\s+(.+)$/gm, '<h1 class="text-2xl font-bold mt-4 mb-2 text-[#7a421b] border-b-2 border-[#7a421b] pb-1">$1</h1>');

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr class="border-[#ead0ad] my-4" />');

  // Bold and italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Blockquote
  html = html.replace(/^>\s+(.+)$/gm, '<blockquote class="border-l-4 border-[#c79f72] pl-3 my-2 text-[#8b735c] italic">$1</blockquote>');

  // Unordered list
  html = html.replace(/^[\s]*[-*+]\s+(.+)$/gm, '<li class="ml-4 list-disc text-[#6d5a47]">$1</li>');

  // Ordered list
  html = html.replace(/^[\s]*\d+\.\s+(.+)$/gm, '<li class="ml-4 list-decimal text-[#6d5a47]">$1</li>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-[#7a421b] underline hover:text-[#6f3714]" target="_blank" rel="noopener">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="max-w-full rounded my-2 border border-[#ead0ad]" />');

  // Table (simple)
  html = html.replace(/^\|(.+)\|$/gm, (match, content) => {
    const cells = content.split('|').map((c: string) => c.trim());
    if (cells.every((c: string) => /^[-:]+$/.test(c))) return ''; // separator row
    const tag = 'td';
    return '<tr>' + cells.map((c: string) => `<${tag} class="border border-[#ead0ad] px-2 py-1 text-xs">${c}</${tag}>`).join('') + '</tr>';
  });
  // Wrap consecutive tr in table
  html = html.replace(/((<tr>.*<\/tr>\n?)+)/g, '<table class="border-collapse w-full my-2">$1</table>');

  // Task list
  html = html.replace(/<li class="ml-4 list-disc text-\[#6d5a47\]">\[x\]\s*/g, '<li class="ml-4 list-none text-[#6d5a47]"><input type="checkbox" checked disabled class="mr-1 accent-[#7a421b]" /> ');
  html = html.replace(/<li class="ml-4 list-disc text-\[#6d5a47\]">\[\s?\]\s*/g, '<li class="ml-4 list-none text-[#6d5a47]"><input type="checkbox" disabled class="mr-1 accent-[#7a421b]" /> ');

  // Paragraphs - wrap remaining lines
  html = html.replace(/\n\n+/g, '\n\n');
  html = html.split('\n\n').map(block => {
    const trimmed = block.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<')) return trimmed;
    return `<p class="my-1 text-[#6d5a47]">${trimmed.replace(/\n/g, '<br />')}</p>`;
  }).join('\n');

  return html;
};

const SAMPLE_MD = `# Markdown 编辑器示例

## 基本语法

这是一段**粗体**和*斜体*文字，还有~~删除线~~。

### 列表

- 项目一
- 项目二
- [ ] 待办事项
- [x] 已完成

1. 有序列表一
2. 有序列表二

### 引用

> 这是一段引用文字

### 代码

\`\`\`javascript
const greeting = "Hello, World!";
console.log(greeting);
\`\`\`

行内代码: \`const x = 1\`

### 链接

[访问示例](https://example.com)

---

| 列1 | 列2 | 列3 |
|-----|-----|-----|
| A   | B   | C   |
| D   | E   | F   |
`;

const MarkdownEditor: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [markdown, setMarkdown] = useState(SAMPLE_MD);
  const [view, setView] = useState<'split' | 'edit' | 'preview'>('split');
  const [copied, setCopied] = useState(false);

  const html = useMemo(() => markdownToHtml(markdown), [markdown]);

  const handleCopy = async () => {
    await copyToClipboard(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyHtml = async () => {
    await copyToClipboard(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'document.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const wordCount = markdown.replace(/\s/g, '').length;
  const lineCount = markdown.split('\n').length;
  const charCount = markdown.length;

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#8b735c]">Markdown 编辑器/预览 — 实时分栏预览、常见语法支持</p>

      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex border border-[#ead0ad] rounded overflow-hidden">
          <button onClick={() => setView('edit')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${view === 'edit' ? 'bg-[#7a421b] text-white' : 'bg-white text-[#6d5a47]'}`}>
            <Edit3 className="w-3 h-3" /> 编辑
          </button>
          <button onClick={() => setView('split')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${view === 'split' ? 'bg-[#7a421b] text-white' : 'bg-white text-[#6d5a47]'}`}>
            <FileText className="w-3 h-3" /> 分栏
          </button>
          <button onClick={() => setView('preview')}
            className={`px-2 py-1 text-xs flex items-center gap-1 ${view === 'preview' ? 'bg-[#7a421b] text-white' : 'bg-white text-[#6d5a47]'}`}>
            <Eye className="w-3 h-3" /> 预览
          </button>
        </div>
        <div className="flex-1" />
        <button onClick={handleCopy} className="p-1 text-[#7a421b] hover:text-[#6f3714]" title="复制 Markdown">
          {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
        </button>
        <button onClick={handleDownload} className="p-1 text-[#7a421b] hover:text-[#6f3714]" title="下载 .md">
          <Download className="w-4 h-4" />
        </button>
      </div>

      {/* Editor area */}
      <div className={`border border-[#ead0ad] rounded-lg overflow-hidden ${view === 'split' ? 'grid grid-cols-2 divide-x divide-[#ead0ad]' : ''}`}>
        {(view === 'edit' || view === 'split') && (
          <div className="relative">
            <div className="bg-[#fff4e6] text-[10px] text-[#8b735c] text-center py-1 border-b border-[#ead0ad]">Markdown</div>
            <textarea value={markdown} onChange={e => setMarkdown(e.target.value)}
              className="w-full h-80 text-xs font-mono px-3 py-2 bg-white resize-none focus:outline-none"
              placeholder="输入 Markdown 内容..." />
          </div>
        )}
        {(view === 'preview' || view === 'split') && (
          <div className="overflow-y-auto" style={{ maxHeight: '340px' }}>
            <div className="bg-[#fff4e6] text-[10px] text-[#8b735c] text-center py-1 border-b border-[#ead0ad]">预览</div>
            <div className="px-4 py-3 prose-sm" dangerouslySetInnerHTML={{ __html: html }} />
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="flex gap-4 text-[10px] text-[#8b735c]">
        <span>字符: {charCount}</span>
        <span>字数: {wordCount}</span>
        <span>行数: {lineCount}</span>
      </div>

      {/* Quick insert toolbar */}
      <div className="flex flex-wrap gap-1">
        {[
          { label: '#', insert: '# ' },
          { label: '##', insert: '## ' },
          { label: '###', insert: '### ' },
          { label: '**B**', insert: '**粗体**' },
          { label: '*I*', insert: '*斜体*' },
          { label: '~~S~~', insert: '~~删除~~' },
          { label: '```', insert: '```\n代码\n```' },
          { label: '- []', insert: '- [ ] ' },
          { label: '---', insert: '\n---\n' },
          { label: '|', insert: '| 列1 | 列2 |\n|------|------|\n| A | B |' },
        ].map(btn => (
          <button key={btn.label} onClick={() => setMarkdown(prev => prev + '\n' + btn.insert)}
            className="px-2 py-0.5 text-[10px] border border-[#ead0ad] rounded bg-white text-[#6d5a47] hover:bg-[#fff4e6] font-mono">
            {btn.label}
          </button>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[10px] text-amber-700">
        提示：此编辑器使用内置简化 Markdown 解析器，支持标题/粗体/斜体/代码/列表/表格/引用/链接等常见语法。复杂语法（如嵌套列表、脚注）暂不支持。
      </div>

      <div className="flex gap-2">
        <Btn onClick={onClose} variant="ghost">关闭</Btn>
      </div>
    </div>
  );
};

export default MarkdownEditor;