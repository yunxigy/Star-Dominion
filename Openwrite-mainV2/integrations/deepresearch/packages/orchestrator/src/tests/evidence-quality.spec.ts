import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { EvidenceLink, KnowledgeNode, ReportBundle, ReportNode } from "@deepresearch/contracts";
import { auditEvidenceQuality, DEFAULT_EVIDENCE_QUALITY_POLICY } from "../evidence-quality.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";
import { publishGatePhase } from "../phases/publish-gate.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("auditEvidenceQuality", () => {
  it("scores a diverse, authoritative, fetched evidence portfolio without issues", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      link("E_1", "K_official", "supports"),
      link("E_2", "K_paper", "qualifies"),
    ]);

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      generatedAt: "2026-07-14T00:00:00.000Z",
      markdown: "## Finding\n\nThe measured rate increased by 12% in 2025 [C1].",
      citationMap: { C1: "K_official", C2: "K_paper" },
    });

    expect(audit.score).toBe(100);
    expect(audit.summary).toMatchObject({
      auditedLeafCount: 1,
      sourceCount: 2,
      independentDomainCount: 2,
      errorCount: 0,
      warningCount: 0,
    });
    expect(audit.reportGrounding?.citationCoverage).toBe(1);
    expect(audit.issues).toEqual([]);
  });

  it("does not count waived must requirements as covered or award a perfect quality score", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      link("E_1", "K_official", "supports"),
      link("E_2", "K_paper", "qualifies"),
    ]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_COVERED"];
    bundle.constraints.requirements = ["RQ_COVERED", "RQ_WAIVED_1", "RQ_WAIVED_2"].map((requirementId) => ({
      requirementId,
      description: `Evaluate ${requirementId}`,
      kind: "question" as const,
      priority: "must" as const,
      evidenceRequired: true,
      evidenceNeeds: ["Direct evidence"],
      successCriteria: ["Cited analysis"],
    }));
    bundle.constraints.waivers = ["RQ_WAIVED_1", "RQ_WAIVED_2"].map((requirementId, index) => ({
      waiverId: `W_${index + 1}`,
      questionId: `Q_${index + 1}`,
      issueCode: "incomplete_entity_coverage",
      action: "downplay" as const,
      rationale: "Bounded research could not fully verify this requirement.",
      requirementIds: [requirementId],
      decidedBy: "framework" as const,
      decidedAt: "2026-07-14T00:00:00.000Z",
    }));

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage).toMatchObject({
      coveredCount: 1,
      coveredMustCount: 1,
      waivedCount: 2,
      waivedMustCount: 2,
      coverage: 0.333,
    });
    expect(audit.summary.waivedMustRequirementCount).toBe(2);
    expect(audit.score).toBe(73.32);
  });

  it("reports a previously waived requirement as covered after its underlying evidence is restored", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      link("E_1", "K_official", "supports"),
      link("E_2", "K_paper", "qualifies"),
    ]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_RESTORED"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_RESTORED",
      description: "Evaluate the restored claim.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Direct evidence"],
      successCriteria: ["Cited analysis"],
    }];
    bundle.constraints.waivers = [{
      waiverId: "W_old",
      questionId: "Q_old",
      issueCode: "ungrounded_research_requirement",
      action: "downplay",
      rationale: "Evidence was missing before resume.",
      requirementIds: ["RQ_RESTORED"],
      decidedBy: "framework",
      decidedAt: "2026-07-14T00:00:00.000Z",
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]?.status).toBe("covered");
    expect(audit.requirementCoverage.waivedCount).toBe(0);
    expect(audit.score).toBe(100);
  });

  it("does not require evidence-free output constraints to own a report-tree leaf", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://official.example/report", "official", 0.9, true),
    ], [link("E_official", "K_official", "supports")]);
    bundle.constraints.requirements = [{
      requirementId: "OUT_FORMAT",
      description: "Write the report in Simplified Chinese Markdown with local citations.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["The rendered output uses the requested language and format."],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      mappedReportNodeIds: [],
      groundedReportNodeIds: [],
    });
    expect(audit.issues.some((issue) => issue.code === "unmapped_research_requirement")).toBe(false);
  });

  it("counts locally cited factual prose as evidence-bearing even without heuristic trigger words", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      link("E_1", "K_official", "supports"),
      link("E_2", "K_paper", "qualifies"),
    ]);
    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "该框架围绕治理、映射、度量和管理四个核心功能组织，并用于可信人工智能风险治理 [C1]。",
      citationMap: { C1: "K_official" },
    });

    expect(audit.reportGrounding).toMatchObject({
      evidenceBearingSentenceCount: 1,
      citedEvidenceBearingSentenceCount: 1,
      citationCoverage: 1,
    });
  });

  it("does not expand explicit comparison entities from illustrative parenthetical prose", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      { ...link("E_1", "K_official", "supports"), claimText: "NIST AI RMF provides a governance perspective and complements DeepSeek-V3." },
      { ...link("E_2", "K_paper", "qualifies"), claimText: "DeepSeek-V3 provides capability benchmarks and complements NIST AI RMF." },
    ]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["CMP1"];
    leaf.reportlets = [{
      reportletId: "RL_compare",
      reportNodeId: leaf.node.nodeId,
      taskId: "T_compare",
      title: "Comparison profiles",
      markdown: [
        "### NIST AI RMF",
        "**视角**：治理与风险管理。",
        "**互补点**：提供风险识别和缓解流程。",
        "### DeepSeek-V3技术报告",
        "**视角**：模型能力基准。",
        "**互补点**：提供可量化的任务性能。",
      ].join("\n\n"),
      citedEvidenceLinkIds: ["E_1", "E_2"],
      citedKnowledgeNodeIds: ["K_official", "K_paper"],
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    }];
    bundle.constraints.requirements = [{
      requirementId: "CMP1",
      description: "比较NIST AI RMF与DeepSeek-V3技术报告的互补视角。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["NIST AI RMF官方文档", "DeepSeek-V3技术报告"],
      successCriteria: ["明确指出两者如何互补（例如，NIST提供治理框架，DeepSeek提供具体技术评估）"],
      temporalScope: { mode: "timeless", basis: "source_publication" },
      geographicScope: [],
      entityScope: ["NIST AI RMF", "DeepSeek-V3技术报告"],
      entityScopeRole: "members",
      metricScope: ["视角", "互补点"],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]?.requiredEntities).toEqual(["NIST AI RMF", "DeepSeek-V3技术报告"]);
    expect(audit.requirementCoverage.entries[0]?.requiredEntities).not.toContain("例如");
    expect(audit.requirementCoverage.entries[0]?.missingMetricCells).toEqual([]);
  });

  it("keeps a fully evidenced structured comparison covered when an acknowledged optional-source gap is safe to omit", () => {
    const bundle = fixtureBundle([
      source("K_official", "https://stats.gov.example/data", "official", 0.9, true),
      source("K_paper", "https://journal.example/study", "primary", 0.8, true),
    ], [
      link("E_1", "K_official", "supports"),
      link("E_2", "K_paper", "qualifies"),
    ]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["CMP1"];
    leaf.reportlets = [{
      reportletId: "RL_complete_comparison",
      reportNodeId: leaf.node.nodeId,
      taskId: "T_compare",
      title: "Complete comparison",
      markdown: "### NIST AI RMF\n\n**视角**：风险治理。\n\n**互补点**：管理风险。\n\n### DeepSeek-V3技术报告\n\n**视角**：能力基准。\n\n**互补点**：量化性能。",
      citedEvidenceLinkIds: ["E_1", "E_2"],
      citedKnowledgeNodeIds: ["K_official", "K_paper"],
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    }];
    leaf.openGaps = [{
      gapType: "missing_evidence",
      description: "An optional third synthesis source was unavailable.",
      suggestedQuery: "optional synthesis source",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
      claimSafeWithoutMissingEvidence: true,
      affectedRequirementIds: ["CMP1"],
    }];
    bundle.constraints.requirements = [{
      requirementId: "CMP1",
      description: "比较NIST AI RMF与DeepSeek-V3技术报告。",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Two primary sources"],
      successCriteria: ["Compare both perspectives"],
      entityScope: ["NIST AI RMF", "DeepSeek-V3技术报告"],
      entityScopeRole: "members",
      metricScope: ["视角", "互补点"],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({ status: "covered", missingMetricCells: [] });
  });

  it("does not let an acknowledged failed-attempt gap override subsequently completed structured coverage", () => {
    const bundle = fixtureBundle([
      source("K_fda", "https://fda.gov.example/casgevy", "official", 0.9, true),
      source("K_ema", "https://ema.eu.example/casgevy", "official", 0.9, true),
    ], [
      { ...link("E_fda", "K_fda", "supports"), claimText: "FDA approved Casgevy on 8 December 2023." },
      { ...link("E_ema", "K_ema", "supports"), claimText: "EMA authorised Casgevy on 9 February 2024." },
    ]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["REQ_DATES"];
    leaf.reportlets = [{
      reportletId: "RL_dates",
      reportNodeId: leaf.node.nodeId,
      taskId: "T_dates",
      title: "Approval dates",
      markdown: "### FDA\n\n**关键批准时间**：2023-12-08。\n\n### EMA\n\n**关键批准时间**：2024-02-09。",
      citedEvidenceLinkIds: ["E_fda", "E_ema"],
      citedKnowledgeNodeIds: ["K_fda", "K_ema"],
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:00.000Z",
    }];
    leaf.openGaps = [{
      gapType: "missing_source",
      description: "An earlier repair attempt did not find a source.",
      suggestedQuery: "Casgevy approval dates",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
      affectedRequirementIds: ["REQ_DATES"],
    }];
    bundle.constraints.requirements = [{
      requirementId: "REQ_DATES",
      description: "Compare FDA and EMA approval dates.",
      kind: "comparison",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["FDA approval date", "EMA approval date"],
      successCriteria: ["Both dates are cited"],
      entityScope: ["FDA", "EMA"],
      entityScopeRole: "members",
      metricScope: ["关键批准时间"],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      groundedReportNodeIds: ["R_leaf"],
      missingMetricCells: [],
    });
  });

  it("scopes an explicit gap to only its affected requirement and ignores timeless publication freshness", () => {
    const authoritative = source("K_primary", "https://official.gov.example/report", "official", 0.9, true);
    const bundle = fixtureBundle([authoritative], [link("E_primary", authoritative.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ1", "CMP1"];
    leaf.openGaps = [{
      gapType: "missing_evidence",
      description: "The comparison needs one more direct source.",
      suggestedQuery: "comparison source",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
      affectedRequirementIds: ["CMP1"],
    }];
    bundle.constraints.requirements = ["RQ1", "CMP1"].map((requirementId) => ({
      requirementId,
      description: `Evaluate ${requirementId}`,
      kind: requirementId === "CMP1" ? "comparison" as const : "question" as const,
      priority: "must" as const,
      evidenceRequired: true,
      evidenceNeeds: ["Direct evidence"],
      successCriteria: ["Cited analysis"],
      temporalScope: { mode: "timeless" as const, basis: "source_publication" as const },
    }));

    const audit = auditEvidenceQuality(bundle, {
      ...DEFAULT_EVIDENCE_QUALITY_POLICY,
      minSourcesPerLeaf: 1,
      minIndependentDomainsPerLeaf: 1,
    });

    expect(audit.requirementCoverage.entries.find((entry) => entry.requirementId === "RQ1")).toMatchObject({
      status: "covered",
      freshnessStatus: "not_applicable",
    });
    expect(audit.requirementCoverage.entries.find((entry) => entry.requirementId === "CMP1")?.status).toBe("ungrounded");
  });

  it("keeps a directly supported unstructured requirement covered when a safe detail gap is acknowledged", () => {
    const authoritative = source("K_law", "https://official.example/regulation", "official", 0.95, true);
    const bundle = fixtureBundle([authoritative], [{
      ...link("E_targets", authoritative.nodeId, "supports"),
      claimText: "Article 59 sets collection targets of 45% in 2023, 63% in 2027, and 73% in 2030.",
    }]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["REQ_TARGETS"];
    leaf.openGaps = [{
      gapType: "missing_detail",
      description: "The separate annex formula was not reproduced.",
      suggestedQuery: "annex formula",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
      recommendedDisposition: "qualify",
      claimSafeWithoutMissingEvidence: true,
      affectedRequirementIds: ["REQ_TARGETS"],
    }];
    bundle.constraints.requirements = [{
      requirementId: "REQ_TARGETS",
      description: "Extract the collection target years and values from the regulation.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official regulation text"],
      successCriteria: ["List every target year and value"],
      temporalScope: { mode: "timeless", basis: "source_publication" },
    }];

    const audit = auditEvidenceQuality(bundle, {
      ...DEFAULT_EVIDENCE_QUALITY_POLICY,
      minSourcesPerLeaf: 1,
      minIndependentDomainsPerLeaf: 1,
    });

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      requirementId: "REQ_TARGETS",
      status: "covered",
      groundedReportNodeIds: ["R_leaf"],
    });
    expect(audit.issues.some((issue) => issue.code === "ungrounded_research_requirement")).toBe(false);
  });

  it("does not let an acknowledged failed repair attempt erase existing direct evidence", () => {
    const authoritative = source("K_law", "https://official.example/regulation", "official", 0.95, true);
    const bundle = fixtureBundle([authoritative], [link("E_targets", authoritative.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["REQ_TARGETS"];
    leaf.openGaps = [{
      gapType: "missing_source",
      description: "A later repair search returned no additional source.",
      suggestedQuery: "another source",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
      affectedRequirementIds: ["REQ_TARGETS"],
    }];
    bundle.constraints.requirements = [{
      requirementId: "REQ_TARGETS",
      description: "Extract the official collection targets.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official regulation text"],
      successCriteria: ["Cited target values"],
    }];

    const audit = auditEvidenceQuality(bundle, {
      ...DEFAULT_EVIDENCE_QUALITY_POLICY,
      minSourcesPerLeaf: 1,
      minIndependentDomainsPerLeaf: 1,
    });

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "covered",
      groundedReportNodeIds: ["R_leaf"],
    });
  });

  it("does not count subdomains of one publisher as independent evidence domains", () => {
    const bundle = fixtureBundle([
      source("K_journal", "https://journal.publisher.co.uk/study", "primary", 0.9, true),
      source("K_repository", "https://repository.publisher.co.uk/data", "primary", 0.8, true),
    ], [
      link("E_journal", "K_journal", "supports"),
      link("E_repository", "K_repository", "qualifies"),
    ]);

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.summary.independentDomainCount).toBe(1);
    expect(audit.nodes[0]?.independentDomainCount).toBe(1);
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "insufficient_source_independence",
      reportNodeId: "R_leaf",
    }));
  });

  it("accepts one matching official document when a named primary source is explicitly sufficient", () => {
    const regulation = source("K_regulation", "https://eur-lex.europa.eu/eli/reg/2023/1542/oj", "official", 0.95, true);
    regulation.title = "Regulation (EU) 2023/1542 official text";
    const bundle = fixtureBundle([regulation], [link("E_regulation", regulation.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_REGULATION", "RQ_DISTINCTION"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_REGULATION",
      description: "Extract the targets from Regulation (EU) 2023/1542.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["The official regulation text"],
      successCriteria: ["List the cited target values"],
      sourcePolicy: {
        mode: "named_primary_sufficient",
        sources: [{ title: "EUR-Lex Regulation (EU) 2023/1542", identifiers: ["2023/1542"] }],
      },
    }, {
      requirementId: "RQ_DISTINCTION",
      description: "Distinguish collection rate from material recovery rate.",
      kind: "constraint",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Direct definitions"],
      successCriteria: ["The report distinguishes both concepts"],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.nodes[0]?.appliedSourcePolicy).toMatchObject({
      mode: "named_primary_sufficient",
      namedSourceTitle: "EUR-Lex Regulation (EU) 2023/1542",
      minSources: 1,
      minIndependentDomains: 1,
    });
    expect(audit.issues.some((issue) => ["insufficient_source_depth", "insufficient_source_independence"].includes(issue.code))).toBe(false);
    expect(audit.nodes[0]?.score).toBe(100);
  });

  it("blocks quantitative values attributed to an explicitly excluded source section while allowing qualitative contrast", () => {
    const regulation = source("K_regulation", "https://eur-lex.europa.eu/eli/reg/2023/1542/oj", "official", 0.95, true);
    regulation.title = "Regulation (EU) 2023/1542 official text";
    const bundle = fixtureBundle([regulation], [link("E_regulation", regulation.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_LITHIUM"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_LITHIUM",
      description: "Use Annex XII Part C lithium recovery targets and do not mix in Part B efficiency values.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Annex XII Part C"],
      successCriteria: ["Only Part C values are reported"],
      renderedExclusions: [{
        scope: "Part B whole-battery recycling efficiency",
        aliases: ["Part B", "recycling efficiency"],
        mode: "quantitative_claims",
      }],
    }];
    const citationMap = { C1: regulation.nodeId };
    const safe = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "Lithium recovery reaches 50% in 2027 [C1]. This is material recovery, not Part B recycling efficiency.",
      citationMap,
    });
    const contaminated = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "Lithium recovery reaches 50% in 2027 [C1]. Part B efficiency is 65% in 2027 [C1].",
      citationMap,
    });

    expect(safe.issues.some((issue) => issue.code === "forbidden_rendered_content")).toBe(false);
    expect(contaminated.issues).toContainEqual(expect.objectContaining({
      code: "forbidden_rendered_content",
      severity: "error",
      requirementId: "RQ_LITHIUM",
    }));
  });

  it("blocks report self-certification while allowing bounded cited findings", () => {
    const regulation = source("K_regulation", "https://official.example/regulation", "official", 0.95, true);
    const bundle = fixtureBundle([regulation], [link("E_regulation", regulation.nodeId, "supports")]);
    const citationMap = { C1: regulation.nodeId };
    const bounded = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "The regulation sets a 50% target in 2027 [C1].",
      citationMap,
    });
    const selfCertified = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "The regulation sets a 50% target in 2027 [C1]. 本报告未发现任何矛盾或模糊之处。本报告完整、准确地回答了所有问题。",
      citationMap,
    });

    expect(bounded.issues.some((issue) => issue.code === "unsupported_meta_certainty")).toBe(false);
    expect(selfCertified.issues).toContainEqual(expect.objectContaining({
      code: "unsupported_meta_certainty",
      severity: "error",
    }));
  });

  it("enforces an all-mentions rendered exclusion even without a number", () => {
    const sourceNode = source("K_allowed", "https://official.example/allowed", "official", 0.9, true);
    const bundle = fixtureBundle([sourceNode], [link("E_allowed", sourceNode.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_ALLOWED"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_ALLOWED",
      description: "Use the allowed source only.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Allowed source"],
      successCriteria: ["Do not cite Appendix Z"],
      renderedExclusions: [{ scope: "Appendix Z", aliases: ["Appendix Z"], mode: "all_mentions" }],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      markdown: "The finding follows from the allowed source [C1]. Appendix Z was not used.",
      citationMap: { C1: sourceNode.nodeId },
    });

    expect(audit.issues).toContainEqual(expect.objectContaining({ code: "forbidden_rendered_content", severity: "error" }));
  });

  it("keeps ordinary depth warnings when the saved source does not match the named primary document", () => {
    const commentary = source("K_commentary", "https://news.example/battery-story", "secondary", 0.8, true);
    commentary.title = "Battery policy commentary";
    const bundle = fixtureBundle([commentary], [link("E_commentary", commentary.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["RQ_REGULATION"];
    bundle.constraints.requirements = [{
      requirementId: "RQ_REGULATION",
      description: "Extract the targets from Regulation (EU) 2023/1542.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["The official regulation text"],
      successCriteria: ["List the cited target values"],
      sourcePolicy: {
        mode: "named_primary_sufficient",
        sources: [{ title: "EUR-Lex Regulation (EU) 2023/1542", identifiers: ["2023/1542"] }],
      },
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.nodes[0]?.appliedSourcePolicy).toBeUndefined();
    expect(audit.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "insufficient_source_depth" }),
      expect.objectContaining({ code: "insufficient_source_independence" }),
      expect.objectContaining({ code: "missing_authoritative_source" }),
    ]));
  });

  it("blocks a supported node that has only weak background evidence in balanced mode", () => {
    const bundle = fixtureBundle([
      source("K_weak", "https://blog.example/post", "secondary", 0.2, false),
    ], [link("E_weak", "K_weak", "background")]);

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY, {
      generatedAt: "2026-07-14T00:00:00.000Z",
    });

    expect(audit.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "no_direct_evidence", severity: "error", reportNodeId: "R_leaf" }),
      expect.objectContaining({ code: "low_average_source_quality", severity: "error", reportNodeId: "R_leaf" }),
      expect.objectContaining({ code: "search_snippet_only_evidence", severity: "warning", reportNodeId: "R_leaf" }),
    ]));
    expect(audit.score).toBeLessThan(50);
  });

  it("does not count a must requirement as covered while a medium-impact gap is merely acknowledged", () => {
    const authoritative = source("K_primary", "https://journal.example/paper", "primary", 0.9, true);
    const bundle = fixtureBundle([authoritative], [link("E_primary", authoritative.nodeId, "supports")]);
    const leaf = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    leaf.node.requirementIds = ["R1"];
    leaf.openGaps = [{
      gapType: "planned_reportlet_not_completed",
      description: "Two required application areas remain unsupported.",
      suggestedQuery: "missing application evidence",
      reportNodeId: leaf.node.nodeId,
      impact: "medium",
      status: "acknowledged",
    }];
    bundle.constraints.requirements = [{
      requirementId: "R1",
      description: "Analyze all three required application areas",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["area one", "area two", "area three"],
      successCriteria: ["all three areas are analyzed"],
      temporalScope: { mode: "timeless" },
      geographicScope: [],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries).toContainEqual(expect.objectContaining({
      requirementId: "R1",
      status: "ungrounded",
    }));
    expect(audit.issues).toContainEqual(expect.objectContaining({
      code: "ungrounded_research_requirement",
      severity: "error",
    }));
  });

  it("requires every mapped leaf for one evidence-bearing requirement to be grounded", () => {
    const authoritative = source("K_primary", "https://official.gov.example/report", "official", 0.9, true);
    const bundle = fixtureBundle([authoritative], [link("E_primary", authoritative.nodeId, "supports")]);
    const first = bundle.tree.find((entry) => entry.node.nodeId === "R_leaf")!;
    first.node.requirementIds = ["R_ALL_PRODUCTS"];
    const secondNode = reportNode("R_leaf_2", "hypothesis", "R_aspect", "Second required product");
    secondNode.requirementIds = ["R_ALL_PRODUCTS"];
    bundle.tree.push({ node: secondNode, children: [], evidence: [], reportlets: [], openGaps: [] });
    bundle.constraints.requirements = [{
      requirementId: "R_ALL_PRODUCTS",
      description: "Cover every listed product.",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Official product documentation"],
      successCriteria: ["No product is omitted"],
    }];

    const audit = auditEvidenceQuality(bundle, DEFAULT_EVIDENCE_QUALITY_POLICY);

    expect(audit.requirementCoverage.entries[0]).toMatchObject({
      status: "ungrounded",
      mappedReportNodeIds: ["R_leaf", "R_leaf_2"],
      groundedReportNodeIds: ["R_leaf"],
    });
  });

  it("turns depth, independence, authority, fetch, and citation thresholds into errors in strict mode", () => {
    const bundle = fixtureBundle([
      source("K_secondary", "https://news.example/story", "secondary", 0.7, false),
    ], [link("E_secondary", "K_secondary", "supports")]);
    const policy = { ...DEFAULT_EVIDENCE_QUALITY_POLICY, mode: "strict" as const };

    const audit = auditEvidenceQuality(bundle, policy, {
      generatedAt: "2026-07-14T00:00:00.000Z",
      markdown: "The program expanded by 25% in 2024. Research showed that it led to higher output.",
      citationMap: { C1: "K_secondary" },
    });

    for (const code of [
      "insufficient_source_depth",
      "insufficient_source_independence",
      "missing_authoritative_source",
      "search_snippet_only_evidence",
      "low_report_citation_coverage",
      "uncited_quantitative_claim",
    ]) {
      expect(audit.issues).toContainEqual(expect.objectContaining({ code, severity: "error" }));
    }
    expect(audit.reportGrounding).toMatchObject({
      evidenceBearingSentenceCount: 2,
      citedEvidenceBearingSentenceCount: 0,
      citationCoverage: 0,
      uncitedQuantitativeClaimCount: 1,
    });
  });

  it("does not auto-skip strict evidence failures when completion repair budget is exhausted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-quality-completion-"));
    dirs.push(dir);
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "auto_accept";
    runtimeProfile.evidenceQuality.mode = "strict";
    const ctx = createPhaseContext({ sessionId: "S_quality", userInput: "Audit quality" }, {
      runtimeProfile,
      artifactDir: dir,
      now: () => Date.UTC(2026, 6, 14),
      llm: new EchoJsonLlm(),
    });
    ctx.state.episodeId = "EP_strict_completion";
    ctx.state.globalRubric = {
      rubricId: "RB_strict",
      episodeId: ctx.state.episodeId,
      rubricText: "Strict evidence quality.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
    };
    const root = reportNode("R_root", "root", null, "Root");
    const leaf = reportNode("R_leaf", "hypothesis", "R_root", "Finding");
    ctx.state.rootNode = root;
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(leaf);
    const weakSource = source("K_one", "https://news.example/story", "secondary", 0.7, false);
    await ctx.stack.kg.upsertKnowledgeNode(weakSource);
    await ctx.stack.kg.upsertEvidenceLink(link("E_one", weakSource.nodeId, "supports"));

    const decision = await completionGatePhase(ctx, { final: true, allowRepairTasks: false });

    expect(decision.decision).toBe("need_more_work");
    if (decision.decision !== "need_more_work") throw new Error("expected strict completion failure");
    expect(decision.result).toMatchObject({ status: "needs_human_review" });
    expect(decision.reason).toContain("evidence quality policy");
  });

  it("does not force-publish strict evidence failures in automatic mode", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-quality-publish-"));
    dirs.push(dir);
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "auto_accept";
    runtimeProfile.evidenceQuality.mode = "strict";
    const ctx = createPhaseContext({ sessionId: "S_quality", userInput: "Audit quality" }, {
      runtimeProfile,
      artifactDir: dir,
      now: () => Date.UTC(2026, 6, 14),
      llm: new EchoJsonLlm(),
    });
    ctx.state.episodeId = "EP_strict_publish";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const root = reportNode("R_root", "root", null, "Root");
    const leaf = reportNode("R_leaf", "hypothesis", "R_root", "Finding");
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(leaf);
    const weakSource = source("K_one", "https://news.example/story", "secondary", 0.7, false);
    await ctx.stack.kg.upsertKnowledgeNode(weakSource);
    await ctx.stack.kg.upsertEvidenceLink(link("E_one", weakSource.nodeId, "supports"));
    const bundle = fixtureBundle([weakSource], [link("E_one", weakSource.nodeId, "supports")]);
    const markdown = `# Report\n\n## Analysis\n\n${"Grounded discussion with adequate analytical depth [C1]. ".repeat(30)}\n\n## Conclusion\n\nThe bounded conclusion follows from the cited discussion.`;
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, markdown, "utf8");
    ctx.state.reportBundle = bundle;
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: markdown,
      citationMap: { C1: weakSource.nodeId },
      evidenceIndex: bundle.globalEvidenceIndex,
      diagnostics: [],
      generatedAt: "2026-07-14T00:00:00.000Z",
    };

    const result = await publishGatePhase(ctx, draftPath, { finalize: true, forcePublish: true });

    expect(result.status).toBe("needs_human_review");
    expect(result.humanReview?.stage).toBe("publish_gate");
    expect(result.humanReviewPath).toContain("human-review.json");
    expect(result.metrics.publishGatePassed).toBe(false);
  });

  it("distinguishes unresolved mixed evidence from a resolved refutation", () => {
    const supporting = source("K_support", "https://official.gov.example/support", "official", 0.9, true);
    const opposing = source("K_oppose", "https://research.example/oppose", "primary", 0.85, true);
    const mixed = fixtureBundle([supporting, opposing], [
      link("E_support", supporting.nodeId, "supports"),
      link("E_oppose", opposing.nodeId, "contradicts"),
    ]);
    const refuted = fixtureBundle([opposing], [link("E_refute", opposing.nodeId, "contradicts")]);
    refuted.tree.find((entry) => entry.node.nodeId === "R_leaf")!.node.status = "contradicted";

    const mixedAudit = auditEvidenceQuality(mixed, DEFAULT_EVIDENCE_QUALITY_POLICY);
    const refutedAudit = auditEvidenceQuality(refuted, {
      ...DEFAULT_EVIDENCE_QUALITY_POLICY,
      minSourcesPerLeaf: 1,
      minIndependentDomainsPerLeaf: 1,
    });

    expect(mixedAudit.issues).toContainEqual(expect.objectContaining({ code: "evidence_status_inconsistent", severity: "error" }));
    expect(refutedAudit.issues.some((issue) => issue.code === "evidence_status_inconsistent")).toBe(false);
  });
});

function fixtureBundle(sources: KnowledgeNode[], links: EvidenceLink[]): ReportBundle {
  const root = reportNode("R_root", "root", null, "Root");
  const aspect = reportNode("R_aspect", "aspect", "R_root", "Aspect");
  const leaf = reportNode("R_leaf", "hypothesis", "R_aspect", "Finding");
  return {
    episodeId: "EP_quality",
    root,
    tree: [
      { node: root, children: [aspect.nodeId], evidence: [], reportlets: [], openGaps: [] },
      { node: aspect, children: [leaf.nodeId], evidence: [], reportlets: [], openGaps: [] },
      {
        node: leaf,
        children: [],
        evidence: links.map((evidenceLink) => ({
          link: evidenceLink,
          knowledge: sources.find((item) => item.nodeId === evidenceLink.knowledgeNodeId)!,
        })),
        reportlets: [],
        openGaps: [],
      },
    ],
    globalEvidenceIndex: sources.map((item, index) => ({
      citationId: `C${index + 1}`,
      knowledgeNodeId: item.nodeId,
      title: item.title,
      url: item.url,
      canonicalUrl: item.url,
      sourceTier: item.sourceTier,
      summary: item.summary,
      retrievedAt: item.retrievedAt,
    })),
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: "RB_quality",
      rubricText: "Produce an evidence-backed report.",
    },
  };
}

function reportNode(nodeId: string, nodeKind: ReportNode["nodeKind"], parentNodeId: string | null, label: string): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    label,
    scopeNote: label,
    status: nodeKind === "hypothesis" ? "supported" : "verified",
    hypothesis: nodeKind === "hypothesis" ? {
      statement: `${label} is supported by evidence.`,
      researchBrief: `Research ${label}.`,
      evidenceGuidance: `Find direct evidence for ${label}.`,
    } : undefined,
    coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function source(nodeId: string, url: string, sourceTier: KnowledgeNode["sourceTier"], qualityScore: number, fetched: boolean): KnowledgeNode {
  return {
    nodeId,
    nodeType: "WebPage",
    title: nodeId,
    url,
    contentHash: `hash:${nodeId}`,
    summary: `Summary for ${nodeId}`,
    sourceTier,
    qualityScore,
    retrievedByTaskId: "T_quality",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    metadata: fetched ? { fetched: true, contentPreview: "x".repeat(300) } : {},
  };
}

function link(linkId: string, knowledgeNodeId: string, relation: EvidenceLink["relation"]): EvidenceLink {
  return {
    linkId,
    reportNodeId: "R_leaf",
    knowledgeNodeId,
    relation,
    claimText: "Evidence-backed finding.",
    confidence: 0.8,
    createdByTaskId: "T_quality",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}
