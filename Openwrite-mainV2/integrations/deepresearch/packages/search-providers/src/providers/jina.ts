import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError, createProxyFetch, envProxy, formatFetchError, macosSystemProxy, sleep, throwIfAborted } from "@deepresearch/net-utils";

export interface JinaSearchOptions {
  apiKey: string;
  timeoutMs?: number;
  num?: number;
  maxNum?: number;
  proxy?: string;
  retry?: number;
  fetchImpl?: typeof fetch;
}

export class JinaSearchProvider implements SearchProvider {
  static readonly apiMaxNum = 20;
  readonly name = "jina-search";
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly num: number;
  private readonly maxNum: number;
  private readonly proxy?: string;
  private readonly retry: number;
  private readonly fetchImpl?: typeof fetch;

  constructor(opts: JinaSearchOptions) {
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.num = opts.num ?? 5;
    this.maxNum = Math.min(opts.maxNum ?? JinaSearchProvider.apiMaxNum, JinaSearchProvider.apiMaxNum);
    this.proxy = opts.proxy ?? envProxy();
    this.retry = opts.retry ?? 2;
    this.fetchImpl = opts.fetchImpl;
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];
    throwIfAborted(opts.signal, "Jina search aborted");

    const url = new URL("https://s.jina.ai/");
    url.searchParams.set("q", query);
    url.searchParams.set("num", String(Math.min(Math.max(topK, this.num, 1), this.maxNum)));

    const fetchFn = await this.getFetch();
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry + 1; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (opts.signal?.aborted) controller.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const resp = await fetchFn(url.toString(), {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
        }).catch((err: unknown) => {
          throw new Error(`Jina search request failed for ${url.origin} after ${this.timeoutMs}ms (attempt ${attempt}/${this.retry + 1}): ${formatFetchError(err)}`);
        });

        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          if (resp.status === 422 && isNoSearchResultsResponse(body)) return [];
          throw new Error(`Jina search HTTP ${resp.status} (attempt ${attempt}/${this.retry + 1}): ${body.slice(0, 200)}`);
        }

        const json = (await resp.json()) as {
          data?: Array<{ title?: string; url?: string; description?: string; content?: string }>;
        };

        return (json.data ?? [])
          .filter((item) => item.url && item.title)
          .slice(0, topK)
          .map((item) => ({
            url: item.url!,
            title: item.title!,
            snippet: item.description ?? item.content?.slice(0, 300) ?? "",
          }));
      } catch (err) {
        if (opts.signal?.aborted) throw abortError(opts.signal, "Jina search aborted");
        lastError = err;
        if (attempt > this.retry) break;
        await sleep(500 * attempt);
      } finally {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async getFetch(): Promise<typeof fetch> {
    if (this.fetchImpl) return this.fetchImpl;
    const proxy = this.proxy ?? macosSystemProxy();
    if (proxy) return createProxyFetch(proxy);
    return globalThis.fetch;
  }
}

function isNoSearchResultsResponse(body: string): boolean {
  return /No search results?/i.test(body) || /"status"\s*:\s*42206/.test(body) || /"code"\s*:\s*422/.test(body);
}
