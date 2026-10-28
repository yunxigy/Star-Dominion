export interface RetryOptions {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const retries = Math.max(0, options.retries ?? 2);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 200);
  const sleep = options.sleep ?? wait;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response | undefined;
    let requestError: unknown;
    try {
      response = await fetcher(input, { ...init, signal: controller.signal });
    } catch (error) {
      requestError = error;
    } finally {
      clearTimeout(timeout);
    }

    if (response && !isRetryableStatus(response.status)) {
      return response;
    }

    const canRetry = attempt < retries;
    if (!canRetry) {
      if (requestError !== undefined) {
        throw new Error(controller.signal.aborted ? "External request timed out" : "External request failed");
      }
      return response as Response;
    }

    if (response?.body) {
      await response.body.cancel().catch(() => undefined);
    }
    await sleep(Math.min(3_000, retryDelayMs * 2 ** attempt));
  }

  throw new Error("External request failed");
}
