import { abortError } from "./abort.js";

/** Resolves after `ms` milliseconds. Not abortable. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SleepWithAbortOptions {
  /**
   * Resolve immediately when `ms <= 0`, without observing the signal at all.
   * Default false (a non-positive delay still goes through setTimeout).
   */
  immediateWhenNonPositive?: boolean;
  /**
   * Reject immediately when the signal is already aborted before the wait
   * starts. Default true. When false, an already-aborted signal is ignored
   * and the sleep resolves normally after `ms`.
   */
  rejectIfAlreadyAborted?: boolean;
}

/**
 * Resolves after `ms` milliseconds, rejecting with
 * `abortError(signal, fallbackMessage)` when the signal fires first.
 */
export async function sleepWithAbort(
  ms: number,
  signal: AbortSignal | undefined,
  fallbackMessage: string,
  options: SleepWithAbortOptions = {},
): Promise<void> {
  if (options.immediateWhenNonPositive && ms <= 0) return;
  if ((options.rejectIfAlreadyAborted ?? true) && signal?.aborted) {
    throw abortError(signal, fallbackMessage);
  }
  let onAbort: (() => void) | undefined;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    onAbort = () => {
      clearTimeout(timer);
      reject(abortError(signal, fallbackMessage));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  }).finally(() => {
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  });
}
