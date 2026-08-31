import type { LlmChat, LlmChatRequest, LlmChatResponse } from "@deepresearch/contracts";
import { abortError } from "@deepresearch/net-utils";

export interface OpenAICompatibleChatOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  providerName?: string;
  wireApi?: "chat_completions" | "responses";
  reasoningEffort?: "low" | "medium" | "high";
  includeReasoningEffort?: boolean;
  includeTemperature?: boolean;
  chatCompletionsMaxTokensParam?: "max_tokens" | "max_completion_tokens";
  chatCompletionsExtraBody?: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export class OpenAICompatibleChat implements LlmChat {
  readonly name: string;
  private readonly opts: Required<OpenAICompatibleChatOptions>;

  constructor(opts: OpenAICompatibleChatOptions) {
    this.opts = {
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.5",
      providerName: "openai-compatible",
      wireApi: "chat_completions",
      reasoningEffort: "low",
      includeReasoningEffort: true,
      includeTemperature: false,
      chatCompletionsMaxTokensParam: "max_completion_tokens",
      chatCompletionsExtraBody: {},
      timeoutMs: 120000,
      fetchImpl: defaultFetch,
      ...opts,
    };
    this.name = this.opts.providerName;
  }

  async chat(req: LlmChatRequest): Promise<LlmChatResponse> {
    if (this.opts.wireApi === "responses") return await this.responsesChat(req);
    return await this.chatCompletions(req);
  }

  private async chatCompletions(req: LlmChatRequest): Promise<LlmChatResponse> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (req.system) messages.push({ role: "system", content: req.system });
    messages.push({ role: "user", content: req.user });

    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages,
    };
    if (req.maxTokens !== undefined) body[this.opts.chatCompletionsMaxTokensParam] = req.maxTokens;
    if (this.opts.includeReasoningEffort && this.opts.reasoningEffort) body.reasoning_effort = this.opts.reasoningEffort;
    if (this.opts.includeTemperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json) body.response_format = { type: "json_object" };
    Object.assign(body, this.opts.chatCompletionsExtraBody);

    const resp = await fetchWithTimeout(this.opts.fetchImpl, `${this.opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    }, req.timeoutMs ?? this.opts.timeoutMs, "OpenAI-compatible chat", req.signal);
    if (!resp.ok) throw new Error(`OpenAI-compatible chat ${resp.status}: ${await resp.text()}`);

    const data = await resp.json() as {
      choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    const choice = data.choices?.[0];
    return {
      content: stripSpecialTokens(choice?.message?.content ?? ""),
      reasoning: choice?.message?.reasoning_content,
      usage: data.usage
        ? {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
        : undefined,
    };
  }

  private async responsesChat(req: LlmChatRequest): Promise<LlmChatResponse> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      input: req.user,
      store: false,
      reasoning: { effort: this.opts.reasoningEffort },
      tool_choice: "none",
      tools: [],
    };
    if (req.system) body.instructions = req.system;
    if (req.maxTokens !== undefined) body.max_output_tokens = req.maxTokens;
    if (this.opts.includeTemperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (req.json) {
      body.text = { format: { type: "json_object" } };
    }

    const resp = await fetchWithTimeout(this.opts.fetchImpl, `${this.opts.baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.opts.apiKey}`,
      },
      body: JSON.stringify(body),
    }, req.timeoutMs ?? this.opts.timeoutMs, "OpenAI-compatible responses", req.signal);
    if (!resp.ok) throw new Error(`OpenAI-compatible responses ${resp.status}: ${await resp.text()}`);

    const data = await resp.json() as {
      output_text?: string;
      output?: Array<{
        type?: string;
        content?: Array<{ type?: string; text?: string }>;
        summary?: Array<{ text?: string }>;
      }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
      reasoning?: { summary?: Array<{ text?: string }> | string | null };
    };
    return {
      content: extractResponseText(data),
      reasoning: extractResponseReasoning(data),
      usage: data.usage
        ? {
          promptTokens: data.usage.input_tokens ?? 0,
          completionTokens: data.usage.output_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        }
        : undefined,
    };
  }
}

const defaultFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit,
  timeoutMs: number,
  label: string,
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
    if (externalSignal?.aborted) {
      throw abortError(externalSignal, `${label} aborted`);
    }
    const err = e as Error & { cause?: { code?: string; message?: string } };
    const cause = err.cause ? ` cause=${err.cause.code ?? ""} ${err.cause.message ?? ""}`.trim() : "";
    throw new Error(`${label} fetch failed: ${err.message}${cause ? ` (${cause})` : ""}`);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function extractResponseText(data: {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
}): string {
  if (typeof data.output_text === "string") return stripSpecialTokens(data.output_text);
  return stripSpecialTokens(
    (data.output ?? [])
      .flatMap((item) => item.content ?? [])
      .filter((part) => part.type === "output_text" || typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("\n"),
  );
}

/**
 * Strip non-printable and zero-width Unicode characters that some models
 * (MiniMax, Qwen, etc.) inject into their output and that break JSON parsing.
 *
 * Strategy: remove any character outside the "printable ASCII + common Unicode"
 * range.  This is model-agnostic — no per-vendor token list to maintain.
 */
function stripSpecialTokens(text: string): string {
  return Array.from(text).filter((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const disallowedControl = (codePoint <= 0x1f && ![0x09, 0x0a, 0x0d].includes(codePoint))
      || (codePoint >= 0x7f && codePoint <= 0x9f);
    const disallowedZeroWidth = (codePoint >= 0x200b && codePoint <= 0x200f)
      || (codePoint >= 0x2028 && codePoint <= 0x202f)
      || codePoint === 0xfeff;
    return !disallowedControl && !disallowedZeroWidth;
  }).join("");
}

function extractResponseReasoning(data: {
  output?: Array<{ type?: string; summary?: Array<{ text?: string }> }>;
  reasoning?: { summary?: Array<{ text?: string }> | string | null };
}): string | undefined {
  if (typeof data.reasoning?.summary === "string") return data.reasoning.summary;
  if (Array.isArray(data.reasoning?.summary)) {
    const text = data.reasoning.summary.map((x) => x.text ?? "").filter(Boolean).join("\n");
    if (text) return text;
  }
  const text = (data.output ?? [])
    .filter((item) => item.type === "reasoning")
    .flatMap((item) => item.summary ?? [])
    .map((x) => x.text ?? "")
    .filter(Boolean)
    .join("\n");
  return text || undefined;
}
