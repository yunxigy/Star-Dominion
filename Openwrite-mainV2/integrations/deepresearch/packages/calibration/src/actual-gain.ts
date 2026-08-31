// actualGain 量化规则：把 v5 agent 运行后落到 KG 的知识节点、EvidenceLink、
// 节点状态更新和完成状态映射到 [0, 1] 的实际收益分数。

import type { AgentRunResult, EvidenceLink, KnowledgeNode } from "@deepresearch/contracts";
import type { CalibrationSource } from "./types.js";

export interface ActualGainInput {
  source: CalibrationSource;
  agentResults?: AgentRunResult[];
  knowledgeNodes?: Array<Pick<KnowledgeNode, "nodeId">>;
  evidenceLinks?: Array<Pick<EvidenceLink, "linkId">>;
}

const MAX_EVIDENCE_LINKS = 5;
const MAX_KNOWLEDGE_NODES = 5;
const MAX_CITED_LINKS = 5;
const MAX_NODE_UPDATES = 3;

export function computeActualGain(input: ActualGainInput): number {
  const results = input.agentResults ?? [];
  const uniqueKnowledge = new Set([
    ...(input.knowledgeNodes ?? []).map((node) => node.nodeId),
    ...results.flatMap((result) => result.knowledgeNodeIds),
  ]);
  const uniqueEvidence = new Set([
    ...(input.evidenceLinks ?? []).map((link) => link.linkId),
    ...results.flatMap((result) => result.evidenceLinkIds),
  ]);

  if (results.length === 0 && uniqueKnowledge.size === 0 && uniqueEvidence.size === 0) {
    return 0;
  }

  const evidenceScore = Math.min(1, uniqueEvidence.size / MAX_EVIDENCE_LINKS) * 0.4;
  const knowledgeScore = Math.min(1, uniqueKnowledge.size / MAX_KNOWLEDGE_NODES) * 0.25;

  const citedEvidence = new Set(
    results.flatMap((result) => result.turnSummary.citedEvidenceLinkIds),
  );
  const citationScore = Math.min(1, citedEvidence.size / MAX_CITED_LINKS) * 0.15;

  const updateCount = results.reduce((sum, result) => sum + result.nodeUpdates.length, 0);
  const updateScore = Math.min(1, updateCount / MAX_NODE_UPDATES) * 0.1;

  const completionScore = results.length === 0
    ? 0
    : results.reduce((sum, result) => {
        if (result.branchOutcome === "done_here") return sum + 1;
        if (result.branchOutcome === "defer_to_next_round") return sum + 0.4;
        return sum;
      }, 0) / results.length * 0.1;

  const gapPenalty = Math.min(
    0.2,
    results.reduce((sum, result) => sum + result.openGaps.length, 0) * 0.04,
  );

  return clamp01(evidenceScore + knowledgeScore + citationScore + updateScore + completionScore - gapPenalty);
}

export function actualGainFromAgentResult(result: AgentRunResult): number {
  return computeActualGain({ source: "agent_run", agentResults: [result] });
}

export function countLinkedEvidence(linkIds: string[], realizedLinkIds: string[]): number {
  if (linkIds.length === 0) return 0;
  const realized = new Set(realizedLinkIds);
  return linkIds.filter((id) => realized.has(id)).length;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
