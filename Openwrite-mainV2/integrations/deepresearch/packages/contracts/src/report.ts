import type { EvidenceLink, KnowledgeNode } from "./knowledge.js";
import type { AgentNodePartPlan } from "./task.js";
import type { ResearchIssueWaiver, ResearchRequirement } from "./context.js";

export type ReportNodeKind = "root" | "aspect" | "hypothesis";

export type ReportNodeStatus =
  | "planned"
  | "researching"
  | "needs_review"
  | "needs_repair"
  | "supported"
  | "partially_supported"
  | "contradicted"
  | "insufficient_evidence"
  | "downplayed"
  | "verified"
  | "pruned";

export const NON_TERMINAL_STATUSES: ReportNodeStatus[] = [
  "planned",
  "researching",
  "needs_review",
  "needs_repair",
];

export const TERMINAL_STATUSES: ReportNodeStatus[] = [
  "supported",
  "partially_supported",
  "contradicted",
  "insufficient_evidence",
  "downplayed",
  "verified",
  "pruned",
];

export function isTerminalStatus(status: ReportNodeStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface ReportNodeCoverage {
  supportingCount: number;
  contradictingCount: number;
  openGapCount: number;
}

export interface ReportNodeHypothesis {
  statement: string;
  researchBrief: string;
  evidenceGuidance: string;
}

export interface ReportNode {
  nodeId: string;
  nodeKind: ReportNodeKind;
  label: string;
  parentNodeId: string | null;
  scopeNote: string;
  status: ReportNodeStatus;
  requirementIds?: string[];
  hypothesis?: ReportNodeHypothesis;
  draftSummary?: string;
  draftMarkdown?: string;
  coverage: ReportNodeCoverage;
  createdAt: string;
  updatedAt: string;
}

export interface Reportlet {
  reportletId: string;
  reportNodeId: string;
  taskId: string;
  title: string;
  markdown: string;
  citedEvidenceLinkIds: string[];
  citedKnowledgeNodeIds: string[];
  plannedReportlet?: AgentNodePartPlan;
  reasoningSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export function reportNodeConfidence(node: ReportNode): number {
  const total = node.coverage.supportingCount + node.coverage.contradictingCount + node.coverage.openGapCount;
  return total === 0 ? 0 : node.coverage.supportingCount / total;
}

export interface OpenGap {
  gapType: string;
  description: string;
  suggestedQuery: string;
  reportNodeId?: string;
  taskId?: string;
  impact?: "low" | "medium" | "high";
  status?: "open" | "acknowledged" | "closed";
  recommendedDisposition?: "retry" | "qualify" | "omit";
  claimSafeWithoutMissingEvidence?: boolean;
  affectedRequirementIds?: string[];
}

export interface ReportBundle {
  episodeId: string;
  root: ReportNode;
  tree: Array<{
    node: ReportNode;
    children: string[];
    evidence: Array<{
      link: EvidenceLink;
      knowledge: KnowledgeNode;
    }>;
    reportlets: Reportlet[];
    openGaps: OpenGap[];
  }>;
  globalEvidenceIndex: Array<{
    citationId: string;
    knowledgeNodeId: string;
    title: string;
    url?: string;
    canonicalUrl?: string;
    sourceTier: string;
    qualityScore?: number;
    publishedAt?: string;
    publisher?: string;
    authors?: string[];
    summary?: string;
    retrievedAt: string;
  }>;
  constraints: {
    language: string;
    citationRequired: boolean;
    rubricId: string;
    rubricText: string;
    requirements?: ResearchRequirement[];
    waivers?: ResearchIssueWaiver[];
  };
}
