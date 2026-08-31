import type { MemoryGraph } from "@deepresearch/contracts";
import { InMemoryMemoryGraph } from "./impl/in-memory.js";
import { SqliteMemoryGraph, type SqliteMemoryGraphOptions } from "./impl/sqlite.js";
import type { MemoryGraphFactoryOptions } from "./types.js";

export const MODULE_NAME = "memory-graph";

export type { MemoryGraph } from "@deepresearch/contracts";
export { InMemoryMemoryGraph, SqliteMemoryGraph };
export type { MemoryGraphFactoryOptions, SqliteMemoryGraphOptions };

export function createInMemoryMemoryGraph(opts: MemoryGraphFactoryOptions = {}): MemoryGraph {
  return new InMemoryMemoryGraph({ initial: opts.initial });
}

export function createSqliteMemoryGraph(opts: SqliteMemoryGraphOptions = {}): MemoryGraph {
  return new SqliteMemoryGraph(opts);
}
