// @deepresearch/embedding-providers
// Embedding providers: FeatureHashEmbedding（本地哈希）/ OpenAICompatibleEmbeddingProvider / LlmRerankProvider
// LLM providers: DeepSeekChat / OpenAICompatibleChat / EchoLlmChat（测试用）

export { FeatureHashEmbedding, type FeatureHashEmbeddingOptions } from "./providers/feature-hash-embedding.js";
export { OpenAICompatibleEmbeddingProvider, type OpenAICompatibleEmbeddingProviderOptions } from "./providers/openai-compatible.js";
export { LlmRerankProvider, type LlmRerankProviderOptions } from "./providers/llm-rerank.js";
export { DeepSeekChat, type DeepSeekChatOptions } from "./providers/deepseek-chat.js";
export { EchoLlmChat, type EchoLlmChatOptions } from "./providers/echo-llm.js";
export { OpenAICompatibleChat, type OpenAICompatibleChatOptions } from "./providers/openai-compatible-chat.js";
export { featureHash, cosine, fnv1a, tokenize, stableId } from "./internal/feature-hash.js";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EmbeddingService, LlmChat } from "@deepresearch/contracts";
import { FeatureHashEmbedding, type FeatureHashEmbeddingOptions } from "./providers/feature-hash-embedding.js";
import { OpenAICompatibleEmbeddingProvider, type OpenAICompatibleEmbeddingProviderOptions } from "./providers/openai-compatible.js";
import { LlmRerankProvider, type LlmRerankProviderOptions } from "./providers/llm-rerank.js";
import { DeepSeekChat, type DeepSeekChatOptions } from "./providers/deepseek-chat.js";
import { OpenAICompatibleChat, type OpenAICompatibleChatOptions } from "./providers/openai-compatible-chat.js";
import { EchoLlmChat, type EchoLlmChatOptions } from "./providers/echo-llm.js";

export type EmbeddingProviderConfig =
  | { kind: "feature-hash"; options?: FeatureHashEmbeddingOptions }
  | { kind: "openai-compatible"; options: OpenAICompatibleEmbeddingProviderOptions }
  | { kind: "llm-rerank"; options: LlmRerankProviderOptions };

/** 工厂：从统一 config 创建 EmbeddingService。例：createEmbeddingProvider({ kind: "feature-hash" }) */
export function createEmbeddingProvider(cfg: EmbeddingProviderConfig): EmbeddingService {
  switch (cfg.kind) {
    case "feature-hash":
      return new FeatureHashEmbedding(cfg.options);
    case "openai-compatible":
      return new OpenAICompatibleEmbeddingProvider(cfg.options);
    case "llm-rerank":
      return new LlmRerankProvider(cfg.options);
    default: {
      const exhaustive: never = cfg;
      throw new Error(`createEmbeddingProvider: unknown kind ${String(exhaustive)}`);
    }
  }
}

// ---------- LlmChat 工厂 ----------

export type LlmChatConfig =
  | { provider: "deepseek"; options?: DeepSeekChatOptions }
  | { provider: "bigmodel"; options?: OpenAICompatibleChatOptions }
  | { provider: "openai"; options: OpenAICompatibleChatOptions }
  | { provider: "echo"; options?: EchoLlmChatOptions };

/** 工厂：从统一 config 创建 LlmChat。例：createLlmChat({ provider: "echo" }) */
export function createLlmChat(cfg: LlmChatConfig): LlmChat {
  switch (cfg.provider) {
    case "deepseek":
      return new DeepSeekChat(cfg.options ?? { apiKey: "" });
    case "bigmodel":
      return new OpenAICompatibleChat({
        apiKey: "",
        ...cfg.options,
        providerName: cfg.options?.providerName ?? "bigmodel",
        baseUrl: cfg.options?.baseUrl ?? "https://open.bigmodel.cn/api/paas/v4",
        model: cfg.options?.model ?? "glm-4.7-flash",
        includeReasoningEffort: cfg.options?.includeReasoningEffort ?? false,
        includeTemperature: cfg.options?.includeTemperature ?? true,
        chatCompletionsMaxTokensParam: cfg.options?.chatCompletionsMaxTokensParam ?? "max_tokens",
        chatCompletionsExtraBody: cfg.options?.chatCompletionsExtraBody ?? { thinking: { type: "disabled" } },
      });
    case "openai":
      return new OpenAICompatibleChat(cfg.options);
    case "echo":
      return new EchoLlmChat(cfg.options);
    default: {
      const exhaustive: never = cfg;
      throw new Error(`createLlmChat: unknown provider ${String(exhaustive)}`);
    }
  }
}

export interface LlmChatEnvConfig {
  env: NodeJS.ProcessEnv;
  /** CLI --llm 参数，优先于 env.AGENT_PROVIDER */
  providerOverride?: string;
  /** 可选：从 .env/.env.local 读取默认值，低于 env 现有值。 */
  cwd?: string;
  /** Set false when the caller has already loaded and merged its environment. */
  loadEnvFile?: boolean;
}

/** 从环境变量创建 LlmChat。优先读 providerOverride / env.AGENT_PROVIDER，缺省 bigmodel。 */
export function createLlmChatFromEnv(cfg: LlmChatEnvConfig): LlmChat {
  const env = cfg.loadEnvFile === false ? { ...cfg.env } : mergeEnv(cfg.env, cfg.cwd);
  const provider = (cfg.providerOverride ?? env.AGENT_PROVIDER ?? "bigmodel").toLowerCase();
  switch (provider) {
    case "deepseek": {
      const apiKey = env.DEEPSEEK_API_KEY;
      if (!apiKey) throw new Error("DEEPSEEK_API_KEY is required");
      return new DeepSeekChat({
        apiKey,
        baseUrl: env.DEEPSEEK_BASE_URL,
        model: env.DEEPSEEK_MODEL ?? "deepseek-chat",
        timeoutMs: 300000,
        retry: envNumber(env.DEEPSEEK_RETRY, 1),
        maxTokensFallback: envNumber(env.DEEPSEEK_MAX_TOKENS_FALLBACK, 8192),
      });
    }
    case "bigmodel":
    case "zhipu":
    case "glm": {
      const apiKey = env.BIGMODEL_API_KEY ?? env.ZHIPU_API_KEY;
      if (!apiKey) throw new Error("BIGMODEL_API_KEY is required");
      return new OpenAICompatibleChat({
        apiKey,
        providerName: "bigmodel",
        baseUrl: env.BIGMODEL_BASE_URL ?? "https://open.bigmodel.cn/api/paas/v4",
        model: env.BIGMODEL_MODEL ?? env.AGENT_MODEL ?? "glm-4.7-flash",
        wireApi: "chat_completions",
        includeReasoningEffort: false,
        includeTemperature: true,
        chatCompletionsMaxTokensParam: "max_tokens",
        chatCompletionsExtraBody: { thinking: { type: "disabled" } },
        timeoutMs: 300000,
      });
    }
    case "openai":
    case "custom": {
      const apiKey = env.OPENAI_API_KEY;
      if (!apiKey) throw new Error("OPENAI_API_KEY is required");
      return new OpenAICompatibleChat({
        apiKey,
        baseUrl: env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        model: env.AGENT_MODEL ?? "gpt-5.5",
        wireApi: (env.OPENAI_WIRE_API as "chat_completions" | "responses" | undefined) ?? "chat_completions",
        reasoningEffort: (env.AGENT_REASONING_EFFORT as "low" | "medium" | "high" | undefined) ?? "low",
        timeoutMs: 300000,
      });
    }
    case "echo":
      return new EchoLlmChat();
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}

function mergeEnv(env: NodeJS.ProcessEnv, cwd?: string): NodeJS.ProcessEnv {
  const merged = { ...env, ...readEnvFile(resolveEnvPath(cwd)) };
  return merged;
}

function resolveEnvPath(cwd?: string): string | undefined {
  const root = cwd ?? process.cwd();
  const candidates = [".env.local", ".env"];
  for (const name of candidates) {
    const file = resolve(root, name);
    if (existsSync(file)) return file;
  }
  return undefined;
}

function readEnvFile(path?: string): NodeJS.ProcessEnv {
  if (!path) return {};
  const out: NodeJS.ProcessEnv = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (out[key] === undefined) out[key] = value;
  }
  return out;
}

function envNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
