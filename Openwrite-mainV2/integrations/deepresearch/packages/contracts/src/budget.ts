export type ProviderOperation = "llm" | "search" | "fetch";

export interface ProviderFailureSample {
  url?: string;
  /** Stable category such as timeout, http_403, network_error, ssrf_blocked. */
  reason: string;
  /** Bounded provider error message for diagnostics. */
  message: string;
  phase: string;
  occurredAt: string;
}

export interface ProviderUsageRecord {
  operation: ProviderOperation;
  provider: string;
  requests: number;
  succeededRequests: number;
  failedRequests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedTokenRequests: number;
  estimatedCostUsd: number;
  /** Bounded samples (first N per provider) explaining failedRequests. */
  failureSamples?: ProviderFailureSample[];
}

export interface ResearchBudgetBreach {
  breachId: string;
  operation: ProviderOperation | "episode";
  provider: string;
  limit: "maxRequests" | "maxInputTokens" | "maxOutputTokens" | "maxTotalTokens" | "maxCostUsd";
  allowed: number;
  observed: number;
  phase: string;
  occurredAt: string;
}

export interface ResearchCycleGain {
  cycle: number;
  knowledgeNodeGain: number;
  evidenceLinkGain: number;
  completedTaskGain: number;
  evidenceQualityScoreGain: number;
  coveredMustRequirementGain: number;
  activeQualityErrorReduction: number;
  recordedAt: string;
}

export interface ResearchBudgetAudit {
  version: 1;
  generatedAt: string;
  limits: Record<string, {
    maxCostUsd?: number;
    maxRequests?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxTotalTokens?: number;
    inputCostPerMillionTokensUsd?: number;
    outputCostPerMillionTokensUsd?: number;
    costPerRequestUsd?: number;
  }>;
  usage: ProviderUsageRecord[];
  totals: {
    requests: number;
    succeededRequests: number;
    failedRequests: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  breaches: ResearchBudgetBreach[];
  cycleGains: ResearchCycleGain[];
  adaptiveStop?: {
    stopped: boolean;
    reason: string;
    cycle: number;
    cancelledTaskIds: string[];
  };
}
