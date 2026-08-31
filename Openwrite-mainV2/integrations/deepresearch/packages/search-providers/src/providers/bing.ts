import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError, throwIfAborted } from "@deepresearch/net-utils";

export interface BingSearchOptions {
  timeoutMs?: number;
  userAgent?: string;
  market?: string;
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
}

export class BingSearchProvider implements SearchProvider {
  readonly name = "bing-html";
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly market: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxResponseBytes: number;

  constructor(opts: BingSearchOptions = {}) {
    this.timeoutMs = opts.timeoutMs ?? 15000;
    this.userAgent = opts.userAgent ??
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    this.market = opts.market ?? "zh-CN";
    this.fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.maxResponseBytes = boundedResponseBytes(opts.maxResponseBytes);
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];
    throwIfAborted(opts.signal, "Bing search aborted");
    const officialIdentifiers = officialEuropeanLawHits(query);
    if (officialIdentifiers.length > 0) return officialIdentifiers.slice(0, topK);

    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("q", query);
    url.searchParams.set("mkt", this.market);
    url.searchParams.set("setlang", this.market.toLowerCase().startsWith("zh") ? "zh-cn" : "en-us");
    url.searchParams.set("cc", this.market.toLowerCase().startsWith("zh") ? "CN" : "US");
    if (!this.market.toLowerCase().startsWith("zh")) url.searchParams.set("ensearch", "1");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url.toString(), {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": `${this.market},zh;q=0.9,en;q=0.8`,
        },
        redirect: "follow",
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`Bing HTTP ${resp.status}`);
      const html = await readBoundedText(resp, this.maxResponseBytes);
      return relevantBingHits(parseBingHtml(html, Math.max(topK * 3, 10)), query).slice(0, topK);
    } catch (err) {
      if (opts.signal?.aborted) throw abortError(opts.signal, "Bing search aborted");
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function officialEuropeanLawHits(query: string): SearchHit[] {
  const out: SearchHit[] = [];
  for (const match of query.matchAll(/\bCELEX\s*:?\s*([0-9][0-9A-Z]{7,15})\b/giu)) {
    pushCelexHit(out, match[1]!, `Official EUR-Lex text (${match[1]!.toUpperCase()})`);
  }
  for (const match of query.matchAll(/\bEUR-?Lex\s*:?\s*(3\d{4}[RLD]\d{4})\b/giu)) {
    pushCelexHit(out, match[1]!, `Official EUR-Lex text (${match[1]!.toUpperCase()})`);
  }
  const types: Array<{ pattern: RegExp; code: string; label: string }> = [
    { pattern: /\bRegulation\s*\(\s*EU\s*\)\s*(\d{4})\s*\/\s*(\d{1,4})\b/giu, code: "R", label: "Regulation (EU)" },
    { pattern: /\bDirective\s*\(\s*EU\s*\)\s*(\d{4})\s*\/\s*(\d{1,4})\b/giu, code: "L", label: "Directive (EU)" },
    { pattern: /\bDecision\s*\(\s*EU\s*\)\s*(\d{4})\s*\/\s*(\d{1,4})\b/giu, code: "D", label: "Decision (EU)" },
  ];
  for (const type of types) {
    for (const match of query.matchAll(type.pattern)) {
      const year = match[1]!;
      const number = match[2]!.padStart(4, "0");
      pushCelexHit(out, `3${year}${type.code}${number}`, `${type.label} ${year}/${match[2]} — official EUR-Lex text`);
    }
  }
  return out;
}

function pushCelexHit(out: SearchHit[], identifier: string, title: string): void {
  const normalized = identifier.toUpperCase();
  const url = eliUrlForCelex(normalized) ?? `https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:${normalized}`;
  if (out.some((item) => item.url === url)) return;
  out.push({
    url,
    title,
    snippet: `Direct official EUR-Lex resolution for CELEX identifier ${normalized}.`,
  });
}

function eliUrlForCelex(identifier: string): string | undefined {
  const match = identifier.match(/^3(\d{4})([RLD])(\d{4})$/u);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const type = { R: "reg", L: "dir", D: "dec" }[match[2]];
  if (!type) return undefined;
  return `https://eur-lex.europa.eu/eli/${type}/${match[1]}/${Number(match[3])}/oj`;
}

function relevantBingHits(hits: SearchHit[], query: string): SearchHit[] {
  const terms = queryTerms(query);
  if (!terms.length) return hits;
  const minimumMatches = terms.length >= 4 ? 2 : 1;
  return hits
    .map((hit, index) => ({
      hit,
      index,
      matches: terms.filter((term) => `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase().includes(term)).length,
    }))
    .filter((item) => item.matches >= minimumMatches)
    .sort((left, right) => right.matches - left.matches || left.index - right.index)
    .map((item) => item.hit);
}

function queryTerms(query: string): string[] {
  const ignored = new Set([
    "and", "the", "for", "from", "with", "site", "http", "https", "www", "com", "org",
    "article", "filetype", "find", "guide", "guidance", "official", "paper", "pdf", "primary", "report", "research", "source",
    "探究", "究并", "并解", "解释", "识别", "别并", "并描", "描述", "调研", "研究", "汇集", "集并", "并综", "综合", "总结",
    "包括", "括如", "如何", "何围", "围绕", "基本", "原则", "核心", "要素", "官方", "权威", "资料", "来源", "报告", "文章", "指南", "分析",
  ]);
  const terms: string[] = [];
  for (const raw of query.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    if (ignored.has(raw)) continue;
    if (/^\p{Script=Han}+$/u.test(raw) && raw.length > 2) {
      for (let index = 0; index < raw.length - 1; index += 1) {
        const term = raw.slice(index, index + 2);
        if (!ignored.has(term)) terms.push(term);
      }
    } else {
      terms.push(raw);
    }
  }
  return Array.from(new Set(terms));
}

function boundedResponseBytes(value: number | undefined): number {
  if (value === undefined) return 5_000_000;
  if (!Number.isInteger(value) || value <= 0 || value > 20_000_000) {
    throw new Error("maxResponseBytes must be an integer between 1 and 20000000");
  }
  return value;
}

async function readBoundedText(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new Error(`Bing response exceeds ${maxBytes} byte limit: ${contentLength}`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`Bing response exceeds ${maxBytes} byte limit while reading`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function parseBingHtml(html: string, topK: number): SearchHit[] {
  const out: SearchHit[] = [];
  const blocks = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
      ?? block.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link?.[1] || !link[2]) continue;
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i)
      ?? block.match(/<div class="b_caption"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const url = unwrapBingUrl(decodeHtml(link[1]));
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: htmlToText(link[2]),
      snippet: snippetMatch?.[1] ? htmlToText(snippetMatch[1]) : "",
    });
    if (out.length >= topK) break;
  }
  return out;
}

function unwrapBingUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!/bing\.com$/i.test(u.hostname) && !/\.bing\.com$/i.test(u.hostname)) return url;
    const encoded = u.searchParams.get("u");
    if (!encoded?.startsWith("a1")) return url;
    const b64 = encoded.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return url;
  }
}

function htmlToText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
