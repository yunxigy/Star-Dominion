/**
 * Minimal injectable logger for benchmark library code, so programmatic
 * consumers can capture progress output instead of writing to stdout.
 *
 * Only `info` is required. A missing `warn`/`error` channel falls back to
 * `info` when one was provided, otherwise to the matching console method;
 * omitting the logger entirely therefore preserves the historical console
 * output exactly.
 */
export interface BenchmarkLogger {
  info(message: string): void;
  warn?(message: string): void;
  error?(message: string): void;
}

export function resolveBenchmarkLogger(logger?: BenchmarkLogger): Required<BenchmarkLogger> {
  const info = logger?.info ?? ((message: string) => console.log(message));
  const warn = logger?.warn ?? (logger?.info ? info : (message: string) => console.warn(message));
  const error = logger?.error ?? (logger?.warn ? warn : logger?.info ? info : (message: string) => console.error(message));
  return { info, warn, error };
}
