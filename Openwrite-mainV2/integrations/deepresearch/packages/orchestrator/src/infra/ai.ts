import type { LlmChatResponse } from "@deepresearch/contracts";
import { parseJsonObject } from "./json.js";

export function parseLlmJson<T>(
  phase: string,
  llmName: string,
  response: LlmChatResponse,
  fallback?: () => T,
): T {
  const parsed = parseJsonObject<T>(response.content || response.reasoning || "");
  if (parsed) return parsed;
  if (isExplicitTestLlm(llmName) && fallback) return fallback();
  throw new Error(`${phase} phase expected JSON from the LLM but received an invalid payload`);
}

export function isExplicitTestLlm(llmName: string): boolean {
  return llmName === "echo" || llmName.startsWith("echo-") || llmName.includes("testing-echo");
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

export function asNonEmptyStrings(value: unknown, fallback: string[], limit: number): string[] {
  const items = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  const out = items.length > 0 ? items : fallback;
  return out.slice(0, limit);
}
