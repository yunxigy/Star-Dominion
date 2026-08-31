import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError } from "@deepresearch/net-utils";

export interface ArxivSearchOptions {
  timeoutMs?: number;
  sortBy?: "relevance" | "lastUpdatedDate" | "submittedDate";
  sortOrder?: "ascending" | "descending";
  fetchImpl?: typeof fetch;
}

export class ArxivSearchProvider implements SearchProvider {
  readonly name = "arxiv";
  private readonly opts: Required<ArxivSearchOptions>;

  constructor(opts: ArxivSearchOptions = {}) {
    this.opts = {
      timeoutMs: 15000,
      sortBy: "relevance",
      sortOrder: "descending",
      fetchImpl: defaultFetch,
      ...opts,
    };
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];
    if (opts.signal?.aborted) throw abortError(opts.signal, "arXiv search aborted");

    const url = new URL("https://export.arxiv.org/api/query");
    url.searchParams.set("search_query", query);
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", String(Math.min(Math.max(topK, 1), 50)));
    url.searchParams.set("sortBy", this.opts.sortBy);
    url.searchParams.set("sortOrder", this.opts.sortOrder);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const resp = await this.opts.fetchImpl(url.toString(), {
        headers: { Accept: "application/atom+xml,application/xml,text/xml,*/*" },
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`arXiv API HTTP ${resp.status}: ${await resp.text()}`);
      return parseArxivAtom(await resp.text(), topK);
    } catch (error) {
      if (opts.signal?.aborted) throw abortError(opts.signal, "arXiv search aborted");
      throw error;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function parseArxivAtom(xml: string, topK: number): SearchHit[] {
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  return entries.slice(0, topK).flatMap((entry) => {
    const title = textOf(entry, "title");
    const summary = textOf(entry, "summary");
    const id = textOf(entry, "id");
    const published = textOf(entry, "published");
    if (!title || !id) return [];
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map((m) => decodeXml(m[1] ?? "").trim())
      .filter(Boolean)
      .slice(0, 5)
      .join(", ");
    return [{
      url: id.replace(/^http:\/\//i, "https://").replace("/pdf/", "/abs/"),
      title: normalizeText(title),
      snippet: [
        published ? `Published: ${published.slice(0, 10)}.` : "",
        authors ? `Authors: ${authors}.` : "",
        normalizeText(summary),
      ].filter(Boolean).join(" "),
    }];
  });
}

function textOf(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1] ? decodeXml(m[1]) : "";
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)));
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
