import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { FetchProvider, LlmChat, SearchProvider } from "@deepresearch/contracts";
import { buildResearchBudgetAudit, ProviderBudgetExceededError, writeResearchBudgetAudit } from "../budget.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { createPhaseContext } from "../phase-runner.js";
import { categorizeFetchError, tracedFetchPage, tracedLlmChat, tracedSearch } from "../trace.js";
import { restoreResearchCheckpoint, saveResearchCheckpoint } from "../checkpoint.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("research provider budgets", () => {
  it("accounts LLM tokens and estimated cost, then blocks the next over-limit request", async () => {
    let calls = 0;
    const llm: LlmChat = {
      name: "metered-llm",
      async chat() {
        calls += 1;
        return { content: "ok", usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 } };
      },
    };
    const ctx = await context({ llm });
    ctx.state.runtimeProfile.providers = {
      default_llm: {
        maxRequests: 1,
        maxCostUsd: 1,
        inputCostPerMillionTokensUsd: 1,
        outputCostPerMillionTokensUsd: 2,
      },
    };

    await tracedLlmChat(ctx, "test.first", { user: "hello" });
    await expect(tracedLlmChat(ctx, "test.second", { user: "blocked" })).rejects.toBeInstanceOf(ProviderBudgetExceededError);

    expect(calls).toBe(1);
    expect(buildResearchBudgetAudit(ctx)).toMatchObject({
      totals: { requests: 1, promptTokens: 100, completionTokens: 50, totalTokens: 150, estimatedCostUsd: 0.0002 },
      breaches: [expect.objectContaining({ operation: "llm", provider: "metered-llm", limit: "maxRequests", allowed: 1, observed: 1 })],
    });
  });

  it("estimates tokens when a provider omits usage and writes a reusable audit artifact", async () => {
    const ctx = await context({
      llm: { name: "usage-less", async chat() { return { content: "abcdefgh" }; } },
    });
    await tracedLlmChat(ctx, "test.estimated", { system: "abcd", user: "12345678" });

    const path = await writeResearchBudgetAudit(ctx);
    const audit = JSON.parse(await readFile(path, "utf8")) as ReturnType<typeof buildResearchBudgetAudit>;
    expect(audit.usage[0]).toMatchObject({ estimatedTokenRequests: 1 });
    expect(audit.totals.totalTokens).toBeGreaterThan(0);
    expect(path).toContain("budget-audit.json");
  });

  it("counts duplicate-replenishment searches as real provider requests", async () => {
    let calls = 0;
    const search: SearchProvider = {
      name: "metered-search",
      async search(_query, topK) {
        calls += 1;
        return Array.from({ length: topK }, () => ({
          url: "https://same.example/item",
          title: "Duplicate",
          snippet: "Duplicate source",
        }));
      },
    };
    const ctx = await context({ search });
    ctx.state.runtimeProfile.providers = { default_search: { maxRequests: 1, costPerRequestUsd: 0.02 } };

    await expect(tracedSearch(ctx, "test.search", "query", 2)).rejects.toBeInstanceOf(ProviderBudgetExceededError);

    expect(calls).toBe(1);
    expect(buildResearchBudgetAudit(ctx)).toMatchObject({
      totals: { requests: 1, estimatedCostUsd: 0.02 },
      breaches: [expect.objectContaining({ operation: "search", limit: "maxRequests" })],
    });
  });

  it("does not charge fetch cache hits as additional provider requests", async () => {
    let calls = 0;
    const fetch: FetchProvider = {
      name: "metered-fetch",
      async fetchPage(url) {
        calls += 1;
        return { url, title: "Fetched source", content: "Substantive source content. ".repeat(100) };
      },
    };
    const ctx = await context({ fetch });
    ctx.state.runtimeProfile.providers = { default_fetch: { maxRequests: 1, costPerRequestUsd: 0.005 } };

    await expect(tracedFetchPage(ctx, "test.fetch", "https://official.gov.example/source")).resolves.toBeTruthy();
    await expect(tracedFetchPage(ctx, "test.fetch", "https://official.gov.example/source")).resolves.toBeTruthy();

    expect(calls).toBe(1);
    expect(buildResearchBudgetAudit(ctx).totals).toMatchObject({ requests: 1, estimatedCostUsd: 0.005 });
  });

  it("does not reuse a focused long-document excerpt for a different task focus", async () => {
    let calls = 0;
    const fetch: FetchProvider = {
      name: "focused-fetch",
      async fetchPage(url, opts) {
        calls += 1;
        const focus = opts?.focusTerms?.[0] ?? "none";
        return {
          url,
          title: "Long regulation",
          content: `Header\n\n--- Focused source passage 1 (characters 100-200) ---\n${focus}`,
        };
      },
    };
    const ctx = await context({ fetch });

    const article = await tracedFetchPage(ctx, "test.fetch", "https://official.example/regulation", {
      maxChars: 60_000,
      focusTerms: ["Article 59"],
    });
    const annex = await tracedFetchPage(ctx, "test.fetch", "https://official.example/regulation", {
      maxChars: 60_000,
      focusTerms: ["Annex XII Part C"],
    });

    expect(calls).toBe(2);
    expect(article?.content).toContain("Article 59");
    expect(annex?.content).toContain("Annex XII Part C");
  });

  it("persists usage, breaches, and cycle gains through checkpoints", async () => {
    const ctx = await context({
      llm: { name: "checkpoint-meter", async chat() { return { content: "ok", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }; } },
    });
    ctx.state.runtimeProfile.providers = { default_llm: { maxRequests: 1 } };
    await tracedLlmChat(ctx, "test.checkpoint", { user: "meter" });
    ctx.state.cycleGains.push({
      cycle: 1,
      knowledgeNodeGain: 1,
      evidenceLinkGain: 1,
      completedTaskGain: 1,
      evidenceQualityScoreGain: 5,
      coveredMustRequirementGain: 1,
      activeQualityErrorReduction: 1,
      recordedAt: "2026-07-14T00:00:00.000Z",
    });
    const path = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 });
    if (!path) throw new Error("checkpoint expected");

    const restored = await restoreResearchCheckpoint(path, { llm: ctx.stack.llm });
    const audit = buildResearchBudgetAudit(restored.ctx);
    expect(audit.totals).toMatchObject({ requests: 1, totalTokens: 15 });
    expect(audit.breaches).toHaveLength(1);
    expect(audit.cycleGains).toHaveLength(1);
  });

  it("records bounded fetch failure samples with URL and categorized reason", async () => {
    const errors: Record<string, Error> = {
      "https://slow.example/a": new Error("request timed out after 30000ms"),
      "https://blocked.example/b": new Error("HTTP 403 Forbidden"),
      "https://down.example/c": new Error("fetch failed: connect ECONNRESET"),
    };
    const fetch: FetchProvider = {
      name: "flaky-fetch",
      async fetchPage(url) { throw errors[url] ?? new Error("unexpected"); },
    };
    const ctx = await context({ fetch });

    for (const url of Object.keys(errors)) {
      await expect(tracedFetchPage(ctx, "test.fetch", url)).resolves.toBeUndefined();
    }

    const usage = buildResearchBudgetAudit(ctx).usage.find((item) => item.operation === "fetch");
    expect(usage).toMatchObject({ requests: 3, succeededRequests: 0, failedRequests: 3 });
    expect(usage?.failureSamples?.map((sample) => sample.reason)).toEqual(["timeout", "http_403", "network_error"]);
    expect(usage?.failureSamples?.[0]).toMatchObject({ url: "https://slow.example/a", phase: "test.fetch" });
    expect(usage?.failureSamples?.[0]?.occurredAt).toBeTruthy();
  });

  it("caps fetch failure samples per provider while counting every failure", async () => {
    const fetch: FetchProvider = {
      name: "always-failing-fetch",
      async fetchPage() { throw new Error("HTTP 503 Service Unavailable"); },
    };
    const ctx = await context({ fetch });

    for (let index = 0; index < 25; index += 1) {
      await expect(tracedFetchPage(ctx, "test.fetch", `https://unstable.example/${index}`)).resolves.toBeUndefined();
    }

    const usage = buildResearchBudgetAudit(ctx).usage.find((item) => item.operation === "fetch");
    expect(usage?.failedRequests).toBe(25);
    expect(usage?.failureSamples).toHaveLength(20);
    expect(usage?.failureSamples?.every((sample) => sample.reason === "http_503")).toBe(true);
  });

  it("caches fetch failures across tasks with different focus terms", async () => {
    let calls = 0;
    const fetch: FetchProvider = {
      name: "dead-url-fetch",
      async fetchPage() {
        calls += 1;
        throw new Error("HTTP 403 Forbidden");
      },
    };
    const ctx = await context({ fetch });

    await expect(tracedFetchPage(ctx, "test.first", "https://dead.example/page", { focusTerms: ["alpha"] })).resolves.toBeUndefined();
    await expect(tracedFetchPage(ctx, "test.second", "https://dead.example/page", { focusTerms: ["beta"] })).resolves.toBeUndefined();

    expect(calls).toBe(1);
  });

  it("categorizes fetch errors into stable reason codes", () => {
    expect(categorizeFetchError(new Error("The operation was aborted"))).toBe("aborted");
    expect(categorizeFetchError(new Error("resolvePublicHost blocked loopback address 127.0.0.1"))).toBe("ssrf_blocked");
    expect(categorizeFetchError(new Error("response exceeds maxTextBytes 10000000"))).toBe("content_too_large");
    expect(categorizeFetchError(new Error("exceeded 5 redirects"))).toBe("redirect_error");
    expect(categorizeFetchError(new Error("something else"))).toBe("error");
  });
});

async function context(opts: { llm?: LlmChat; search?: SearchProvider; fetch?: FetchProvider }) {
  const dir = await mkdtemp(join(tmpdir(), "dr-budget-"));
  dirs.push(dir);
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  const ctx = createPhaseContext({ sessionId: "S_budget", userInput: "Budget test" }, {
    runtimeProfile,
    artifactDir: dir,
    llm: opts.llm ?? { name: "noop", async chat() { return { content: "{}" }; } },
    search: opts.search,
    fetch: opts.fetch,
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_budget";
  return ctx;
}
