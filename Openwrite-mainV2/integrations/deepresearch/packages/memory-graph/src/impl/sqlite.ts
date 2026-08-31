import Database from "better-sqlite3";
import type { MemoryEvent, MemoryEventType, MemoryGraph } from "@deepresearch/contracts";
import { validateMemoryEvent } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memory_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  episode_id TEXT NOT NULL,
  task_id TEXT,
  report_node_id TEXT,
  branch_id TEXT,
  agent_run_id TEXT,
  timestamp TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_events_episode ON memory_events(episode_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_memory_events_task ON memory_events(task_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_report ON memory_events(report_node_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_branch ON memory_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_memory_events_type ON memory_events(event_type);
`;

export interface SqliteMemoryGraphOptions {
  dbPath?: string;
  path?: string;
}

export class SqliteMemoryGraph implements MemoryGraph {
  private readonly db: Database.Database;

  constructor(opts: SqliteMemoryGraphOptions = {}) {
    this.db = new Database(opts.dbPath ?? opts.path ?? ":memory:");
    this.db.exec(SCHEMA);
  }

  async appendEvent(event: MemoryEvent): Promise<void> {
    validateMemoryEvent(event);
    this.db.prepare(
      `INSERT OR REPLACE INTO memory_events(event_id, event_type, episode_id, task_id, report_node_id, branch_id, agent_run_id, timestamp, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.eventId,
      event.eventType,
      event.episodeId,
      event.taskId ?? null,
      event.reportNodeId ?? null,
      event.branchId ?? null,
      event.agentRunId ?? null,
      event.timestamp,
      JSON.stringify(event),
    );
  }

  async listEvents(opts: {
    episodeId?: string;
    taskId?: string;
    reportNodeId?: string;
    branchId?: string;
    eventType?: MemoryEventType;
    limit?: number;
  } = {}): Promise<MemoryEvent[]> {
    const rows = this.db.prepare("SELECT payload FROM memory_events ORDER BY timestamp, event_id").all() as Row[];
    const filtered = rows
      .map((row) => JSON.parse(row.payload) as MemoryEvent)
      .filter((event) => !opts.episodeId || event.episodeId === opts.episodeId)
      .filter((event) => !opts.taskId || event.taskId === opts.taskId)
      .filter((event) => !opts.reportNodeId || event.reportNodeId === opts.reportNodeId)
      .filter((event) => !opts.branchId || event.branchId === opts.branchId)
      .filter((event) => !opts.eventType || event.eventType === opts.eventType);
    return filtered.slice(0, opts.limit ?? filtered.length);
  }

  async exportJsonl(episodeId: string): Promise<string> {
    const events = await this.listEvents({ episodeId });
    return events.map((event) => JSON.stringify(event)).join("\n");
  }

  close(): void {
    this.db.close();
  }
}

interface Row {
  payload: string;
}
