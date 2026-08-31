export type TaskStatus = "queued" | "running" | "blocked" | "completed" | "failed" | "cancelled";

export interface AgentNodePartPlan {
  partId: string;
  parentAgentTaskId: string;
  parentReportNodeId: string;
  researchQuestion: string;
  searchGoal: string;
  writingGoal: string;
  expectedHeading: string;
  evidenceNeeds: string[];
}

export interface TaskItem {
  taskId: string;
  parentTaskId: string | null;
  reportNodeId: string;
  title: string;
  objective: string;
  /** Structured requirements this task is allowed to open or repair gaps for. */
  requirementIds?: string[];
  plannedReportlet?: AgentNodePartPlan;
  plannedReportlets?: AgentNodePartPlan[];
  status: TaskStatus;
  priority: number;
  branchId: string;
  acceptanceCriteria: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskUpdate {
  taskId: string;
  newStatus: Extract<TaskStatus, "completed" | "queued" | "blocked" | "failed" | "cancelled">;
  reason: string;
}

export interface NewTaskRequest {
  parentTaskId?: string | null;
  reportNodeId: string;
  title: string;
  objective: string;
  requirementIds?: string[];
  priority: number;
  acceptanceCriteria: string[];
}

export interface TaskLedger {
  upsert(item: TaskItem): Promise<void>;
  getById(id: string): Promise<TaskItem | null>;
  listAll(): Promise<TaskItem[]>;
  listByBranch(branchId: string): Promise<TaskItem[]>;
  listByReportNode(reportNodeId: string): Promise<TaskItem[]>;
  listByStatus(status: TaskStatus, opts?: { limit?: number }): Promise<TaskItem[]>;
  updateStatus(taskId: string, status: TaskStatus, reason?: string): Promise<void>;
}
