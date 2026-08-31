export const MODULE_NAME = "orchestrator";

export type {
  LlmChat,
  MemoryEvent,
  AgentRunResult,
  ContextPacket,
  EpisodeResult,
  EvidenceQualityAudit,
  EvidenceQualityIssue,
  EvidenceQualityPolicy,
  GlobalRubric,
  HumanReviewDecision,
  HumanReviewResponse,
  ResearchIssueWaiver,
  Orchestrator,
  OrchestratorOptions,
  RuntimeProfile,
  TaskSubmission,
} from "@deepresearch/contracts";
export type { PhaseContext, V5OrchestratorOptions } from "./types.js";

export { CheckpointPauseError, OrchestratorImpl, InMemoryOrchestrator, SqliteOrchestrator, createInMemoryOrchestrator, createSqliteOrchestrator } from "./orchestrator.js";
export {
  buildResearchRuntimeProfile,
  createResearchFetchFromEnv,
  createResearchLlmFromEnv,
  createResearchReviewLlmFromEnv,
  createResearchSearchFromEnv,
  runResearch,
  streamResearch,
  summarizeEpisodeResult,
  type ResearchLlmProviderName,
  type ResearchRunInput,
  type ResearchRunOutput,
  type ResearchRunSummary,
  type ResearchSearchProviderName,
  type ResearchStreamMessage,
} from "./research-api.js";
export { buildContextPacket } from "./context-builder.js";
export { MarkdownReporter } from "./reporter.js";
export { loadDefaultRuntimeProfile, mergeRuntimeProfile } from "./infra/config.js";
export {
  ResearchStreamRenderer,
  renderResearchEvent,
  toVisualResearchEvent,
  type ResearchStreamFrame,
  type ResearchStreamFrameKind,
  type ResearchStreamMode,
  type ResearchStreamRendererOptions,
} from "./stream-renderer.js";
export { runAgentRuntime, type RunAgentRuntimeInput } from "./agent-runtime.js";
export {
  inspectResearchCheckpoint,
  readResearchCheckpointEvents,
  restoreResearchCheckpoint,
  saveResearchCheckpoint,
  type CheckpointCursor,
  type InspectedResearchCheckpoint,
  type ResearchCheckpoint,
  type RestoredCheckpoint,
  type ResumeStage,
} from "./checkpoint.js";
export {
  encodeResearchSse,
  researchSseHeaders,
  streamResearchToSse,
  writeResearchSseMessage,
  type ResearchSseOptions,
  type ResearchSseTarget,
} from "./sse.js";
export {
  buildResearchHttpInput,
  createInMemoryResearchRunStore,
  createResearchHttpHandler,
  readJsonBody,
  type ReadJsonBodyOptions,
  type ResearchHttpHandler,
  type ResearchHttpHandlerOptions,
  type ResearchRunRecord,
  type ResearchRunStatus,
  type ResearchRunStore,
  ResearchRunConflictError,
} from "./node-http.js";
export {
  SqliteResearchRunStore,
  createSqliteResearchRunStore,
  type SqliteResearchRunStoreOptions,
} from "./sqlite-run-store.js";
export { createPhaseToolRegistry, scoutTools, evidenceTools, runtimeTools, type PhaseToolRegistryOptions } from "./tools.js";
export {
  auditEvidenceQuality,
  resolveEvidenceQualityPolicy,
  DEFAULT_EVIDENCE_QUALITY_POLICY,
  type EvidenceQualityAuditOptions,
} from "./evidence-quality.js";
export { applyHumanReviewResponse, validateResponse, type AppliedHumanReviewResponse } from "./human-review-response.js";
export {
  applyAdaptiveStopIfSafe,
  buildResearchBudgetAudit,
  captureResearchGainSnapshot,
  ProviderBudgetExceededError,
  recordResearchCycleGain,
  writeResearchBudgetAudit,
  type ResearchGainSnapshot,
} from "./budget.js";
export * from "./prompts.js";
