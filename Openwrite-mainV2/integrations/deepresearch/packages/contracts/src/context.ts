export interface TaskSubmission {
  sessionId: string;
  userInput: string;
  uiOptions?: {
    outputLanguage?: string;
    citationRequired?: boolean;
  };
  attachments?: Array<{
    fileId: string;
    filename: string;
    mimeType: string;
  }>;
}

export type ExpectedArtifact = "report" | "evidence_index" | "evidence_quality_audit" | "budget_audit" | "trace" | "diagnostics";

export interface ResearchContext {
  episodeId: string;
  sessionId: string;
  userInput: string;
  expectedArtifacts: ExpectedArtifact[];
}

export type ResearchRequirementPriority = "must" | "should" | "exploratory";
export type ResearchRequirementKind = "question" | "constraint" | "comparison" | "deliverable" | "risk" | (string & {});

export interface ResearchRequirementTemporalSourceException {
  title: string;
  aliases?: string[];
  identifiers?: string[];
}

export interface ResearchRequirementTemporalScope {
  mode: "current" | "historical" | "as_of" | "range" | "timeless";
  /** Whether the time boundary constrains when evidence was published or the period described by that evidence. */
  basis?: "source_publication" | "covered_period";
  asOf?: string;
  start?: string;
  end?: string;
  maxAgeDays?: number;
  /** Exact user-required sources that may fall outside this temporal boundary; strings remain checkpoint-compatible. */
  exemptSources?: Array<string | ResearchRequirementTemporalSourceException>;
}

export interface ResearchRequirementNamedSource {
  title: string;
  aliases?: string[];
  identifiers?: string[];
}

export interface ResearchRequirementSourcePolicy {
  /** A specifically requested canonical primary document is sufficient for this requirement; additional sources remain allowed. */
  mode: "named_primary_sufficient";
  sources: ResearchRequirementNamedSource[];
}

export interface ResearchRequirementRenderedExclusion {
  scope: string;
  aliases?: string[];
  /** Qualitative contrast remains allowed, but concrete values must not be attributed to this excluded scope. */
  mode: "quantitative_claims" | "all_mentions";
}

/** A normalized, testable obligation derived from the user's request. */
export interface ResearchRequirement {
  requirementId: string;
  description: string;
  kind: ResearchRequirementKind;
  priority: ResearchRequirementPriority;
  evidenceRequired?: boolean;
  evidenceNeeds: string[];
  successCriteria: string[];
  sourcePolicy?: ResearchRequirementSourcePolicy;
  renderedExclusions?: ResearchRequirementRenderedExclusion[];
  temporalScope?: ResearchRequirementTemporalScope;
  geographicScope?: string[];
  /** Exact named subjects, or top-level discovery groups when entityScopeRole is "groups". */
  entityScope?: string[];
  /** "members" means each entity is a final row/profile; "groups" means each entity is a category whose members must be discovered. */
  entityScopeRole?: "members" | "groups";
  /** Exact user-mandated narrative cases/examples that require cited coverage without becoming table rows or profiles. */
  exampleScope?: string[];
  /** Explicit fields/columns required for structured multi-field deliverables. */
  metricScope?: string[];
  /** Whether exhausted evidence may be transparently degraded, or must stop publication. */
  failurePolicy?: "degrade" | "block";
  /** Internal policy constraints are enforced but never rendered as report content. */
  visibility?: "reader" | "internal";
}

export interface GlobalRubric {
  rubricId: string;
  episodeId: string;
  rubricText: string;
  outputHints: {
    titleHint?: string;
    language?: string;
    citationRequired?: boolean;
    format?: "markdown" | (string & {});
  };
  researchQuestionHints?: string[];
  requirements?: ResearchRequirement[];
}

export interface RuntimeLlmConfig {
  model: string;
  maxTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface RuntimePhaseConfig {
  enabled: boolean;
  maxCycles?: number;
  maxLlmCalls?: number;
  maxAgentRuns?: number;
  maxParallelAgents?: number;
  maxConcurrentAgents?: number;
  maxReactSteps?: number;
  maxSearchCalls?: number;
  maxFetchCalls?: number;
  contextTokenLimit: number;
  maxOutputItems?: number;
}

export interface RuntimeAgentConfig {
  maxRuns?: number;
  maxReactSteps: number;
  maxToolCalls?: number;
  maxSearchCalls?: number;
  maxFetchCalls?: number;
  targetReactSteps?: number;
  targetToolCalls?: number;
  targetSearchCalls?: number;
  targetFetchCalls?: number;
  outputRepairAttempts: number;
  allowToolEscalationRequest: boolean;
}

export interface RuntimeToolConfig {
  topK?: number;
  timeoutMs: number;
  maxChars?: number;
  retry?: number;
  rateLimitPerMinute?: number;
}

export interface RuntimeProviderLimit {
  maxCostUsd?: number;
  maxRequests?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  inputCostPerMillionTokensUsd?: number;
  outputCostPerMillionTokensUsd?: number;
  costPerRequestUsd?: number;
  timeoutMs?: number;
}

export interface RuntimeAdaptiveBudgetPolicy {
  enabled: boolean;
  minDispatchCycles: number;
  plateauWindow: number;
  minKnowledgeNodeGain: number;
  minEvidenceLinkGain: number;
  minQualityScoreGain: number;
}

export type EvidenceQualityMode = "advisory" | "balanced" | "strict";

/**
 * Deterministic evidence quality thresholds. Balanced mode blocks only clear
 * grounding defects; strict mode also enforces portfolio depth/diversity.
 */
export interface EvidenceQualityPolicy {
  mode: EvidenceQualityMode;
  minSourcesPerLeaf: number;
  minIndependentDomainsPerLeaf: number;
  minPrimaryOrOfficialSourcesPerLeaf: number;
  minAverageQualityScore: number;
  requireFetchedSourcePerLeaf: boolean;
  minReportCitationCoverage: number;
}

export interface RuntimeProfile {
  hilMode: "auto_accept" | "explicit";
  artifactDir: string;
  reportFormat: "markdown";
  includeEvidenceIndex: boolean;
  traceLevel?: "summary" | "full";
  evidenceQuality: EvidenceQualityPolicy;
  debug?: {
    singleBranch?: boolean;
    maxAspects?: number;
    maxBranchesPerAspect?: number;
    maxInitialAgentNodes?: number;
    maxAgentNodeParts?: number;
  };
  llm: Record<string, RuntimeLlmConfig>;
  phases: Record<string, RuntimePhaseConfig>;
  agents: Record<string, RuntimeAgentConfig>;
  tools: Record<string, RuntimeToolConfig>;
  providers: Record<string, RuntimeProviderLimit>;
  adaptiveBudget?: RuntimeAdaptiveBudgetPolicy;
}

export interface HumanReviewQuestion {
  id: string;
  title: string;
  question: string;
  whyNeeded: string;
  answerFormat: string;
  options?: string[];
  recommendedAnswer?: string;
  reportNodeId?: string;
  issueCode?: string;
  requirementIds?: string[];
}

export interface HumanReviewRequest {
  stage: "completion_gate" | "publish_gate";
  summary: string;
  questions: HumanReviewQuestion[];
  responseInstructions: string;
  generatedAt: string;
}

export type HumanReviewDecisionAction = "continue_research" | "downplay" | "omit" | "accept_risk";

export interface HumanReviewDecision {
  questionId: string;
  action: HumanReviewDecisionAction;
  rationale: string;
  sourceUrls?: string[];
  reportNodeId?: string;
  requirementIds?: string[];
}

export interface HumanReviewResponse {
  decisions: HumanReviewDecision[];
  submittedAt?: string;
  submittedBy?: string;
}

export interface ResearchIssueWaiver {
  waiverId: string;
  questionId: string;
  issueCode: string;
  action: Exclude<HumanReviewDecisionAction, "continue_research">;
  rationale: string;
  reportNodeId?: string;
  requirementIds?: string[];
  /** Old checkpoints may omit this; newly-created dispositions always record their origin. */
  decidedBy?: "user" | "framework";
  decidedAt: string;
}

export interface EpisodeResult {
  episodeId: string;
  status: "succeeded" | "failed" | "needs_human_review";
  reportArtifactPath: string;
  evidenceIndexPath?: string;
  evidenceQualityAuditPath?: string;
  budgetAuditPath?: string;
  tracePath?: string;
  fullTracePath?: string;
  humanReview?: HumanReviewRequest;
  humanReviewPath?: string;
  humanReviewResponsePath?: string;
  metrics: {
    reportNodeCount: number;
    knowledgeNodeCount: number;
    evidenceLinkCount: number;
    completedTaskCount: number;
    openGapCount: number;
    citationCount: number;
    usedCitationCount?: number;
    citationUtilization?: number;
    rubricIssueCount: number;
    publishGatePassed: boolean;
    evidenceQualityScore?: number;
    evidenceQualityIssueCount?: number;
    requirementCoverage?: number;
    mustRequirementCount?: number;
    coveredMustRequirementCount?: number;
    providerRequestCount?: number;
    totalTokenCount?: number;
    estimatedCostUsd?: number;
    budgetBreachCount?: number;
    adaptiveStopApplied?: boolean;
  };
  closedAt: string;
}
