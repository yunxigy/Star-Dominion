import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type {
  EvidenceLink,
  EvidenceQualityAudit,
  EvidenceQualityPolicy,
  KnowledgeNode,
  ReportBundle,
  ReportNode,
  ResearchBudgetAudit,
  ResearchIssueWaiver,
  ResearchRequirement,
} from "@deepresearch/contracts";
import { auditEvidenceQuality, resolveEvidenceQualityPolicy } from "@deepresearch/orchestrator";

export interface QualityRegressionManifest {
  version: 1;
  generatedAt: string;
  cases: QualityRegressionCase[];
  artifactCases?: ArtifactRegressionCase[];
}

export interface QualityRegressionCase {
  id: string;
  description: string;
  policy?: Partial<EvidenceQualityPolicy>;
  requirements?: ResearchRequirement[];
  leaf: {
    status: ReportNode["status"];
    requirementIds?: string[];
  };
  sources?: Array<{
    id: string;
    url: string;
    sourceTier: KnowledgeNode["sourceTier"];
    qualityScore: number;
    fetched?: boolean;
    publishedAt?: string;
  }>;
  links?: Array<{
    id: string;
    sourceId: string;
    relation: EvidenceLink["relation"];
    claimText?: string;
    evidenceQuote?: string;
  }>;
  report?: {
    markdown: string;
    citationMap: Record<string, string>;
  };
  waivers?: ResearchIssueWaiver[];
  budgetAudit?: ResearchBudgetAudit;
  expect: QualityRegressionExpectation;
}

export interface ArtifactRegressionCase {
  id: string;
  description: string;
  artifactDir: string;
  expect: QualityRegressionExpectation;
}

export interface QualityRegressionExpectation {
  minScore?: number;
  maxScore?: number;
  activeErrorCount?: number;
  maxActiveErrorCount?: number;
  requiredIssueCodes?: string[];
  forbiddenIssueCodes?: string[];
  requiredWaivedIssueCodes?: string[];
  requirementStatuses?: Record<string, string>;
  minCitationCoverage?: number;
  maxUncitedQuantitativeClaims?: number;
  budget?: {
    maxRequests?: number;
    maxTotalTokens?: number;
    maxEstimatedCostUsd?: number;
    maxBreaches?: number;
    adaptiveStopApplied?: boolean;
  };
}

export interface QualityRegressionCaseResult {
  id: string;
  description: string;
  passed: boolean;
  failures: string[];
  observed: {
    score?: number;
    activeErrorCount?: number;
    issueCodes?: string[];
    waivedIssueCodes?: string[];
    requirementStatuses?: Record<string, string>;
    citationCoverage?: number;
    uncitedQuantitativeClaimCount?: number;
    budget?: ResearchBudgetAudit["totals"] & { breachCount: number; adaptiveStopApplied: boolean };
  };
}

export interface QualityRegressionResult {
  version: 1;
  manifestPath: string;
  evaluatedAt: string;
  passed: boolean;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  cases: QualityRegressionCaseResult[];
}

export function runQualityRegressionManifest(
  manifestPath: string,
  opts: { outputPath?: string; cwd?: string } = {},
): QualityRegressionResult {
  const cwd = opts.cwd ?? process.cwd();
  const resolvedManifest = resolve(cwd, manifestPath);
  const manifest = JSON.parse(readFileSync(resolvedManifest, "utf8")) as QualityRegressionManifest;
  validateManifest(manifest);
  const cases = [
    ...manifest.cases.map((item) => evaluateInlineCase(item, manifest.generatedAt)),
    ...(manifest.artifactCases ?? []).map((item) => evaluateArtifactCase(item, dirname(resolvedManifest))),
  ];
  const result: QualityRegressionResult = {
    version: 1,
    manifestPath: resolvedManifest,
    evaluatedAt: new Date().toISOString(),
    passed: cases.every((item) => item.passed),
    caseCount: cases.length,
    passedCount: cases.filter((item) => item.passed).length,
    failedCount: cases.filter((item) => !item.passed).length,
    cases,
  };
  if (opts.outputPath) {
    const outputPath = resolve(cwd, opts.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  return result;
}

export function evaluateInlineCase(input: QualityRegressionCase, generatedAt: string): QualityRegressionCaseResult {
  const audit = auditInlineCase(input, generatedAt);
  return evaluateObserved(input.id, input.description, input.expect, audit, input.budgetAudit);
}

export function auditInlineCase(input: QualityRegressionCase, generatedAt: string): EvidenceQualityAudit {
  const bundle = buildFixtureBundle(input);
  return auditEvidenceQuality(bundle, resolveEvidenceQualityPolicy(input.policy), {
    generatedAt,
    markdown: input.report?.markdown,
    citationMap: input.report?.citationMap,
  });
}

export function evaluateArtifactCase(input: ArtifactRegressionCase, manifestDir = process.cwd()): QualityRegressionCaseResult {
  const dir = resolve(manifestDir, input.artifactDir);
  const auditPath = resolve(dir, "evidence-quality-audit.json");
  if (!existsSync(auditPath)) {
    return {
      id: input.id,
      description: input.description,
      passed: false,
      failures: [`artifact audit missing: ${auditPath}`],
      observed: {},
    };
  }
  const audit = readJson<EvidenceQualityAudit>(auditPath);
  const budgetAudit = readOptionalJson<ResearchBudgetAudit>(resolve(dir, "budget-audit.json"));
  return evaluateObserved(input.id, input.description, input.expect, audit, budgetAudit);
}

function evaluateObserved(
  id: string,
  description: string,
  expect: QualityRegressionExpectation,
  audit: EvidenceQualityAudit,
  budgetAudit?: ResearchBudgetAudit,
): QualityRegressionCaseResult {
  const failures: string[] = [];
  const issueCodes = audit.issues.map((issue) => issue.code);
  const waivedIssueCodes = audit.waivedIssues.map((issue) => issue.code);
  const requirementStatuses = Object.fromEntries(audit.requirementCoverage.entries.map((entry) => [entry.requirementId, entry.status]));
  assertMin(failures, "score", audit.score, expect.minScore);
  assertMax(failures, "score", audit.score, expect.maxScore);
  if (expect.activeErrorCount !== undefined && audit.summary.errorCount !== expect.activeErrorCount) {
    failures.push(`activeErrorCount expected ${expect.activeErrorCount}, observed ${audit.summary.errorCount}`);
  }
  assertMax(failures, "activeErrorCount", audit.summary.errorCount, expect.maxActiveErrorCount);
  for (const code of expect.requiredIssueCodes ?? []) {
    if (!issueCodes.includes(code)) failures.push(`required active issue missing: ${code}`);
  }
  for (const code of expect.forbiddenIssueCodes ?? []) {
    if (issueCodes.includes(code)) failures.push(`forbidden active issue present: ${code}`);
  }
  for (const code of expect.requiredWaivedIssueCodes ?? []) {
    if (!waivedIssueCodes.includes(code)) failures.push(`required waived issue missing: ${code}`);
  }
  for (const [requirementId, status] of Object.entries(expect.requirementStatuses ?? {})) {
    if (requirementStatuses[requirementId] !== status) {
      failures.push(`requirement ${requirementId} expected status ${status}, observed ${requirementStatuses[requirementId] ?? "<missing>"}`);
    }
  }
  const grounding = audit.reportGrounding;
  if (expect.minCitationCoverage !== undefined && (grounding?.citationCoverage ?? 0) < expect.minCitationCoverage) {
    failures.push(`citationCoverage expected >= ${expect.minCitationCoverage}, observed ${grounding?.citationCoverage ?? 0}`);
  }
  if (expect.maxUncitedQuantitativeClaims !== undefined && (grounding?.uncitedQuantitativeClaimCount ?? 0) > expect.maxUncitedQuantitativeClaims) {
    failures.push(`uncitedQuantitativeClaimCount expected <= ${expect.maxUncitedQuantitativeClaims}, observed ${grounding?.uncitedQuantitativeClaimCount ?? 0}`);
  }
  const budgetObserved = budgetAudit ? {
    ...budgetAudit.totals,
    breachCount: budgetAudit.breaches.length,
    adaptiveStopApplied: budgetAudit.adaptiveStop?.stopped ?? false,
  } : undefined;
  if (expect.budget) {
    if (!budgetObserved) {
      failures.push("budget audit is required but missing");
    } else {
      assertMax(failures, "budget.requests", budgetObserved.requests, expect.budget.maxRequests);
      assertMax(failures, "budget.totalTokens", budgetObserved.totalTokens, expect.budget.maxTotalTokens);
      assertMax(failures, "budget.estimatedCostUsd", budgetObserved.estimatedCostUsd, expect.budget.maxEstimatedCostUsd);
      assertMax(failures, "budget.breachCount", budgetObserved.breachCount, expect.budget.maxBreaches);
      if (expect.budget.adaptiveStopApplied !== undefined && budgetObserved.adaptiveStopApplied !== expect.budget.adaptiveStopApplied) {
        failures.push(`budget.adaptiveStopApplied expected ${expect.budget.adaptiveStopApplied}, observed ${budgetObserved.adaptiveStopApplied}`);
      }
    }
  }
  return {
    id,
    description,
    passed: failures.length === 0,
    failures,
    observed: {
      score: audit.score,
      activeErrorCount: audit.summary.errorCount,
      issueCodes,
      waivedIssueCodes,
      requirementStatuses,
      citationCoverage: grounding?.citationCoverage,
      uncitedQuantitativeClaimCount: grounding?.uncitedQuantitativeClaimCount,
      budget: budgetObserved,
    },
  };
}

function buildFixtureBundle(input: QualityRegressionCase): ReportBundle {
  const root = reportNode("R_root", "root", null, "planned", input.leaf.requirementIds ?? []);
  const aspect = reportNode("R_aspect", "aspect", root.nodeId, "planned", input.leaf.requirementIds ?? []);
  const leaf = reportNode("R_leaf", "hypothesis", aspect.nodeId, input.leaf.status, input.leaf.requirementIds ?? []);
  const sources = (input.sources ?? []).map((item): KnowledgeNode => ({
    nodeId: item.id,
    nodeType: "WebPage",
    title: item.id,
    url: item.url,
    contentHash: `hash_${item.id}`,
    summary: `Fixture evidence from ${item.id}.`,
    sourceTier: item.sourceTier,
    qualityScore: item.qualityScore,
    retrievedByTaskId: "T_fixture",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    metadata: {
      fetched: item.fetched === true,
      contentPreview: item.fetched ? `Fetched substantive content for ${item.id}.` : undefined,
      publishedAt: item.publishedAt,
    },
  }));
  const links = (input.links ?? []).map((item): EvidenceLink => ({
    linkId: item.id,
    reportNodeId: leaf.nodeId,
    knowledgeNodeId: item.sourceId,
    relation: item.relation,
    claimText: item.claimText ?? `Fixture claim grounded by ${item.sourceId}.`,
    evidenceQuote: item.evidenceQuote,
    confidence: 0.85,
    createdByTaskId: "T_fixture",
    createdAt: "2026-07-14T00:00:00.000Z",
  }));
  return {
    episodeId: `EP_regression_${input.id}`,
    root,
    tree: [
      { node: root, children: [aspect.nodeId], evidence: [], reportlets: [], openGaps: [] },
      { node: aspect, children: [leaf.nodeId], evidence: [], reportlets: [], openGaps: [] },
      {
        node: leaf,
        children: [],
        evidence: links.map((link) => ({ link, knowledge: sources.find((source) => source.nodeId === link.knowledgeNodeId)! })),
        reportlets: [],
        openGaps: [],
      },
    ],
    globalEvidenceIndex: sources.map((source, index) => ({
      citationId: `C${index + 1}`,
      knowledgeNodeId: source.nodeId,
      title: source.title,
      url: source.url,
      canonicalUrl: source.url,
      sourceTier: source.sourceTier,
      summary: source.summary,
      retrievedAt: source.retrievedAt,
    })),
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: `RB_${input.id}`,
      rubricText: input.description,
      requirements: input.requirements,
      waivers: input.waivers,
    },
  };
}

function reportNode(
  nodeId: string,
  nodeKind: ReportNode["nodeKind"],
  parentNodeId: string | null,
  status: ReportNode["status"],
  requirementIds: string[],
): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    label: nodeId,
    scopeNote: nodeId,
    status,
    requirementIds,
    hypothesis: nodeKind === "hypothesis" ? { statement: nodeId, researchBrief: nodeId, evidenceGuidance: nodeId } : undefined,
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function assertMin(failures: string[], label: string, observed: number, expected: number | undefined): void {
  if (expected !== undefined && observed < expected) failures.push(`${label} expected >= ${expected}, observed ${observed}`);
}

function assertMax(failures: string[], label: string, observed: number, expected: number | undefined): void {
  if (expected !== undefined && observed > expected) failures.push(`${label} expected <= ${expected}, observed ${observed}`);
}

function validateManifest(manifest: QualityRegressionManifest): void {
  if (manifest.version !== 1) throw new Error(`Unsupported quality regression manifest version: ${String(manifest.version)}`);
  if (!Array.isArray(manifest.cases)) throw new Error("Quality regression manifest cases must be an array");
  if (manifest.artifactCases !== undefined && !Array.isArray(manifest.artifactCases)) {
    throw new Error("Quality regression manifest artifactCases must be an array");
  }
  if (manifest.cases.length + (manifest.artifactCases?.length ?? 0) === 0) {
    throw new Error("Quality regression manifest must contain at least one inline or artifact case");
  }
  const ids = [...manifest.cases, ...(manifest.artifactCases ?? [])].map((item) => item.id);
  if (new Set(ids).size !== ids.length) throw new Error("Quality regression case IDs must be unique");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readOptionalJson<T>(path: string): T | undefined {
  return existsSync(path) ? readJson<T>(path) : undefined;
}
