import type { TaskItem, TaskLedger, TaskStatus } from "@deepresearch/contracts";
import { sortTasksForDispatch, validateTaskItem, type StoredTaskItem } from "../types.js";

export interface InMemoryTaskLedgerOptions {
  seed?: number;
  initial?: TaskItem[];
}

export class InMemoryTaskLedger implements TaskLedger {
  private readonly items = new Map<string, StoredTaskItem>();

  constructor(opts: InMemoryTaskLedgerOptions = {}) {
    for (const item of opts.initial ?? []) {
      validateTaskItem(item);
      this.items.set(item.taskId, { ...structuredClone(item), insertedAt: new Date().toISOString() });
    }
  }

  async upsert(item: TaskItem): Promise<void> {
    const prev = this.items.get(item.taskId);
    validateTaskItem(item, prev);
    this.items.set(item.taskId, {
      ...structuredClone(item),
      insertedAt: prev?.insertedAt ?? new Date().toISOString(),
    });
  }

  async getById(id: string): Promise<TaskItem | null> {
    return clonePublic(this.items.get(id));
  }

  async listAll(): Promise<TaskItem[]> {
    return Array.from(this.items.values()).map((item) => clonePublic(item)!);
  }

  async listByBranch(branchId: string): Promise<TaskItem[]> {
    return Array.from(this.items.values())
      .filter((item) => item.branchId === branchId)
      .map((item) => clonePublic(item)!)
      .sort(sortTasksForDispatch);
  }

  async listByReportNode(reportNodeId: string): Promise<TaskItem[]> {
    return Array.from(this.items.values())
      .filter((item) => item.reportNodeId === reportNodeId)
      .map((item) => clonePublic(item)!)
      .sort(sortTasksForDispatch);
  }

  async listByStatus(status: TaskStatus, opts?: { limit?: number }): Promise<TaskItem[]> {
    const out = Array.from(this.items.values())
      .filter((item) => item.status === status)
      .map((item) => clonePublic(item)!)
      .sort(sortTasksForDispatch);
    return typeof opts?.limit === "number" ? out.slice(0, opts.limit) : out;
  }

  async updateStatus(taskId: string, status: TaskStatus, reason?: string): Promise<void> {
    const found = this.items.get(taskId);
    if (!found) return;
    await this.upsert({
      ...clonePublic(found)!,
      status,
      updatedAt: new Date().toISOString(),
      acceptanceCriteria: reason ? found.acceptanceCriteria : found.acceptanceCriteria,
    });
  }

  snapshot(): TaskItem[] {
    return Array.from(this.items.values()).map((item) => clonePublic(item)!);
  }

  static restore(items: TaskItem[]): InMemoryTaskLedger {
    return new InMemoryTaskLedger({ initial: items });
  }
}

function clonePublic(item: StoredTaskItem | undefined): TaskItem | null {
  if (!item) return null;
  const { insertedAt: _insertedAt, ...publicItem } = item;
  return structuredClone(publicItem);
}
