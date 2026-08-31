import { ValidationError, type TaskItem, type TaskStatus } from "@deepresearch/contracts";

export type StoredTaskItem = TaskItem & { insertedAt: string };

export const VALID_STATUS_TRANSITIONS: ReadonlyArray<readonly [TaskStatus, TaskStatus]> = [
  ["queued", "running"],
  ["queued", "blocked"],
  ["queued", "cancelled"],
  ["running", "completed"],
  ["running", "failed"],
  ["running", "blocked"],
  ["running", "queued"],
  ["blocked", "queued"],
  ["failed", "queued"],
];

export function validateTaskItem(item: TaskItem, prev?: TaskItem): void {
  if (!item.taskId) throw new ValidationError("TaskItem.taskId is required", "taskId");
  if (item.parentTaskId === undefined) throw new ValidationError("TaskItem.parentTaskId is required", "parentTaskId");
  if (!item.reportNodeId) throw new ValidationError("TaskItem.reportNodeId is required", "reportNodeId");
  if (!item.title) throw new ValidationError("TaskItem.title is required", "title");
  if (!item.objective) throw new ValidationError("TaskItem.objective is required", "objective");
  if (!item.status) throw new ValidationError("TaskItem.status is required", "status");
  if (typeof item.priority !== "number") throw new ValidationError("TaskItem.priority must be number", "priority");
  if (!item.branchId) throw new ValidationError("TaskItem.branchId is required", "branchId");
  if (!Array.isArray(item.acceptanceCriteria) || item.acceptanceCriteria.length === 0) {
    throw new ValidationError("TaskItem.acceptanceCriteria must be non-empty", "acceptanceCriteria");
  }
  if (!item.createdAt) throw new ValidationError("TaskItem.createdAt is required", "createdAt");
  if (!item.updatedAt) throw new ValidationError("TaskItem.updatedAt is required", "updatedAt");

  if (prev && prev.status !== item.status) {
    const allowed = VALID_STATUS_TRANSITIONS.some(([from, to]) => from === prev.status && to === item.status);
    if (!allowed) {
      throw new ValidationError(`Illegal task status transition: ${prev.status} -> ${item.status}`, "status");
    }
  }
}

export function sortTasksForDispatch(a: TaskItem, b: TaskItem): number {
  return b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId);
}
