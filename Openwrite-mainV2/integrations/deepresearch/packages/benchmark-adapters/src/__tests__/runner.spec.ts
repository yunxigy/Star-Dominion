import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EpisodeResult, OrchestratorOptions, RuntimeProfile, TaskSubmission } from "@deepresearch/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BenchmarkAdapter, BenchmarkRunnerOptions } from "../types.js";

const runEpisodeMock = vi.hoisted(() => vi.fn());
const orchestratorConstructorMock = vi.hoisted(() => vi.fn());

vi.mock("@deepresearch/orchestrator", async () => {
  const actual = await vi.importActual<typeof import("@deepresearch/orchestrator")>("@deepresearch/orchestrator");
  return {
    ...actual,
    OrchestratorImpl: class {
      constructor(options: unknown) {
        orchestratorConstructorMock(options);
      }
      runEpisode = runEpisodeMock;
    },
  };
});

import {
  assertBenchmarkEpisodeSucceeded,
  buildBenchmarkRuntimeProfile,
  buildBenchmarkSearchProvider,
  classifyBenchmarkProviderFailure,
  runBenchmarkAdapter,
} from "../runner.js";
import { CheckpointPauseError } from "@deepresearch/orchestrator";

const dirs: string[] = [];

afterEach(() => {
  runEpisodeMock.mockReset();
  orchestratorConstructorMock.mockReset();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("benchmark runner result validation", () => {
  it("accepts only succeeded episode results", () => {
    expect(() => assertBenchmarkEpisodeSucceeded(result("succeeded", "/tmp/report.md"))).not.toThrow();
    expect(() => assertBenchmarkEpisodeSucceeded(result("needs_human_review", "/tmp/review.md"))).toThrow(
      'non-success status "needs_human_review"',
    );
  });

  it("uses bounded evidence-agent budgets and the configured context ceiling", () => {
    const profile = buildBenchmarkRuntimeProfile({
      maxUsd: 5,
      maxTotalTokens: 3_000_000,
      maxRounds: 2,
      maxParallelBranches: 4,
      maxSubAgentTurns: 12,
      subAgentMaxTokens: 7_777,
      subAgentContextMaxChars: 32_000,
      reportMaxTokens: 16_384,
    }, undefined, "/tmp/benchmark-profile");

    expect(profile.phases.dispatchEvidence).toMatchObject({
      maxCycles: 2,
      maxParallelAgents: 4,
      contextTokenLimit: 8_000,
    });
    expect(profile.providers.default_llm?.maxTotalTokens).toBe(3_000_000);
    expect(profile.providers.episode?.maxTotalTokens).toBe(3_000_000);
    expect(profile.providers.episode?.maxCostUsd).toBe(5);
    expect(profile.phases.scout).toMatchObject({ maxSearchCalls: 8, maxFetchCalls: 8, maxOutputItems: 12 });
    expect(profile.phases.publishGate).toMatchObject({ maxCycles: 2 });
    expect(profile.phases.report).toMatchObject({ maxConcurrentAgents: 4 });
    expect(profile.agents.evidence).toMatchObject({
      targetReactSteps: 9,
      maxReactSteps: 12,
      maxToolCalls: 11,
      maxSearchCalls: 2,
      maxFetchCalls: 3,
    });
    expect(profile.llm.evidence?.maxTokens).toBe(7_777);
    expect(profile.debug?.maxAgentNodeParts).toBe(3);
    expect(profile.hilMode).toBe("explicit");

    const constrained = buildBenchmarkRuntimeProfile({
      maxUsd: 5,
      maxRounds: 2,
      maxParallelBranches: 4,
      maxSubAgentTurns: 5,
      subAgentMaxTokens: 4_321,
      subAgentContextMaxChars: 32_000,
      reportMaxTokens: 16_384,
    }, undefined, "/tmp/benchmark-profile-constrained");
    expect(constrained.debug?.maxAgentNodeParts).toBe(1);
    expect(constrained.llm.evidence?.maxTokens).toBe(4_321);

    const raised = buildBenchmarkRuntimeProfile({
      maxUsd: 9,
      maxRounds: 2,
      maxParallelBranches: 4,
      maxSubAgentTurns: 12,
      subAgentMaxTokens: 7_777,
      subAgentContextMaxChars: 32_000,
      reportMaxTokens: 16_384,
    }, undefined, "/tmp/benchmark-profile-raised");
    expect(raised.providers.default_llm?.maxCostUsd).toBe(9);
    expect(raised.providers.episode?.maxCostUsd).toBe(9);

    const restored = structuredClone(profile);
    restored.agents.evidence = {
      ...restored.agents.evidence!,
      maxReactSteps: 8,
      maxToolCalls: 7,
      maxSearchCalls: 2,
      maxFetchCalls: 2,
    };
    const expandedResume = buildBenchmarkRuntimeProfile({
      maxUsd: 5,
      maxRounds: 3,
      maxParallelBranches: 2,
      maxSubAgentTurns: 18,
      subAgentMaxTokens: 12_288,
      subAgentContextMaxChars: 32_000,
      reportMaxTokens: 16_384,
    }, restored, "/tmp/benchmark-profile-expanded-resume");
    expect(expandedResume.agents.evidence).toMatchObject({
      maxReactSteps: 18,
      maxToolCalls: 17,
      maxSearchCalls: 3,
      maxFetchCalls: 5,
    });
  });

  it("surfaces the checkpoint failure behind a failed placeholder report", () => {
    const dir = mkdtempSync(join(tmpdir(), "benchmark-runner-status-"));
    dirs.push(dir);
    mkdirSync(join(dir, "checkpoints"));
    writeFileSync(join(dir, "checkpoints", "last-error.json"), JSON.stringify({
      error: { name: "ProviderBudgetExceededError", message: "llm budget exceeded" },
    }));

    expect(() => assertBenchmarkEpisodeSucceeded(result("failed", join(dir, "budget-exhausted.md")))).toThrow(
      "ProviderBudgetExceededError: llm budget exceeded",
    );
  });

  it("distinguishes billing blocks from retryable rate limits", () => {
    expect(classifyBenchmarkProviderFailure('DeepSeek API 402: {"message":"Insufficient Balance"}')).toEqual({
      rateLimited: false,
      billingBlocked: true,
    });
    expect(classifyBenchmarkProviderFailure("OpenAI API 429: too many requests")).toEqual({
      rateLimited: true,
      billingBlocked: false,
    });
    expect(classifyBenchmarkProviderFailure("Benchmark episode needs human review")).toEqual({
      rateLimited: false,
      billingBlocked: false,
    });
  });

  it("routes literature searches through the ToolProfile arXiv provider", async () => {
    const webSearch = vi.fn(async () => [
      { url: "https://example.com/web", title: "Web", snippet: "" },
    ]);
    const arxivSearch = vi.fn(async () => [
      { url: "https://arxiv.org/abs/1902.00870", title: "Paper", snippet: "" },
    ]);
    const search = buildBenchmarkSearchProvider({
      searchProvider: { name: "web", search: webSearch },
      arxivProvider: { name: "arxiv", search: arxivSearch },
    });

    await expect(search.search("Kaniewski 2019 robust self-testing paper", 5)).resolves.toHaveLength(2);
    expect(webSearch).toHaveBeenCalledOnce();
    expect(arxivSearch).toHaveBeenCalledWith('au:Kaniewski AND all:"robust self-testing"', 5, {});
  });

  it("uses the requested episode identity for successful artifacts and completed-run metadata", async () => {
    const traceRoot = temporaryTraceRoot();
    let adapterEpisodeId = "";
    const adapter = testAdapter((episodeId) => {
      adapterEpisodeId = episodeId;
    });
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const artifactDir = requiredArtifactDir(options.runtimeProfile);
      const episodeDir = join(artifactDir, episodeId);
      mkdirSync(episodeDir, { recursive: true });
      const reportPath = join(episodeDir, "final.md");
      writeFileSync(reportPath, "# Complete report\n");
      return result("succeeded", reportPath, episodeId);
    });

    const benchmark = await runBenchmarkAdapter(benchmarkOptions(traceRoot, adapter));
    const completed = benchmark.completed[0];

    expect(benchmark.failures).toEqual([]);
    expect(benchmark.outputs).toEqual([adapterEpisodeId]);
    expect(completed?.episodeId).toBe(adapterEpisodeId);
    expect(completed?.traceDir).toBe(join(traceRoot, adapterEpisodeId));
    expect(runEpisodeMock.mock.calls[0]?.[1]).toMatchObject({ episodeId: adapterEpisodeId });
    expect(existsSync(join(traceRoot, adapterEpisodeId, "report.md"))).toBe(true);
  });

  it("records a human-review failure as recoverable from the unified episode directory", async () => {
    const traceRoot = temporaryTraceRoot();
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const episodeDir = join(requiredArtifactDir(options.runtimeProfile), episodeId);
      const checkpointDir = join(episodeDir, "checkpoints");
      mkdirSync(checkpointDir, { recursive: true });
      const reportPath = join(episodeDir, "needs-human-review.md");
      const humanReviewPath = join(episodeDir, "human-review.json");
      writeFileSync(reportPath, "# Needs review\n");
      writeFileSync(humanReviewPath, "{}\n");
      writeFileSync(join(checkpointDir, "latest.json"), "{}\n");
      return { ...result("needs_human_review", reportPath, episodeId), humanReviewPath };
    });

    const benchmark = await runBenchmarkAdapter(benchmarkOptions(traceRoot));
    const failure = benchmark.failures[0];

    expect(failure).toMatchObject({
      requestedEpisodeId: failure?.actualEpisodeId,
      recoverable: true,
      billingBlocked: false,
      rateLimited: false,
    });
    expect(failure?.episodeArtifactDir).toBe(failure?.traceDir);
    expect(failure?.resumeCheckpointPath).toBe(join(failure!.traceDir, "checkpoints", "latest.json"));
    expect(failure?.resumeCommand).toContain("pnpm bench:drb2 -- --resume");
    expect(failure?.humanReviewPath).toBe(join(failure!.traceDir, "human-review.json"));
    expect(JSON.parse(readFileSync(join(failure!.traceDir, "failure.json"), "utf8"))).toMatchObject({
      actualEpisodeId: failure?.actualEpisodeId,
      recoverable: true,
    });
  });

  it("records a controlled checkpoint pause separately from real failures", async () => {
    const traceRoot = temporaryTraceRoot();
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const episodeDir = join(requiredArtifactDir(options.runtimeProfile), episodeId);
      const checkpointDir = join(episodeDir, "checkpoints");
      mkdirSync(checkpointDir, { recursive: true });
      const checkpointPath = join(checkpointDir, "latest.json");
      writeFileSync(checkpointPath, "{}\n");
      throw new CheckpointPauseError("after_rubric", checkpointPath);
    });

    const benchmark = await runBenchmarkAdapter({
      ...benchmarkOptions(traceRoot),
      pauseAfterCheckpoint: "after_rubric",
    });
    const pause = benchmark.pauses[0];

    expect(benchmark.failures).toEqual([]);
    expect(pause).toMatchObject({
      recoverable: true,
      error: { name: "CheckpointPauseError" },
    });
    expect(existsSync(join(pause!.traceDir, "failure.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(traceRoot, "failures.json"), "utf8"))).toEqual([]);
    expect(JSON.parse(readFileSync(join(traceRoot, "pauses.json"), "utf8"))).toHaveLength(1);
    expect(orchestratorConstructorMock).toHaveBeenCalledWith(expect.objectContaining({ maxCheckpointFiles: 32 }));
  });

  it("records an early provider failure with last-error diagnostics but no false resume point", async () => {
    const traceRoot = temporaryTraceRoot();
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const episodeDir = join(requiredArtifactDir(options.runtimeProfile), episodeId);
      const checkpointDir = join(episodeDir, "checkpoints");
      mkdirSync(checkpointDir, { recursive: true });
      writeFileSync(join(checkpointDir, "last-error.json"), JSON.stringify({
        episodeId,
        error: { name: "Error", message: "DeepSeek API 402: Insufficient Balance" },
      }));
      writeFileSync(join(episodeDir, "trace.jsonl"), "{}\n");
      throw new Error("DeepSeek API 402: Insufficient Balance");
    });

    const benchmark = await runBenchmarkAdapter(benchmarkOptions(traceRoot));
    const failure = benchmark.failures[0];

    expect(failure).toMatchObject({
      requestedEpisodeId: failure?.actualEpisodeId,
      recoverable: false,
      billingBlocked: true,
      rateLimited: false,
    });
    expect(failure?.resumeCheckpointPath).toBeUndefined();
    expect(failure?.lastErrorPath).toBe(join(failure!.traceDir, "checkpoints", "last-error.json"));
    expect(existsSync(join(failure!.traceDir, "trace.jsonl"))).toBe(true);
  });

  it("routes runner progress logs into the injected logger instead of console", async () => {
    const traceRoot = temporaryTraceRoot();
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const episodeDir = join(requiredArtifactDir(options.runtimeProfile), episodeId);
      mkdirSync(episodeDir, { recursive: true });
      writeFileSync(join(episodeDir, "trace.jsonl"), "{}\n");
      throw new Error("DeepSeek API 402: Insufficient Balance");
    });

    const captured: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const benchmark = await runBenchmarkAdapter({
        ...benchmarkOptions(traceRoot),
        logger: { info: (message) => captured.push(message) },
      });
      expect(benchmark.failures[0]?.billingBlocked).toBe(true);
      // The error channel falls back to the provided info sink.
      expect(captured).toEqual([expect.stringMatching(/\[billing\] Task 7 cannot start/)]);
      expect(consoleLog).not.toHaveBeenCalled();
      expect(consoleError).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
      consoleError.mockRestore();
    }
  });

  it("falls back to a timestamped checkpoint when latest.json was not committed", async () => {
    const traceRoot = temporaryTraceRoot();
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const episodeId = requiredEpisodeId(options);
      const episodeDir = join(requiredArtifactDir(options.runtimeProfile), episodeId);
      const checkpointDir = join(episodeDir, "checkpoints");
      mkdirSync(checkpointDir, { recursive: true });
      writeFileSync(join(checkpointDir, "1784070000000_00001_after_rubric_test.json"), "{}\n");
      throw new Error("provider transport failed");
    });

    const benchmark = await runBenchmarkAdapter(benchmarkOptions(traceRoot));
    const failure = benchmark.failures[0];

    expect(failure?.recoverable).toBe(true);
    expect(failure?.resumeCheckpointPath).toBe(join(
      failure!.traceDir,
      "checkpoints",
      "1784070000000_00001_after_rubric_test.json",
    ));
  });

  it("resumes one benchmark task under the checkpoint episode identity", async () => {
    const traceRoot = temporaryTraceRoot();
    const episodeId = "deepresearch-bench-ii_107_resume";
    const checkpointPath = join(traceRoot, episodeId, "checkpoints", "latest.json");
    mkdirSync(join(traceRoot, episodeId, "checkpoints"), { recursive: true });
    writeFileSync(checkpointPath, "{}\n");
    runEpisodeMock.mockImplementation(async (
      _submission: TaskSubmission,
      options: OrchestratorOptions,
    ) => {
      const reportPath = join(requiredArtifactDir(options.runtimeProfile), episodeId, "final.md");
      mkdirSync(join(traceRoot, episodeId), { recursive: true });
      writeFileSync(reportPath, "# Resumed report\n");
      return result("succeeded", reportPath, episodeId);
    });

    const benchmark = await runBenchmarkAdapter({
      ...benchmarkOptions(traceRoot),
      resumeCheckpointPath: checkpointPath,
      resumeEpisodeId: episodeId,
    });

    expect(benchmark.completed[0]).toMatchObject({
      episodeId,
      traceDir: join(traceRoot, episodeId),
    });
    expect(orchestratorConstructorMock).toHaveBeenCalledWith(expect.objectContaining({
      resumeCheckpointPath: checkpointPath,
      artifactDir: traceRoot,
    }));
    expect(runEpisodeMock.mock.calls[0]?.[1]).toMatchObject({ episodeId });
  });

  it("rejects checkpoint resume when more than one benchmark task is selected", async () => {
    await expect(runBenchmarkAdapter({
      ...benchmarkOptions(temporaryTraceRoot()),
      tasks: [{ id: 7 }, { id: 8 }],
      resumeCheckpointPath: "/tmp/checkpoints/latest.json",
      resumeEpisodeId: "EP_resume",
    })).rejects.toThrow("requires exactly one selected task");
    expect(runEpisodeMock).not.toHaveBeenCalled();
  });
});

function result(status: EpisodeResult["status"], reportArtifactPath: string, episodeId = "EP_test"): EpisodeResult {
  return {
    episodeId,
    status,
    reportArtifactPath,
    metrics: {
      reportNodeCount: 0,
      knowledgeNodeCount: 0,
      evidenceLinkCount: 0,
      completedTaskCount: 0,
      openGapCount: 0,
      citationCount: 0,
      rubricIssueCount: 0,
      publishGatePassed: status === "succeeded",
    },
    closedAt: new Date(0).toISOString(),
  };
}

interface TestTask {
  id: number;
}

function testAdapter(onEpisodeId?: (episodeId: string) => void): BenchmarkAdapter<TestTask, string> {
  return {
    name: "recovery-bench",
    async loadTasks() {
      return [{ id: 7 }];
    },
    taskId: (task) => task.id,
    taskTitle: (task) => `Task ${task.id}`,
    toTaskSubmission: (_task, env) => {
      onEpisodeId?.(env.episodeId);
      return { sessionId: "S_benchmark_recovery", userInput: "Research the test question." };
    },
    buildToolProfile: () => ({
      searchProvider: { name: "test-search", search: async () => [] },
    }),
    async renderOutput(run) {
      return run.episodeId;
    },
    async writeOutputs() {},
  };
}

function benchmarkOptions(
  traceRoot: string,
  adapter: BenchmarkAdapter<TestTask, string> = testAdapter(),
): BenchmarkRunnerOptions<TestTask, string> {
  return {
    adapter,
    tasks: [{ id: 7 }],
    modelName: "test-model",
    traceRoot,
    createLlm: () => ({ name: "unused-test-llm", chat: async () => ({ content: "{}" }) }),
    maxUsd: 1,
    maxRounds: 1,
    maxParallelBranches: 1,
    maxDepth: 2,
    maxSubbranchesPerParent: 1,
    maxSubAgentTurns: 4,
    subAgentMode: "react",
    subAgentMaxTokens: 1_024,
    subAgentContextMaxChars: 4_096,
    synthesizeReport: true,
    reportMaxTokens: 1_024,
    reporterReAct: false,
    reporterMaxTurns: 1,
  };
}

function temporaryTraceRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "benchmark-runner-recovery-"));
  dirs.push(dir);
  return dir;
}

function requiredEpisodeId(options: OrchestratorOptions): string {
  if (!options.episodeId) throw new Error("Test expected runner to provide episodeId");
  return options.episodeId;
}

function requiredArtifactDir(profile: RuntimeProfile | undefined): string {
  if (!profile?.artifactDir) throw new Error("Test expected runner to provide runtimeProfile.artifactDir");
  return profile.artifactDir;
}
