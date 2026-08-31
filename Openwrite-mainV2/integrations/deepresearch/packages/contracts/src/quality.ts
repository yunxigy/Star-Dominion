import type { EvidenceQualityMode, EvidenceQualityPolicy } from "./context.js";

export type EvidenceQualityIssueSeverity = "info" | "warning" | "error";

export interface EvidenceQualityIssue {
  code: string;
  severity: EvidenceQualityIssueSeverity;
  message: string;
  /** Stable structured binding; avoids recovering requirement identity from message text. */
  requirementId?: string;
  reportNodeId?: string;
  suggestedRepair?: string;
  requiredYears?: number[];
  coveredYears?: number[];
  missingYears?: number[];
  requiredEntities?: string[];
  coveredEntities?: string[];
  missingEntities?: string[];
  requiredExamples?: string[];
  coveredExamples?: string[];
  missingExamples?: string[];
  requiredCells?: string[];
  coveredCells?: string[];
  missingCells?: string[];
  requiredMetrics?: string[];
  coveredMetrics?: string[];
  missingMetrics?: string[];
  requiredMetricCells?: string[];
  coveredMetricCells?: string[];
  missingMetricCells?: string[];
}

export interface EvidenceNodeAudit {
  reportNodeId: string;
  label: string;
  status: string;
  sourceCount: number;
  independentDomainCount: number;
  primaryOrOfficialSourceCount: number;
  fetchedSourceCount: number;
  supportingCount: number;
  qualifyingCount: number;
  contradictingCount: number;
  backgroundCount: number;
  averageQualityScore: number;
  score: number;
  appliedSourcePolicy?: {
    mode: "named_primary_sufficient";
    namedSourceTitle: string;
    minSources: number;
    minIndependentDomains: number;
  };
  issues: EvidenceQualityIssue[];
}

export interface ReportGroundingAudit {
  evidenceBearingSentenceCount: number;
  citedEvidenceBearingSentenceCount: number;
  citationCoverage: number;
  uncitedQuantitativeClaimCount: number;
  uncitedClaimSamples: string[];
}

export interface RequirementCoverageEntry {
  requirementId: string;
  description: string;
  priority: string;
  mappedReportNodeIds: string[];
  groundedReportNodeIds: string[];
  status: "covered" | "incomplete" | "ungrounded" | "unmapped" | "stale" | "freshness_unknown" | "waived";
  freshnessStatus: "not_applicable" | "current" | "stale" | "unknown";
  freshKnowledgeNodeIds: string[];
  latestPublishedAt?: string;
  latestCoverageEnd?: string;
  requiredYears?: number[];
  coveredYears?: number[];
  missingYears?: number[];
  requiredEntities?: string[];
  coveredEntities?: string[];
  missingEntities?: string[];
  requiredExamples?: string[];
  coveredExamples?: string[];
  missingExamples?: string[];
  requiredCells?: string[];
  coveredCells?: string[];
  missingCells?: string[];
  requiredMetrics?: string[];
  coveredMetrics?: string[];
  missingMetrics?: string[];
  requiredMetricCells?: string[];
  coveredMetricCells?: string[];
  missingMetricCells?: string[];
  waiverId?: string;
}

export interface RequirementCoverageAudit {
  totalCount: number;
  mustCount: number;
  coveredCount: number;
  coveredMustCount: number;
  waivedCount: number;
  waivedMustCount: number;
  coverage: number;
  entries: RequirementCoverageEntry[];
}

export interface EvidenceQualityAudit {
  version: 1;
  mode: EvidenceQualityMode;
  policy: EvidenceQualityPolicy;
  score: number;
  generatedAt: string;
  summary: {
    auditedLeafCount: number;
    sourceCount: number;
    independentDomainCount: number;
    primaryOrOfficialSourceCount: number;
    fetchedSourceCount: number;
    errorCount: number;
    warningCount: number;
    requirementCount: number;
    coveredRequirementCount: number;
    mustRequirementCount: number;
    coveredMustRequirementCount: number;
    waivedRequirementCount: number;
    waivedMustRequirementCount: number;
    waivedIssueCount: number;
  };
  nodes: EvidenceNodeAudit[];
  requirementCoverage: RequirementCoverageAudit;
  reportGrounding?: ReportGroundingAudit;
  issues: EvidenceQualityIssue[];
  waivedIssues: EvidenceQualityIssue[];
}
