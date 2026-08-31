import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { EpisodeResult, EpisodeStack, ReportArtifact, RuntimeProfile, SearchProvider } from "@deepresearch/contracts";
import { FeatureHashEmbedding } from "@deepresearch/embedding-providers";
import { CheckpointPauseError, OrchestratorImpl, loadDefaultRuntimeProfile, mergeRuntimeProfile } from "@deepresearch/orchestrator";
import { AcademicAugmentedSearchProvider } from "@deepresearch/search-providers";
import { newInMemoryStack } from "@deepresearch/testing";
import type {
  BenchmarkAdapter,
  BenchmarkCompletedRun,
  BenchmarkFailureRecord,
  BenchmarkRunnerOptions,
  BenchmarkRunnerResult,
  FrameworkRunResult,
  ToolProfile,
} from "./types.js";
import { evaluateArtifactCase, type QualityRegressionCaseResult } from "./quality-regression.js";
import { resolveBenchmarkLogger } from "./logger.js";

export async function runBenchmarkAdapter<TTask, TOutput>(
  opts: BenchmarkRunnerOptions<TTask, TOutput>,
): Promise<BenchmarkRunnerResult<TOutput>> {
  mkdirSync(opts.traceRoot, { recursive: true });
  const selected = selectTasks(opts.tasks ?? await opts.adapter.loadTasks(), opts.adapter, opts.ids);
  if (selected.length === 0) throw new Error(`No ${opts.adapter.name} tasks selected`);
  if (opts.resumeCheckpointPath && selected.length !== 1) {
    throw new Error("Benchmark checkpoint resume requires exactly one selected task");
  }
  if (Boolean(opts.resumeCheckpointPath) !== Boolean(opts.resumeEpisodeId)) {
    throw new Error("resumeCheckpointPath and resumeEpisodeId must be provided together");
  }

  const concurrency = opts.concurrency ?? 1;
  const log = resolveBenchmarkLogger(opts.logger);
  const outputs: TOutput[] = [];
  const failures: BenchmarkFailureRecord[] = [];
  const pauses: BenchmarkFailureRecord[] = [];
  const completed: BenchmarkCompletedRun[] = [];
  let rateLimitUntil = 0;

  async function runOne(task: TTask): Promise<void> {
    const now = Date.now();
    if (now < rateLimitUntil) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitUntil - now));
    }

    const taskId = opts.adapter.taskId(task);
    const startedAt = Date.now();
    const episodeId = opts.resumeEpisodeId
      ?? `${sanitizeId(opts.adapter.name)}_${sanitizeId(String(taskId))}_${Date.now()}`;
    const taskEnv = {
      episodeId,
      maxUsd: opts.maxUsd,
      maxTotalTokens: opts.maxTotalTokens,
      maxRounds: opts.maxRounds,
      maxParallelBranches: opts.maxParallelBranches,
      maxDepth: opts.maxDepth,
      maxSubbranchesPerParent: opts.maxSubbranchesPerParent,
    };
    const submission = opts.adapter.toTaskSubmission(task, taskEnv);
    const toolProfile = opts.adapter.buildToolProfile(task, taskEnv);
    const searchProvider = buildBenchmarkSearchProvider(toolProfile);
    const llm = opts.createLlm();
    const traceDir = join(opts.traceRoot, episodeId);
    const runtimeProfile = buildBenchmarkRuntimeProfile(opts, opts.adapter.buildRuntimeProfile?.(task, taskEnv), opts.traceRoot);
    const stack = {
      ...newInMemoryStack({ seed: numericSeed(taskId) }),
      embedding: new FeatureHashEmbedding({ dim: 128 }),
      search: searchProvider,
      fetch: toolProfile.fetchProvider,
      llm,
    } satisfies EpisodeStack;
    const orchestrator = new OrchestratorImpl({
      stack,
      llm,
      search: searchProvider,
      runtimeProfile,
      artifactDir: opts.traceRoot,
      resumeCheckpointPath: opts.resumeCheckpointPath,
      humanReviewResponse: opts.humanReviewResponse,
      pauseAfterCheckpoint: opts.pauseAfterCheckpoint,
      maxCheckpointFiles: opts.pauseAfterCheckpoint ? 32 : undefined,
    });
    let episodeResult: EpisodeResult | undefined;

    try {
      const result = await orchestrator.runEpisode(submission, { episodeId, runtimeProfile });
      episodeResult = result;
      copyAuditArtifacts(dirname(result.reportArtifactPath), traceDir);
      assertBenchmarkEpisodeSucceeded(result);
      const artifact = readReportArtifact(result);
      const expectation = typeof opts.qualityExpectation === "function"
        ? opts.qualityExpectation(task)
        : opts.qualityExpectation;
      const quality = expectation
        ? evaluateArtifactCase({
          id: String(taskId),
          description: `${opts.adapter.name} Task ${taskId}`,
          artifactDir: traceDir,
          expect: expectation,
        })
        : undefined;
      if (quality && !quality.passed) throw new BenchmarkQualityRegressionError(quality);
      writeReportArtifact(traceDir, artifact);
      writeTraceSummary(traceDir, {
        title: `${opts.adapter.name} Task ${taskId}`,
        inputs: opts.adapter.traceInputs?.(task) ?? { taskId, title: opts.adapter.taskTitle(task) },
        result,
        metrics: result.metrics,
        quality,
      });
      const run: FrameworkRunResult = { taskId, episodeId: result.episodeId, submission, result, artifact, stack, traceDir };
      outputs.push(await opts.adapter.renderOutput(run, task));
      completed.push({
        taskId,
        episodeId: result.episodeId,
        traceDir,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        metrics: result.metrics,
      });
      log.info(`[done] Task ${taskId} completed`);
    } catch (err) {
      const msg = String(err);
      const classification = classifyBenchmarkProviderFailure(msg);
      const failure = createFailureRecord(
        taskId,
        episodeId,
        traceDir,
        err,
        classification,
        Date.now() - startedAt,
        episodeResult,
      );
      if (err instanceof CheckpointPauseError) {
        pauses.push(failure);
        log.info(`[paused] Task ${taskId} after ${err.stage}. Resume from: ${err.checkpointPath}`);
      } else {
        failures.push(failure);
        writeFailureRecord(traceDir, failure);
      }
      if (err instanceof CheckpointPauseError) {
        return;
      } else if (classification.rateLimited) {
        const cooldownMs = opts.rateLimitCooldownMs ?? 60 * 60 * 1000;
        rateLimitUntil = Date.now() + cooldownMs;
        log.info(`[rate-limit] Task ${taskId} hit rate limit. Cooling down for ${Math.round(cooldownMs / 60000)}min.`);
        selected.push(task);
      } else if (classification.billingBlocked) {
        log.error(`[billing] Task ${taskId} cannot start because the model provider reported insufficient balance or quota. Not retrying.`);
      } else {
        log.error(`[error] Task ${taskId} failed: ${msg}`);
      }
    }
  }

  const running = new Set<Promise<void>>();
  for (const task of selected) {
    if (running.size >= concurrency) {
      await Promise.race(running);
    }
    const p = runOne(task).then(() => {
      running.delete(p);
    });
    running.add(p);
  }
  await Promise.all(running);

  await opts.adapter.writeOutputs(outputs, { modelName: opts.modelName, outputPath: opts.outputPath, outputDir: opts.outputPath });
  writeFileSync(join(opts.traceRoot, "failures.json"), `${JSON.stringify(failures, null, 2)}\n`, "utf-8");
  writeFileSync(join(opts.traceRoot, "pauses.json"), `${JSON.stringify(pauses, null, 2)}\n`, "utf-8");
  return { outputs, traceRoot: opts.traceRoot, failures, pauses, completed };
}

export function assertBenchmarkEpisodeSucceeded(result: EpisodeResult): void {
  if (result.status === "succeeded") return;
  if (result.status === "needs_human_review") {
    const detail = result.humanReviewPath ?? result.reportArtifactPath;
    throw new BenchmarkEpisodeStatusError(result.status, result.episodeId, `; human review artifact: ${detail}`);
  }
  const lastErrorPath = join(dirname(result.reportArtifactPath), "checkpoints", "last-error.json");
  const lastError = readJsonIfExists<{ error?: { name?: string; message?: string } }>(lastErrorPath, {});
  const detail = [lastError.error?.name, lastError.error?.message].filter(Boolean).join(": ");
  const suffix = detail ? `: ${detail}` : `; report artifact: ${result.reportArtifactPath}`;
  throw new BenchmarkEpisodeStatusError(result.status, result.episodeId, suffix);
}

function ensureNamedSearchProvider(provider: SearchProvider): SearchProvider {
  return {
    name: provider.name || "benchmark-search",
    search: (query, topK, opts) => provider.search(query, topK, opts),
  };
}

export function buildBenchmarkSearchProvider(
  toolProfile: Pick<ToolProfile, "searchProvider" | "arxivProvider">,
): SearchProvider {
  const web = ensureNamedSearchProvider(toolProfile.searchProvider);
  return toolProfile.arxivProvider
    ? new AcademicAugmentedSearchProvider({
        web,
        academic: ensureNamedSearchProvider(toolProfile.arxivProvider),
      })
    : web;
}

function selectTasks<TTask>(
  tasks: TTask[],
  adapter: BenchmarkAdapter<TTask, unknown>,
  ids: Array<string | number> | undefined,
): TTask[] {
  if (!ids || ids.length === 0) return tasks;
  const wanted = new Set(ids.map(String));
  return tasks.filter((task) => wanted.has(String(adapter.taskId(task))));
}

export function buildBenchmarkRuntimeProfile(
  opts: Pick<BenchmarkRunnerOptions<unknown>, "maxUsd" | "maxTotalTokens" | "maxRounds" | "maxParallelBranches" | "maxSubAgentTurns" | "subAgentMaxTokens" | "subAgentContextMaxChars" | "reportMaxTokens">,
  override: Partial<RuntimeProfile> | undefined,
  artifactDir: string,
): RuntimeProfile {
  const base = loadDefaultRuntimeProfile();
  const profile = mergeRuntimeProfile(base, override);
  const hardSteps = Math.max(2, Math.floor(opts.maxSubAgentTurns));
  // A planned reportlet normally needs at least search -> fetch -> save/link,
  // plus one final response. Scale decomposition with the actual ReAct budget
  // instead of collapsing every benchmark task to two oversized parts.
  const agentNodePartCapacity = Math.max(1, Math.min(4, Math.floor((hardSteps - 1) / 3)));
  // Keep interaction available for genuine preference or non-waivable integrity
  // decisions. Balanced evidence scarcity is resolved separately by the
  // completion disposition policy, so this no longer forces routine gaps into HIL.
  profile.hilMode = "explicit";
  profile.artifactDir = artifactDir;
  profile.providers.default_llm = {
    ...profile.providers.default_llm,
    maxCostUsd: opts.maxUsd,
    ...(typeof opts.maxTotalTokens === "number" ? { maxTotalTokens: opts.maxTotalTokens } : {}),
  };
  // The episode envelope defaults to the same ceiling as the LLM provider, so
  // raising --maxUsd without mirroring it here would silently keep the old
  // per-task ceiling effective (LLM + search + fetch share the envelope).
  profile.providers.episode = {
    ...profile.providers.episode,
    maxCostUsd: opts.maxUsd,
    ...(typeof opts.maxTotalTokens === "number" ? { maxTotalTokens: opts.maxTotalTokens } : {}),
  };
  if (profile.phases.scout) {
    profile.phases.scout = {
      ...profile.phases.scout,
      maxSearchCalls: Math.min(profile.phases.scout.maxSearchCalls ?? 8, 8),
      maxFetchCalls: Math.min(profile.phases.scout.maxFetchCalls ?? 8, 8),
      maxOutputItems: Math.min(profile.phases.scout.maxOutputItems ?? 12, 12),
    };
  }
  if (profile.phases.dispatchEvidence) {
    profile.phases.dispatchEvidence = {
      ...profile.phases.dispatchEvidence,
      maxCycles: opts.maxRounds,
      maxParallelAgents: opts.maxParallelBranches,
      contextTokenLimit: Math.max(1_024, Math.ceil(opts.subAgentContextMaxChars / 4)),
    };
  }
  if (profile.agents.evidence) {
    // --maxSubAgentTurns is an explicit run ceiling, including on resume. Do
    // not silently retain the smaller tool caps restored from an older
    // checkpoint when the caller deliberately increases this value.
    const hardToolCalls = Math.max(1, hardSteps - 1);
    const hardSearchCalls = Math.max(1, Math.ceil(hardSteps / 6));
    const hardFetchCalls = Math.max(1, Math.ceil(hardSteps / 4));
    profile.agents.evidence = {
      ...profile.agents.evidence,
      targetReactSteps: Math.max(2, Math.min(hardSteps, Math.ceil(hardSteps * 0.75))),
      maxReactSteps: hardSteps,
      targetToolCalls: Math.max(1, Math.min(hardToolCalls, Math.ceil(hardToolCalls * 0.75))),
      maxToolCalls: hardToolCalls,
      targetSearchCalls: Math.min(2, hardSearchCalls),
      maxSearchCalls: hardSearchCalls,
      targetFetchCalls: Math.min(2, hardFetchCalls),
      maxFetchCalls: hardFetchCalls,
    };
  }
  if (profile.llm.evidence) {
    profile.llm.evidence = {
      ...profile.llm.evidence,
      maxTokens: Math.max(1, Math.floor(opts.subAgentMaxTokens)),
    };
  }
  profile.debug = {
    ...profile.debug,
    maxAgentNodeParts: Math.min(profile.debug?.maxAgentNodeParts ?? agentNodePartCapacity, agentNodePartCapacity),
  };
  if (profile.phases.publishGate) {
    profile.phases.publishGate = {
      ...profile.phases.publishGate,
      maxCycles: Math.min(profile.phases.publishGate.maxCycles ?? 2, 2),
    };
  }
  if (profile.phases.report) {
    profile.phases.report = {
      ...profile.phases.report,
      maxConcurrentAgents: Math.max(1, Math.min(
        profile.phases.report.maxConcurrentAgents ?? 4,
        opts.maxParallelBranches,
      )),
    };
  }
  if (profile.llm.report) {
    profile.llm.report = {
      ...profile.llm.report,
      maxTokens: opts.reportMaxTokens,
    };
  }
  return profile;
}

function readReportArtifact(result: { episodeId: string; reportArtifactPath: string; evidenceIndexPath?: string; closedAt: string }): ReportArtifact {
  const dir = dirname(result.reportArtifactPath);
  const citationMapPath = join(dir, "citation-map.json");
  const diagnosticsPath = join(dir, "grounding-diagnostics.json");
  const evidenceIndexPath = result.evidenceIndexPath ?? join(dir, "evidence-index.json");
  return {
    episodeId: result.episodeId,
    reportMd: existsSync(result.reportArtifactPath) ? readFileSync(result.reportArtifactPath, "utf-8") : "",
    citationMap: readJsonIfExists<Record<string, string>>(citationMapPath, {}),
    evidenceIndex: readJsonIfExists<ReportArtifact["evidenceIndex"]>(evidenceIndexPath, []),
    diagnostics: readJsonIfExists<ReportArtifact["diagnostics"]>(diagnosticsPath, []),
    generatedAt: result.closedAt,
  };
}

function readJsonIfExists<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function writeTraceSummary(traceDir: string, payload: unknown): void {
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "summary.json"), JSON.stringify(payload, null, 2), "utf-8");
}

function copyAuditArtifacts(sourceDir: string, traceDir: string): void {
  mkdirSync(traceDir, { recursive: true });
  for (const filename of ["evidence-quality-audit.json", "budget-audit.json"] as const) {
    const source = resolve(sourceDir, filename);
    const destination = resolve(traceDir, filename);
    if (source !== destination && existsSync(source)) copyFileSync(source, destination);
  }
}

function createFailureRecord(
  taskId: string | number,
  requestedEpisodeId: string,
  traceDir: string,
  error: unknown,
  classification: ReturnType<typeof classifyBenchmarkProviderFailure>,
  durationMs: number,
  result?: EpisodeResult,
): BenchmarkFailureRecord {
  const normalized = error instanceof Error ? error : new Error(String(error));
  const recovery = discoverFailureRecovery(requestedEpisodeId, traceDir, result);
  return {
    taskId,
    requestedEpisodeId,
    ...recovery,
    traceDir,
    failedAt: new Date().toISOString(),
    rateLimited: classification.rateLimited,
    billingBlocked: classification.billingBlocked,
    retryScheduled: classification.rateLimited,
    error: {
      name: normalized.name,
      message: normalized.message,
      stack: normalized.stack,
    },
    qualityFailures: error instanceof BenchmarkQualityRegressionError ? error.result.failures : undefined,
    durationMs,
  };
}

function discoverFailureRecovery(
  requestedEpisodeId: string,
  traceDir: string,
  result?: EpisodeResult,
): Pick<BenchmarkFailureRecord,
  "actualEpisodeId" | "episodeArtifactDir" | "resumeCheckpointPath" | "humanReviewPath" | "lastErrorPath" | "resumeCommand" | "recoverable"
> {
  const episodeArtifactDir = result ? dirname(result.reportArtifactPath) : traceDir;
  const checkpointsDir = join(episodeArtifactDir, "checkpoints");
  const lastErrorPath = join(checkpointsDir, "last-error.json");
  const conventionalHumanReviewPath = join(episodeArtifactDir, "human-review.json");
  const humanReviewPath = result?.humanReviewPath && existsSync(result.humanReviewPath)
    ? result.humanReviewPath
    : existsSync(conventionalHumanReviewPath) ? conventionalHumanReviewPath : undefined;
  const resumeCheckpointPath = findResumeCheckpointPath(checkpointsDir);
  return {
    actualEpisodeId: result?.episodeId ?? requestedEpisodeId,
    episodeArtifactDir,
    resumeCheckpointPath,
    humanReviewPath,
    lastErrorPath: existsSync(lastErrorPath) ? lastErrorPath : undefined,
    resumeCommand: resumeCheckpointPath
      ? `pnpm bench:drb2 -- --resume ${JSON.stringify(resumeCheckpointPath)}`
      : undefined,
    recoverable: Boolean(resumeCheckpointPath),
  };
}

function findResumeCheckpointPath(checkpointsDir: string): string | undefined {
  const latest = join(checkpointsDir, "latest.json");
  if (isRegularFile(latest)) return latest;
  if (!existsSync(checkpointsDir)) return undefined;
  try {
    const newestTimestamped = readdirSync(checkpointsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^\d{13}_.+\.json$/u.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => b.localeCompare(a))[0];
    return newestTimestamped ? join(checkpointsDir, newestTimestamped) : undefined;
  } catch {
    return undefined;
  }
}

function isRegularFile(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function writeFailureRecord(traceDir: string, failure: BenchmarkFailureRecord): void {
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "failure.json"), `${JSON.stringify(failure, null, 2)}\n`, "utf-8");
}

function numericSeed(value: string | number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  let hash = 0;
  for (const ch of String(value)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash || 1;
}

function sanitizeId(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .slice(0, 48)
    || "task";
}

function writeReportArtifact(traceDir: string, artifact: ReportArtifact): void {
  mkdirSync(traceDir, { recursive: true });
  writeFileSync(join(traceDir, "report.md"), artifact.reportMd, "utf-8");
  writeFileSync(join(traceDir, "report.json"), JSON.stringify(artifact, null, 2), "utf-8");
}

export function classifyBenchmarkProviderFailure(message: string): { rateLimited: boolean; billingBlocked: boolean } {
  const normalized = message.toLowerCase();
  return {
    rateLimited: /\b429\b|rate[_ -]?limit|too many requests/u.test(normalized),
    billingBlocked: /\b402\b|insufficient (?:balance|credit|quota)|payment required|billing (?:error|limit|quota)/u.test(normalized),
  };
}

class BenchmarkQualityRegressionError extends Error {
  constructor(readonly result: QualityRegressionCaseResult) {
    super(`Quality regression failed: ${result.failures.join("; ")}`);
    this.name = "BenchmarkQualityRegressionError";
  }
}

class BenchmarkEpisodeStatusError extends Error {
  constructor(readonly status: EpisodeResult["status"], episodeId: string, suffix: string) {
    super(`Benchmark episode ${episodeId} ended with non-success status ${JSON.stringify(status)}${suffix}`);
    this.name = "BenchmarkEpisodeStatusError";
  }
}
