import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { LlmChat, SearchProvider } from "@deepresearch/contracts";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { buildResearchRuntimeProfile, createResearchFetchFromEnv, createResearchLlmFromEnv, createResearchReviewLlmFromEnv, createResearchSearchFromEnv, runResearch, streamResearch, type ResearchStreamFrame, type ResearchStreamMessage } from "../index.js";
import { acceptBingResearchResults } from "../research-api.js";

describe("runResearch backend API", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("runs with injected providers and emits reusable stream frames", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-"));
    dirs.push(artifactDir);
    const frames: ResearchStreamFrame[] = [];
    const output = await runResearch({
      prompt: "Backend API smoke research task",
      artifactDir,
      language: "en",
      maxCycles: 1,
      llm: new EchoJsonLlm(),
      search: mockSearch(),
      onFrame(frame) {
        frames.push(frame);
      },
    });

    expect(output.result.status).toBe("succeeded");
    expect(output.summary.filesExist.report).toBe(true);
    expect(output.summary.filesExist.fullTrace).toBe(true);
    expect(output.summary.filesExist.budgetAudit).toBe(true);
    expect(output.summary.filesExist.checkpoint).toBe(true);
    expect(output.summary.budgetAudit).toContain("budget-audit.json");
    expect(output.result.metrics.providerRequestCount).toBeGreaterThan(0);
    expect(output.summary.checkpoint).toContain("checkpoints/latest.json");
    expect(output.summary.resumeCommand).toContain("--resume");
    expect(frames.some((frame) => frame.visual?.kind === "agent_thinking")).toBe(true);
    expect(frames.some((frame) => frame.kind === "search")).toBe(true);
  });

  it("passes abort signals through backend API provider calls", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-signal-"));
    dirs.push(artifactDir);
    const controller = new AbortController();
    const echo = new EchoJsonLlm();
    let sawLlmSignal = false;
    let sawSearchSignal = false;
    const llm: LlmChat = {
      name: "testing-echo-signal-test-llm",
      async chat(req) {
        sawLlmSignal ||= req.signal === controller.signal;
        return echo.chat(req);
      },
    };

    const output = await runResearch({
      prompt: "Backend API signal propagation smoke",
      artifactDir,
      language: "en",
      maxCycles: 1,
      signal: controller.signal,
      llm,
      search: mockSearch((signal) => {
        sawSearchSignal ||= signal === controller.signal;
      }),
      onFrame() {},
    });

    expect(output.result.status).toBe("succeeded");
    expect(sawLlmSignal).toBe(true);
    expect(sawSearchSignal).toBe(true);
  });

  it("rejects promptly when a backend request is already aborted", async () => {
    const controller = new AbortController();
    controller.abort("client disconnected");

    await expect(runResearch({
      prompt: "Already aborted backend API request",
      signal: controller.signal,
    })).rejects.toThrow("client disconnected");
  });

  it("rejects a human review response without a resume checkpoint", async () => {
    await expect(runResearch({
      prompt: "A new run cannot consume an old review response.",
      humanReviewResponse: {
        decisions: [{ questionId: "quality_1", action: "accept_risk", rationale: "Accepted for this scope." }],
      },
    })).rejects.toThrow("humanReviewResponse requires resumeCheckpointPath");
  });

  it("returns an auditable resumable failure when a provider hard budget is exhausted", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-budget-exhausted-"));
    dirs.push(artifactDir);
    const runtimeProfile = buildResearchRuntimeProfile({ artifactDir });
    runtimeProfile.providers.default_llm = { maxRequests: 1, maxCostUsd: 1 };
    runtimeProfile.providers.episode = { maxRequests: 1000 };
    const echo = new EchoJsonLlm();
    let calls = 0;
    const llm: LlmChat = {
      name: "testing-echo-hard-budget-llm",
      async chat(req) {
        calls += 1;
        return await echo.chat(req);
      },
    };

    const output = await runResearch({
      prompt: "Stop safely when the configured provider budget is exhausted.",
      runtimeProfile,
      llm,
      search: mockSearch(),
    });

    expect(calls).toBe(1);
    expect(output.result.status).toBe("failed");
    expect(output.result.reportArtifactPath).toContain("budget-exhausted.md");
    expect(output.summary.filesExist.budgetAudit).toBe(true);
    expect(output.summary.checkpoint).toContain("checkpoints/latest.json");
    expect(output.result.metrics).toMatchObject({ providerRequestCount: 1, budgetBreachCount: 1, publishGatePassed: false });
    const audit = JSON.parse(await readFile(output.result.budgetAuditPath!, "utf8")) as { breaches: Array<{ limit: string; provider: string }> };
    expect(audit.breaches).toContainEqual(expect.objectContaining({ limit: "maxRequests", provider: "testing-echo-hard-budget-llm" }));

    runtimeProfile.providers.default_llm = { maxRequests: 100, maxCostUsd: 5 };
    const resumed = await runResearch({
      prompt: "__resume__",
      runtimeProfile,
      resumeCheckpointPath: output.summary.checkpoint,
      llm,
      search: mockSearch(),
    });
    expect(resumed.result.status).toBe("succeeded");
    expect(resumed.result.metrics.providerRequestCount).toBeGreaterThan(1);
  });

  it("inherits the checkpoint artifact directory and policy when applying a review response", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-review-resume-"));
    dirs.push(artifactDir);
    const initial = await runResearch({
      prompt: "Evaluate the fixture claim using authoritative independent evidence.",
      artifactDir,
      maxCycles: 1,
      evidenceQualityMode: "strict",
      llm: new EchoJsonLlm(),
      search: mockSearch(),
    });
    expect(initial.result.status).toBe("needs_human_review");
    expect(initial.result.humanReview?.questions.length).toBeGreaterThan(0);
    if (!initial.summary.checkpoint || !initial.result.humanReview) throw new Error("review checkpoint expected");

    const evidenceReviewed = await runResearch({
      prompt: "__resume__",
      resumeCheckpointPath: initial.summary.checkpoint,
      humanReviewResponse: {
        submittedBy: "api-test",
        decisions: initial.result.humanReview.questions.map((question) => ({
          questionId: question.id,
          action: "accept_risk" as const,
          rationale: "Accept the explicitly recorded limitation for this fixture run.",
        })),
      },
      llm: new EchoJsonLlm(),
      search: mockSearch(),
    });

    expect(evidenceReviewed.result.humanReviewResponsePath?.startsWith(`${artifactDir}/`)).toBe(true);
    expect(evidenceReviewed.summary.filesExist.humanReviewResponse).toBe(true);
    expect(evidenceReviewed.result.status).toBe("needs_human_review");
    expect(evidenceReviewed.result.humanReview?.stage).toBe("publish_gate");
    if (!evidenceReviewed.summary.checkpoint || !evidenceReviewed.result.humanReview) throw new Error("publish review checkpoint expected");

    const publishReviewed = await runResearch({
      prompt: "__resume__",
      resumeCheckpointPath: evidenceReviewed.summary.checkpoint,
      humanReviewResponse: {
        submittedBy: "api-test",
        decisions: evidenceReviewed.result.humanReview.questions.map((question) => ({
          questionId: question.id,
          action: "accept_risk" as const,
          rationale: "Accept this exact deterministic report limitation for the fixture output.",
        })),
      },
      llm: new EchoJsonLlm(),
      search: mockSearch(),
    });

    expect(publishReviewed.result.status).toBe("succeeded");
    expect(publishReviewed.result.humanReviewResponsePath?.startsWith(`${artifactDir}/`)).toBe(true);
    expect(publishReviewed.summary.filesExist.humanReviewResponse).toBe(true);
    const traceEvents = (await readFile(publishReviewed.result.tracePath!, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { eventId: string });
    expect(new Set(traceEvents.map((event) => event.eventId)).size).toBe(traceEvents.length);
  });

  it("applies report budget overrides to the runtime profile", () => {
    const profile = buildResearchRuntimeProfile({
      reportMaxTokens: 20000,
      reportMaxCalls: 100,
      reportContextTokenLimit: 96000,
      evidenceTargetSteps: 80,
      evidenceTargetFetchCalls: 40,
      maxEpisodeCostUsd: 12.5,
      maxLlmRequests: 75,
      maxEpisodeTokens: 500000,
      adaptiveBudget: false,
      completionRepairCycles: 0,
    });

    expect(profile.llm.report?.maxTokens).toBe(20000);
    expect(profile.phases.report?.maxLlmCalls).toBe(100);
    expect(profile.phases.report?.contextTokenLimit).toBe(96000);
    expect(profile.agents.evidence?.targetReactSteps).toBe(80);
    expect(profile.agents.evidence?.maxReactSteps).toBe(160);
    expect(profile.agents.evidence?.targetToolCalls).toBe(79);
    expect(profile.agents.evidence?.maxToolCalls).toBe(159);
    expect(profile.agents.evidence?.targetSearchCalls).toBe(14);
    expect(profile.agents.evidence?.maxSearchCalls).toBe(27);
    expect(profile.agents.evidence?.targetFetchCalls).toBe(40);
    expect(profile.agents.evidence?.maxFetchCalls).toBe(80);
    expect(profile.providers.episode?.maxCostUsd).toBe(12.5);
    expect(profile.providers.default_llm?.maxCostUsd).toBe(12.5);
    expect(profile.providers.default_llm?.maxRequests).toBe(75);
    expect(profile.providers.episode?.maxTotalTokens).toBe(500000);
    expect(profile.providers.default_llm?.maxTotalTokens).toBe(500000);
    expect(profile.adaptiveBudget?.enabled).toBe(false);
    expect(profile.phases.completionGate?.maxCycles).toBe(0);
  });

  it("loads bounded scout and evidence defaults from the shipped runtime config", () => {
    const profile = buildResearchRuntimeProfile({});

    expect(profile.phases.scout).toMatchObject({
      maxReactSteps: 24,
      maxSearchCalls: 8,
      maxFetchCalls: 8,
      contextTokenLimit: 24_000,
      maxOutputItems: 6,
    });
    expect(profile.agents.evidence).toMatchObject({
      targetReactSteps: 12,
      maxReactSteps: 24,
      targetToolCalls: 11,
      maxToolCalls: 23,
      targetSearchCalls: 4,
      maxSearchCalls: 8,
      targetFetchCalls: 4,
      maxFetchCalls: 8,
    });
    expect(profile.phases.completionGate?.maxCycles).toBe(1);
  });

  it("bounds evidence tool and search calls when a small step target overrides the default profile", () => {
    const profile = buildResearchRuntimeProfile({
      evidenceTargetSteps: 8,
      evidenceTargetFetchCalls: 4,
    });

    expect(profile.agents.evidence).toMatchObject({
      targetReactSteps: 8,
      maxReactSteps: 16,
      targetToolCalls: 7,
      maxToolCalls: 15,
      targetSearchCalls: 2,
      maxSearchCalls: 3,
      targetFetchCalls: 4,
      maxFetchCalls: 8,
    });
  });

  it("maps the optional human review switch to the runtime profile", () => {
    expect(buildResearchRuntimeProfile({ humanReview: true }).hilMode).toBe("explicit");
    expect(buildResearchRuntimeProfile({ humanReview: false }).hilMode).toBe("auto_accept");
  });

  it("applies an evidence quality mode override", () => {
    expect(buildResearchRuntimeProfile({ evidenceQualityMode: "strict" }).evidenceQuality.mode).toBe("strict");
  });

  it("applies single-branch debug limits to the runtime profile", () => {
    const profile = buildResearchRuntimeProfile({
      debugSingleBranch: true,
    });

    expect(profile.debug?.singleBranch).toBe(true);
    expect(profile.debug?.maxAspects).toBe(2);
    expect(profile.debug?.maxBranchesPerAspect).toBe(2);
    expect(profile.debug?.maxInitialAgentNodes).toBe(4);
    expect(profile.debug?.maxAgentNodeParts).toBe(2);
    expect(profile.phases.dispatchEvidence?.maxParallelAgents).toBe(4);
    expect(profile.phases.dispatchEvidence?.maxConcurrentAgents).toBe(4);
    expect(profile.phases.dispatchEvidence?.maxCycles).toBe(2);
  });

  it("hard-caps the test profile at two aspects, two branches, and one agent per branch", () => {
    const profile = buildResearchRuntimeProfile({
      debugSingleBranch: true,
      debugMaxAspects: 9,
      debugMaxBranchesPerAspect: 9,
      debugMaxInitialAgentNodes: 99,
    });

    expect(profile.debug?.maxAspects).toBe(2);
    expect(profile.debug?.maxBranchesPerAspect).toBe(2);
    expect(profile.debug?.maxInitialAgentNodes).toBe(4);
    expect(profile.phases.dispatchEvidence?.maxParallelAgents).toBe(4);
    expect(profile.phases.dispatchEvidence?.maxConcurrentAgents).toBe(4);
  });

  it("uses Bocha as the default environment search provider", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-env-"));
    dirs.push(artifactDir);
    const provider = createResearchSearchFromEnv({
      BOCHA_API_KEY: "test-bocha-key",
    }, "bocha", artifactDir);

    expect(provider?.name).toBe("bocha-search");
  });

  it("uses BigModel as the default environment LLM provider", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-llm-env-"));
    dirs.push(artifactDir);
    const llm = createResearchLlmFromEnv({
      AGENT_PROVIDER: "bigmodel",
      BIGMODEL_API_KEY: "test-bigmodel-key",
    }, undefined, artifactDir);

    expect(llm.name).toBe("bigmodel");
  });

  it("honors AGENT_PROVIDER when no LLM override is passed", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-llm-agent-provider-"));
    dirs.push(artifactDir);
    const llm = createResearchLlmFromEnv({
      AGENT_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      DEEPSEEK_BASE_URL: "https://relay.deepseek.test/v1",
      DEEPSEEK_MODEL: "deepseek-v4-flash",
      DEEPSEEK_RETRY: "5",
    }, undefined, artifactDir);

    expect(llm.name).toBe("deepseek");
  });

  it("requires BOCHA_API_KEY for the default search provider", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-env-missing-"));
    dirs.push(artifactDir);
    expect(() => createResearchSearchFromEnv({}, "bocha", artifactDir)).toThrow("BOCHA_API_KEY");
  });

  it("keeps Jina search as an explicit provider", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-env-jina-"));
    dirs.push(artifactDir);
    const provider = createResearchSearchFromEnv({
      JINA_API_KEY: "test-jina-key",
    }, "jina", artifactDir);

    expect(provider?.name).toBe("jina-search");
  });

  it("supports keyless Bing HTML search as an explicit provider", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-env-bing-"));
    dirs.push(artifactDir);
    expect(createResearchSearchFromEnv({ BING_MARKET: "en-US" }, "bing", artifactDir)?.name).toBe("bing-html");
  });

  it("keeps Bing first and uses configured Jina only as a weak-result fallback", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-env-bing-jina-"));
    dirs.push(artifactDir);
    expect(createResearchSearchFromEnv({
      BING_MARKET: "zh-CN",
      JINA_API_KEY: "test-jina-key",
    }, "bing", artifactDir)?.name).toBe("fallback(bing-html->jina-search)");
  });

  it("rejects Bing results that ignore a site constraint or only return dictionaries", () => {
    expect(acceptBingResearchResults({
      query: "site:reedsy.com mystery novel clues",
      providerName: "bing-html",
      results: [{ url: "https://dictionary.cambridge.org/dictionary/english/mystery" }],
    })).toBe(false);
    expect(acceptBingResearchResults({
      query: "悬疑小说 剧情设计 核心要素",
      providerName: "bing-html",
      results: [{ url: "https://baike.baidu.com/item/mystery" }],
    })).toBe(false);
    expect(acceptBingResearchResults({
      query: "site:reedsy.com mystery novel clues",
      providerName: "bing-html",
      results: [{ url: "https://reedsy.com/blog/how-to-write-a-mystery" }],
    })).toBe(true);
  });

  it("uses direct fetch-page by default instead of Jina Reader", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-fetch-env-"));
    dirs.push(artifactDir);
    expect(createResearchFetchFromEnv({}, artifactDir).name).toBe("fetch-page");
    expect(createResearchFetchFromEnv({ FETCH_USE_JINA_READER: "1", JINA_API_KEY: "test-jina-key" }, artifactDir).name).toBe("jina-reader-fetch");
  });

  it("creates an independent publish reviewer only when explicitly configured", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-api-review-env-"));
    dirs.push(artifactDir);
    expect(createResearchReviewLlmFromEnv({}, artifactDir)).toBeUndefined();
    expect(createResearchReviewLlmFromEnv({
      PUBLISH_REVIEW_PROVIDER: "deepseek",
      DEEPSEEK_API_KEY: "test-review-key",
      PUBLISH_REVIEW_MODEL: "deepseek-reasoner",
    }, artifactDir)?.name).toBe("review:deepseek:deepseek-reasoner");
    expect(() => createResearchReviewLlmFromEnv({ PUBLISH_REVIEW_PROVIDER: "unknown" }, artifactDir)).toThrow(/Unsupported PUBLISH_REVIEW_PROVIDER/);
  });

  it("exposes an async iterable stream for SSE/WebSocket adapters", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-stream-api-"));
    dirs.push(artifactDir);
    const messages: ResearchStreamMessage[] = [];

    for await (const message of streamResearch({
      prompt: "Async iterable backend smoke research task",
      artifactDir,
      language: "en",
      maxCycles: 1,
      llm: new EchoJsonLlm(),
      search: mockSearch(),
    })) {
      messages.push(message);
    }

    expect(messages.some((message) => message.type === "frame" && message.frame.kind === "thinking")).toBe(true);
    const result = messages.find((message) => message.type === "result");
    expect(result?.summary.status).toBe("succeeded");
  });

  it("propagates aborts through the async iterable stream", async () => {
    const controller = new AbortController();
    controller.abort("stream client disconnected");

    const stream = streamResearch({
      prompt: "Already aborted stream request",
      signal: controller.signal,
    });

    await expect(stream.next()).rejects.toThrow("stream client disconnected");
  });
});

function mockSearch(onSignal?: (signal: AbortSignal | undefined) => void): SearchProvider {
  return {
    name: "api-test-search",
    async search(query, topK, opts) {
      onSignal?.(opts?.signal);
      return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
        url: `https://example.test/api/${index + 1}`,
        title: `API source ${index + 1}`,
        snippet: `Evidence for ${query}`,
      }));
    },
  };
}
