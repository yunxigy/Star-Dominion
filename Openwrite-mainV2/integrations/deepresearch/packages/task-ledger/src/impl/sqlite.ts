import Database from "better-sqlite3";
import type { TaskItem, TaskLedger, TaskStatus } from "@deepresearch/contracts";
import { sortTasksForDispatch, validateTaskItem } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS task_items (
  task_id TEXT PRIMARY KEY,
  parent_task_id TEXT,
  report_node_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  status TEXT NOT NULL,
  priority REAL NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_items_branch ON task_items(branch_id);
CREATE INDEX IF NOT EXISTS idx_task_items_report ON task_items(report_node_id);
CREATE INDEX IF NOT EXISTS idx_task_items_status ON task_items(status, priority DESC);
`;

export interface SqliteTaskLedgerOptions {
  path?: string;
  dbPath?: string;
}

export class SqliteTaskLedger implements TaskLedger {
  private readonly db: Database.Database;

  constructor(opts: SqliteTaskLedgerOptions = {}) {
    this.db = new Database(opts.dbPath ?? opts.path ?? ":memory:");
    this.db.exec(SCHEMA);
  }

  async upsert(item: TaskItem): Promise<void> {
    const prev = await this.getById(item.taskId);
    validateTaskItem(item, prev ?? undefined);
    this.db.prepare(
      `INSERT OR REPLACE INTO task_items(task_id, parent_task_id, report_node_id, branch_id, status, priority, payload, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      item.taskId,
      item.parentTaskId,
      item.reportNodeId,
      item.branchId,
      item.status,
      item.priority,
      JSON.stringify(item),
      item.createdAt,
      item.updatedAt,
    );
  }

  async getById(id: string): Promise<TaskItem | null> {
    const row = this.db.prepare("SELECT payload FROM task_items WHERE task_id = ?").get(id) as Row | undefined;
    return row ? JSON.parse(row.payload) as TaskItem : null;
  }

  async listAll(): Promise<TaskItem[]> {
    const rows = this.db.prepare("SELECT payload FROM task_items").all() as Row[];
    return rows.map(parseRow).sort(sortTasksForDispatch);
  }

  async listByBranch(branchId: string): Promise<TaskItem[]> {
    const rows = this.db.prepare("SELECT payload FROM task_items WHERE branch_id = ?").all(branchId) as Row[];
    return rows.map(parseRow).sort(sortTasksForDispatch);
  }

  async listByReportNode(reportNodeId: string): Promise<TaskItem[]> {
    const rows = this.db.prepare("SELECT payload FROM task_items WHERE report_node_id = ?").all(reportNodeId) as Row[];
    return rows.map(parseRow).sort(sortTasksForDispatch);
  }

  async listByStatus(status: TaskStatus, opts?: { limit?: number }): Promise<TaskItem[]> {
    const rows = this.db.prepare("SELECT payload FROM task_items WHERE status = ?").all(status) as Row[];
    const out = rows.map(parseRow).sort(sortTasksForDispatch);
    return typeof opts?.limit === "number" ? out.slice(0, opts.limit) : out;
  }

  async updateStatus(taskId: string, status: TaskStatus, _reason?: string): Promise<void> {
    const found = await this.getById(taskId);
    if (!found) return;
    await this.upsert({ ...found, status, updatedAt: new Date().toISOString() });
  }

  close(): void {
    this.db.close();
  }
}

interface Row {
  payload: string;
}

function parseRow(row: Row): TaskItem {
  return JSON.parse(row.payload) as TaskItem;
}
