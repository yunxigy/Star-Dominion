// DeepSeekChat: 实测可用的 chat provider。
// 走 /v1/chat/completions 协议。DeepSeek V4 模型默认开启 reasoning_content，content 字段可能为空。
// 用途：纯 LLM API 跑通；不依赖 embedding 端点（DeepSeek 不提供）。
//
// 关键 trade-off：reasoning_content 大量消耗 max_tokens，实际可用 content 很短。
// 默认 temperature=0.2、maxTokens=2048，足够常规调用。

import type { LlmChat, LlmChatRequest, LlmChatResponse } from "@deepresearch/contracts";
import { abortError, sleepWithAbort } from "@deepresearch/net-utils";

export interface DeepSeekChatOptions {
  apiKey: string;
  /** base url，缺省 https://api.deepseek.com/v1 */
  baseUrl?: string;
  /** 模型名，缺省 deepseek-chat */
  model?: string;
  /** 自定义 fetch（测试时可注入） */
  fetchImpl?: typeof fetch;
  /** 单次请求超时（ms），缺省 120000（2 分钟） */
  timeoutMs?: number;
  /** transient fetch/HTTP failures retry count，缺省 1。 */
  retry?: number;
  /** 服务端拒绝过大的 max_tokens 时，降级重试的输出上限。缺省 8192。 */
  maxTokensFallback?: number;
}

export class DeepSeekChat implements LlmChat {
  readonly name = "deepseek";
  private readonly opts: Required<DeepSeekChatOptions>;

  constructor(opts: DeepSeekChatOptions) {
    this.opts = {
      apiKey: opts.apiKey,
      baseUrl: opts.baseUrl ?? "https://api.deepseek.com/v1",
      model: opts.model ?? "deepseek-chat",
      fetchImpl: opts.fetchImpl ?? defaultFetch,
      timeoutMs: opts.timeoutMs ?? 120000,
      retry: nonNegativeInteger(opts.retry, 1),
      maxTokensFallback: positiveNumber(opts.maxTokensFallback, 8192),
    };
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    const f = this.opts.fetchImpl;
    if (!f) throw new Error("DeepSeekChat: fetch not available");
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
      max_tokens: req.maxTokens ?? 2048,
      temperature: req.temperature ?? 0.2,
    };
    if (req.json) body.response_format = { type: "json_object" };
    const resp = await this.postChatCompletion(f, body, req);
    const data = (await resp.json()) as {
      choices: Array<{ message: { content: string; reasoning_content?: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
    };
    const choice = data.choices[0];
    return {
      content: choice?.message.content ?? "",
      reasoning: choice?.message.reasoning_content,
      usage: data.usage
        ? { promptTokens: data.usage.prompt_tokens, completionTokens: data.usage.completion_tokens, totalTokens: data.usage.total_tokens }
        : undefined,
    };
  }

  private async postChatCompletion(fetchImpl: typeof fetch, body: Record<string, unknown>, req: LlmChatRequest): Promise<Response> {
    const resp = await this.postChatCompletionOnce(fetchImpl, body, req);
    if (resp.ok) return resp;
    const text = await resp.text();
    const requestedMaxTokens = typeof body.max_tokens === "number" ? body.max_tokens : undefined;
    if (requestedMaxTokens && requestedMaxTokens > this.opts.maxTokensFallback && isMaxTokensLimitError(resp.status, text)) {
      const fallbackBody = { ...body, max_tokens: this.opts.maxTokensFallback };
      const retry = await this.postChatCompletionOnce(fetchImpl, fallbackBody, req);
      if (retry.ok) return retry;
      throw new Error(`DeepSeek API ${retry.status}: ${await retry.text()}`);
    }
    throw new Error(`DeepSeek API ${resp.status}: ${text}`);
  }

  private async postChatCompletionOnce(fetchImpl: typeof fetch, body: Record<string, unknown>, req: LlmChatRequest): Promise<Response> {
    const maxAttempts = Math.max(1, this.opts.retry + 1);
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await fetchWithTimeout(
          fetchImpl,
          `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${this.opts.apiKey}`,
            },
            body: JSON.stringify(body),
          },
          req.timeoutMs ?? this.opts.timeoutMs,
          req.signal,
        );
        if (resp.ok || !isRetryableHttpStatus(resp.status) || attempt >= maxAttempts) return resp;
        lastError = new Error(`DeepSeek API ${resp.status}: ${await resp.text()}`);
      } catch (err) {
        if (req.signal?.aborted || attempt >= maxAttempts) throw err;
        lastError = err;
      }
      await sleepWithAbort(retryDelayMs(attempt), req.signal, "DeepSeek API request aborted");
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "DeepSeek API retry failed"));
  }
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function positiveNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function retryDelayMs(attempt: number): number {
  return Math.min(8000, 400 * 2 ** Math.max(0, attempt - 1));
}

function isMaxTokensLimitError(status: number, text: string): boolean {
  return status === 400 && /max[_ ]?tokens|max_tokens|token/i.test(text);
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } catch (e) {
    const err = e as Error & { name?: string; cause?: unknown };
    if (externalSignal?.aborted) {
      throw abortError(externalSignal, "DeepSeek API request aborted");
    }
    if (err.name === "AbortError") {
      throw new Error(`DeepSeek API request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`DeepSeek API fetch failed: ${formatNetworkError(err)}`, { cause: e });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function formatNetworkError(err: Error & { cause?: unknown }): string {
  const details: string[] = [`${err.name}: ${err.message}`];
  let cause = err.cause;
  const seen = new Set<unknown>();
  while (cause && !seen.has(cause)) {
    seen.add(cause);
    if (cause instanceof Error) {
      const coded = cause as Error & { code?: string; syscall?: string; hostname?: string; cause?: unknown };
      details.push([
        coded.code,
        coded.syscall,
        coded.hostname,
        coded.message,
      ].filter(Boolean).join(" "));
      cause = coded.cause;
    } else {
      details.push(String(cause));
      break;
    }
  }
  return details.filter(Boolean).join("; cause=");
}

