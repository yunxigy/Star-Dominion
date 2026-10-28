import { MONITORED_ACCOUNTS } from "./accounts";
import { deduplicatePosts } from "./dedup";
import { filterPosts } from "./filter";
import type { GeneratedReport, SiteIngestBatch } from "./contracts";
import {
  acquireLease,
  readCursor,
  releaseLease,
  writeCursor,
  type KVStore,
} from "./kv";
import type { NormalizedPost, ProviderScan } from "./providers/types";

export interface PipelineLogger {
  info(event: string, fields?: Record<string, string | number | boolean>): void;
  error(event: string, fields?: Record<string, string | number | boolean>): void;
}

export interface PipelineOptions {
  kv: KVStore;
  provider: {
    fetchLatest(handle: string, options?: { afterPostId?: string }): Promise<ProviderScan>;
  };
  gemini: { summarize(posts: readonly NormalizedPost[]): Promise<GeneratedReport> };
  site: { push(batch: SiteIngestBatch): Promise<unknown> };
  accounts?: readonly string[];
  modelName?: string;
  runId?: () => string;
  now?: () => number;
  logger?: PipelineLogger;
}

export type PipelineResult =
  | { status: "skipped_lease"; runId: string }
  | { status: "no_new_posts" | "no_eligible_posts" | "delivered" | "partial"; runId: string };

interface AccountScan {
  handle: string;
  scan: ProviderScan;
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

const defaultLogger: PipelineLogger = {
  info(event, fields = {}) {
    console.info(JSON.stringify({ event, ...fields }));
  },
  error(event, fields = {}) {
    console.error(JSON.stringify({ event, ...fields }));
  },
};

export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const runId = options.runId?.() ?? crypto.randomUUID();
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;
  const accounts = options.accounts ?? MONITORED_ACCOUNTS;
  if (!(await acquireLease(options.kv, runId, now()))) {
    logger.info("run_skipped_lease", { runId });
    return { status: "skipped_lease", runId };
  }

  try {
    const settled = await Promise.allSettled(
      accounts.map(async (handle): Promise<AccountScan> => {
        const afterPostId = await readCursor(options.kv, handle);
        const result = await options.provider.fetchLatest(handle, {
          ...(afterPostId ? { afterPostId } : {}),
        });
        return { handle, scan: result };
      }),
    );

    const successful: AccountScan[] = [];
    let hasAccountFailure = false;
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        successful.push(result.value);
        logger.info("account_scan_complete", {
          runId,
          handle: result.value.handle,
          postCount: result.value.scan.posts.length,
          scanComplete: result.value.scan.scanComplete,
        });
      } else {
        hasAccountFailure = true;
        logger.error("account_scan_failed", {
          runId,
          handle: accounts[index],
          errorType: errorType(result.reason),
        });
      }
    });

    const hasIncompleteScan = successful.some(({ scan }) => !scan.scanComplete);
    const newPosts = successful.flatMap(({ scan }) => scan.posts);
    if (newPosts.length === 0) {
      const status = hasAccountFailure || hasIncompleteScan ? "partial" : "no_new_posts";
      logger.info("run_finished", { runId, status, postCount: 0 });
      return { status, runId };
    }

    const eligiblePosts = deduplicatePosts(filterPosts(newPosts));
    if (eligiblePosts.length === 0) {
      const status = hasAccountFailure || hasIncompleteScan ? "partial" : "no_eligible_posts";
      logger.info("run_finished", {
        runId,
        status,
        fetchedCount: newPosts.length,
        eligibleCount: 0,
      });
      return { status, runId };
    }

    const report = await options.gemini.summarize(eligiblePosts);
    const batch: SiteIngestBatch = {
      provider: "fxtwitter",
      modelProvider: "google",
      modelName: options.modelName ?? "gemini-2.5-flash",
      posts: report.posts,
      summary: report.summary,
    };
    await options.site.push(batch);

    const cursorCandidates = successful.filter(
      ({ scan }) => scan.scanComplete && scan.latestPostId && scan.posts.length > 0,
    );
    const cursorWrites = cursorCandidates.map(({ handle, scan }) =>
      writeCursor(options.kv, handle, scan.latestPostId as string).then(() => handle),
    );
    const cursorResults = await Promise.allSettled(cursorWrites);
    let cursorWriteFailed = false;
    cursorResults.forEach((result, index) => {
      if (result.status === "rejected") {
        cursorWriteFailed = true;
        logger.error("cursor_write_failed", {
          runId,
          handle: cursorCandidates[index]?.handle ?? "unknown",
          errorType: errorType(result.reason),
        });
      }
    });

    const status =
      hasAccountFailure || hasIncompleteScan || cursorWriteFailed ? "partial" : "delivered";
    logger.info("run_finished", {
      runId,
      status,
      fetchedCount: newPosts.length,
      eligibleCount: eligiblePosts.length,
      cursorCount: cursorResults.filter((result) => result.status === "fulfilled").length,
    });
    return { status, runId };
  } catch (error) {
    logger.error("run_failed", { runId, errorType: errorType(error) });
    throw error;
  } finally {
    try {
      await releaseLease(options.kv, runId);
    } catch (error) {
      logger.error("lease_release_failed", { runId, errorType: errorType(error) });
    }
  }
}
