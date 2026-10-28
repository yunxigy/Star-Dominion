import { fetchWithRetry } from "./http";
import type { SiteIngestBatch, SitePushResult, SummarizedPost } from "./contracts";

export interface SiteClientOptions {
  endpoint: string;
  token: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function createIdempotencyKey(
  provider: string,
  posts: readonly SummarizedPost[],
): Promise<string> {
  if (!provider || posts.length === 0 || posts.some((post) => !post.id)) {
    throw new Error("Cannot create an idempotency key for an empty batch");
  }
  const ids = posts.map((post) => post.id).sort();
  if (new Set(ids).size !== ids.length) {
    throw new Error("Cannot create an idempotency key for duplicate post IDs");
  }
  const input = new TextEncoder().encode(provider + "\n" + ids.join("\n"));
  const digest = await crypto.subtle.digest("SHA-256", input);
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return "x-" + hex;
}

export class SiteClient {
  private readonly fetcher: typeof fetch;

  constructor(private readonly options: SiteClientOptions) {
    const endpoint = new URL(options.endpoint);
    if (endpoint.protocol !== "https:") {
      throw new Error("Site endpoint must use HTTPS");
    }
    this.fetcher = options.fetcher ?? fetch;
  }

  async push(batch: SiteIngestBatch): Promise<SitePushResult> {
    const idempotencyKey = await createIdempotencyKey(batch.provider, batch.posts);
    const response = await fetchWithRetry(
      this.options.endpoint,
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + this.options.token,
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(batch),
      },
      {
        fetcher: this.fetcher,
        timeoutMs: this.options.timeoutMs,
        retries: this.options.retries,
        retryDelayMs: this.options.retryDelayMs,
        sleep: this.options.sleep,
      },
    );
    if (!response.ok) {
      throw new Error("Site ingestion failed with status " + response.status);
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch {
      throw new Error("Site ingestion returned invalid response JSON");
    }
    if (typeof result !== "object" || result === null || Array.isArray(result)) {
      throw new Error("Site ingestion returned an invalid response");
    }
    return result as SitePushResult;
  }
}
