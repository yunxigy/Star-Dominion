import { createHash } from "node:crypto";

const COMMON_COMPOUND_PUBLIC_SUFFIXES = new Set([
  "ac.jp", "ac.nz", "ac.uk", "asn.au", "co.jp", "co.kr", "co.nz", "co.uk",
  "com.au", "com.br", "com.cn", "com.hk", "com.mx", "com.sg", "com.tr", "com.tw",
  "edu.au", "edu.cn", "edu.hk", "edu.sg", "go.jp", "go.kr", "gov.au", "gov.br",
  "gov.cn", "gov.hk", "gov.sg", "gov.uk", "ne.jp", "net.au", "net.br", "net.cn",
  "net.hk", "net.nz", "net.sg", "or.jp", "org.au", "org.br", "org.cn", "org.hk",
  "org.nz", "org.sg", "org.uk",
]);

export interface SourceSummaryInput {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
  content?: string;
}

export interface SourceCoveragePeriod {
  coverageStart?: string;
  coverageEnd?: string;
}

/** Infer only explicit temporal coverage, never a publication date. */
export function inferSourceCoveragePeriod(input: SourceSummaryInput): SourceCoveragePeriod {
  const candidates = [
    input.title,
    [input.description, input.snippet].filter(Boolean).join(" "),
    input.content?.slice(0, 20_000),
  ];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const coverage = inferCoverageFromText(candidate.normalize("NFKC"));
    if (coverage.coverageStart || coverage.coverageEnd) return coverage;
  }
  return {};
}

function inferCoverageFromText(text: string): SourceCoveragePeriod {
  const explicitAsOf = text.match(/截至\s*((?:19|20)\d{2})\s*年\s*(?:12\s*月\s*31\s*日|底|末)/u)
    ?? text.match(/as\s+of\s+(?:dec(?:ember)?\s+31,?\s+)?((?:19|20)\d{2})/iu);
  const annual = text.match(/((?:19|20)\d{2})\s*年度\s*(?:统计|分析|报告|年报)/u)
    ?? text.match(/((?:19|20)\d{2})\s+(?:annual|yearly)\s+(?:statistics|statistical|analysis|report)/iu)
    ?? text.match(/(?:annual|yearly)\s+(?:statistics|statistical|analysis|report)\s+(?:for\s+)?((?:19|20)\d{2})/iu);
  if (explicitAsOf?.[1]) {
    return annual?.[1] === explicitAsOf[1]
      ? { coverageStart: `${explicitAsOf[1]}-01-01`, coverageEnd: `${explicitAsOf[1]}-12-31` }
      : { coverageEnd: `${explicitAsOf[1]}-12-31` };
  }
  if (annual?.[1]) {
    return { coverageStart: `${annual[1]}-01-01`, coverageEnd: `${annual[1]}-12-31` };
  }
  const range = text.match(/((?:19|20)\d{2})\s*(?:-|–|—|至|到)\s*((?:19|20)\d{2})\s*年?/u);
  if (range?.[1] && range[2] && Number(range[1]) <= Number(range[2])) {
    return { coverageStart: `${range[1]}-01-01`, coverageEnd: `${range[2]}-12-31` };
  }
  return {};
}

export function canonicalizeSourceUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || ["spm", "from", "source", "share", "ref", "ref_src"].includes(lower)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    if (!parsed.searchParams.toString()) parsed.search = "";
    return parsed.toString();
  } catch {
    return url.trim();
  }
}

export function sourcePublisherDomain(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    if (!host || host === "localhost" || /^\[.*\]$/.test(host) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return host || undefined;
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return host;
    const compoundSuffix = labels.slice(-2).join(".");
    return labels.slice(COMMON_COMPOUND_PUBLIC_SUFFIXES.has(compoundSuffix) ? -3 : -2).join(".");
  } catch {
    return undefined;
  }
}

export function knowledgeNodeIdForUrl(url: string | undefined, fallback: string): string {
  const canonical = canonicalizeSourceUrl(url);
  const basis = canonical || fallback;
  return `K_url_${createHash("sha1").update(basis).digest("hex").slice(0, 16)}`;
}

export function sourceContentHash(url: string | undefined, content: string): string {
  return `sha256:${createHash("sha256").update(`${canonicalizeSourceUrl(url)}\n${content}`).digest("hex")}`;
}

export function buildSourceSummary(input: SourceSummaryInput, maxChars = 900): string {
  const title = clean(input.title);
  const description = clean(input.description);
  const snippet = clean(input.snippet);
  const content = stripReaderBoilerplate(clean(input.content));
  const sentences = splitSentences(content)
    .filter((sentence) => sentence.length >= 18 && !isNavigationNoise(sentence))
    .slice(0, 4);
  const parts = [
    title ? `资料题名：${title}` : "",
    description ? `页面说明：${description}` : "",
    snippet ? `搜索摘要：${snippet}` : "",
    sentences.length ? `内容概览：${sentences.join(" ")}` : "",
  ].filter(Boolean);
  const summary = parts.join("\n");
  const fallback = snippet || content || title || input.url || "";
  return truncate(summary || fallback, maxChars);
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 3))}...`;
}

function clean(value: string | undefined): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function stripReaderBoilerplate(value: string): string {
  return value
    .replace(/^Title:\s*.+?URL Source:/s, "URL Source:")
    .replace(/URL Source:\s*\S+/g, "")
    .replace(/Published Time:\s*.+?(?=Markdown Content:|$)/g, "")
    .replace(/Markdown Content:/g, "")
    .trim();
}

function splitSentences(value: string): string[] {
  return value
    .split(/(?<=[。！？.!?])\s+|\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isNavigationNoise(value: string): boolean {
  if (/^(首页|当前位置|责任编辑|来源|责编|一审|二审|三审|分享到|打印|关闭)[：:]/.test(value)) return true;
  const linkNoise = (value.match(/\[|\]|\(|\)|Image|点击|返回/g) ?? []).length;
  return linkNoise >= 5;
}
