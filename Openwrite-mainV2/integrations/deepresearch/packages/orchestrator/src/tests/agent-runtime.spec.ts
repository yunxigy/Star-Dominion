import { describe, expect, it } from "vitest";
import type { AgentRuntimeStep, LlmChat, ToolRegistry } from "@deepresearch/contracts";
import { runAgentRuntime, serializeRuntimeHistory } from "../agent-runtime.js";

describe("runAgentRuntime", () => {
  it("finishes when the model returns a finish action", async () => {
    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "done", action: "finish", finish: { ok: true } },
      ]),
      system: "system",
      context: { task: "test" },
      tools: emptyTools(),
      budget: { maxReactSteps: 2, maxToolCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(result.finish).toEqual({ ok: true });
    expect(result.steps).toHaveLength(1);
  });

  it("treats a missing action with finish payload as finish", async () => {
    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "done", finish: { ok: true } },
      ]),
      system: "system",
      context: { task: "test" },
      tools: emptyTools(),
      budget: { maxReactSteps: 2, maxToolCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(result.finish).toEqual({ ok: true });
  });

  it("treats a missing action with toolName as a tool call", async () => {
    const calls: unknown[] = [];
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "web_search", description: "search" }],
      invoke: async (req) => {
        calls.push(req);
        return { toolName: req.toolName, ok: true, output: { results: [] } };
      },
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "search", toolName: "web_search", args: { query: "q" } },
        { thoughtSummary: "done", action: "finish", finish: { ok: true } },
      ]),
      system: "system",
      context: { task: "test" },
      tools,
      budget: { maxReactSteps: 3, maxToolCalls: 2, maxSearchCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(1);
  });

  it("invokes an allowed tool and then finishes", async () => {
    const calls: unknown[] = [];
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "web_search", description: "search" }],
      invoke: async (req) => {
        calls.push(req);
        return { toolName: req.toolName, ok: true, output: { results: ["one"] } };
      },
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "need search", action: "tool", toolName: "web_search", args: { query: "q" } },
        { thoughtSummary: "done", action: "finish", finish: { answer: "ok" } },
      ]),
      system: "system",
      context: { task: "test" },
      tools,
      budget: { maxReactSteps: 3, maxToolCalls: 2, maxSearchCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(calls).toHaveLength(1);
    expect(result.steps[0]?.toolResult?.ok).toBe(true);
  });

  it("lets the agent recover from a failed tool observation", async () => {
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "save_knowledge_node", description: "save source" }],
      invoke: async (req) => ({ toolName: req.toolName, ok: false, error: "url is required" }),
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "try save", action: "tool", toolName: "save_knowledge_node", args: { title: "Missing URL" } },
        { thoughtSummary: "record gap instead of failing", action: "finish", finish: { openGaps: ["Need a source URL."] } },
      ]),
      system: "system",
      context: { task: "test" },
      tools,
      budget: { maxReactSteps: 3, maxToolCalls: 2 },
    });

    expect(result.status).toBe("completed");
    expect(result.steps[0]?.toolResult).toMatchObject({ ok: false, error: "url is required" });
    expect(result.finish).toEqual({ openGaps: ["Need a source URL."] });
  });

  it("returns budget_exceeded before invoking over-budget tools", async () => {
    let calls = 0;
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "web_search", description: "search" }],
      invoke: async (req) => {
        calls += 1;
        return { toolName: req.toolName, ok: true };
      },
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: scriptedLlm([
        { thoughtSummary: "search", action: "tool", toolName: "web_search", args: { query: "q" } },
      ]),
      system: "system",
      context: {},
      tools,
      budget: { maxReactSteps: 2, maxToolCalls: 0, maxSearchCalls: 0 },
    });

    expect(result.status).toBe("budget_exceeded");
    expect(calls).toBe(0);
    expect(result.error).toContain("maxToolCalls=0");
  });

  it("injects runtime budget rules and remaining budget into model requests", async () => {
    const requests: Array<{ system: string; user: string }> = [];
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "fetch_page", description: "fetch" }],
      invoke: async (req) => ({ toolName: req.toolName, ok: true, output: { ok: true } }),
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: {
        name: "inspect-budget-prompt",
        async chat(req) {
          requests.push({ system: req.system ?? "", user: req.user });
          return requests.length === 1
            ? { content: JSON.stringify({ thoughtSummary: "fetch once", action: "tool", toolName: "fetch_page", args: { url: "https://example.test" } }) }
            : { content: JSON.stringify({ thoughtSummary: "finish before budget", action: "finish", finish: { ok: true } }) };
        },
      },
      system: "system",
      context: {},
      tools,
      budget: { maxReactSteps: 2, maxToolCalls: 2, maxFetchCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(requests[0]?.system).toContain("HARD RUNTIME BUDGET RULES");
    expect(requests[0]?.user).toContain("Runtime budget status");
    expect(requests[0]?.user).toContain('"target"');
    expect(requests[0]?.user).toContain('"hardLimit"');
    expect(requests[0]?.user).toContain('"fetchCalls": 1');
    expect(requests[1]?.user).toContain('"mustFinishNow": true');
    expect(requests[1]?.user).toContain('"fetchCalls": 0');
  });

  it("injects soft target budget and repeated tool-call guidance", async () => {
    const requests: Array<{ user: string }> = [];
    const tools: ToolRegistry = {
      listTools: () => [{ toolName: "fetch_page", description: "fetch" }],
      invoke: async (req) => ({ toolName: req.toolName, ok: true, output: { ok: true } }),
    };

    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: {
        name: "repeat-fetch",
        async chat(req) {
          requests.push({ user: req.user });
          return requests.length <= 3
            ? { content: JSON.stringify({ thoughtSummary: "repeat", action: "tool", toolName: "fetch_page", args: { url: "https://example.test/a" } }) }
            : { content: JSON.stringify({ thoughtSummary: "stop", action: "finish", finish: { ok: true } }) };
        },
      },
      system: "system",
      context: {},
      tools,
      budget: { targetReactSteps: 3, maxReactSteps: 6, targetFetchCalls: 2, maxFetchCalls: 4, maxToolCalls: 6 },
    });

    expect(result.status).toBe("completed");
    expect(requests[0]?.user).toContain('"reactSteps": 3');
    expect(requests[0]?.user).toContain('"hardLimit"');
    expect(requests[2]?.user).toContain('"repeatingSameToolCall": true');
    expect(requests[3]?.user).toContain('"pastTargetBudget": true');
  });

  it("bounds repeated ReAct history while retaining source identifiers", () => {
    const steps: AgentRuntimeStep[] = Array.from({ length: 8 }, (_, index) => ({
      step: index + 1,
      decision: {
        thoughtSummary: `Inspect source ${index + 1}`,
        action: "tool",
        toolName: "fetch_page",
        args: { url: `https://example.test/${index + 1}` },
      },
      toolResult: {
        toolName: "fetch_page",
        ok: true,
        output: {
          url: `https://example.test/${index + 1}`,
          content: `${"source content ".repeat(8_000)} E_saved_${index + 1}`,
        },
      },
    }));

    const serialized = serializeRuntimeHistory(steps, 5_000);

    expect(serialized.length).toBeLessThanOrEqual(5_000);
    expect(serialized).toContain('"historyCompacted": true');
    expect(serialized).toContain("E_saved_8");
    expect(serialized).toContain("https://example.test/8");
  });

  it("repairs malformed decisions with a compact structured prompt", async () => {
    const requests: Array<{ system?: string; user: string; maxTokens?: number }> = [];
    const result = await runAgentRuntime({
      agent: agentMeta(),
      llm: {
        name: "repair-malformed-output",
        async chat(req) {
          requests.push({ system: req.system, user: req.user, maxTokens: req.maxTokens });
          if (requests.length === 1) return { content: '{"thoughtSummary":"done","action":"finish", MALFORMED_FRAGMENT' };
          return { content: JSON.stringify({ thoughtSummary: "repaired", action: "finish", finish: { answer: "ok" } }) };
        },
      },
      system: "system",
      context: { payload: `FULL_CONTEXT_SECRET_${"x".repeat(20_000)}` },
      outputSchema: { answer: "string" },
      outputRepairAttempts: 1,
      tools: emptyTools(),
      budget: { maxReactSteps: 2, maxToolCalls: 1 },
    });

    expect(result.status).toBe("completed");
    expect(result.finish).toEqual({ answer: "ok" });
    expect(requests).toHaveLength(2);
    expect(requests[1]?.system).toContain("Repair one malformed");
    expect(requests[1]?.user).toContain("MALFORMED_FRAGMENT");
    expect(requests[1]?.user).toContain('"answer": "string"');
    expect(requests[1]?.user).not.toContain("FULL_CONTEXT_SECRET");
    expect(requests[1]?.maxTokens).toBe(8_192);
  });
});

function agentMeta() {
  return {
    agentId: "evidence",
    agentRunId: "A_1",
    role: "subagent" as const,
    title: "EvidenceAgent T_1",
    objective: "Find evidence",
    episodeId: "EP_test",
    taskId: "T_1",
    reportNodeId: "R_1",
  };
}

function scriptedLlm(outputs: unknown[]): LlmChat {
  let index = 0;
  return {
    name: "scripted",
    async chat() {
      const output = outputs[index++];
      return { content: JSON.stringify(output) };
    },
  };
}

function emptyTools(): ToolRegistry {
  return {
    listTools: () => [],
    invoke: async (req) => ({ toolName: req.toolName, ok: false, error: "no tools" }),
  };
}
