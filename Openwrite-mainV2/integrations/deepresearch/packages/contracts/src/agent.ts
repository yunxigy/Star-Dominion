import type { GlobalRubric } from "./context.js";
import type { StructurePatchSuggestion } from "./patch.js";
import type { ReportNode } from "./report.js";
import type { AgentNodePartPlan, TaskItem } from "./task.js";

export interface ToolDefinition {
  toolName: string;
  description: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface ToolCallRequest {
  toolName: string;
  args: unknown;
  agentRunId?: string;
  taskId?: string;
  reportNodeId?: string;
}

export interface ToolCallResult {
  toolName: string;
  ok: boolean;
  output?: unknown;
  error?: string;
  durationMs?: number;
}

export interface ToolRegistry {
  listTools(): Promise<ToolDefinition[]> | ToolDefinition[];
  invoke(req: ToolCallRequest): Promise<ToolCallResult>;
}

export interface AgentRuntimeBudget {
  maxReactSteps: number;
  maxToolCalls: number;
  maxSearchCalls?: number;
  maxFetchCalls?: number;
  targetReactSteps?: number;
  targetToolCalls?: number;
  targetSearchCalls?: number;
  targetFetchCalls?: number;
}

export interface AgentRuntimeMeta {
  agentId: string;
  agentRunId: string;
  role: AgentRole;
  title: string;
  objective: string;
  episodeId?: string;
  branchId?: string;
  taskId?: string;
  reportNodeId?: string;
  parentAgentRunId?: string;
}

export interface AgentRuntimeDecision {
  thoughtSummary?: string;
  action: "tool" | "finish";
  toolName?: string;
  args?: unknown;
  finish?: unknown;
}

export interface AgentRuntimeStep {
  step: number;
  decision: AgentRuntimeDecision;
  toolResult?: ToolCallResult;
}

export interface AgentRuntimeResult {
  agent: AgentRuntimeMeta;
  status: "completed" | "failed" | "budget_exceeded";
  steps: AgentRuntimeStep[];
  finish?: unknown;
  error?: string;
}

export interface ContextPacket {
  globalRubric: {
    rubricText: string;
    outputHints: GlobalRubric["outputHints"];
    requirements?: GlobalRubric["requirements"];
  };
  currentTask: {
    taskId: string;
    branchId: string;
    reportNodeId: string;
    objective: string;
    acceptanceCriteria: string[];
    plannedReportlet?: AgentNodePartPlan;
    plannedReportlets?: AgentNodePartPlan[];
  };
  currentReportNode: Pick<ReportNode, "nodeId" | "nodeKind" | "label" | "scopeNote" | "hypothesis" | "requirementIds">;
  parentContext?: {
    nodeId: string;
    label: string;
    scopeNote: string;
  };
  siblingTasks: Array<Pick<TaskItem, "taskId" | "title" | "status">>;
  relevantEvidence: Array<{
    knowledgeNodeId: string;
    title: string;
    url?: string;
    sourceTier: string;
    qualityScore?: number;
    publishedAt?: string;
    summary: string;
    relation: string;
  }>;
  relevantReportlets?: Array<{
    reportletId: string;
    reportNodeId: string;
    title: string;
    markdown: string;
    citedEvidenceLinkIds: string[];
    citedKnowledgeNodeIds: string[];
    plannedReportlet?: AgentNodePartPlan;
  }>;
  budget: {
    maxReactSteps: number;
    maxToolCalls: number;
    maxSearchCalls: number;
    maxFetchCalls: number;
    targetReactSteps?: number;
    targetToolCalls?: number;
    targetSearchCalls?: number;
    targetFetchCalls?: number;
  };
  availableTools: ToolDefinition[];
  bindingContext: {
    currentReportNodeId: string;
    currentTaskId: string;
    currentBranchId: string;
  };
}

export interface AgentRunResult {
  agentRunId: string;
  taskId: string;
  reportNodeId: string;
  branchId: string;
  branchOutcome: "done_here" | "defer_to_next_round" | "failed";
  knowledgeNodeIds: string[];
  evidenceLinkIds: string[];
  reportletIds?: string[];
  nodeUpdates: Array<{
    reportNodeId: string;
    oldStatus: string;
    newStatus: string;
    reason: string;
    confidence: number;
  }>;
  openGaps: Array<{
    gapType: string;
    description: string;
    suggestedQuery: string;
    recommendedDisposition?: "retry" | "qualify" | "omit";
    claimSafeWithoutMissingEvidence?: boolean;
    affectedRequirementIds?: string[];
  }>;
  structurePatchSuggestions: StructurePatchSuggestion[];
  turnSummary: {
    actionSummary: string;
    searchSummary: string;
    reasoningSummary: string;
    citedKnowledgeNodeIds: string[];
    citedEvidenceLinkIds: string[];
  };
}

export type AgentRole = "main_dispatcher" | "subagent" | "reporter" | "system" | (string & {});

export interface TraceAgentMeta {
  agentId: string;
  agentRunId?: string;
  role: AgentRole;
  title: string;
  objective?: string;
  episodeId?: string;
  branchId?: string;
  taskId?: string;
  reportNodeId?: string;
  contextPacketId?: string;
}

export interface TraceEvent {
  title: string;
  summary?: string;
  input?: unknown;
  output?: unknown;
  parsed?: unknown;
  toolCalls?: Array<{
    name: string;
    args?: unknown;
    result?: unknown;
    status?: "ok" | "error" | "skipped";
    durationMs?: number;
  }>;
  error?: unknown;
}

export interface AgentTraceRecorder {
  readonly rootDir?: string;
  startAgent(meta: TraceAgentMeta): void;
  event(agentId: string, event: TraceEvent): void;
}

export const noopTraceRecorder: AgentTraceRecorder = {
  startAgent: () => {},
  event: () => {},
};
