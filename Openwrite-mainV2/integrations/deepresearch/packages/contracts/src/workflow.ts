import type { AgentRunResult } from "./agent.js";
import type { GlobalRubric, ResearchContext, RuntimeProfile, TaskSubmission } from "./context.js";
import type { ReportBundle, ReportNode } from "./report.js";
import type { NewTaskRequest, TaskUpdate } from "./task.js";

export type PhaseName =
  | "parse"
  | "rubric"
  | "init-root"
  | "scout"
  | "architect-tree"
  | "dispatch-evidence"
  | "cycle-reflection"
  | "structure-review"
  | "completion-gate"
  | "report"
  | "publish-gate";

export interface EpisodeInput {
  researchContext: ResearchContext;
  runtimeProfile: RuntimeProfile;
}

export interface ParsePhaseInput {
  submission: TaskSubmission;
  runtimeProfileOverrides?: Partial<RuntimeProfile>;
}

export interface RubricPhaseOutput {
  globalRubric: GlobalRubric;
  rootTaskId: string;
}

export interface InitRootPhaseOutput {
  root: ReportNode;
}

export interface ArchitectTreeOutput {
  aspectNodeIds: string[];
  hypothesisNodeIds: string[];
  taskIds: string[];
}

export interface CycleReflectionOutput {
  taskUpdates: TaskUpdate[];
  newTasks: NewTaskRequest[];
  skipReasons: Array<{ gap: string; reason: string }>;
}

export interface CompletionDecision {
  decision: "ready_for_report" | "need_more_work";
  reason?: string;
  newTasks?: NewTaskRequest[];
}

export interface ReportPhaseOutput {
  draftMarkdownPath: string;
  citationMapPath: string;
  diagnosticsPath: string;
  bundle: ReportBundle;
}

export interface PublishGateResult {
  status: "passed" | "needs_repair";
  reportArtifactPath?: string;
  evidenceIndexPath?: string;
  tracePath?: string;
  diagnostics?: Array<{
    code: string;
    severity: "warning" | "error";
    message: string;
  }>;
  repairTasks?: NewTaskRequest[];
}

export interface DispatchEvidenceOutput {
  cycleId: string;
  results: AgentRunResult[];
}
