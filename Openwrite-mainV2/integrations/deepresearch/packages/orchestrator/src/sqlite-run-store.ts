import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import type { EpisodeResult, MemoryEvent } from "@deepresearch/contracts";
import type { ResearchRunSummary } from "./research-api.js";
import type { ResearchStreamFrame } from "./stream-renderer.js";
import {
  ResearchRunConflictError,
  type ResearchRunRecord,
  type ResearchRunStatus,
  type ResearchRunStore,
} from "./node-http.js";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
CREATE TABLE IF NOT EXISTS research_runs (
  run_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  episode_id TEXT,
  result_json TEXT,
  summary_json TEXT,
  error TEXT,
  checkpoint_path TEXT,
  checkpoint_cursor_json TEXT,
  owner_id TEXT NOT NULL,
  heartbeat_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS research_run_events (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, event_id),
  UNIQUE (run_id, sequence)
);
CREATE TABLE IF NOT EXISTS research_run_frames (
  run_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (run_id, sequence)
);
CREATE INDEX IF NOT EXISTS idx_research_runs_updated ON research_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_events_run_sequence ON research_run_events(run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_research_frames_run_sequence ON research_run_frames(run_id, sequence);
`;

export interface SqliteResearchRunStoreOptions {
  dbPath: string;
  ownerId?: string;
  staleAfterMs?: number;
  maxEvents?: number;
  maxFrames?: number;
  now?: () => number;
}

export class SqliteResearchRunStore implements ResearchRunStore {
  private readonly db: Database.Database;
  private readonly ownerId: string;
  private readonly staleAfterMs: number;
  private readonly maxEvents: number;
  private readonly maxFrames: number;
  private readonly now: () => number;
  private readonly controllers = new Map<string, AbortController>();

  constructor(opts: SqliteResearchRunStoreOptions) {
    this.db = new Database(opts.dbPath);
    this.db.exec(SCHEMA);
    this.ownerId = opts.ownerId ?? `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
    this.staleAfterMs = opts.staleAfterMs ?? 15 * 60_000;
    this.maxEvents = Math.max(1, opts.maxEvents ?? 6000);
    this.maxFrames = Math.max(1, opts.maxFrames ?? 3000);
    this.now = opts.now ?? Date.now;
  }

  createRunId(): string {
    return `RUN_${this.now()}_${randomUUID().slice(0, 8)}`;
  }

  create(input: { runId: string; prompt: string; controller: AbortController }): ResearchRunRecord {
    const timestamp = this.isoNow();
    try {
      this.db.prepare(`
        INSERT INTO research_runs(
          run_id, status, prompt, created_at, updated_at, owner_id, heartbeat_at
        ) VALUES (?, 'running', ?, ?, ?, ?, ?)
      `).run(input.runId, input.prompt, timestamp, timestamp, this.ownerId, timestamp);
    } catch (err) {
      if (isUniqueConstraint(err)) throw new ResearchRunConflictError(input.runId);
      throw err;
    }
    this.controllers.set(input.runId, input.controller);
    return this.get(input.runId)!;
  }

  list(): ResearchRunRecord[] {
    const rows = this.db.prepare("SELECT * FROM research_runs ORDER BY created_at DESC").all() as RunRow[];
    return rows.map((row) => this.materialize(row));
  }

  get(runId: string): ResearchRunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM research_runs WHERE run_id = ?").get(runId) as RunRow | undefined;
    return row ? this.materialize(row) : undefined;
  }

  getStatus(runId: string): { status: ResearchRunStatus; error?: string } | undefined {
    const row = this.row(runId);
    if (!row) return undefined;
    const status = this.effectiveStatus(row);
    return {
      status,
      error: row.error ?? (status === "interrupted" ? "run heartbeat expired before completion" : undefined),
    };
  }

  appendEvent(runId: string, event: MemoryEvent): void {
    this.db.transaction(() => {
      const sequence = this.nextSequence("research_run_events", runId);
      this.db.prepare(`
        INSERT OR IGNORE INTO research_run_events(run_id, sequence, event_id, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(runId, sequence, event.eventId, JSON.stringify(event));
      const checkpoint = event.eventType === "checkpoint_saved"
        ? {
            path: stringValue(event.payload?.path),
            cursor: {
              stage: event.payload?.stage,
              nextCycle: event.payload?.nextCycle,
              pass: event.payload?.pass,
              draftPath: event.payload?.draftPath,
            },
          }
        : undefined;
      const timestamp = this.isoNow();
      this.db.prepare(`
        UPDATE research_runs
        SET updated_at = ?, heartbeat_at = ?, episode_id = COALESCE(?, episode_id),
            checkpoint_path = COALESCE(?, checkpoint_path),
            checkpoint_cursor_json = COALESCE(?, checkpoint_cursor_json)
        WHERE run_id = ?
      `).run(
        timestamp,
        timestamp,
        event.episodeId || null,
        checkpoint?.path ?? null,
        checkpoint ? JSON.stringify(checkpoint.cursor) : null,
        runId,
      );
      this.trim("research_run_events", runId, sequence, this.maxEvents);
    })();
  }

  appendFrame(runId: string, frame: ResearchStreamFrame): void {
    this.db.transaction(() => {
      const sequence = this.nextSequence("research_run_frames", runId);
      this.db.prepare(`
        INSERT INTO research_run_frames(run_id, sequence, payload_json) VALUES (?, ?, ?)
      `).run(runId, sequence, JSON.stringify(frame));
      const timestamp = this.isoNow();
      this.db.prepare("UPDATE research_runs SET updated_at = ?, heartbeat_at = ? WHERE run_id = ?")
        .run(timestamp, timestamp, runId);
      this.trim("research_run_frames", runId, sequence, this.maxFrames);
    })();
  }

  finish(runId: string, result: EpisodeResult, summary: ResearchRunSummary): void {
    const row = this.row(runId);
    if (!row || row.status === "cancelled") return;
    const timestamp = this.isoNow();
    this.db.prepare(`
      UPDATE research_runs
      SET status = ?, updated_at = ?, heartbeat_at = ?, episode_id = ?, result_json = ?, summary_json = ?,
          checkpoint_path = COALESCE(?, checkpoint_path), error = NULL
      WHERE run_id = ? AND status != 'cancelled'
    `).run(
      result.status,
      timestamp,
      timestamp,
      result.episodeId,
      JSON.stringify(result),
      JSON.stringify(summary),
      summary.checkpoint ?? null,
      runId,
    );
    this.controllers.delete(runId);
  }

  fail(runId: string, error: unknown): void {
    const row = this.row(runId);
    if (!row || row.status === "cancelled") return;
    const timestamp = this.isoNow();
    this.db.prepare(`
      UPDATE research_runs SET status = 'failed', updated_at = ?, heartbeat_at = ?, error = ?
      WHERE run_id = ? AND status != 'cancelled'
    `).run(timestamp, timestamp, messageOf(error), runId);
    this.controllers.delete(runId);
  }

  cancel(runId: string, reason: string): void {
    const timestamp = this.isoNow();
    this.db.prepare(`
      UPDATE research_runs SET status = 'cancelled', updated_at = ?, heartbeat_at = ?, error = ? WHERE run_id = ?
    `).run(timestamp, timestamp, reason, runId);
    const controller = this.controllers.get(runId);
    if (controller && !controller.signal.aborted) controller.abort(reason);
  }

  close(): void {
    this.db.close();
  }

  private materialize(row: RunRow): ResearchRunRecord {
    const controller = this.controllers.get(row.run_id) ?? new AbortController();
    if (row.status === "cancelled" && !controller.signal.aborted) controller.abort(row.error ?? "cancelled");
    const events = this.db.prepare(`
      SELECT payload_json FROM research_run_events WHERE run_id = ? ORDER BY sequence
    `).all(row.run_id).map((item) => parseJson<MemoryEvent>((item as PayloadRow).payload_json));
    const frames = this.db.prepare(`
      SELECT payload_json FROM research_run_frames WHERE run_id = ? ORDER BY sequence
    `).all(row.run_id).map((item) => parseJson<ResearchStreamFrame>((item as PayloadRow).payload_json));
    const status = this.effectiveStatus(row);
    return {
      runId: row.run_id,
      episodeId: row.episode_id ?? undefined,
      status,
      prompt: row.prompt,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      controller,
      events,
      frames,
      result: parseOptionalJson<EpisodeResult>(row.result_json),
      summary: parseOptionalJson<ResearchRunSummary>(row.summary_json),
      error: row.error ?? (status === "interrupted" ? "run heartbeat expired before completion" : undefined),
      checkpointPath: row.checkpoint_path ?? undefined,
      checkpointCursor: parseOptionalJson<Record<string, unknown>>(row.checkpoint_cursor_json),
    };
  }

  private effectiveStatus(row: RunRow): ResearchRunStatus {
    if (row.status !== "running") return row.status;
    const heartbeat = Date.parse(row.heartbeat_at);
    return Number.isFinite(heartbeat) && this.now() - heartbeat > this.staleAfterMs ? "interrupted" : "running";
  }

  private row(runId: string): RunRow | undefined {
    return this.db.prepare("SELECT * FROM research_runs WHERE run_id = ?").get(runId) as RunRow | undefined;
  }

  private nextSequence(table: "research_run_events" | "research_run_frames", runId: string): number {
    const row = this.db.prepare(`SELECT COALESCE(MAX(sequence), 0) AS value FROM ${table} WHERE run_id = ?`).get(runId) as { value: number };
    return row.value + 1;
  }

  private trim(table: "research_run_events" | "research_run_frames", runId: string, latest: number, limit: number): void {
    const cutoff = latest - limit;
    if (cutoff <= 0) return;
    this.db.prepare(`DELETE FROM ${table} WHERE run_id = ? AND sequence <= ?`).run(runId, cutoff);
  }

  private isoNow(): string {
    return new Date(this.now()).toISOString();
  }
}

export function createSqliteResearchRunStore(opts: SqliteResearchRunStoreOptions): SqliteResearchRunStore {
  return new SqliteResearchRunStore(opts);
}

interface RunRow {
  run_id: string;
  status: ResearchRunStatus;
  prompt: string;
  created_at: string;
  updated_at: string;
  episode_id: string | null;
  result_json: string | null;
  summary_json: string | null;
  error: string | null;
  checkpoint_path: string | null;
  checkpoint_cursor_json: string | null;
  owner_id: string;
  heartbeat_at: string;
}

interface PayloadRow { payload_json: string }

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseOptionalJson<T>(value: string | null): T | undefined {
  return value ? parseJson<T>(value) : undefined;
}

function isUniqueConstraint(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && String(err.code).startsWith("SQLITE_CONSTRAINT"));
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
