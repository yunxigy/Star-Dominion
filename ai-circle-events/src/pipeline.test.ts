import { describe, expect, it, vi } from "vitest";
import { runPipeline, type PipelineLogger } from "./pipeline";
import type { GeneratedReport } from "./contracts";
import type { NormalizedPost, ProviderScan } from "./providers/types";
import { FxTwitterProvider } from "./providers/fxtwitter";
import { GeminiClient } from "./gemini";
import { SiteClient } from "./site-client";

class FakeKV {
  values = new Map<string, string>();
  put = vi.fn(async (key: string, value: string) => {
    this.values.set(key, value);
  });
  get = vi.fn(async (key: string) => this.values.get(key) ?? null);
  delete = vi.fn(async (key: string) => {
    this.values.delete(key);
  });
}

const sourcePost = (id: string, overrides: Partial<NormalizedPost> = {}): NormalizedPost => ({
  id,
  author: "OpenAI",
  username: "OpenAI",
  handle: "OpenAI",
  text: "We released a new reasoning model.",
  url: "https://x.com/OpenAI/status/" + id,
  publishedAt: "2026-09-25T10:00:00.000Z",
  replyingTo: null,
  isRetweet: false,
  ...overrides,
});

const scan = (posts: NormalizedPost[], overrides: Partial<ProviderScan> = {}): ProviderScan => ({
  posts,
  latestPostId: posts[0]?.id ?? null,
  reachedAfterPostId: true,
  scanComplete: true,
  ...overrides,
});

const reportFor = (posts: readonly NormalizedPost[]): GeneratedReport => ({
  posts: posts.map((post) => ({
    id: post.id,
    author: post.author,
    username: post.username,
    text: post.text,
    url: post.url,
    publishedAt: post.publishedAt,
    importance: 75,
  })),
  summary: { title: "AI 圈大事", summary: "本轮动态摘要。", events: [], risks: [] },
});

function setup(options: {
  scans: Record<string, ProviderScan | Error>;
  kv?: FakeKV;
  geminiError?: Error;
  siteError?: Error;
  logger?: PipelineLogger;
}): {
  kv: FakeKV;
  provider: { fetchLatest: ReturnType<typeof vi.fn> };
  gemini: { summarize: ReturnType<typeof vi.fn> };
  site: { push: ReturnType<typeof vi.fn> };
  logger: PipelineLogger;
  run: () => ReturnType<typeof runPipeline>;
} {
  const kv = options.kv ?? new FakeKV();
  const accounts = Object.keys(options.scans);
  const provider = {
    fetchLatest: vi.fn(async (handle: string) => {
      const outcome = options.scans[handle];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
  const gemini = {
    summarize: vi.fn(async (posts: readonly NormalizedPost[]) => {
      if (options.geminiError) throw options.geminiError;
      return reportFor(posts);
    }),
  };
  const site = {
    push: vi.fn(async () => {
      if (options.siteError) throw options.siteError;
      return { accepted: 1 };
    }),
  };
  const logger = options.logger ?? {
    info: vi.fn(),
    error: vi.fn(),
  };
  const run = () => runPipeline({
    kv,
    provider,
    gemini,
    site,
    accounts,
    runId: () => "run-test-1",
    now: () => 1_000,
    logger,
  });
  return { kv, provider, gemini, site, logger, run };
}

describe("runPipeline", () => {
  it("runs a mocked FxTwitter-to-Gemini-to-site chain and advances the cursor after delivery", async () => {
    const events: string[] = [];
    const postId = "integration-post-1";
    const sourceStatus = {
      id: postId,
      url: "https://x.com/OpenAI/status/" + postId,
      text: "We announced an important AI research update.",
      created_at: "2026-09-25T10:00:00.000Z",
      author: { name: "OpenAI", screen_name: "OpenAI" },
    };
    const modelOutput = {
      posts: [{
        id: postId,
        author: "OpenAI",
        username: "OpenAI",
        text: sourceStatus.text,
        url: sourceStatus.url,
        publishedAt: sourceStatus.created_at,
        importance: 90,
      }],
      summary: {
        title: "AI 圈大事",
        summary: "OpenAI 分享了重要研究进展。",
        events: [{
          title: "研究进展",
          summary: "OpenAI 发布了一项研究更新。",
          importance: 90,
          postIds: [postId],
        }],
        risks: [],
      },
    };
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes("/2/profile/")) {
        const handle = new URL(url).pathname.split("/")[3];
        return new Response(JSON.stringify({
          code: 200,
          results: handle === "OpenAI" ? [sourceStatus] : [],
          cursor: { top: null, bottom: null },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes(":generateContent")) {
        events.push("gemini");
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(modelOutput) }] } }],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      events.push("site");
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0, reportId: "report-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const kv = new FakeKV();
    const put = kv.put;
    kv.put = vi.fn(async (key: string, value: string) => {
      if (key.startsWith("cursor:")) events.push("cursor:" + key.slice("cursor:".length));
      await put(key, value);
    });
    const logger: PipelineLogger = { info: vi.fn(), error: vi.fn() };

    const result = await runPipeline({
      kv,
      provider: new FxTwitterProvider({
        baseUrl: "https://api.fxtwitter.test",
        fetcher,
        retries: 0,
      }),
      gemini: new GeminiClient({
        apiKey: "test-gemini-key",
        model: "gemini-2.5-flash",
        fetcher,
        retries: 0,
      }),
      site: new SiteClient({
        endpoint: "https://reports.example.test/api/v1/ingest/x",
        token: "test-site-token",
        fetcher,
        retries: 0,
      }),
      logger,
      runId: () => "integration-run",
      now: () => 1_000,
    });

    expect(result.status).toBe("delivered");
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes(":generateContent"))).toHaveLength(1);
    expect(fetcher.mock.calls.filter(([input]) => String(input).includes("reports.example.test"))).toHaveLength(1);
    expect(kv.values.get("cursor:OpenAI")).toBe(postId);
    expect(events).toEqual(["gemini", "site", "cursor:OpenAI"]);
  });

  it("scans each of the nine configured accounts independently", async () => {
    const kv = new FakeKV();
    const provider = { fetchLatest: vi.fn(async (_handle: string) => scan([])) };
    const gemini = { summarize: vi.fn() };
    const site = { push: vi.fn() };

    const result = await runPipeline({
      kv,
      provider,
      gemini,
      site,
      runId: () => "nine-account-run",
      now: () => 1_000,
      logger: { info: vi.fn(), error: vi.fn() },
    });

    expect(result.status).toBe("no_new_posts");
    expect(provider.fetchLatest).toHaveBeenCalledTimes(9);
    expect(provider.fetchLatest.mock.calls.map(([handle]) => handle)).toEqual([
      "OpenAI",
      "AnthropicAI",
      "GoogleDeepMind",
      "sama",
      "demishassabis",
      "huggingface",
      "MistralAI",
      "perplexity_ai",
      "claudeai",
    ]);
  });

  it("does not call Gemini, push to the site, or advance cursors when there are no new posts", async () => {
    const kv = new FakeKV();
    kv.values.set("cursor:OpenAI", "20");
    const harness = setup({ scans: { OpenAI: scan([], { latestPostId: "20" }) }, kv });

    const result = await harness.run();

    expect(result.status).toBe("no_new_posts");
    expect(harness.gemini.summarize).not.toHaveBeenCalled();
    expect(harness.site.push).not.toHaveBeenCalled();
    expect(kv.values.get("cursor:OpenAI")).toBe("20");
  });

  it("does not call Gemini or the site when deterministic filtering removes every post", async () => {
    const lowValueReply = sourcePost("21", {
      text: "Thanks!",
      replyingTo: { status: "10", screenName: "someone" },
    });
    const harness = setup({ scans: { OpenAI: scan([lowValueReply]) } });

    const result = await harness.run();

    expect(result.status).toBe("no_eligible_posts");
    expect(harness.gemini.summarize).not.toHaveBeenCalled();
    expect(harness.site.push).not.toHaveBeenCalled();
    expect(harness.kv.values.has("cursor:OpenAI")).toBe(false);
  });

  it("isolates a failed account and summarizes all successful accounts in one Gemini call", async () => {
    const harness = setup({
      scans: {
        OpenAI: scan([sourcePost("30")]),
        AnthropicAI: new Error("private provider detail"),
      },
    });

    const result = await harness.run();

    expect(result.status).toBe("partial");
    expect(harness.gemini.summarize).toHaveBeenCalledTimes(1);
    expect(harness.gemini.summarize.mock.calls[0][0].map((post: NormalizedPost) => post.id)).toEqual(["30"]);
    expect(harness.site.push).toHaveBeenCalledTimes(1);
    expect(harness.kv.values.get("cursor:OpenAI")).toBe("30");
    expect(harness.kv.values.has("cursor:AnthropicAI")).toBe(false);
    expect(JSON.stringify(harness.logger)).not.toContain("private provider detail");
  });

  it.each(["gemini", "site"] as const)("does not advance cursors when %s fails", async (failedStage) => {
    const kv = new FakeKV();
    kv.values.set("cursor:OpenAI", "20");
    const harness = setup({
      scans: { OpenAI: scan([sourcePost("30")]) },
      kv,
      geminiError: failedStage === "gemini" ? new Error("model detail") : undefined,
      siteError: failedStage === "site" ? new Error("site detail") : undefined,
    });

    await expect(harness.run()).rejects.toThrow(failedStage === "gemini" ? "model detail" : "site detail");

    expect(kv.values.get("cursor:OpenAI")).toBe("20");
  });

  it("does not advance a handle whose timeline scan stopped at the page limit", async () => {
    const kv = new FakeKV();
    kv.values.set("cursor:OpenAI", "20");
    const harness = setup({
      scans: { OpenAI: scan([sourcePost("30")], { reachedAfterPostId: false, scanComplete: false }) },
      kv,
    });

    const result = await harness.run();

    expect(result.status).toBe("partial");
    expect(harness.site.push).toHaveBeenCalledTimes(1);
    expect(kv.values.get("cursor:OpenAI")).toBe("20");
  });

  it("skips a run while a non-expired KV lease exists", async () => {
    const kv = new FakeKV();
    kv.values.set("lease:active", JSON.stringify({ runId: "other-run", expiresAt: 2_000 }));
    const harness = setup({ scans: { OpenAI: scan([sourcePost("30")]) }, kv });

    const result = await harness.run();

    expect(result.status).toBe("skipped_lease");
    expect(harness.provider.fetchLatest).not.toHaveBeenCalled();
    expect(harness.gemini.summarize).not.toHaveBeenCalled();
    expect(harness.site.push).not.toHaveBeenCalled();
  });

  it("releases its lease after completing a successful delivery", async () => {
    const harness = setup({ scans: { OpenAI: scan([sourcePost("30")]) } });

    await harness.run();

    expect(harness.kv.values.has("lease:active")).toBe(false);
  });
});
