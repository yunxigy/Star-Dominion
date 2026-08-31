import { InMemoryIntentParser } from "./impl/in-memory.js";
import { SqliteIntentParser } from "./impl/sqlite.js";

export const MODULE_NAME = "intent-analyzer";

export { buildResearchContext } from "./types.js";
export type { IntentParser, IntentParserOptions, ParseInput, StoredContext } from "./types.js";
export { InMemoryIntentParser } from "./impl/in-memory.js";
export type { InMemoryIntentParserOptions } from "./impl/in-memory.js";
export { SqliteIntentParser, RESEARCH_CONTEXTS_SCHEMA } from "./impl/sqlite.js";
export type { SqliteIntentParserOptions } from "./impl/sqlite.js";

export function createIntentParserMock(opts = {}): InMemoryIntentParser {
  return new InMemoryIntentParser(opts);
}

export function createIntentParserImpl(opts: { kind: "in-memory" | "sqlite"; dbPath?: string; now?: () => number } = { kind: "in-memory" }): InMemoryIntentParser | SqliteIntentParser {
  return opts.kind === "sqlite"
    ? new SqliteIntentParser({ dbPath: opts.dbPath, now: opts.now })
    : new InMemoryIntentParser({ now: opts.now });
}
