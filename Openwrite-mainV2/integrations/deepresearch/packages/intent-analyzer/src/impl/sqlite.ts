import Database from "better-sqlite3";
import type { ResearchContext } from "@deepresearch/contracts";
import { buildResearchContext, type IntentParser, type IntentParserOptions, type ParseInput } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS research_contexts (
  episode_id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_contexts_session ON research_contexts(session_id);
`;

export interface SqliteIntentParserOptions extends IntentParserOptions {
  path?: string;
  dbPath?: string;
}

export class SqliteIntentParser implements IntentParser {
  private readonly db: Database.Database;
  private readonly opts: IntentParserOptions;

  constructor(opts: SqliteIntentParserOptions = {}) {
    this.opts = opts;
    this.db = new Database(opts.dbPath ?? opts.path ?? ":memory:");
    this.db.exec(SCHEMA);
  }

  async parse(input: ParseInput): Promise<ResearchContext> {
    const ctx = buildResearchContext(input, this.opts);
    this.db.prepare("INSERT OR REPLACE INTO research_contexts(episode_id, session_id, payload, stored_at) VALUES (?, ?, ?, ?)")
      .run(ctx.episodeId, ctx.sessionId, JSON.stringify(ctx), new Date(this.opts.now?.() ?? Date.now()).toISOString());
    return ctx;
  }

  getByEpisodeId(episodeId: string): ResearchContext | null {
    const row = this.db.prepare("SELECT payload FROM research_contexts WHERE episode_id = ?").get(episodeId) as { payload: string } | undefined;
    return row ? JSON.parse(row.payload) as ResearchContext : null;
  }

  close(): void {
    this.db.close();
  }
}

export const RESEARCH_CONTEXTS_SCHEMA = SCHEMA;
