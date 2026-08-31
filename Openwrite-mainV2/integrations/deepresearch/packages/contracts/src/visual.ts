import type { AgentRole } from "./agent.js";

export type VisualResearchEventKind =
  | "agent_started"
  | "agent_thinking"
  | "agent_message"
  | "tool_started"
  | "tool_finished"
  | "source_saved"
  | "evidence_linked"
  | "gap_opened"
  | "task_created"
  | "tree_changed"
  | "reflection_decision"
  | "structure_decision"
  | "writer_draft"
  | "gate_check"
  | "artifact_ready"
  | "error";

export type VisualResearchLane = "main" | "agent" | "writer" | "gate" | "system";

export type VisualResearchSeverity = "info" | "warning" | "error" | "success";

export interface VisualResearchEvent {
  eventId: string;
  episodeId: string;
  timestamp: string;
  kind: VisualResearchEventKind;
  actor: {
    agentRunId?: string;
    role: AgentRole;
    title: string;
    taskId?: string;
    reportNodeId?: string;
    parentAgentRunId?: string;
  };
  ui: {
    lane: VisualResearchLane;
    severity?: VisualResearchSeverity;
    title: string;
    summary?: string;
    collapsible?: boolean;
    initiallyCollapsed?: boolean;
  };
  budget?: {
    maxReactSteps?: number;
    maxToolCalls?: number;
    maxSearchCalls?: number;
    maxFetchCalls?: number;
    targetReactSteps?: number;
    targetToolCalls?: number;
    targetSearchCalls?: number;
    targetFetchCalls?: number;
  };
  payload?: unknown;
}
