const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const inlineMarkdown = (value: string) => value
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/__([^_]+)__/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>')
  .replace(/_([^_]+)_/g, '<em>$1</em>');

export function markdownToHtml(markdown: string): string {
  const escaped = escapeHtml(markdown.replace(/\r\n?/g, '\n'));
  const lines = escaped.split('\n');
  const output: string[] = [];
  let inCode = false;
  let codeLines: string[] = [];
  let inList = false;
  let paragraph: string[] = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inlineMarkdown(paragraph.join('<br>'))}</p>`);
    paragraph = [];
  };
  const closeList = () => { if (inList) { output.push('</ul>'); inList = false; } };
  for (const line of lines) {
    if (/^```/.test(line)) {
      flushParagraph(); closeList();
      if (inCode) { output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`); codeLines = []; }
      inCode = !inCode;
      continue;
    }
    if (inCode) { codeLines.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = heading[1].length; output.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`); continue; }
    const listItem = line.match(/^\s*[-*+]\s+(.+)$/);
    if (listItem) { flushParagraph(); if (!inList) { output.push('<ul>'); inList = true; } output.push(`<li>${inlineMarkdown(listItem[1])}</li>`); continue; }
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    closeList(); paragraph.push(line);
  }
  if (inCode) output.push(`<pre><code>${codeLines.join('\n')}</code></pre>`);
  flushParagraph(); closeList();
  return output.join('');
}

export function plainTextToHtml(input: string): string {
  const paragraphs = input.replace(/\r\n?/g, '\n').split(/\n{2,}/).filter((part) => part.length > 0);
  return paragraphs.length ? paragraphs.map((part) => `<p>${escapeHtml(part).replace(/\n/g, '<br>')}</p>`).join('') : '<p></p>';
}

export function htmlToPlainText(input: string): string {
  if (typeof DOMParser === 'undefined') {
    return input
      .replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(h[1-6]|p|div|li|section|article|header|footer|main|nav|pre|ul|ol|table|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();
  }
  const document = new DOMParser().parseFromString(input, 'text/html');
  document.querySelectorAll('script,style,iframe,object,template').forEach((node) => node.remove());
  const blockTags = 'address,article,aside,blockquote,div,dl,fieldset,footer,form,h1,h2,h3,h4,h5,h6,header,hr,li,main,nav,ol,p,pre,section,table,ul,tr';
  document.querySelectorAll(blockTags).forEach((node) => node.appendChild(document.createTextNode('\n')));
  return (document.body.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export { escapeHtml };
