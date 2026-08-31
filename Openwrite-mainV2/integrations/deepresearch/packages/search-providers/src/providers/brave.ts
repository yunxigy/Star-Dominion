import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError, formatFetchErrorWithCauseDetails, sleepWithAbort, throwIfAborted } from "@deepresearch/net-utils";

export interface BraveSearchOptions {
  apiKey: string;
  timeoutMs?: number;
  country?: string;
  searchLang?: string;
  safesearch?: "off" | "moderate" | "strict";
  retry?: number;
  fetchImpl?: typeof fetch;
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = "brave-search";
  private readonly opts: Required<BraveSearchOptions>;

  constructor(opts: BraveSearchOptions) {
    this.opts = {
      timeoutMs: 15000,
      country: "US",
      searchLang: "en",
      safesearch: "moderate",
      retry: 2,
      fetchImpl: defaultFetch,
      ...opts,
    };
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];

    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(Math.max(topK, 1), 20)));
    url.searchParams.set("country", this.opts.country);
    url.searchParams.set("search_lang", this.opts.searchLang);
    url.searchParams.set("safesearch", this.opts.safesearch);
    url.searchParams.set("text_decorations", "false");
    url.searchParams.set("spellcheck", "true");

    const maxAttempts = Math.max(1, Math.floor(this.opts.retry) + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      throwIfAborted(opts.signal, "Brave Search aborted");
      try {
        const resp = await braveFetch(this.opts.fetchImpl, url.toString(), this.opts.apiKey, this.opts.timeoutMs, opts.signal);
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          const error = new BraveHttpError(resp.status, `Brave Search HTTP ${resp.status} (attempt ${attempt}/${maxAttempts}): ${body.slice(0, 300)}`);
          if (!isRetryableStatus(resp.status) || attempt >= maxAttempts) throw error;
          lastError = error;
        } else {
          const data = await resp.json() as BraveSearchResponse;
          return (data.web?.results ?? []).slice(0, topK).flatMap((item) => {
            if (!item.url || !item.title) return [];
            return [{
              url: item.url,
              title: stripHtml(item.title),
              snippet: stripHtml(item.description ?? item.extra_snippets?.join(" ") ?? ""),
            }];
          });
        }
      } catch (err) {
        if (opts.signal?.aborted) throw abortError(opts.signal, "Brave Search aborted");
        lastError = err;
        if (err instanceof BraveHttpError && !isRetryableStatus(err.status)) throw err;
        if (attempt >= maxAttempts) break;
      }
      await sleepWithAbort(Math.min(4000, 400 * 2 ** (attempt - 1)), opts.signal, "Brave Search aborted");
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "Brave Search failed"));
  }
}

class BraveHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "BraveHttpError";
  }
}

async function braveFetch(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        "X-Subscription-Token": apiKey,
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (externalSignal?.aborted) throw abortError(externalSignal, "Brave Search aborted");
    if (err instanceof Error && err.name === "AbortError") throw new Error(`Brave Search timed out after ${timeoutMs}ms`);
    throw new Error(`Brave Search fetch failed: ${formatFetchErrorWithCauseDetails(err)}`, { cause: err });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      extra_snippets?: string[];
    }>;
  };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);
