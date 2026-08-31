import type {
  AgentRuntimeBudget,
  AgentRuntimeDecision,
  AgentRuntimeMeta,
  AgentRuntimeResult,
  AgentRuntimeStep,
  LlmChat,
  LlmChatRequest,
  LlmChatResponse,
  ToolCallResult,
  ToolDefinition,
  ToolRegistry,
  VisualResearchEvent,
} from "@deepresearch/contracts";
import { parseLlmJson } from "./infra/ai.js";
import { ProviderBudgetExceededError } from "./budget.js";

export interface RunAgentRuntimeInput {
  agent: AgentRuntimeMeta;
  llm: LlmChat;
  system: string;
  context: unknown;
  tools: ToolRegistry;
  budget: AgentRuntimeBudget;
  outputSchema?: unknown;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Maximum serialized characters retained from prior ReAct steps. */
  historyMaxChars?: number;
  /** Retry malformed structured decisions with a compact repair prompt. */
  outputRepairAttempts?: number;
  legacyEvidencePromptHints?: boolean;
  chat?: (request: LlmChatRequest) => Promise<LlmChatResponse>;
  onVisualEvent?: (event: VisualResearchEvent) => void | Promise<void>;
}

export function softHardBudget(input: AgentRuntimeBudget): AgentRuntimeBudget {
  return {
    ...input,
    targetReactSteps: budgetTarget(input.targetReactSteps, input.maxReactSteps),
    targetToolCalls: budgetTarget(input.targetToolCalls, input.maxToolCalls),
    targetSearchCalls: typeof input.maxSearchCalls === "number"
      ? budgetTarget(input.targetSearchCalls, input.maxSearchCalls)
      : undefined,
    targetFetchCalls: typeof input.maxFetchCalls === "number"
      ? budgetTarget(input.targetFetchCalls, input.maxFetchCalls)
      : undefined,
  };
}

export async function runAgentRuntime(input: RunAgentRuntimeInput): Promise<AgentRuntimeResult> {
  input = { ...input, budget: softHardBudget(input.budget) };
  const tools = await input.tools.listTools();
  const availableToolNames = new Set(tools.map((tool) => tool.toolName));
  const steps: AgentRuntimeStep[] = [];
  let toolCalls = 0;
  let searchCalls = 0;
  let fetchCalls = 0;

  await emitRuntimeVisual(input, "agent_started", "started", input.agent.title, input.agent.objective);

  for (let step = 1; step <= input.budget.maxReactSteps; step++) {
    throwIfAborted(input.signal);
    await emitRuntimeVisual(input, "agent_thinking", "thinking", `Step ${step}`, "Choosing next action.");
    let decision: AgentRuntimeDecision;
    try {
      const chat = input.chat ?? ((request: LlmChatRequest) => input.llm.chat(request));
      let response = await chat(buildChatRequest(input, tools, steps));
      let parseError: unknown;
      for (let repair = 0; ; repair += 1) {
        try {
          decision = normalizeDecision(parseLlmJson<unknown>("agent-runtime", input.llm.name, response));
          break;
        } catch (err) {
          parseError = err;
          if (repair >= Math.max(0, Math.floor(input.outputRepairAttempts ?? 0))) throw parseError;
          response = await chat(buildDecisionRepairRequest(input, tools, steps, response, repair + 1));
        }
      }
    } catch (err) {
      if (err instanceof ProviderBudgetExceededError) throw err;
      await emitRuntimeVisual(input, "error", "failed", "Agent runtime failed", errorMessage(err));
      return {
        agent: input.agent,
        status: "failed",
        steps,
        error: errorMessage(err),
      };
    }

    if (decision.action === "finish") {
      steps.push({ step, decision });
      await emitRuntimeVisual(input, "agent_message", "finished", input.agent.title, decision.thoughtSummary);
      return {
        agent: input.agent,
        status: "completed",
        steps,
        finish: decision.finish,
      };
    }

    const toolName = decision.toolName;
    if (!toolName || !availableToolNames.has(toolName)) {
      const error = toolName ? `Tool is not allowed: ${toolName}` : "Tool action requires toolName";
      steps.push({ step, decision, toolResult: { toolName: toolName ?? "unknown", ok: false, error } });
      await emitRuntimeVisual(input, "error", "failed", "Tool rejected", error);
      return { agent: input.agent, status: "failed", steps, error };
    }

    const guidance = buildBudgetStatus(input.budget, steps).guidance as { mustFinishNow: boolean };
    const finalPersistenceTool = ["save_knowledge_node", "link_evidence", "harvest_counted_rows"].includes(toolName);
    if (guidance.mustFinishNow && !finalPersistenceTool) {
      const error = `Agent must finish at the target budget; refusing non-persistence tool ${toolName}`;
      steps.push({ step, decision, toolResult: { toolName, ok: false, error } });
      await emitRuntimeVisual(input, "error", "failed", "Target budget reached", error);
      return { agent: input.agent, status: "budget_exceeded", steps, error };
    }

    const budgetError = nextToolBudgetError(toolName, input.budget, { toolCalls, searchCalls, fetchCalls });
    if (budgetError) {
      steps.push({ step, decision, toolResult: { toolName, ok: false, error: budgetError } });
      await emitRuntimeVisual(input, "error", "failed", "Budget exceeded", budgetError);
      return { agent: input.agent, status: "budget_exceeded", steps, error: budgetError };
    }

    await emitRuntimeVisual(input, "tool_started", "thinking", toolName, decision.thoughtSummary);
    const startedAt = Date.now();
    let toolResult: ToolCallResult;
    try {
      toolResult = await input.tools.invoke({
        toolName,
        args: decision.args ?? {},
        agentRunId: input.agent.agentRunId,
        taskId: input.agent.taskId,
        reportNodeId: input.agent.reportNodeId,
      });
    } catch (err) {
      if (err instanceof ProviderBudgetExceededError) throw err;
      toolResult = {
        toolName,
        ok: false,
        error: errorMessage(err),
        durationMs: Date.now() - startedAt,
      };
    }
    toolCalls += 1;
    if (toolName === "web_search") searchCalls += 1;
    if (toolName === "fetch_page") fetchCalls += 1;
    steps.push({ step, decision, toolResult });
    await emitRuntimeVisual(input, "tool_finished", toolResult.ok ? "finished" : "failed", toolName, toolResult.ok ? undefined : toolResult.error, toolResult);
    if (!toolResult.ok) {
      if (step < input.budget.maxReactSteps && isRecoverableToolError(toolResult.error)) continue;
      return {
        agent: input.agent,
        status: "failed",
        steps,
        error: toolResult.error ?? `Tool failed: ${toolName}`,
      };
    }
  }

  const error = `Agent runtime exceeded maxReactSteps=${input.budget.maxReactSteps}`;
  await emitRuntimeVisual(input, "error", "failed", "Budget exceeded", error);
  return {
    agent: input.agent,
    status: "budget_exceeded",
    steps,
    error,
  };
}

function buildDecisionRepairRequest(
  input: RunAgentRuntimeInput,
  tools: ToolDefinition[],
  steps: AgentRuntimeStep[],
  invalidResponse: LlmChatResponse,
  attempt: number,
): LlmChatRequest {
  const invalid = truncateRuntimeString(invalidResponse.content || invalidResponse.reasoning || "", 6_000) ?? "";
  return {
    system: "Repair one malformed DeepResearch AgentRuntime decision. Return strict JSON only. Do not add facts or prose outside the JSON object.",
    user: `Repair attempt ${attempt}.

Agent objective:
${input.agent.objective}

Available tools:
${JSON.stringify(tools.map((tool) => ({ toolName: tool.toolName, description: tool.description })), null, 2)}

Recent runtime history:
${serializeRuntimeHistory(steps, 2_000)}

Runtime budget status:
${JSON.stringify(buildBudgetStatus(input.budget, steps), null, 2)}

Final output schema:
${JSON.stringify(input.outputSchema ?? {}, null, 2)}

Previous malformed response:
${invalid || "[empty response]"}

Return exactly one complete JSON object:
{"thoughtSummary":string,"action":"tool"|"finish","toolName":string,"args":object,"finish":object}`,
    json: true,
    model: input.model,
    temperature: 0,
    maxTokens: Math.min(input.maxTokens ?? 8_192, 8_192),
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  };
}

function buildChatRequest(input: RunAgentRuntimeInput, tools: ToolDefinition[], steps: AgentRuntimeStep[]): LlmChatRequest {
  const budgetStatus = buildBudgetStatus(input.budget, steps);
  const runtimeInstruction = steps.length === 0
    ? "First decide whether to call a tool or finish."
    : "Use the previous tool observations to decide the next tool call or finish.";
  const legacyInstruction = input.legacyEvidencePromptHints
    ? steps.length === 0
      ? `${runtimeInstruction} For legacy test providers, this is equivalent to: Create a search plan for this evidence task.`
      : `${runtimeInstruction} For legacy test providers, this is equivalent to: Assess the search observations for this evidence task.`
    : runtimeInstruction;
  const rawInstruction = rawContextInstruction(input.context);
  return {
    system: `${input.system}

HARD RUNTIME BUDGET RULES:
- Treat hard runtime limits as a strict contract, not as background metadata.
- Treat target budget as the expected completion budget: plan to finish by targetReactSteps/targetToolCalls/targetFetchCalls. The hard error limit is only a safety buffer.
- Before choosing a tool, check the remaining budget shown in the user message.
- Never call a tool whose remaining call budget is 0.
- If guidance.mustFinishNow or guidance.pastTargetBudget is true, return action="finish" now using the best partial result and explicit open gaps unless one final save_knowledge_node/link_evidence call is strictly necessary.
- If fetch_page remaining calls are low, prefer saving/linking already observed evidence or finishing over opening another page.
- If context.relevantEvidence already contains a source that supports the current task, prefer link_evidence with that knowledgeNodeId over repeating web_search or fetch_page for the same source.
- Treat KnowledgeNode summaries as usable evidence previews. Only fetch_page an already-known URL when the summary is too thin for the specific claim.
- If guidance.repeatingSameToolCall is true, do not repeat that same tool call again. Choose a different tool, save/link current evidence, or finish with an open gap.
- If the previous tool observation has ok=false, fix the tool arguments, choose a different tool, or finish with an explicit gap; do not repeat the same invalid call.
- Finish early once the task has enough usable evidence; do not keep browsing just to improve coverage.`,
    user: `You are running inside the DeepResearch AgentRuntime.
${legacyInstruction}

Agent:
${JSON.stringify(input.agent, null, 2)}

${rawInstruction ? `Instruction:\n${rawInstruction}\n\n` : ""}Context:
${JSON.stringify(input.context, null, 2)}

Available tools:
${JSON.stringify(tools, null, 2)}

Previous steps:
${serializeRuntimeHistory(steps, input.historyMaxChars)}

Runtime budget status:
${JSON.stringify(budgetStatus, null, 2)}

Configured budget:
${JSON.stringify(input.budget, null, 2)}

Final output schema:
${JSON.stringify(input.outputSchema ?? {}, null, 2)}

Return exactly one JSON object:
{"thoughtSummary":string,"action":"tool"|"finish","toolName":string,"args":object,"finish":object}`,
    json: true,
    model: input.model,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
    timeoutMs: input.timeoutMs,
    signal: input.signal,
  };
}

export function serializeRuntimeHistory(steps: AgentRuntimeStep[], maxChars?: number): string {
  const full = JSON.stringify(steps, null, 2);
  if (maxChars === undefined || full.length <= maxChars || steps.length === 0) return full;
  const limit = Math.max(512, Math.floor(maxChars));
  let omittedStepCount = 0;
  const compacted = steps.map(minimalRuntimeStep);
  let serialized = compactedHistory(compacted, steps.length, omittedStepCount);

  while (serialized.length > limit && compacted.length > 1) {
    compacted.shift();
    omittedStepCount += 1;
    serialized = compactedHistory(compacted, steps.length, omittedStepCount);
  }

  const maxStringChars = Math.max(512, Math.min(12_000, Math.floor(limit / 2)));
  for (let index = steps.length - 1; index >= omittedStepCount; index--) {
    const compactedIndex = index - omittedStepCount;
    const previous = compacted[compactedIndex];
    compacted[compactedIndex] = detailedRuntimeStep(steps[index]!, maxStringChars);
    const candidate = compactedHistory(compacted, steps.length, omittedStepCount);
    if (candidate.length <= limit) serialized = candidate;
    else compacted[compactedIndex] = previous!;
  }

  if (serialized.length <= limit) return serialized;
  return JSON.stringify({
    historyCompacted: true,
    originalStepCount: steps.length,
    omittedStepCount: Math.max(0, steps.length - 1),
    steps: [minimalRuntimeStep(steps.at(-1)!)],
  });
}

function compactedHistory(steps: unknown[], originalStepCount: number, omittedStepCount: number): string {
  return JSON.stringify({ historyCompacted: true, originalStepCount, omittedStepCount, steps }, null, 2);
}

function minimalRuntimeStep(step: AgentRuntimeStep): Record<string, unknown> {
  return {
    step: step.step,
    decision: {
      thoughtSummary: truncateRuntimeString(step.decision.thoughtSummary, 240),
      action: step.decision.action,
      toolName: step.decision.toolName,
      args: compactRuntimeValue(step.decision.args, 320, 2, 5),
    },
    toolResult: step.toolResult ? {
      toolName: step.toolResult.toolName,
      ok: step.toolResult.ok,
      error: truncateRuntimeString(step.toolResult.error, 320),
      durationMs: step.toolResult.durationMs,
      retainedIdentifiers: runtimeIdentifiers(step.toolResult.output),
    } : undefined,
  };
}

function detailedRuntimeStep(step: AgentRuntimeStep, maxStringChars: number): Record<string, unknown> {
  return {
    step: step.step,
    decision: {
      ...step.decision,
      thoughtSummary: truncateRuntimeString(step.decision.thoughtSummary, 600),
      args: compactRuntimeValue(step.decision.args, 1200, 4, 12),
    },
    toolResult: step.toolResult ? {
      ...step.toolResult,
      error: truncateRuntimeString(step.toolResult.error, 600),
      output: compactRuntimeValue(step.toolResult.output, maxStringChars, 6, 20),
    } : undefined,
  };
}

function compactRuntimeValue(value: unknown, maxStringChars: number, depth: number, maxArrayItems: number): unknown {
  if (typeof value === "string") return truncateRuntimeString(value, maxStringChars);
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "[object omitted at depth limit]";
  if (Array.isArray(value)) {
    const items: unknown[] = value.slice(0, maxArrayItems).map((item) => compactRuntimeValue(item, maxStringChars, depth - 1, maxArrayItems));
    if (value.length > maxArrayItems) items.push(`[${value.length - maxArrayItems} more items omitted]`);
    return items;
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [
    key,
    compactRuntimeValue(item, maxStringChars, depth - 1, maxArrayItems),
  ]));
}

function runtimeIdentifiers(value: unknown): Record<string, string[]> | undefined {
  const ids = new Set<string>();
  const urls = new Set<string>();
  collectRuntimeIdentifiers(value, ids, urls, 0);
  if (ids.size === 0 && urls.size === 0) return undefined;
  return { ids: [...ids].slice(0, 20), urls: [...urls].slice(0, 12) };
}

function collectRuntimeIdentifiers(value: unknown, ids: Set<string>, urls: Set<string>, depth: number): void {
  if (depth > 6 || value === null || value === undefined) return;
  if (typeof value === "string") {
    for (const match of value.matchAll(/\b(?:E|K|RL)_[A-Za-z0-9._-]+\b/g)) ids.add(match[0]);
    for (const match of value.matchAll(/https?:\/\/[^\s"'<>]+/g)) urls.add(match[0]);
    return;
  }
  if (typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 30)) collectRuntimeIdentifiers(item, ids, urls, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "string" && /(?:^|_)(?:id|url)$/i.test(key)) {
      if (/url/i.test(key)) urls.add(item);
      else ids.add(item);
    }
    collectRuntimeIdentifiers(item, ids, urls, depth + 1);
  }
}

function truncateRuntimeString(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined || value.length <= maxChars) return value;
  const head = Math.max(1, Math.floor(maxChars * 0.75));
  const tail = Math.max(1, maxChars - head);
  return `${value.slice(0, head)}\n...[${value.length - maxChars} chars omitted]...\n${value.slice(-tail)}`;
}

function buildBudgetStatus(budget: AgentRuntimeBudget, steps: AgentRuntimeStep[]): Record<string, unknown> {
  const usedToolCalls = steps.filter((step) => step.toolResult).length;
  const usedSearchCalls = steps.filter((step) => step.toolResult?.toolName === "web_search").length;
  const usedFetchCalls = steps.filter((step) => step.toolResult?.toolName === "fetch_page").length;
  const targetReactSteps = boundedTarget(budget.targetReactSteps, budget.maxReactSteps);
  const targetToolCalls = boundedTarget(budget.targetToolCalls, budget.maxToolCalls);
  const targetSearchCalls = typeof budget.maxSearchCalls === "number"
    ? boundedTarget(budget.targetSearchCalls, budget.maxSearchCalls)
    : undefined;
  const targetFetchCalls = typeof budget.maxFetchCalls === "number"
    ? boundedTarget(budget.targetFetchCalls, budget.maxFetchCalls)
    : undefined;
  const remainingReactSteps = Math.max(0, budget.maxReactSteps - steps.length);
  const remainingToolCalls = Math.max(0, budget.maxToolCalls - usedToolCalls);
  const remainingSearchCalls = typeof budget.maxSearchCalls === "number"
    ? Math.max(0, budget.maxSearchCalls - usedSearchCalls)
    : undefined;
  const remainingFetchCalls = typeof budget.maxFetchCalls === "number"
    ? Math.max(0, budget.maxFetchCalls - usedFetchCalls)
    : undefined;
  const targetRemainingReactSteps = Math.max(0, targetReactSteps - steps.length);
  const targetRemainingToolCalls = Math.max(0, targetToolCalls - usedToolCalls);
  const targetRemainingSearchCalls = typeof targetSearchCalls === "number"
    ? Math.max(0, targetSearchCalls - usedSearchCalls)
    : undefined;
  const targetRemainingFetchCalls = typeof targetFetchCalls === "number"
    ? Math.max(0, targetFetchCalls - usedFetchCalls)
    : undefined;
  const repeated = repeatedToolCallStatus(steps);
  const pastTargetBudget = steps.length >= targetReactSteps
    || usedToolCalls >= targetToolCalls
    || (typeof targetSearchCalls === "number" && usedSearchCalls >= targetSearchCalls)
    || (typeof targetFetchCalls === "number" && usedFetchCalls >= targetFetchCalls);
  return {
    used: {
      reactSteps: steps.length,
      toolCalls: usedToolCalls,
      searchCalls: usedSearchCalls,
      fetchCalls: usedFetchCalls,
    },
    target: {
      reactSteps: targetReactSteps,
      toolCalls: targetToolCalls,
      searchCalls: targetSearchCalls,
      fetchCalls: targetFetchCalls,
    },
    targetRemaining: {
      reactSteps: targetRemainingReactSteps,
      toolCalls: targetRemainingToolCalls,
      searchCalls: targetRemainingSearchCalls,
      fetchCalls: targetRemainingFetchCalls,
    },
    remaining: {
      reactSteps: remainingReactSteps,
      toolCalls: remainingToolCalls,
      searchCalls: remainingSearchCalls,
      fetchCalls: remainingFetchCalls,
    },
    hardLimit: {
      reactSteps: budget.maxReactSteps,
      toolCalls: budget.maxToolCalls,
      searchCalls: budget.maxSearchCalls,
      fetchCalls: budget.maxFetchCalls,
    },
    repeated,
    guidance: {
      mustFinishNow: remainingReactSteps <= 1 || targetRemainingReactSteps <= 0,
      pastTargetBudget,
      avoidMoreTools: pastTargetBudget || remainingReactSteps <= 2 || targetRemainingReactSteps <= 1 || remainingToolCalls <= 0 || targetRemainingToolCalls <= 0,
      avoidMoreFetches: pastTargetBudget || remainingReactSteps <= 4 || targetRemainingReactSteps <= 2 || remainingFetchCalls === 0 || remainingFetchCalls === 1 || targetRemainingFetchCalls === 0 || targetRemainingFetchCalls === 1,
      repeatingSameToolCall: repeated.count >= 2,
    },
  };
}

function boundedTarget(value: number | undefined, hardLimit: number): number {
  if (hardLimit <= 0) return 0;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.max(1, Math.min(hardLimit, Math.floor(value)));
  }
  return Math.max(1, Math.floor(hardLimit / 2));
}

function budgetTarget(value: number | undefined, hardLimit: number): number {
  return boundedTarget(value, hardLimit);
}

function repeatedToolCallStatus(steps: AgentRuntimeStep[]): { count: number; toolName?: string; args?: unknown; lastError?: string } {
  const toolSteps = steps.filter((step) => step.decision.action === "tool" && step.decision.toolName);
  const last = toolSteps.at(-1);
  if (!last?.decision.toolName) return { count: 0 };
  const key = toolCallKey(last.decision.toolName, last.decision.args);
  let count = 0;
  for (let i = toolSteps.length - 1; i >= 0; i--) {
    const step = toolSteps[i]!;
    if (toolCallKey(step.decision.toolName ?? "", step.decision.args) !== key) break;
    count += 1;
  }
  return {
    count,
    toolName: last.decision.toolName,
    args: last.decision.args,
    lastError: last.toolResult?.ok === false ? last.toolResult.error : undefined,
  };
}

function toolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${stableJson(args ?? {})}`;
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(",")}}`;
}

function rawContextInstruction(context: unknown): string | undefined {
  const value = object(context).instruction;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeDecision(decision: unknown): AgentRuntimeDecision {
  const raw = object(decision);
  if (Array.isArray(raw.queries)) {
    const queries = raw.queries.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (queries.length > 0) {
      return {
        thoughtSummary: stringOr(raw.searchRationale) ?? stringOr(raw.reasoningSummary),
        action: "tool",
        toolName: "web_search",
        args: { query: queries[0] },
      };
    }
  }
  if (typeof raw.relation === "string" || typeof raw.nodeStatus === "string" || typeof raw.reasoningSummary === "string") {
    return {
      thoughtSummary: stringOr(raw.reasoningSummary),
      action: "finish",
      finish: { ...raw, __legacyAssessment: true },
    };
  }
  if ("continueDispatch" in raw || "taskUpdates" in raw || "newTasks" in raw || "skipReasons" in raw) {
    return {
      thoughtSummary: stringOr(raw.reasoningSummary) ?? "已生成全局反思调度结果。",
      action: "finish",
      finish: { ...raw, __legacyReflection: true },
    };
  }
  if ("suggestions" in raw) {
    return {
      thoughtSummary: stringOr(raw.reasoningSummary) ?? "已生成结构审查结果。",
      action: "finish",
      finish: { ...raw, __legacyStructureReview: true },
    };
  }
  const action = raw.action;
  if (action !== "tool" && action !== "finish" && object(raw.finish) && Object.keys(object(raw.finish)).length > 0) {
    return {
      thoughtSummary: stringOr(raw.thoughtSummary) ?? stringOr(raw.reasoningSummary),
      action: "finish",
      finish: raw.finish,
    };
  }
  if (action !== "tool" && action !== "finish" && typeof raw.toolName === "string") {
    return {
      thoughtSummary: stringOr(raw.thoughtSummary) ?? stringOr(raw.reasoningSummary),
      action: "tool",
      toolName: stringOr(raw.toolName),
      args: raw.args,
    };
  }
  if (action !== "tool" && action !== "finish") {
    throw new Error("AgentRuntime decision.action must be tool or finish");
  }
  return {
    thoughtSummary: stringOr(raw.thoughtSummary),
    action,
    toolName: stringOr(raw.toolName),
    args: raw.args,
    finish: raw.finish,
  };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOr(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function nextToolBudgetError(
  toolName: string,
  budget: AgentRuntimeBudget,
  counts: { toolCalls: number; searchCalls: number; fetchCalls: number },
): string | undefined {
  if (counts.toolCalls >= budget.maxToolCalls) return `Agent runtime exceeded maxToolCalls=${budget.maxToolCalls}`;
  if (toolName === "web_search" && typeof budget.maxSearchCalls === "number" && counts.searchCalls >= budget.maxSearchCalls) {
    return `Agent runtime exceeded maxSearchCalls=${budget.maxSearchCalls}`;
  }
  if (toolName === "fetch_page" && typeof budget.maxFetchCalls === "number" && counts.fetchCalls >= budget.maxFetchCalls) {
    return `Agent runtime exceeded maxFetchCalls=${budget.maxFetchCalls}`;
  }
  return undefined;
}

function isRecoverableToolError(error: unknown): boolean {
  const message = String(error || "");
  if (!message) return false;
  if (/request failed|search failure|AbortError|timeout|timed out|ECONN|ENOTFOUND|EAI_AGAIN/i.test(message)) return false;
  return /\b(is required|must be|invalid|missing)\b|KnowledgeNode not found/i.test(message);
}

async function emitRuntimeVisual(
  input: RunAgentRuntimeInput,
  kind: VisualResearchEvent["kind"],
  state: "started" | "thinking" | "finished" | "failed",
  title: string,
  summary?: string,
  payload?: unknown,
): Promise<void> {
  if (!input.onVisualEvent) return;
  await input.onVisualEvent({
    eventId: `VR_${input.agent.agentRunId}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    episodeId: input.agent.episodeId ?? "EP_unknown",
    timestamp: new Date().toISOString(),
    kind,
    actor: {
      agentRunId: input.agent.agentRunId,
      role: input.agent.role,
      title: input.agent.title,
      taskId: input.agent.taskId,
      reportNodeId: input.agent.reportNodeId,
      parentAgentRunId: input.agent.parentAgentRunId,
    },
    ui: {
      lane: laneForRole(input.agent.role),
      severity: state === "failed" ? "error" : state === "finished" ? "success" : "info",
      title,
      summary,
      collapsible: kind === "agent_thinking",
      initiallyCollapsed: kind === "agent_thinking",
    },
    budget: {
      maxReactSteps: input.budget.maxReactSteps,
      maxToolCalls: input.budget.maxToolCalls,
      maxSearchCalls: input.budget.maxSearchCalls,
      maxFetchCalls: input.budget.maxFetchCalls,
      targetReactSteps: input.budget.targetReactSteps,
      targetToolCalls: input.budget.targetToolCalls,
      targetSearchCalls: input.budget.targetSearchCalls,
      targetFetchCalls: input.budget.targetFetchCalls,
    },
    payload,
  });
}

function laneForRole(role: string): VisualResearchEvent["ui"]["lane"] {
  if (role === "reporter") return "writer";
  if (role === "system") return "system";
  if (role === "main_dispatcher") return "main";
  return "agent";
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw new Error(typeof reason === "string" ? reason : "Agent runtime aborted");
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
