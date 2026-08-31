/**
 * Formats an unknown fetch failure as `Name: message; cause=<cause message>`.
 */
export function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  const causeText = cause instanceof Error ? `; cause=${cause.message}` : "";
  return `${err.name}: ${err.message}${causeText}`;
}

/**
 * Formats an unknown fetch failure like {@link formatFetchError}, but the
 * cause segment also includes Node system-error metadata when present:
 * `Name: message; cause=<code> <syscall> <hostname> <message>`.
 */
export function formatFetchErrorWithCauseDetails(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (!(cause instanceof Error)) return `${err.name}: ${err.message}`;
  const coded = cause as Error & { code?: string; syscall?: string; hostname?: string };
  return `${err.name}: ${err.message}; cause=${[coded.code, coded.syscall, coded.hostname, coded.message].filter(Boolean).join(" ")}`;
}
