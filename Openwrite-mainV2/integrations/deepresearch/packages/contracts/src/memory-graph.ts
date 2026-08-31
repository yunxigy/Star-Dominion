export type MemoryEventType =
  | "episode_started"
  | "rubric_created"
  | "root_created"
  | "scout_started"
  | "scout_finished"
  | "architect_tree_created"
  | "evidence_agent_started"
  | "evidence_agent_finished"
  | "cycle_reflection"
  | "structure_review"
  | "completion_gate"
  | "report_draft_created"
  | "publish_gate_repair"
  | "episode_succeeded"
  | (string & {});

export interface MemoryEvent {
  eventId: string;
  eventType: MemoryEventType;
  episodeId: string;
  timestamp: string;
  taskId?: string;
  reportNodeId?: string;
  branchId?: string;
  agentRunId?: string;
  payload?: Record<string, unknown>;
}

export interface MemoryGraph {
  appendEvent(event: MemoryEvent): Promise<void>;
  listEvents(opts?: {
    episodeId?: string;
    taskId?: string;
    reportNodeId?: string;
    branchId?: string;
    eventType?: MemoryEventType;
    limit?: number;
  }): Promise<MemoryEvent[]>;
  exportJsonl?(episodeId: string): Promise<string>;
}
