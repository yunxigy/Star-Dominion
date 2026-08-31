import type { OpenGap, ReportBundle, Reportlet, ReportNode } from "./report.js";
import type { ResearchIssueWaiver, ResearchRequirement } from "./context.js";

export type KnowledgeNodeType =
  | "WebPage"
  | "Paper"
  | "DataPoint"
  | "Report"
  | "Dataset"
  | "UserFile"
  | (string & {});

export type SourceTier = "official" | "primary" | "secondary" | "unknown" | (string & {});

export interface KnowledgeNodeMetadata {
  [key: string]: unknown;
  authors?: string[];
  publishedAt?: string;
  venue?: string;
  publisher?: string;
  language?: string;
  /** Earliest date explicitly covered by this source's data or analysis. */
  coverageStart?: string;
  /** Latest date explicitly covered by this source's data or analysis. */
  coverageEnd?: string;
}

export interface KnowledgeNode {
  nodeId: string;
  nodeType: KnowledgeNodeType;
  title: string;
  url?: string;
  contentHash: string;
  summary: string;
  sourceTier: SourceTier;
  qualityScore: number;
  retrievedByTaskId: string;
  retrievedAt: string;
  metadata: KnowledgeNodeMetadata;
}

export type EvidenceRelation = "supports" | "contradicts" | "qualifies" | "background" | (string & {});

export interface EvidenceLink {
  linkId: string;
  reportNodeId: string;
  knowledgeNodeId: string;
  relation: EvidenceRelation;
  claimText: string;
  evidenceQuote?: string;
  confidence: number;
  createdByTaskId: string;
  createdAt: string;
}

export interface KgService {
  upsertReportNode(node: ReportNode): Promise<{ created: boolean }>;
  getReportNode(id: string): Promise<ReportNode | null>;
  listReportNodes(): Promise<ReportNode[]>;
  listChildren(parentNodeId: string): Promise<ReportNode[]>;
  updateReportNode(node: ReportNode): Promise<void>;

  upsertKnowledgeNode(node: KnowledgeNode): Promise<{ created: boolean; nodeId: string }>;
  getKnowledgeNode(id: string): Promise<KnowledgeNode | null>;
  listKnowledgeNodes(): Promise<KnowledgeNode[]>;

  upsertEvidenceLink(link: EvidenceLink): Promise<{ created: boolean; linkId: string }>;
  getEvidenceLink(id: string): Promise<EvidenceLink | null>;
  listEvidenceLinks(reportNodeId?: string): Promise<EvidenceLink[]>;
  listEvidenceLinksByKnowledgeNode(knowledgeNodeId: string): Promise<EvidenceLink[]>;
  updateEvidenceLink(link: EvidenceLink): Promise<void>;

  upsertReportlet?(reportlet: Reportlet): Promise<{ created: boolean; reportletId: string }>;
  getReportlet?(id: string): Promise<Reportlet | null>;
  listReportlets?(reportNodeId?: string): Promise<Reportlet[]>;

  listOpenGaps?(reportNodeId?: string): Promise<OpenGap[]>;
  addOpenGap?(gap: OpenGap): void | Promise<void>;
  closeOpenGaps?(reportNodeId: string, reason?: string): Promise<number>;
  closeOpenGapsMatching?(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number>;
  acknowledgeOpenGaps?(matches: Array<{ reportNodeId?: string; description: string; reason: string }>): Promise<number>;
  buildReportBundle(episodeId: string, rootNodeId: string, opts: {
    rubricId: string;
    rubricText: string;
    language: string;
    citationRequired: boolean;
    requirements?: ResearchRequirement[];
    waivers?: ResearchIssueWaiver[];
  }): Promise<ReportBundle>;
}
