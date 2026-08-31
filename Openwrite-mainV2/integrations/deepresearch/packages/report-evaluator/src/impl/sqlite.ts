import { InMemoryReporterService, type InMemoryReporterOptions } from "./in-memory.js";

export interface SqliteReporterOptions extends InMemoryReporterOptions {
  dbPath?: string;
}

export class SqliteReporterService extends InMemoryReporterService {
  readonly dbPath: string;

  constructor(opts: SqliteReporterOptions = {}) {
    super(opts);
    this.dbPath = opts.dbPath ?? ":memory:";
  }
}
