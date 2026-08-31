import type { EvidenceLink, KnowledgeNode, ReportNode, TaskItem } from "@deepresearch/contracts";
import { Rng } from "./random.js";

export const FIXTURE_NOW = "2026-07-01T00:00:00.000Z";

export function makeRootReportNode(_rng: Rng): ReportNode {
  return {
    nodeId: "R_root",
    nodeKind: "root",
    label: "Root",
    parentNodeId: null,
    scopeNote: "report root",
    status: "planned",
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: FIXTURE_NOW,
    updatedAt: FIXTURE_NOW,
  };
}

export function makeSampleReportNodes(rng: Rng, n: number): ReportNode[] {
  const labels = [
    "Overview",
    "Method Evolution",
    "Benchmarks",
    "Open Problems",
    "Implementation Details",
    "Case Studies",
  ];
  return Array.from({ length: n }, (_, i) => ({
    nodeId: `R_DIM_${String(i + 1).padStart(2, "0")}`,
    nodeKind: "aspect" as const,
    label: labels[i % labels.length]!,
    parentNodeId: i === 0 ? "R_root" : `R_DIM_${String(i).padStart(2, "0")}`,
    scopeNote: `scope of dimension ${i + 1}`,
    status: "planned" as const,
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: rng.isoDate(),
    updatedAt: rng.isoDate(),
  }));
}

export function makeSampleKnowledgeNodes(rng: Rng, n: number): KnowledgeNode[] {
  const types = ["Paper", "WebPage", "Report", "Dataset", "UserFile"] as const;
  return Array.from({ length: n }, (_, i) => ({
    nodeId: `K_${String(i + 1).padStart(4, "0")}`,
    nodeType: types[i % types.length]!,
    title: `Knowledge ${i + 1}`,
    url: `https://example.test/source/${i + 1}`,
    contentHash: `sha256:${i + 1}`,
    summary: `Summary of source ${i + 1}`,
    sourceTier: "secondary" as const,
    qualityScore: 0.5 + rng.next() * 0.5,
    retrievedByTaskId: `T_${i + 1}`,
    retrievedAt: rng.isoDate(),
    metadata: {},
  }));
}

export const makeSampleResources = makeSampleKnowledgeNodes;

export function makeSampleEvidenceLinks(reportNodeId: string, knowledgeNodes: KnowledgeNode[]): EvidenceLink[] {
  return knowledgeNodes.map((node, i) => ({
    linkId: `EL_${String(i + 1).padStart(4, "0")}`,
    reportNodeId,
    knowledgeNodeId: node.nodeId,
    relation: "supports",
    claimText: `Claim supported by ${node.title}`,
    confidence: 0.7,
    createdByTaskId: node.retrievedByTaskId,
    createdAt: node.retrievedAt,
  }));
}

export function makeSampleTaskItem(rng: Rng, branchId: string, reportNodeId: string, title: string): TaskItem {
  const createdAt = rng.isoDate();
  return {
    taskId: rng.id("T"),
    parentTaskId: null,
    reportNodeId,
    title,
    objective: title,
    status: "queued",
    priority: rng.next(),
    branchId,
    acceptanceCriteria: ["collect evidence", "link evidence to the report node"],
    createdAt,
    updatedAt: createdAt,
  };
}
