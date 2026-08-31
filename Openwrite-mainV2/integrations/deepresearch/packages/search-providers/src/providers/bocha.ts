import type { SearchHit, SearchOptions, SearchProvider } from "./types.js";
import { abortError, formatFetchError, sleepWithAbort, throwIfAborted } from "@deepresearch/net-utils";

export interface BochaSearchOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  retry?: number;
  count?: number;
  maxCount?: number;
  freshness?: "noLimit" | "oneDay" | "oneWeek" | "oneMonth" | "oneYear";
  summary?: boolean;
  /** Minimum delay between request starts that share the same endpoint and API key. */
  minIntervalMs?: number;
  /** Base delay used for transient failures when Retry-After is unavailable. */
  retryBaseDelayMs?: number;
  /** Upper bound for a single retry delay. */
  maxRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
}

interface BochaWebPage {
  name?: string;
  title?: string;
  url?: string;
  snippet?: string;
  summary?: string;
  description?: string;
}

const requestGates = new Map<string, SerialRequestGate>();

export class BochaSearchProvider implements SearchProvider {
  readonly name = "bocha-search";
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly timeoutMs: number;
  private readonly retry: number;
  private readonly count: number;
  private readonly maxCount: number;
  private readonly freshness: BochaSearchOptions["freshness"];
  private readonly summary: boolean;
  private readonly minIntervalMs: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly requestGate: SerialRequestGate;

  constructor(opts: BochaSearchOptions) {
    this.apiKey = opts.apiKey;
    this.endpoint = opts.endpoint ?? "https://api.bochaai.com/v1/web-search";
    this.timeoutMs = opts.timeoutMs ?? 60000;
    this.retry = opts.retry ?? 2;
    this.count = opts.count ?? 10;
    this.maxCount = opts.maxCount ?? 50;
    this.freshness = opts.freshness ?? "noLimit";
    this.summary = opts.summary ?? true;
    this.minIntervalMs = nonNegativeInteger(opts.minIntervalMs, 350);
    this.retryBaseDelayMs = nonNegativeInteger(opts.retryBaseDelayMs, 1500);
    this.maxRetryDelayMs = nonNegativeInteger(opts.maxRetryDelayMs, 15000);
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    const gateKey = `${this.endpoint}\0${this.apiKey}\0${this.minIntervalMs}`;
    this.requestGate = requestGates.get(gateKey) ?? new SerialRequestGate(this.minIntervalMs);
    requestGates.set(gateKey, this.requestGate);
  }

  async search(query: string, topK: number, opts: SearchOptions = {}): Promise<SearchHit[]> {
    if (!query) throw new Error("query is required");
    if (topK <= 0) return [];
    throwIfAborted(opts.signal, "Bocha search aborted");

    const count = Math.min(Math.max(topK, this.count, 1), this.maxCount);
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retry + 1; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (opts.signal?.aborted) controller.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const response = await this.requestGate.run(async () => {
          timer = setTimeout(() => controller.abort(), this.timeoutMs);
          return await this.fetchImpl(this.endpoint, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${this.apiKey}`,
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              query,
              freshness: this.freshness,
              summary: this.summary,
              count,
            }),
            signal: controller.signal,
          }).catch((err: unknown) => {
            throw new Error(`Bocha search request failed for ${originOf(this.endpoint)} after ${this.timeoutMs}ms (attempt ${attempt}/${this.retry + 1}): ${formatFetchError(err)}`);
          });
        }, controller.signal);

        const body = await response.text();
        if (!response.ok) {
          throw new BochaHttpError(
            `Bocha search HTTP ${response.status} (attempt ${attempt}/${this.retry + 1}): ${body.slice(0, 300)}`,
            response.status,
            retryAfterMs(response.headers.get("retry-after")),
          );
        }
        const json = parseJson(body);
        const code = numericCode(json);
        if (code !== undefined && code !== 200 && code !== 0) {
          throw new Error(`Bocha search API code ${code} (attempt ${attempt}/${this.retry + 1}): ${apiMessage(json).slice(0, 300)}`);
        }
        return extractBochaPages(json)
          .filter((item) => item.url && (item.name || item.title))
          .slice(0, topK)
          .map((item) => ({
            url: item.url!,
            title: cleanText(item.name ?? item.title ?? item.url!),
            snippet: cleanText(item.summary ?? item.snippet ?? item.description ?? ""),
          }));
      } catch (err) {
        if (opts.signal?.aborted) throw abortError(opts.signal, "Bocha search aborted");
        lastError = err;
        if (attempt > this.retry || !isRetryableBochaError(err)) break;
        const delayMs = bochaRetryDelayMs(err, attempt, this.retryBaseDelayMs, this.maxRetryDelayMs);
        await sleepWithAbort(delayMs, opts.signal, "Bocha search aborted", { immediateWhenNonPositive: true, rejectIfAlreadyAborted: false });
      } finally {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

class SerialRequestGate {
  private tail: Promise<void> = Promise.resolve();
  private nextStartAt = 0;

  constructor(private readonly minIntervalMs: number) {}

  async run<T>(task: () => Promise<T>, signal: AbortSignal | undefined): Promise<T> {
    let release = () => {};
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      throwIfAborted(signal, "Bocha search aborted");
      const waitMs = Math.max(0, this.nextStartAt - Date.now());
      if (waitMs > 0) await sleepWithAbort(waitMs, signal, "Bocha search aborted", { immediateWhenNonPositive: true, rejectIfAlreadyAborted: false });
      throwIfAborted(signal, "Bocha search aborted");
      this.nextStartAt = Date.now() + this.minIntervalMs;
      return await task();
    } finally {
      release();
    }
  }
}

class BochaHttpError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message);
    this.name = "BochaHttpError";
  }
}

function isRetryableBochaError(err: unknown): boolean {
  if (!(err instanceof BochaHttpError)) return true;
  return err.status === 408 || err.status === 425 || err.status === 429 || err.status >= 500;
}

function bochaRetryDelayMs(
  err: unknown,
  attempt: number,
  baseDelayMs = 1500,
  maxDelayMs = 15000,
): number {
  if (err instanceof BochaHttpError && typeof err.retryAfterMs === "number") {
    return Math.min(maxDelayMs, Math.max(0, err.retryAfterMs));
  }
  const exponential = Math.max(0, baseDelayMs) * (2 ** Math.max(0, attempt - 1));
  const jitter = exponential > 0 ? Math.floor(Math.random() * Math.max(1, exponential * 0.25)) : 0;
  return Math.min(Math.max(0, maxDelayMs), exponential + jitter);
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function extractBochaPages(value: unknown): BochaWebPage[] {
  const root = object(value) ?? {};
  const data = object(root.data) ?? root;
  const webPages = object(data.webPages);
  const candidates = [
    webPages?.value,
    webPages?.results,
    data.value,
    data.results,
    data.pages,
    root.results,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.map((item) => object(item)).filter((item): item is BochaWebPage => Boolean(item));
  }
  return [];
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch (err) {
    throw new Error(`Bocha search returned invalid JSON: ${err instanceof Error ? err.message : String(err)}; body=${body.slice(0, 200)}`);
  }
}

function numericCode(value: unknown): number | undefined {
  const code = object(value)?.code;
  if (typeof code === "number") return code;
  if (typeof code === "string" && code.trim() && Number.isFinite(Number(code))) return Number(code);
  return undefined;
}

function apiMessage(value: unknown): string {
  const root = object(value);
  return String(root?.msg ?? root?.message ?? root?.error ?? JSON.stringify(value));
}

function object(value: unknown): Record<string, any> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : undefined;
}

function cleanText(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : fallback;
}

function originOf(endpoint: string): string {
  try {
    return new URL(endpoint).origin;
  } catch {
    return endpoint;
  }
}
