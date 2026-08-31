import type {
  EpisodeResult,
  EpisodeStack,
  FetchProvider,
  HumanReviewResponse,
  LlmChat,
  ReportArtifact,
  RuntimeProfile,
  SearchProvider,
  TaskSubmission,
} from "@deepresearch/contracts";
import type { QualityRegressionExpectation } from "./quality-regression.js";
import type { BenchmarkLogger } from "./logger.js";

export interface ToolProfile {
  searchProvider: SearchProvider;
  fetchProvider?: FetchProvider;
  arxivProvider?: SearchProvider;
  jinaApiKey?: string;
  policy?: {
    defaultTopK?: number;
    allowBrowser?: boolean;
    allowPdf?: boolean;
    preferredSources?: string[];
  };
}

export interface PromptProfile {
  language: "zh" | "en" | "auto";
  outputType: "research_report" | "taxonomy" | "qa" | (string & {});
  citationRequired?: boolean;
  systemAddendum?: string;
  reportRequirements?: string[];
}

export interface FrameworkRunResult {
  taskId: string | number;
  episodeId: string;
  submission: TaskSubmission;
  result: EpisodeResult;
  artifact: ReportArtifact;
  stack: EpisodeStack;
  traceDir: string;
}

export interface BenchmarkAdapter<TTask, TOutput> {
  readonly name: string;
  loadTasks(): Promise<TTask[]>;
  taskId(task: TTask): string | number;
  taskTitle(task: TTask): string;
  toTaskSubmission(task: TTask, env: AdapterTaskEnv): TaskSubmission;
  buildRuntimeProfile?(task: TTask, env: AdapterTaskEnv): Partial<RuntimeProfile>;
  buildToolProfile(task: TTask, env: AdapterTaskEnv): ToolProfile;
  buildPromptProfile?(task: TTask, env: AdapterTaskEnv): PromptProfile;
  renderOutput(run: FrameworkRunResult, task: TTask): Promise<TOutput>;
  writeOutputs(outputs: TOutput[], env: AdapterWriteEnv): Promise<void>;
  traceInputs?(task: TTask): Record<string, unknown>;
}

export interface AdapterTaskEnv {
  episodeId: string;
  maxUsd: number;
  maxTotalTokens?: number;
  maxRounds: number;
  maxParallelBranches: number;
  maxDepth: number;
  maxSubbranchesPerParent: number;
}

export interface AdapterWriteEnv {
  modelName: string;
  outputPath?: string;
  outputDir?: string;
}

export interface BenchmarkRunnerOptions<TTask, TOutput = unknown> {
  adapter: BenchmarkAdapter<TTask, TOutput>;
  tasks?: TTask[];
  ids?: Array<string | number>;
  modelName: string;
  traceRoot: string;
  createLlm: () => LlmChat;
  outputPath?: string;
  maxUsd: number;
  maxTotalTokens?: number;
  maxRounds: number;
  maxParallelBranches: number;
  maxDepth: number;
  maxSubbranchesPerParent: number;
  maxSubAgentTurns: number;
  subAgentMode: "single" | "react";
  subAgentMaxTokens: number;
  subAgentContextMaxChars: number;
  synthesizeReport: boolean;
  reportMaxTokens: number;
  reporterReAct: boolean;
  reporterMaxTurns: number;
  concurrency?: number;
  rateLimitCooldownMs?: number;
  qualityExpectation?: QualityRegressionExpectation | ((task: TTask) => QualityRegressionExpectation | undefined);
  /** Resume one selected benchmark task from an existing orchestrator checkpoint. */
  resumeCheckpointPath?: string;
  /** Episode identity stored in resumeCheckpointPath. Required when resuming. */
  resumeEpisodeId?: string;
  /** Debug-only controlled pause after one stable orchestrator checkpoint. */
  pauseAfterCheckpoint?: "after_rubric" | "after_root" | "after_scout" | "after_main_planner" | "after_dispatch" | "after_structure_review" | "after_report";
  /** Structured human-review decisions applied when resuming a paused episode. */
  humanReviewResponse?: HumanReviewResponse;
  /** Progress output sink; defaults to console. */
  logger?: BenchmarkLogger;
}

export interface BenchmarkRunnerResult<TOutput> {
  outputs: TOutput[];
  traceRoot: string;
  failures: BenchmarkFailureRecord[];
  pauses: BenchmarkFailureRecord[];
  completed: BenchmarkCompletedRun[];
}

export interface BenchmarkCompletedRun {
  taskId: string | number;
  episodeId: string;
  traceDir: string;
  completedAt: string;
  durationMs: number;
  metrics: EpisodeResult["metrics"];
}

export interface BenchmarkFailureRecord {
  taskId: string | number;
  requestedEpisodeId: string;
  actualEpisodeId?: string;
  traceDir: string;
  episodeArtifactDir?: string;
  resumeCheckpointPath?: string;
  humanReviewPath?: string;
  lastErrorPath?: string;
  resumeCommand?: string;
  recoverable: boolean;
  failedAt: string;
  rateLimited: boolean;
  billingBlocked: boolean;
  retryScheduled: boolean;
  error: {
    name: string;
    message: string;
    stack?: string;
  };
  qualityFailures?: string[];
  durationMs?: number;
}
