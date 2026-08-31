/**
 * Builds the error to throw for an aborted signal. The signal's own reason
 * wins when it is an Error; a string reason becomes the message; anything
 * else falls back to `fallbackMessage` so each call site keeps its own
 * wording (e.g. "Jina search aborted", "fetch_page aborted").
 */
export function abortError(signal: AbortSignal | undefined, fallbackMessage: string): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) return reason;
  return new Error(typeof reason === "string" ? reason : fallbackMessage);
}

export function throwIfAborted(signal: AbortSignal | undefined, fallbackMessage: string): void {
  if (!signal?.aborted) return;
  throw abortError(signal, fallbackMessage);
}
