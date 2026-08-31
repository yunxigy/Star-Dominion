import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { FetchProvider, HumanReviewResponse, SearchProvider, TaskSubmission } from "@deepresearch/contracts";
import { createLlmChatFromEnv } from "@deepresearch/embedding-providers";
import { createResearchFetchFromEnv, inspectResearchCheckpoint } from "@deepresearch/orchestrator";
import { ArxivSearchProvider, BingSearchProvider, BochaSearchProvider, BraveSearchProvider, FallbackSearchProvider, JinaSearchProvider } from "@deepresearch/search-providers";
import type { SearchHit } from "@deepresearch/search-providers";
import { runBenchmarkAdapter } from "./runner.js";
import type { AdapterTaskEnv, AdapterWriteEnv, BenchmarkAdapter, BenchmarkRunnerOptions, ToolProfile, FrameworkRunResult } from "./types.js";
import { resolveBenchmarkLogger, type BenchmarkLogger } from "./logger.js";
import {
  aggregateDeepResearchBenchIIOfficialScores,
  appendDeepResearchBenchIIHistory,
  ensureDeepResearchBenchIIDataset,
  evaluatorCredentialsConfigured,
  parseDeepResearchBenchIIContent,
  runDeepResearchBenchIIOfficialEvaluator,
  selectDeepResearchBenchIITasks,
  taskRubricCounts,
  writeJsonAtomic,
  type DeepResearchBenchIIOfficialScore,
  type DeepResearchBenchIITaskRecord,
} from "./deepresearch-bench-ii-harness.js";

export type DeepResearchBenchIITask = DeepResearchBenchIITaskRecord;

export interface DeepResearchBenchIIOutput {
  idx: number;
  id: string;
  reportPath: string;
}

export interface DeepResearchBenchIIAdapterOptions {
  queryPath: string;
  outputDir: string;
  env?: NodeJS.ProcessEnv;
  searchProvider?: SearchProvider;
  fetchProvider?: FetchProvider;
}

export class DeepResearchBenchIIAdapter implements BenchmarkAdapter<DeepResearchBenchIITask, DeepResearchBenchIIOutput> {
  readonly name = "deepresearch-bench-ii";
  private readonly queryPath: string;
  private readonly outputDir: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly searchProvider?: SearchProvider;
  private readonly fetchProvider?: FetchProvider;

  constructor(opts: DeepResearchBenchIIAdapterOptions) {
    this.queryPath = opts.queryPath;
    this.outputDir = opts.outputDir;
    this.env = opts.env ?? process.env;
    this.searchProvider = opts.searchProvider;
    this.fetchProvider = opts.fetchProvider;
  }

  async loadTasks(): Promise<DeepResearchBenchIITask[]> {
    return readJsonl<DeepResearchBenchIITask>(this.queryPath);
  }

  taskId(task: DeepResearchBenchIITask): string {
    return String(task.idx);
  }

  taskTitle(task: DeepResearchBenchIITask): string {
    return task.prompt.slice(0, 100);
  }

  toTaskSubmission(task: DeepResearchBenchIITask, _env: AdapterTaskEnv): TaskSubmission {
    const languageInstruction = task.language === "zh"
      ? "最终报告必须用中文。"
      : "The final report must be written in English.";
    const content = parseDeepResearchBenchIIContent(task);
    const taskText = typeof content.task === "string" && content.task.trim() ? content.task.trim() : task.prompt;
    const blockedUrls = Array.isArray(content.blocked?.urls) ? content.blocked.urls.filter((url): url is string => typeof url === "string") : [];
    const blockedTitle = typeof content.blocked?.title === "string" ? content.blocked.title : undefined;
    const blockedInstruction = blockedUrls.length
      ? `\n\n**IMPORTANT — BLOCKED REFERENCE:** Do not search for, open, save, or cite ${blockedTitle ? JSON.stringify(blockedTitle) : "the blocked source"}. The following URLs are forbidden:\n${blockedUrls.map((u: string) => `- ${u}`).join("\n")}`
      : "";
    const adaptedPrompt = `${taskText}\n\n${languageInstruction}${blockedInstruction}`;
    return {
      sessionId: `S_DRB2_${task.idx}`,
      userInput: adaptedPrompt,
      uiOptions: {
        outputLanguage: task.language === "zh" ? "zh-CN" : "en",
        citationRequired: true,
      },
    };
  }

  buildToolProfile(task: DeepResearchBenchIITask, _env: AdapterTaskEnv): ToolProfile {
    const proxy = this.env.HTTP_PROXY ?? this.env.http_proxy;
    let searchProvider: SearchProvider;
    if (this.searchProvider) {
      searchProvider = this.searchProvider;
    } else {
      const providers = benchmarkSearchProviders(this.env, task, proxy);
      if (providers.length === 0) {
        throw new Error("No search API key found. Set BOCHA_API_KEY, BRAVE_API_KEY, JINA_API_KEY, or BING_API_KEY.");
      }
      const selectedProvider = providers.length === 1
        ? providers[0]!
        : new FallbackSearchProvider({ providers, acceptResults: acceptBenchmarkAuthoritySearchResults });
      searchProvider = preferBenchmarkAuthorityResults(selectedProvider);
    }
    const blocked = blockedSourceMatcher(task);
    return {
      searchProvider: filterBlockedSearchProvider(searchProvider, blocked),
      fetchProvider: filterBlockedFetchProvider(this.fetchProvider ?? createResearchFetchFromEnv(this.env), blocked),
      arxivProvider: filterBlockedSearchProvider(
        new ArxivSearchProvider({ timeoutMs: 20000, sortBy: "relevance" }),
        blocked,
      ),
      jinaApiKey: this.env.JINA_API_KEY,
      policy: {
        defaultTopK: 5,
        preferredSources: ["web", "arxiv"],
      },
    };
  }

  traceInputs(task: DeepResearchBenchIITask): Record<string, unknown> {
    return {
      idx: task.idx,
      language: task.language,
      theme: task.theme,
      prompt: task.prompt,
    };
  }

  async renderOutput(run: FrameworkRunResult, task: DeepResearchBenchIITask): Promise<DeepResearchBenchIIOutput> {
    // Save report as markdown file in outputDir
    const reportPath = join(this.outputDir, `idx-${task.idx}.md`);
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, run.artifact.reportMd, "utf-8");
    return {
      idx: task.idx,
      id: task.id,
      reportPath,
    };
  }

  async writeOutputs(outputs: DeepResearchBenchIIOutput[], env: AdapterWriteEnv): Promise<void> {
    // Reports already written individually in renderOutput
    const manifestPath = join(env.outputDir ?? this.outputDir, "manifest.json");
    mkdirSync(dirname(manifestPath), { recursive: true });
    writeFileSync(manifestPath, JSON.stringify(outputs, null, 2), "utf-8");
  }
}

export interface DeepResearchBenchIICliOptions {
  argv: string[];
  env: NodeJS.ProcessEnv;
  repoRoot: string;
  workspaceRoot: string;
  /** Progress output sink; defaults to console. */
  logger?: BenchmarkLogger;
}

export async function runDeepResearchBenchIICli(opts: DeepResearchBenchIICliOptions): Promise<void> {
  const log = resolveBenchmarkLogger(opts.logger);
  if (opts.argv.includes("--help") || opts.argv.includes("-h")) {
    printDeepResearchBenchIIHelp(log.info);
    return;
  }
  const readArg = (name: string): string | undefined => argumentValue(opts.argv, name);
  const hasFlag = (name: string): boolean => opts.argv.includes(name);
  const env = loadBenchmarkEnvironment(opts.env, opts.repoRoot);
  const resume = readArg("--resume")
    ? await loadDeepResearchBenchIIResume(readArg("--resume")!)
    : undefined;
  const requestedIds = (readArg("--ids") ?? readArg("--idx") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (resume && requestedIds.length > 0 && (requestedIds.length !== 1 || requestedIds[0] !== String(resume.taskId))) {
    throw new Error(`--resume checkpoint belongs to task ${resume.taskId}; omit --ids or pass only --ids ${resume.taskId}`);
  }
  const ids = resume ? [String(resume.taskId)] : requestedIds;
  const modelName = readArg("--name") ?? resume?.modelName ?? "our-framework";
  const seed = readArg("--seed") ?? resume?.seed;
  const legacyRoot = join(opts.workspaceRoot, "DeepResearch-Bench-II");
  const cacheRoot = join(opts.repoRoot, "artifacts/benchmark-cache/deepresearch-bench-ii");
  const drb2Root = readArg("--drb2Root")
    ?? (existsSync(join(legacyRoot, "tasks_and_rubrics.jsonl")) ? legacyRoot : cacheRoot);
  const queryPath = readArg("--queryPath")
    ?? resume?.queryPath
    ?? join(drb2Root, "tasks_and_rubrics.jsonl");
  const dataset = await ensureDeepResearchBenchIIDataset(queryPath);
  if (resume?.datasetSha256 && dataset.sha256 !== resume.datasetSha256) {
    throw new Error(`Cannot resume against a different Bench II dataset revision: expected ${resume.datasetSha256}, observed ${dataset.sha256}`);
  }
  const allTasks = readJsonl<DeepResearchBenchIITask>(dataset.path);
  const selection = selectDeepResearchBenchIITasks(allTasks, {
    ids,
    all: hasFlag("--all"),
    sampleSize: optionalPositiveInteger(readArg("--sample"), 1, "--sample"),
    seed,
  });
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const requestedTraceRoot = readArg("--traceRoot");
  if (resume && requestedTraceRoot && resolve(requestedTraceRoot) !== resolve(resume.traceRoot)) {
    throw new Error(`--resume must continue in the checkpoint artifact root: ${resume.traceRoot}`);
  }
  const traceRoot = resume?.traceRoot
    ?? requestedTraceRoot
    ?? join(opts.repoRoot, `artifacts/benchmark-traces/deepresearch-bench-ii/${safePathSegment(modelName)}-${runStamp}-${selection.seed.slice(0, 12)}`);
  const reportRoot = readArg("--reportRoot") ?? resume?.reportRoot ?? join(traceRoot, "official-input");
  const outputDir = readArg("--outputDir") ?? resume?.outputDir ?? join(reportRoot, safePathSegment(modelName));
  const historyPath = readArg("--historyPath")
    ?? resume?.historyPath
    ?? join(opts.repoRoot, "artifacts/benchmark-history/deepresearch-bench-ii.jsonl");
  const manifestPath = join(traceRoot, resume ? `benchmark-resume-${runStamp}.json` : "benchmark-run.json");
  const adapter = new DeepResearchBenchIIAdapter({ queryPath, outputDir, env });
  const selectedTasks = selection.tasks.map((task) => ({
    idx: task.idx,
    id: task.id,
    language: task.language,
    theme: task.theme,
    description: task.description,
    license: task.license,
    rubricCounts: taskRubricCounts(task),
  }));
  const previousGeneration = resume?.generation;
  const pauseAfterCheckpoint = readArg("--pauseAfterCheckpoint") as BenchmarkRunnerOptions<DeepResearchBenchIITask>["pauseAfterCheckpoint"];
  if (pauseAfterCheckpoint && ![
    "after_rubric",
    "after_root",
    "after_scout",
    "after_main_planner",
    "after_dispatch",
    "after_structure_review",
    "after_report",
  ].includes(pauseAfterCheckpoint)) {
    throw new Error("--pauseAfterCheckpoint must name a stable checkpoint stage");
  }
  const subAgentMode = readArg("--subAgentMode") ?? stringRecordValue(previousGeneration, "subAgentMode") ?? "react";
  if (subAgentMode !== "single" && subAgentMode !== "react") throw new Error("--subAgentMode must be single or react");
  const generation = {
    llmProvider: readArg("--llm") ?? stringRecordValue(previousGeneration, "llmProvider") ?? "auto",
    maxUsd: numericArg(readArg("--maxUsd"), numberRecordValue(previousGeneration, "maxUsd") ?? 5, "--maxUsd", 0),
    maxTotalTokens: numericArg(readArg("--maxTotalTokens"), numberRecordValue(previousGeneration, "maxTotalTokens") ?? 2_000_000, "--maxTotalTokens", 1),
    maxRounds: numericArg(readArg("--maxRounds"), numberRecordValue(previousGeneration, "maxRounds") ?? 2, "--maxRounds", 1),
    maxParallelBranches: numericArg(readArg("--maxParallelBranches"), numberRecordValue(previousGeneration, "maxParallelBranches") ?? 4, "--maxParallelBranches", 1),
    maxDepth: numericArg(readArg("--maxDepth"), numberRecordValue(previousGeneration, "maxDepth") ?? 3, "--maxDepth", 1),
    maxSubbranchesPerParent: numericArg(readArg("--maxSubbranchesPerParent"), numberRecordValue(previousGeneration, "maxSubbranchesPerParent") ?? 2, "--maxSubbranchesPerParent", 1),
    maxSubAgentTurns: numericArg(readArg("--maxSubAgentTurns") ?? env.MAX_SUB_AGENT_TURNS, numberRecordValue(previousGeneration, "maxSubAgentTurns") ?? 12, "--maxSubAgentTurns", 2),
    subAgentMode,
    subAgentMaxTokens: numericArg(readArg("--subAgentMaxTokens"), numberRecordValue(previousGeneration, "subAgentMaxTokens") ?? 12_288, "--subAgentMaxTokens", 1),
    subAgentContextMaxChars: numericArg(readArg("--subAgentContextMaxChars"), numberRecordValue(previousGeneration, "subAgentContextMaxChars") ?? 32_000, "--subAgentContextMaxChars", 1),
    synthesizeReport: booleanArg(readArg("--synthesizeReport"), booleanRecordValue(previousGeneration, "synthesizeReport") ?? true),
    reportMaxTokens: numericArg(readArg("--reportMaxTokens"), numberRecordValue(previousGeneration, "reportMaxTokens") ?? 16_384, "--reportMaxTokens", 1),
    reporterReAct: booleanArg(readArg("--reporterReAct"), booleanRecordValue(previousGeneration, "reporterReAct") ?? true),
    reporterMaxTurns: numericArg(readArg("--reporterMaxTurns"), numberRecordValue(previousGeneration, "reporterMaxTurns") ?? 4, "--reporterMaxTurns", 1),
    concurrency: numericArg(readArg("--parallel"), numberRecordValue(previousGeneration, "concurrency") ?? 1, "--parallel", 1),
    rateLimitCooldownMs: numericArg(readArg("--rateLimitCooldownMs"), numberRecordValue(previousGeneration, "rateLimitCooldownMs") ?? 60 * 60 * 1000, "--rateLimitCooldownMs", 0),
  } as const;
  const baseRecord: Record<string, unknown> = {
    version: 2,
    benchmark: "DeepResearch Bench II",
    benchmarkUrl: "https://agentresearchlab.com/benchmarks/deepresearch-bench-ii/index.html#leaderboard",
    status: hasFlag("--select-only") ? "selected" : "running",
    modelName,
    seed: selection.seed,
    selectionMode: selection.mode,
    selectedTasks,
    dataset: {
      path: dataset.path,
      sha256: dataset.sha256,
      taskCount: dataset.taskCount,
      downloaded: dataset.downloaded,
    },
    traceRoot,
    manifestPath,
    historyPath,
    reportRoot,
    outputDir,
    generation,
    pauseAfterCheckpoint,
    resumedFrom: resume ? {
      checkpointPath: resume.checkpointPath,
      episodeId: resume.episodeId,
      cursor: { stage: resume.stage, nextCycle: resume.nextCycle },
      sourceManifestPath: resume.sourceManifestPath,
    } : undefined,
    startedAt: new Date().toISOString(),
    evaluation: { status: hasFlag("--evaluate") ? "pending" : "not_requested" },
  };
  writeJsonAtomic(manifestPath, baseRecord);

  log.info(`Selected ${selection.tasks.length}/${dataset.taskCount} DeepResearch Bench II task(s): ${selection.tasks.map((task) => task.idx).join(", ")}`);
  log.info(`Selection seed: ${selection.seed} (${selection.mode})`);
  log.info(`Dataset SHA-256: ${dataset.sha256}`);
  if (hasFlag("--select-only")) {
    log.info(`Selection manifest: ${manifestPath}`);
    return;
  }

  if (resume && resume.stage !== "after_report" && resume.nextCycle > generation.maxRounds && readArg("--maxRounds") === undefined) {
    log.warn(`[resume] Checkpoint nextCycle=${resume.nextCycle} exceeds maxRounds=${generation.maxRounds}. Pass --maxRounds ${resume.nextCycle} or higher to authorize additional evidence cycles; otherwise resume may only re-run completion gates.`);
  }

  const reviewResponsePath = readArg("--reviewResponse");
  if (reviewResponsePath && !resume) throw new Error("--reviewResponse requires --resume");
  const humanReviewResponse = reviewResponsePath
    ? JSON.parse(readFileSync(reviewResponsePath, "utf8")) as HumanReviewResponse
    : undefined;

  if (resume) archiveResumeFailureArtifacts(resume, runStamp);

  const evaluate = hasFlag("--evaluate");
  const evaluatorRoot = readArg("--evaluatorRoot")
    ?? (existsSync(join(legacyRoot, "run_evaluation.py")) ? legacyRoot : join(cacheRoot, "official-evaluator"));

  log.info(`Running ${adapter.name}: ids=${selection.tasks.map((task) => task.idx).join(",")} model=${modelName}`);
  log.info(`Reports will be saved to: ${outputDir}`);
  try {
    if (evaluate && !evaluatorCredentialsConfigured(env, evaluatorRoot)) {
      throw new Error("--evaluate requires GEMINI_API_URL, GEMINI_API_TOKEN, and GEMINI_MODEL in the environment or evaluator .env file");
    }
    const result = await runBenchmarkAdapter({
      adapter,
      tasks: selection.tasks,
      modelName,
      outputPath: outputDir,
      traceRoot,
      createLlm: () => createLlmChatFromEnv({ env, providerOverride: generation.llmProvider === "auto" ? undefined : generation.llmProvider, loadEnvFile: false }),
      maxRounds: generation.maxRounds,
      maxParallelBranches: generation.maxParallelBranches,
      maxDepth: generation.maxDepth,
      maxSubbranchesPerParent: generation.maxSubbranchesPerParent,
      maxSubAgentTurns: generation.maxSubAgentTurns,
      subAgentMode: generation.subAgentMode,
      subAgentMaxTokens: generation.subAgentMaxTokens,
      subAgentContextMaxChars: generation.subAgentContextMaxChars,
      maxUsd: generation.maxUsd,
      maxTotalTokens: generation.maxTotalTokens,
      synthesizeReport: generation.synthesizeReport,
      reportMaxTokens: generation.reportMaxTokens,
      reporterReAct: generation.reporterReAct,
      reporterMaxTurns: generation.reporterMaxTurns,
      concurrency: generation.concurrency,
      rateLimitCooldownMs: generation.rateLimitCooldownMs,
      resumeCheckpointPath: resume?.checkpointPath,
      resumeEpisodeId: resume?.episodeId,
      humanReviewResponse,
      pauseAfterCheckpoint,
      logger: opts.logger,
    });
    const completedIds = new Set(result.outputs.map((output) => output.idx));
    const unresolved = selection.tasks.filter((task) => !completedIds.has(task.idx)).map((task) => task.idx);
    let score: DeepResearchBenchIIOfficialScore | undefined;
    let evaluation: Record<string, unknown> = { status: "not_requested" };
    if (evaluate && unresolved.length === 0) {
      const officialResultPath = join(traceRoot, "official-evaluation.jsonl");
      const evaluator = runDeepResearchBenchIIOfficialEvaluator({
        evaluatorRoot,
        reportRoot,
        tasksPath: dataset.path,
        outputPath: officialResultPath,
        logPath: join(traceRoot, "official-evaluation.log"),
        env,
        chunkSize: numericArg(readArg("--judgeChunkSize"), 50, "--judgeChunkSize", 1),
        maxWorkers: numericArg(readArg("--judgeWorkers"), 1, "--judgeWorkers", 1),
        maxRetries: numericArg(readArg("--judgeRetries"), 5, "--judgeRetries", 1),
      });
      score = aggregateDeepResearchBenchIIOfficialScores(officialResultPath, selection.tasks);
      writeJsonAtomic(join(traceRoot, "official-score.json"), score);
      evaluation = {
        status: "scored",
        evaluatorRevision: evaluator.revision,
        judgeModel: env.GEMINI_MODEL,
        resultPath: officialResultPath,
        scorePath: join(traceRoot, "official-score.json"),
        score: score.aggregate,
      };
    } else if (evaluate) {
      evaluation = { status: "skipped_due_to_generation_failure", unresolvedTaskIds: unresolved };
    }
    const completedAt = new Date().toISOString();
    const previous = score ? previousComparableRun(historyPath, modelName, selection.tasks.map((task) => task.idx)) : undefined;
    const comparison = score && previous ? {
      previousStartedAt: previous.startedAt,
      previousManifestPath: previous.manifestPath,
      previousTotalPassPercent: previous.totalPassPercent,
      currentTotalPassPercent: score.aggregate.total.passPercent,
      deltaPassPercent: score.aggregate.total.passPercent - previous.totalPassPercent,
    } : undefined;
    const pausedRuns = result.pauses;
    const allUnresolvedPaused = unresolved.length > 0
      && unresolved.every((taskId) => pausedRuns.some((pause) => Number(pause.taskId) === taskId));
    const finalRecord = {
      ...baseRecord,
      status: unresolved.length ? allUnresolvedPaused ? "paused" : "failed" : "completed",
      completedAt,
      durationMs: Date.parse(completedAt) - Date.parse(String(baseRecord.startedAt)),
      outputs: result.outputs,
      completedRuns: result.completed,
      failures: result.failures,
      pauses: pausedRuns,
      unresolvedTaskIds: unresolved,
      evaluation,
      comparison,
    };
    writeJsonAtomic(manifestPath, finalRecord);
    appendDeepResearchBenchIIHistory(historyPath, finalRecord);
    log.info(`Reports saved to: ${outputDir}`);
    log.info(`Framework traces/debug: ${result.traceRoot}`);
    log.info(`Benchmark run manifest: ${manifestPath}`);
    if (score) log.info(`Official rubric pass rate: ${score.aggregate.total.passPercent.toFixed(2)}%`);
    if (unresolved.length && !allUnresolvedPaused) {
      process.exitCode = 1;
      log.error(`Benchmark generation failed for task(s): ${unresolved.join(", ")}`);
    } else if (allUnresolvedPaused) {
      log.info(`Benchmark task paused at checkpoint. Resume command: ${pausedRuns[0]?.resumeCommand ?? "see pauses.json"}`);
    }
  } catch (err) {
    const failedAt = new Date().toISOString();
    const failedRecord = {
      ...baseRecord,
      status: "failed",
      failedAt,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) },
    };
    writeJsonAtomic(manifestPath, failedRecord);
    appendDeepResearchBenchIIHistory(historyPath, failedRecord);
    throw err;
  }
}

interface DeepResearchBenchIIResumeContext {
  checkpointPath: string;
  episodeId: string;
  episodeArtifactDir: string;
  taskId: number;
  stage: string;
  nextCycle: number;
  traceRoot: string;
  sourceManifestPath: string;
  modelName?: string;
  seed?: string;
  queryPath?: string;
  datasetSha256?: string;
  reportRoot?: string;
  outputDir?: string;
  historyPath?: string;
  generation?: Record<string, unknown>;
}

async function loadDeepResearchBenchIIResume(checkpointInput: string): Promise<DeepResearchBenchIIResumeContext> {
  const inspected = await inspectResearchCheckpoint(checkpointInput);
  const checkpointPath = resolve(inspected.checkpointPath);
  const episodeId = inspected.checkpoint.state.episodeId;
  const episodeArtifactDir = dirname(dirname(checkpointPath));
  if (resolve(episodeArtifactDir) !== resolve(join(dirname(episodeArtifactDir), episodeId))) {
    throw new Error(`Checkpoint episode directory does not match episodeId ${episodeId}: ${episodeArtifactDir}`);
  }
  const traceRoot = dirname(episodeArtifactDir);
  const sourceManifestPath = join(traceRoot, "benchmark-run.json");
  if (!existsSync(sourceManifestPath)) {
    throw new Error(`Bench II resume requires the original benchmark manifest: ${sourceManifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(sourceManifestPath, "utf8")) as Record<string, unknown>;
  if (manifest.benchmark !== "DeepResearch Bench II") {
    throw new Error(`Checkpoint manifest is not a DeepResearch Bench II run: ${sourceManifestPath}`);
  }
  const sessionId = inspected.checkpoint.state.submission.sessionId;
  const taskId = Number(/^S_DRB2_(\d+)$/u.exec(sessionId)?.[1]);
  if (!Number.isSafeInteger(taskId) || taskId < 0) {
    throw new Error(`Checkpoint sessionId does not identify a Bench II task: ${sessionId}`);
  }
  const selectedTaskIds = Array.isArray(manifest.selectedTasks)
    ? manifest.selectedTasks.map((item) => Number((item as { idx?: unknown }).idx)).filter(Number.isSafeInteger)
    : [];
  if (!selectedTaskIds.includes(taskId)) {
    throw new Error(`Checkpoint task ${taskId} is not present in ${sourceManifestPath}`);
  }
  const dataset = recordValue(manifest.dataset);
  return {
    checkpointPath,
    episodeId,
    episodeArtifactDir,
    taskId,
    stage: inspected.checkpoint.cursor.stage,
    nextCycle: inspected.checkpoint.cursor.nextCycle,
    traceRoot,
    sourceManifestPath,
    modelName: stringRecordValue(manifest, "modelName"),
    seed: stringRecordValue(manifest, "seed"),
    queryPath: stringRecordValue(dataset, "path"),
    datasetSha256: stringRecordValue(dataset, "sha256"),
    reportRoot: stringRecordValue(manifest, "reportRoot"),
    outputDir: stringRecordValue(manifest, "outputDir"),
    historyPath: stringRecordValue(manifest, "historyPath"),
    generation: recordValue(manifest.generation),
  };
}

function archiveResumeFailureArtifacts(resume: DeepResearchBenchIIResumeContext, runStamp: string): void {
  archiveIfExists(join(resume.episodeArtifactDir, "failure.json"), runStamp);
  archiveIfExists(join(resume.traceRoot, "failures.json"), runStamp);
  archiveIfExists(join(resume.traceRoot, "pauses.json"), runStamp);
}

function archiveIfExists(path: string, runStamp: string): void {
  if (!existsSync(path)) return;
  const archivedPath = path.replace(/\.json$/u, `.before-resume-${runStamp}.json`);
  renameSync(path, archivedPath);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberRecordValue(record: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanRecordValue(record: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = record?.[key];
  return typeof value === "boolean" ? value : undefined;
}

function booleanArg(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("Boolean generation arguments must be true or false");
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf-8").trim().split(/\n/).filter(Boolean).map((line) => JSON.parse(line) as T);
}

function argumentValue(argv: string[], name: string): string | undefined {
  const exactIndex = argv.indexOf(name);
  if (exactIndex >= 0) {
    const value = argv[exactIndex + 1];
    if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
    return value;
  }
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function optionalPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  return value === undefined ? fallback : numericArg(value, fallback, name, 1);
}

function numericArg(value: string | undefined, fallback: number, name: string, minimum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) throw new Error(`${name} must be >= ${minimum}`);
  return parsed;
}

function safePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "model";
}

export function loadBenchmarkEnvironment(env: NodeJS.ProcessEnv, repoRoot: string): NodeJS.ProcessEnv {
  const path = [join(repoRoot, ".env.local"), join(repoRoot, ".env")].find(existsSync);
  if (!path) return { ...env };
  const defaults: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    defaults[key] = value;
  }
  return { ...defaults, ...env };
}

export function benchmarkSearchProviders(
  env: NodeJS.ProcessEnv,
  task: DeepResearchBenchIITask,
  proxy = env.HTTPS_PROXY ?? env.https_proxy ?? env.HTTP_PROXY ?? env.http_proxy,
): SearchProvider[] {
  const providers = new Map<string, SearchProvider>();
  const bochaApiKey = nonEmptyEnv(env.BOCHA_API_KEY);
  const braveApiKey = nonEmptyEnv(env.BRAVE_API_KEY);
  const jinaApiKey = nonEmptyEnv(env.JINA_API_KEY);

  if (bochaApiKey) {
    providers.set("bocha", new BochaSearchProvider({
      apiKey: bochaApiKey,
      endpoint: nonEmptyEnv(env.BOCHA_ENDPOINT),
      timeoutMs: integerEnv(env, "BOCHA_TIMEOUT_MS", 60_000, 1, 600_000),
      retry: integerEnv(env, "BOCHA_RETRY", 2, 0, 10),
      count: integerEnv(env, "BOCHA_COUNT", 10, 1, 50),
      maxCount: integerEnv(env, "BOCHA_MAX_COUNT", 50, 1, 50),
      freshness: bochaFreshnessEnv(env.BOCHA_FRESHNESS),
      summary: booleanEnv(env, "BOCHA_SUMMARY", true),
      minIntervalMs: integerEnv(env, "BOCHA_MIN_INTERVAL_MS", 350, 0, 60_000),
      retryBaseDelayMs: integerEnv(env, "BOCHA_RETRY_BASE_DELAY_MS", 1500, 0, 120_000),
      maxRetryDelayMs: integerEnv(env, "BOCHA_MAX_RETRY_DELAY_MS", 15_000, 0, 300_000),
    }));
  }
  if (braveApiKey) {
    providers.set("brave", new BraveSearchProvider({
      apiKey: braveApiKey,
      country: task.language === "zh" ? "CN" : "US",
      searchLang: task.language === "zh" ? "zh-hans" : "en",
      timeoutMs: integerEnv(env, "BRAVE_TIMEOUT_MS", 15_000, 1, 600_000),
      retry: integerEnv(env, "BRAVE_RETRY", 2, 0, 10),
    }));
  }
  if (jinaApiKey) {
    providers.set("jina", new JinaSearchProvider({
      apiKey: jinaApiKey,
      timeoutMs: integerEnv(env, "JINA_TIMEOUT_MS", 60_000, 1, 600_000),
      retry: integerEnv(env, "JINA_RETRY", 2, 0, 10),
      maxNum: integerEnv(env, "JINA_MAX_NUM", 20, 1, 20),
      proxy,
    }));
  }
  // Bing's HTML endpoint does not use an API key. Preserve the existing
  // explicit opt-in contract so benchmark runs never silently add a provider.
  if (nonEmptyEnv(env.BING_API_KEY)) {
    providers.set("bing", new BingSearchProvider({
      market: task.language === "zh" ? "zh-CN" : "en-US",
      timeoutMs: integerEnv(env, "BING_TIMEOUT_MS", 20_000, 1, 600_000),
    }));
  }

  const requestedOrder = (nonEmptyEnv(env.BENCH_SEARCH_ORDER) ?? "bocha,brave,jina,bing")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const unsupported = requestedOrder.filter((name) => !["bocha", "brave", "jina", "bing"].includes(name));
  if (unsupported.length > 0) {
    throw new Error(`BENCH_SEARCH_ORDER contains unsupported provider(s): ${[...new Set(unsupported)].join(", ")}`);
  }
  return [...new Set(requestedOrder)].flatMap((name) => {
    const provider = providers.get(name);
    return provider ? [provider] : [];
  });
}

const AUTHORITY_QUERY_PATTERN = /\b(?:official\s+(?:(?:data|statistics|regulatory|technical)\s+)?(?:documentation|docs?|report|website|repository|source|dataset)|primary\s+(?:study|source|research)|source\s+code\s+repository|license\s+file)\b|(?:官方|权威|原始)(?:文档|报告|数据|统计|网站|仓库|研究|来源)/iu;
const GENERIC_AUTHORITY_QUERY_TOKENS = new Set([
  "about", "analysis", "and", "available", "confirm", "confirming", "data", "dataset", "documentation", "document", "docs",
  "evidence", "file", "filetype", "find", "for", "from", "information", "official", "primary", "provide", "report", "statistics",
  "repository", "research", "source", "sources", "study", "support", "technical", "the", "their", "used",
  "uses", "using", "website", "with",
]);
const LOW_QUALITY_PORTAL_HOST_PATTERN = /(?:^|[.-])(?:download|downloads|soft|software|crack|apk|portal|wenku|baike|sohu|csdn)(?:[.-]|$)/i;

/**
 * Authority-first queries may fall through to the next configured provider
 * when a provider returns only generic portals. Non-authority queries retain
 * the normal low-latency first-non-empty behavior.
 */
export function acceptBenchmarkAuthoritySearchResults(input: {
  query: string;
  providerName: string;
  results: SearchHit[];
}): boolean {
  if (!AUTHORITY_QUERY_PATTERN.test(input.query)) return true;
  return benchmarkAuthorityCandidates(input.query, input.results).length > 0;
}

export function filterBenchmarkAuthoritySearchResults(query: string, results: SearchHit[]): SearchHit[] {
  if (!AUTHORITY_QUERY_PATTERN.test(query)) return results;
  const preferred = benchmarkAuthorityCandidates(query, results);
  // FallbackSearchProvider returns its last non-empty rejected set when every
  // provider lacks an authority hit. Preserve that final safety net rather
  // than turning a weak result set into no result at all.
  return preferred.length > 0 ? preferred : results;
}

function benchmarkAuthorityCandidates(query: string, results: SearchHit[]): SearchHit[] {
  const subjectTokens = authoritySubjectTokens(query);
  return results.filter((result) => {
    const url = parsedHttpUrl(result.url);
    if (!url || LOW_QUALITY_PORTAL_HOST_PATTERN.test(url.hostname)) return false;
    const searchable = `${result.title} ${result.snippet} ${url.hostname} ${decodeURIComponentSafe(url.pathname)}`;
    if (subjectTokens.size > 0 && !hasTokenOverlap(subjectTokens, searchable)) return false;
    return hasAuthorityUrlShape(url, subjectTokens);
  });
}

function preferBenchmarkAuthorityResults(provider: SearchProvider): SearchProvider {
  return {
    // Preserve the provider name so budget and A/B traces remain comparable.
    name: provider.name,
    async search(query, topK, opts) {
      return filterBenchmarkAuthoritySearchResults(query, await provider.search(query, topK, opts));
    },
  };
}

function hasAuthorityUrlShape(url: URL, subjectTokens: Set<string>): boolean {
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  const labels = hostname.split(".");
  const pathSegments = url.pathname.split("/").filter(Boolean);
  if (labels[0] === "docs" || labels.includes("documentation") || labels.includes("developer") || labels.includes("wiki")) return true;
  if (isGovernmentOrInstitutionHost(hostname)) return true;
  if (["github.com", "gitlab.com", "codeberg.org"].includes(hostname)) {
    return pathSegments.length >= 2 && !["search", "topics", "explore"].includes(pathSegments[0]!.toLowerCase());
  }
  if (["raw.githubusercontent.com", "raw.github.com"].includes(hostname)) return pathSegments.length >= 3;
  if (["arxiv.org", "doi.org", "openreview.net"].includes(hostname)) return true;
  const hostnameTokens = new Set(hostname.split(/[^a-z0-9]+/).filter((token) => token.length >= 2));
  const dedicatedProjectHost = [...subjectTokens].some((token) => hostnameTokens.has(token));
  if (dedicatedProjectHost) return true;
  return false;
}

function isGovernmentOrInstitutionHost(hostname: string): boolean {
  return /(?:^|\.)(?:gov|govt|gouv|gc|go|mil|edu|ac)(?:\.[a-z]{2,})?$/i.test(hostname)
    || /(?:^|\.)(?:europa\.eu|who\.int|worldbank\.org|oecd\.org|un\.org|nist\.gov|ofcom\.org\.uk|acm\.nl|dhsprogram\.com|ib-net\.org|nwasco\.org\.zm)$/i.test(hostname);
}

function authoritySubjectTokens(query: string): Set<string> {
  return new Set(
    query.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu)
      ?.map((token) => token.replace(/^[._+-]+|[._+-]+$/g, ""))
      .filter((token) => token.length >= 3 && !GENERIC_AUTHORITY_QUERY_TOKENS.has(token))
      ?? [],
  );
}

function hasTokenOverlap(tokens: Set<string>, value: string): boolean {
  const candidateTokens = new Set(
    value.toLowerCase().normalize("NFKC").match(/[\p{L}\p{N}][\p{L}\p{N}._+-]*/gu)
      ?.map((token) => token.replace(/^[._+-]+|[._+-]+$/g, ""))
      .filter(Boolean)
      ?? [],
  );
  return [...tokens].some((token) => candidateTokens.has(token));
}

function parsedHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url : undefined;
  } catch {
    return undefined;
  }
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function nonEmptyEnv(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function integerEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = nonEmptyEnv(env[name]);
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function booleanEnv(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = nonEmptyEnv(env[name]);
  if (value === undefined) return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`${name} must be one of: 1, 0, true, false, yes, no, on, off`);
}

function bochaFreshnessEnv(value: string | undefined): "noLimit" | "oneDay" | "oneWeek" | "oneMonth" | "oneYear" | undefined {
  const normalized = nonEmptyEnv(value);
  if (normalized === undefined) return undefined;
  if (["noLimit", "oneDay", "oneWeek", "oneMonth", "oneYear"].includes(normalized)) {
    return normalized as "noLimit" | "oneDay" | "oneWeek" | "oneMonth" | "oneYear";
  }
  throw new Error("BOCHA_FRESHNESS must be one of: noLimit, oneDay, oneWeek, oneMonth, oneYear");
}

interface BlockedSourceMatcher {
  urls: Set<string>;
  title?: string;
}

function blockedSourceMatcher(task: DeepResearchBenchIITask): BlockedSourceMatcher {
  const blocked = parseDeepResearchBenchIIContent(task).blocked;
  return {
    urls: new Set((blocked?.urls ?? []).filter((url): url is string => typeof url === "string").map(normalizeUrl)),
    title: blocked?.title ? normalizeTitle(blocked.title) : undefined,
  };
}

function filterBlockedSearchProvider(provider: SearchProvider, blocked: BlockedSourceMatcher): SearchProvider {
  return {
    name: `${provider.name || "search"}-drb2-block-filter`,
    async search(query, topK, opts) {
      const results = await provider.search(query, topK, opts);
      return results.filter((result) => !isBlockedSource(result.url, result.title, blocked));
    },
  };
}

function filterBlockedFetchProvider(provider: FetchProvider, blocked: BlockedSourceMatcher): FetchProvider {
  return {
    name: `${provider.name || "fetch"}-drb2-block-filter`,
    async fetchPage(url, opts) {
      if (isBlockedSource(url, undefined, blocked)) throw new Error(`DeepResearch Bench II blocked reference URL: ${url}`);
      const page = await provider.fetchPage(url, opts);
      if (isBlockedSource(page.url, page.title, blocked)) throw new Error(`DeepResearch Bench II blocked reference redirect/title: ${page.url}`);
      return page;
    },
  };
}

function isBlockedSource(url: string | undefined, title: string | undefined, blocked: BlockedSourceMatcher): boolean {
  if (url && blocked.urls.has(normalizeUrl(url))) return true;
  if (!title || !blocked.title) return false;
  const normalized = normalizeTitle(title);
  return normalized.includes(blocked.title) || blocked.title.includes(normalized);
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref$|source$|campaign$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${url.protocol}//${url.hostname.toLowerCase()}${url.port ? `:${url.port}` : ""}${url.pathname.replace(/\/+$/, "") || "/"}${url.search}`;
  } catch {
    return value.trim();
  }
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function previousComparableRun(
  historyPath: string,
  modelName: string,
  taskIds: number[],
): { startedAt?: string; manifestPath?: string; totalPassPercent: number } | undefined {
  if (!existsSync(historyPath)) return undefined;
  const key = [...taskIds].sort((a, b) => a - b).join(",");
  const lines = readFileSync(historyPath, "utf8").split(/\r?\n/).filter(Boolean).reverse();
  for (const line of lines) {
    try {
      const record = JSON.parse(line) as Record<string, unknown>;
      if (record.modelName !== modelName) continue;
      const selected = Array.isArray(record.selectedTasks)
        ? record.selectedTasks.map((item) => Number((item as { idx?: unknown }).idx)).filter(Number.isFinite).sort((a, b) => a - b).join(",")
        : "";
      if (selected !== key) continue;
      const evaluation = record.evaluation as { status?: unknown; score?: { total?: { passPercent?: unknown } } } | undefined;
      const passPercent = evaluation?.score?.total?.passPercent;
      if (evaluation?.status === "scored" && typeof passPercent === "number" && Number.isFinite(passPercent)) {
        return {
          startedAt: typeof record.startedAt === "string" ? record.startedAt : undefined,
          manifestPath: typeof record.manifestPath === "string" ? record.manifestPath : undefined,
          totalPassPercent: passPercent,
        };
      }
    } catch {
      // Ignore incomplete historical lines and continue to the previous valid run.
    }
  }
  return undefined;
}

function printDeepResearchBenchIIHelp(info: (message: string) => void): void {
  info(`DeepResearch Bench II random benchmark runner

Usage:
  pnpm bench:drb2 -- [options]

Selection (defaults to one random task):
  --seed <text>          Reproduce a previous random selection
  --sample <n>           Randomly sample n tasks (default: 1)
  --ids <1,2,3>          Run explicit task indices
  --all                  Run all 132 tasks explicitly
  --select-only          Download/validate data and write the selection manifest only
  --resume <path>        Resume one failed task from its checkpoint; task, trace root, and prior generation config are restored automatically
  --reviewResponse <path>  Apply structured human-review decisions (JSON) when resuming a paused task
  --pauseAfterCheckpoint <stage>  Debug pause after committing one stable checkpoint

Generation:
  --name <model>         Report model label (default: our-framework)
  --llm <provider>       Framework LLM provider override
  --maxUsd <amount>      Per-task LLM cost ceiling (default: 5)
  --maxTotalTokens <n>   Per-task LLM token ceiling across planning, research, and writing (default: 2000000)
  --maxRounds <n>        Evidence dispatch cycles (default: 2)
  --maxParallelBranches <n> Concurrent evidence branches per cycle (default: 4)
  --maxSubAgentTurns <n> Evidence-agent ReAct step ceiling (default: 12)
  --subAgentMaxTokens <n> Evidence-agent output-token ceiling (default: 12288)
  --subAgentContextMaxChars <n> Evidence-agent context ceiling in characters (default: 32000)
  --reportMaxTokens <n> Report-writer output-token ceiling (default: 16384)
  --parallel <n>         Concurrent benchmark tasks (default: 1)
  --queryPath <path>     Use a specific tasks_and_rubrics.jsonl
  --traceRoot <path>     Override the run artifact directory

Official scoring:
  --evaluate             Run the official Gemini rubric evaluator after generation
  --evaluatorRoot <path> Use an existing DeepResearch-Bench-II checkout
  --judgeChunkSize <n>   Rubrics per judge request (default: 50)
  --judgeWorkers <n>     Concurrent judge workers (default: 1)

--evaluate requires GEMINI_API_URL, GEMINI_API_TOKEN, and GEMINI_MODEL.
Every run records its seed, selected tasks, dataset SHA-256, runtime metrics,
failures, score, and same-task historical delta in benchmark-run.json.`);
}
