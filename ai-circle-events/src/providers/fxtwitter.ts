import { fetchWithRetry } from "../http";
import type { NormalizedPost, ProviderScan, ProviderScanOptions } from "./types";

export interface FxTwitterProviderOptions {
  baseUrl: string;
  fetcher?: typeof fetch;
  maxPages?: number;
  pageSize?: number;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

interface FxTwitterStatus {
  id?: unknown;
  url?: unknown;
  text?: unknown;
  created_at?: unknown;
  author?: unknown;
  replying_to?: unknown;
  retweeted_status?: unknown;
  reposted_status?: unknown;
  is_retweet?: unknown;
}

interface FxTwitterPage {
  code?: unknown;
  results?: unknown;
  cursor?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStatus(value: unknown, handle: string): NormalizedPost {
  if (!isRecord(value)) {
    throw new Error("FxTwitter returned an invalid post for " + handle);
  }
  const status = value as FxTwitterStatus;
  const author = isRecord(status.author) ? status.author : null;
  const id = typeof status.id === "string" ? status.id : "";
  const url = typeof status.url === "string" ? status.url : "";
  const text = typeof status.text === "string" ? status.text : "";
  const createdAt = typeof status.created_at === "string" ? status.created_at : "";
  const username =
    typeof author?.screen_name === "string" ? author.screen_name : "";
  const authorName = typeof author?.name === "string" ? author.name : "";
  const timestamp = Date.parse(createdAt);
  if (!id || !url || !text || !username || !authorName || !Number.isFinite(timestamp)) {
    throw new Error("FxTwitter returned an invalid post for " + handle);
  }

  const parent = isRecord(status.replying_to) ? status.replying_to : null;
  const parentStatus = typeof parent?.status === "string" ? parent.status : "";
  const parentScreenName = typeof parent?.screen_name === "string" ? parent.screen_name : "";
  const replyingTo =
    parentStatus && parentScreenName
      ? { status: parentStatus, screenName: parentScreenName }
      : null;

  return {
    id,
    author: authorName,
    username,
    handle,
    text,
    url,
    publishedAt: new Date(timestamp).toISOString(),
    replyingTo,
    isRetweet: Boolean(status.is_retweet || status.retweeted_status || status.reposted_status),
  };
}

export class FxTwitterProvider {
  private readonly fetcher: typeof fetch;
  private readonly maxPages: number;
  private readonly pageSize: number;

  constructor(private readonly options: FxTwitterProviderOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.maxPages = Math.max(1, options.maxPages ?? 5);
    this.pageSize = Math.min(100, Math.max(1, options.pageSize ?? 100));
  }

  async fetchLatest(handle: string, scanOptions: ProviderScanOptions = {}): Promise<ProviderScan> {
    const posts: NormalizedPost[] = [];
    const visitedCursors = new Set<string>();
    const afterPostId = scanOptions.afterPostId;
    let cursor: string | null = null;
    let latestPostId: string | null = null;
    let reachedAfterPostId = !afterPostId;
    let scanComplete = false;

    for (let pageNumber = 0; pageNumber < this.maxPages; pageNumber += 1) {
      const url = new URL(
        "/2/profile/" + encodeURIComponent(handle) + "/statuses",
        this.options.baseUrl,
      );
      url.searchParams.set("count", String(this.pageSize));
      if (cursor) {
        url.searchParams.set("cursor", cursor);
      }

      const response = await fetchWithRetry(
        url,
        { method: "GET", headers: { accept: "application/json" } },
        {
          fetcher: this.fetcher,
          timeoutMs: this.options.timeoutMs,
          retries: this.options.retries,
          retryDelayMs: this.options.retryDelayMs,
          sleep: this.options.sleep,
        },
      );
      if (response.status === 204) {
        scanComplete = true;
        break;
      }
      if (!response.ok) {
        throw new Error("FxTwitter request failed with status " + response.status + " for " + handle);
      }

      let body: FxTwitterPage;
      try {
        body = (await response.json()) as FxTwitterPage;
      } catch {
        throw new Error("FxTwitter returned invalid JSON for " + handle);
      }
      if (!isRecord(body) || body.code !== 200 || !Array.isArray(body.results)) {
        throw new Error("FxTwitter returned an invalid timeline for " + handle);
      }

      const pagePosts = body.results.map((item) => normalizeStatus(item, handle));
      if (latestPostId === null && pagePosts.length > 0) {
        latestPostId = pagePosts[0].id;
      }
      for (const post of pagePosts) {
        if (afterPostId && post.id === afterPostId) {
          reachedAfterPostId = true;
          scanComplete = true;
          break;
        }
        posts.push(post);
      }
      if (scanComplete) {
        break;
      }

      if (!afterPostId) {
        scanComplete = true;
        break;
      }

      const pageCursor = isRecord(body.cursor) ? body.cursor.bottom : null;
      if (pageCursor !== null && typeof pageCursor !== "string") {
        throw new Error("FxTwitter returned an invalid cursor for " + handle);
      }
      if (!pageCursor) {
        scanComplete = true;
        break;
      }
      if (visitedCursors.has(pageCursor)) {
        break;
      }
      visitedCursors.add(pageCursor);
      if (pageNumber === this.maxPages - 1) {
        break;
      }
      cursor = pageCursor;
    }

    return { posts, latestPostId, reachedAfterPostId, scanComplete };
  }
}
