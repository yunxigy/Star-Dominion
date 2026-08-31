import type {
  AgentRunResult,
  EpisodeResult,
  EpisodeStack,
  GlobalRubric,
  LlmChat,
  MemoryEvent,
  ReportArtifact,
  ReportBundle,
  ReportNode,
  RuntimeProfile,
  FetchProvider,
  SearchProvider,
  TaskItem,
  TaskSubmission,
  ToolDefinition,
  ResearchRequirement,
  HumanReviewResponse,
  ResearchIssueWaiver,
  ProviderUsageRecord,
  ResearchBudgetAudit,
  ResearchBudgetBreach,
  ResearchCycleGain,
} from "@deepresearch/contracts";

export interface V5OrchestratorOptions {
  /** Stable caller-provided identity for a new episode. Ignored when restoring a checkpoint. */
  episodeId?: string;
  stack?: Partial<EpisodeStack>;
  llm?: LlmChat;
  reviewLlm?: LlmChat;
  search?: SearchProvider;
  fetch?: FetchProvider;
  runtimeProfile?: RuntimeProfile;
  now?: () => number;
  artifactDir?: string;
  signal?: AbortSignal;
  onEvent?: (event: MemoryEvent) => void | Promise<void>;
  checkpointDir?: string;
  resumeCheckpointPath?: string;
  disableCheckpoints?: boolean;
  maxCheckpointFiles?: number;
  /** Debug-only controlled pause immediately after this stable checkpoint is committed. */
  pauseAfterCheckpoint?: "after_rubric" | "after_root" | "after_scout" | "after_main_planner" | "after_dispatch" | "after_structure_review" | "after_report";
  humanReviewResponse?: HumanReviewResponse;
}

export interface EpisodeRunState {
  submission: TaskSubmission;
  runtimeProfile: RuntimeProfile;
  episodeId: string;
  startedAt: string;
  closedAt?: string;
  globalRubric?: GlobalRubric;
  rootTask?: TaskItem;
  rootNode?: ReportNode;
  scoutResult?: AgentRunResult;
  agentResults: AgentRunResult[];
  reportBundle?: ReportBundle;
  reportArtifact?: ReportArtifact;
  result?: EpisodeResult;
  fetchCache: Map<string, { url: string; title: string; content: string; description?: string } | undefined>;
  sourceGuards: SourceGuard[];
  eventSequence: number;
  issueWaivers: ResearchIssueWaiver[];
  humanReviewResponsePath?: string;
  budgetUsage: Record<string, ProviderUsageRecord>;
  budgetBreaches: ResearchBudgetBreach[];
  cycleGains: ResearchCycleGain[];
  adaptiveStop?: ResearchBudgetAudit["adaptiveStop"];
}

export interface SourceGuard {
  canonicalUrl: string;
  url: string;
  title: string;
  reportNodeId: string;
  taskId: string;
  relation: string;
  claimKey: string;
  claimText: string;
  reason: string;
  confidence: number;
  createdAt: string;
}

export interface PhaseContext {
  state: EpisodeRunState;
  stack: Required<Pick<EpisodeStack, "kg" | "ledger" | "memory" | "reporter" | "llm">> & Partial<EpisodeStack>;
  now: () => number;
  signal?: AbortSignal;
  emit(event: Omit<MemoryEvent, "eventId" | "episodeId" | "timestamp"> & { episodeId?: string; timestamp?: string }): Promise<void>;
}

export interface PhaseResult<T = unknown> {
  name: string;
  output: T;
}

export interface ArchitectTreePlan {
  aspects: Array<{
    label: string;
    scopeNote: string;
    requirementIds?: string[];
    hypotheses: Array<{
      statement: string;
      researchBrief: string;
      evidenceGuidance: string;
      requirementIds?: string[];
    }>;
    tasks: Array<{
      title: string;
      objective: string;
      acceptanceCriteria: string[];
    }>;
  }>;
}

export interface RubricJson {
  rubricId?: string;
  rubricText: string;
  outputHints?: GlobalRubric["outputHints"];
  researchQuestionHints?: string[];
  requirements?: ResearchRequirement[];
}

export interface RuntimeToolCatalog {
  evidenceTools: ToolDefinition[];
  scoutTools: ToolDefinition[];
}
