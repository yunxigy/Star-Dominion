const HTML_TAG_RE = /<[^>]*>/g;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\([^)]*\)/g;
const MARKDOWN_EMPHASIS_RE = /[*_`>#]/g;

export function cleanNewsText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(MARKDOWN_LINK_RE, "$1")
    .replace(HTML_TAG_RE, " ")
    .replace(MARKDOWN_EMPHASIS_RE, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function newsChineseLead(title: string, topics: string[]): string {
  const text = cleanNewsText(title).toLowerCase();
  if (text.includes("agent") || text.includes("model") || topics.some((topic) => /ai|model|agent/i.test(topic))) {
    return "AI 行业动态";
  }
  if (text.includes("market") || text.includes("stock")) return "市场与公司动态";
  return "科技行业动态";
}

export function displayNewsTitle(title: string, topics: string[]): string {
  const cleanTitle = cleanNewsText(title);
  return cleanTitle ? `${newsChineseLead(cleanTitle, topics)}：${cleanTitle}` : "未命名新闻";
}

export function displayNewsSummary(summary: string | null | undefined, title: string, topics: string[]): string {
  const cleanSummary = cleanNewsText(summary);
  if (cleanSummary && /[\u3400-\u9fff]/.test(cleanSummary)) return cleanSummary;
  return `${newsChineseLead(title, topics)}，请打开原文查看完整内容。`;
}

export function displayNewsSource(authorOrPublisher: string | null | undefined, sourceId: string): string {
  const publisher = cleanNewsText(authorOrPublisher);
  if (publisher && !/^[0-9a-f-]{20,}$/i.test(publisher)) return publisher;
  if (sourceId.startsWith("x_")) return "X / Twitter 公开索引";
  if (sourceId.startsWith("google_")) return "Google News RSS";
  return "公开 RSS";
}
