import type { ReporterService } from "@deepresearch/contracts";
import { InMemoryReporterService, type InMemoryReporterOptions } from "./impl/in-memory.js";
import { SqliteReporterService, type SqliteReporterOptions } from "./impl/sqlite.js";
import type { BaseReporterOptions } from "./types.js";

export const MODULE_NAME = "report-evaluator";

export function createInMemoryReporter(opts: InMemoryReporterOptions = {}): ReporterService {
  return new InMemoryReporterService(opts);
}

export function createSqliteReporter(opts: SqliteReporterOptions = {}): ReporterService {
  return new SqliteReporterService(opts);
}

export { BaseReporterService, renderBundle } from "./reporter-base.js";
export type { BaseReporterOptions, InMemoryReporterOptions, SqliteReporterOptions };
export type { ReportArtifact, ReportBundle, ReporterService } from "@deepresearch/contracts";
