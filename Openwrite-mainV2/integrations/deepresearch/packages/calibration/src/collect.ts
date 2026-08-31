// 从 v5 episode state 收集 calibration 记录。这层只依赖 contracts，
// 用 duck-typing 读取 orchestrator 暴露的 state 或 _state。

import type { AgentRunResult } from "@deepresearch/contracts";
import { computeActualGain } from "./actual-gain.js";
import type { CalibrationRecord } from "./types.js";

interface V5State {
  agentResults: AgentRunResult[];
  episodeId?: string;
}

/** 任何暴露 state.agentResults 或 _state.agentResults 的 orchestrator 实例。 */
export type OrchestratorLike = { state?: V5State; _state?: V5State };

export function collectFromOrchestrator(
  orch: OrchestratorLike,
  options: {
    episodeId?: string;
    now?: () => string;
    expectedGainByAgentRunId?: Record<string, number>;
    defaultExpectedGain?: number;
  } = {},
): CalibrationRecord[] {
  const state = orch.state ?? orch._state;
  if (!state) return [];
  const now = options.now ?? (() => new Date().toISOString());
  const episodeId = options.episodeId ?? state.episodeId ?? "unknown";
  const out: CalibrationRecord[] = [];

  for (const result of state.agentResults) {
    const actualGain = result.branchOutcome === "failed"
      ? 0
      : computeActualGain({ source: "agent_run", agentResults: [result] });

    const expected = options.expectedGainByAgentRunId?.[result.agentRunId]
      ?? options.defaultExpectedGain
      ?? 0.5;

    out.push({
      recordId: `calib_${result.agentRunId}`,
      episodeId,
      source: "agent_run",
      decisionId: result.agentRunId,
      expectedGain: expected,
      decision: decisionFromOutcome(result.branchOutcome),
      actualGain,
      decidedAt: now(),
      realizedAt: now(),
      branchId: result.branchId,
      reportNodeId: result.reportNodeId,
      meta: {
        knowledgeNodeCount: result.knowledgeNodeIds.length,
        evidenceLinkCount: result.evidenceLinkIds.length,
        openGapCount: result.openGaps.length,
      },
    });
  }

  return out;
}

/** 通用：把任何 (expected, actual, ...) 元组塞成记录。 */
export function makeRecord(input: {
  episodeId: string;
  source: CalibrationRecord["source"];
  decisionId: string;
  expectedGain: number;
  decision: CalibrationRecord["decision"];
  actualGain?: number;
  branchId?: string;
  reportNodeId?: string;
  meta?: Record<string, unknown>;
}): CalibrationRecord {
  return {
    recordId: `calib_${input.decisionId}`,
    decidedAt: new Date().toISOString(),
    ...input,
  };
}

function decisionFromOutcome(outcome: AgentRunResult["branchOutcome"]): CalibrationRecord["decision"] {
  if (outcome === "done_here") return "complete";
  if (outcome === "defer_to_next_round") return "continue";
  return "failed";
}
