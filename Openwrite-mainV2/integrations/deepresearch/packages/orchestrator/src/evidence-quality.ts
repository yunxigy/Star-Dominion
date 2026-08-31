import type {
  EvidenceNodeAudit,
  EvidenceQualityAudit,
  EvidenceQualityIssue,
  EvidenceQualityPolicy,
  KnowledgeNode,
  ReportBundle,
  ReportGroundingAudit,
  ResearchRequirement,
  RequirementCoverageAudit,
} from "@deepresearch/contracts";
import { canonicalizeSourceUrl, inferSourceCoveragePeriod, sourcePublisherDomain } from "./source-identity.js";

export interface EvidenceQualityAuditOptions {
  generatedAt?: string;
  markdown?: string;
  citationMap?: Record<string, string>;
}

export const DEFAULT_EVIDENCE_QUALITY_POLICY: EvidenceQualityPolicy = {
  mode: "balanced",
  minSourcesPerLeaf: 2,
  minIndependentDomainsPerLeaf: 2,
  minPrimaryOrOfficialSourcesPerLeaf: 1,
  minAverageQualityScore: 0.6,
  requireFetchedSourcePerLeaf: true,
  minReportCitationCoverage: 0.8,
};

export function resolveEvidenceQualityPolicy(policy: Partial<EvidenceQualityPolicy> | undefined): EvidenceQualityPolicy {
  return { ...DEFAULT_EVIDENCE_QUALITY_POLICY, ...policy };
}

export function auditEvidenceQuality(
  bundle: ReportBundle,
  policy: EvidenceQualityPolicy,
  opts: EvidenceQualityAuditOptions = {},
): EvidenceQualityAudit {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const activeLeaves = bundle.tree.filter((entry) => (
    entry.node.nodeKind === "hypothesis"
    && entry.node.status !== "pruned"
    && entry.node.status !== "downplayed"
  ));
  const nodes = activeLeaves.map((entry) => auditLeaf(entry, policy, bundle.constraints.requirements ?? []));
  const issues = nodes.flatMap((node) => node.issues);
  const requirementCoverage = auditRequirementCoverage(bundle, activeLeaves, policy, issues, generatedAt);
  const reportGrounding = opts.markdown === undefined
    ? undefined
    : auditReportGrounding(opts.markdown, opts.citationMap ?? {}, bundle.constraints.citationRequired, policy, issues);
  if (opts.markdown !== undefined) {
    auditRenderedExclusions(opts.markdown, bundle.constraints.requirements ?? [], issues);
    auditUnsupportedMetaCertainty(opts.markdown, issues);
  }
  const activeIssues = issues.filter((qualityIssue) => !isIssueWaived(qualityIssue, bundle));
  const waivedIssues = issues.filter((qualityIssue) => isIssueWaived(qualityIssue, bundle));
  const allSources = uniqueKnowledge(activeLeaves.flatMap((entry) => entry.evidence.map((item) => item.knowledge)));
  const domains = new Set(allSources.map(sourceDomain));
  const nodeScore = nodes.length === 0 ? 0 : nodes.reduce((sum, node) => sum + node.score, 0) / nodes.length;
  const score = round(requirementCoverage.totalCount > 0
    ? nodeScore * 0.6 + requirementCoverage.coverage * 100 * 0.4
    : nodeScore);
  return {
    version: 1,
    mode: policy.mode,
    policy: structuredClone(policy),
    score,
    generatedAt,
    summary: {
      auditedLeafCount: nodes.length,
      sourceCount: allSources.length,
      independentDomainCount: domains.size,
      primaryOrOfficialSourceCount: allSources.filter(isPrimaryOrOfficial).length,
      fetchedSourceCount: allSources.filter(hasFetchedContent).length,
      errorCount: activeIssues.filter((issue) => issue.severity === "error").length,
      warningCount: activeIssues.filter((issue) => issue.severity === "warning").length,
      requirementCount: requirementCoverage.totalCount,
      coveredRequirementCount: requirementCoverage.coveredCount,
      mustRequirementCount: requirementCoverage.mustCount,
      coveredMustRequirementCount: requirementCoverage.coveredMustCount,
      waivedRequirementCount: requirementCoverage.waivedCount,
      waivedMustRequirementCount: requirementCoverage.waivedMustCount,
      waivedIssueCount: waivedIssues.length,
    },
    nodes,
    requirementCoverage,
    reportGrounding,
    issues: activeIssues,
    waivedIssues,
  };
}

function auditRequirementCoverage(
  bundle: ReportBundle,
  activeLeaves: ReportBundle["tree"],
  policy: EvidenceQualityPolicy,
  issues: EvidenceQualityIssue[],
  generatedAt: string,
): RequirementCoverageAudit {
  const requirements = bundle.constraints.requirements ?? [];
  const waivers = bundle.constraints.waivers ?? [];
  const entries = requirements.map((requirement) => {
    const requirementWaiver = waivers.find((waiver) => waiver.requirementIds?.includes(requirement.requirementId));
    const mapped = activeLeaves.filter((entry) => entry.node.requirementIds?.includes(requirement.requirementId));
    const explicitlyEvidenceFree = requirement.evidenceRequired === false
      && (!requirement.temporalScope || requirement.temporalScope.mode === "timeless")
      && (requirement.entityScope?.length ?? 0) === 0
      && (requirement.metricScope?.length ?? 0) === 0
      && (requirement.exampleScope?.length ?? 0) === 0
      && (requirement.geographicScope?.length ?? 0) === 0;
    const evidenceRequired = !explicitlyEvidenceFree && (
      requirement.evidenceRequired === true
      || requirement.temporalScope?.basis === "source_publication"
      || !["constraint", "deliverable"].includes(requirement.kind)
    );
    const directlyGrounded = evidenceRequired
      ? mapped.filter((entry) => entry.evidence.some((item) => (
          item.link.relation === "supports" || item.link.relation === "qualifies" || item.link.relation === "contradicts"
        )))
      : mapped;
    const temporalCoverage = evidenceRequired ? requirementTemporalYearCoverage(requirement, mapped) : undefined;
    const entityCoverage = evidenceRequired ? requirementEntityCoverage(requirement, mapped, temporalCoverage) : undefined;
    const exampleCoverage = evidenceRequired ? requirementExampleCoverage(requirement, mapped) : undefined;
    const structuredCoverageComplete = Boolean(
      (temporalCoverage || entityCoverage || exampleCoverage)
      && !(temporalCoverage?.missingYears.length)
      && !(entityCoverage?.missingEntities.length)
      && !(entityCoverage?.missingCells.length)
      && !(entityCoverage?.missingMetrics.length)
      && !(entityCoverage?.missingMetricCells.length)
      && !(exampleCoverage?.missingExamples.length),
    );
    const grounded = directlyGrounded.filter((entry) => !hasUnresolvedRequirementGap(entry, requirement, structuredCoverageComplete));
    const freshness = evidenceRequired
      ? requirementFreshness(requirement, grounded, generatedAt)
      : { status: "not_applicable" as const, freshKnowledgeNodeIds: [] };
    const allMappedLeavesGrounded = grounded.length === mapped.length;
    const allMappedLeavesDirectlyGrounded = directlyGrounded.length === mapped.length;
    const underlyingStatus = explicitlyEvidenceFree
      ? "covered" as const
      : mapped.length === 0
      ? "unmapped" as const
      : directlyGrounded.length === 0 || !allMappedLeavesDirectlyGrounded
        ? "ungrounded" as const
        : temporalCoverage?.missingYears.length
          || entityCoverage?.missingEntities.length
          || entityCoverage?.missingCells.length
          || entityCoverage?.missingMetrics.length
          || entityCoverage?.missingMetricCells.length
          || exampleCoverage?.missingExamples.length
          ? "incomplete" as const
          : grounded.length === 0 || !allMappedLeavesGrounded
            ? "ungrounded" as const
        : freshness.status === "stale"
          ? "stale" as const
          : freshness.status === "unknown"
            ? "freshness_unknown" as const
            : "covered" as const;
    const status = requirementWaiver && underlyingStatus !== "covered"
      ? "waived" as const
      : underlyingStatus;
    if (status === "unmapped" || status === "ungrounded") {
      const severity = requirement.priority === "must"
        ? policy.mode === "advisory" ? "warning" as const : "error" as const
        : requirement.priority === "should" ? "warning" as const : "info" as const;
      const code = status === "unmapped" ? "unmapped_research_requirement" : "ungrounded_research_requirement";
      issues.push({ ...issue(
        code,
        severity,
        `${requirement.requirementId} (${requirement.priority}) is ${status}: ${requirement.description}`,
        mapped.find((entry) => !grounded.includes(entry))?.node.nodeId ?? mapped[0]?.node.nodeId,
        status === "unmapped"
          ? "Add or retag a report leaf that explicitly owns this requirement."
          : "Collect direct evidence for the mapped leaf, or explicitly downscope the requirement with user approval.",
      ), requirementId: requirement.requirementId });
    }
    if (status === "incomplete" && temporalCoverage?.missingYears.length) {
      const severity = requirement.priority === "must"
        ? policy.mode === "advisory" ? "warning" as const : "error" as const
        : requirement.priority === "should" ? "warning" as const : "info" as const;
      issues.push({ ...issue(
        "incomplete_temporal_coverage",
        severity,
        `${requirement.requirementId} (${requirement.priority}) is missing concrete cited values for year(s): ${temporalCoverage.missingYears.join(", ")}.`,
        mapped[0]?.node.nodeId,
        `Collect and cite concrete values for the missing year(s): ${temporalCoverage.missingYears.join(", ")}. Reuse saved annual reports before searching for new sources.`,
        temporalCoverage,
      ), requirementId: requirement.requirementId });
    }
    if (status === "incomplete" && entityCoverage && (
      entityCoverage.missingEntities.length > 0
      || entityCoverage.missingCells.length > 0
      || entityCoverage.missingMetrics.length > 0
      || entityCoverage.missingMetricCells.length > 0
    )) {
      const severity = requirement.priority === "must"
        ? policy.mode === "advisory" ? "warning" as const : "error" as const
        : requirement.priority === "should" ? "warning" as const : "info" as const;
      const missingEntityText = entityCoverage.missingEntities.length > 0
        ? ` Missing entity/entities: ${entityCoverage.missingEntities.join(", ")}.`
        : "";
      const missingCellText = entityCoverage.missingCells.length > 0
        ? ` Missing entity-year cell(s): ${entityCoverage.missingCells.join(", ")}.`
        : "";
      const missingMetricText = entityCoverage.missingMetrics.length > 0
        ? ` Missing field(s): ${entityCoverage.missingMetrics.join(", ")}.`
        : "";
      const missingMetricCellText = entityCoverage.missingMetricCells.length > 0
        ? ` Missing ${metricCellKind(entityCoverage.missingMetricCells)} cell(s): ${entityCoverage.missingMetricCells.join(", ")}.`
        : "";
      issues.push({ ...issue(
        "incomplete_entity_coverage",
        severity,
        `${requirement.requirementId} (${requirement.priority}) is missing concrete cited coverage.${missingEntityText}${missingCellText}${missingMetricText}${missingMetricCellText}`,
        mapped[0]?.node.nodeId,
        `Collect and cite concrete values for the missing entities, years, and fields. Reuse saved cross-tree sources before searching for new sources.`,
        entityCoverage,
      ), requirementId: requirement.requirementId });
    }
    if (status === "incomplete" && exampleCoverage?.missingExamples.length) {
      const severity = requirement.priority === "must"
        ? policy.mode === "advisory" ? "warning" as const : "error" as const
        : requirement.priority === "should" ? "warning" as const : "info" as const;
      issues.push({ ...issue(
        "incomplete_example_coverage",
        severity,
        `${requirement.requirementId} (${requirement.priority}) is missing cited substantive analysis for narrative example(s): ${exampleCoverage.missingExamples.join(", ")}.`,
        mapped[0]?.node.nodeId,
        `Reuse saved primary or authoritative sources, then collect and cite substantive analysis for the missing narrative example(s): ${exampleCoverage.missingExamples.join(", ")}.`,
        exampleCoverage,
      ), requirementId: requirement.requirementId });
    }
    if (status === "stale" || status === "freshness_unknown") {
      const stale = status === "stale";
      const publicationBound = requirement.temporalScope?.basis === "source_publication";
      const severity = requirement.priority === "must"
        ? stale && policy.mode !== "advisory" ? "error" as const : policy.mode === "strict" ? "error" as const : "warning" as const
        : requirement.priority === "should" ? "warning" as const : "info" as const;
      issues.push({ ...issue(
        publicationBound
          ? stale ? "out_of_scope_source_publication" : "unknown_source_publication_date"
          : stale ? "stale_research_requirement" : "unknown_source_freshness",
        severity,
        publicationBound
          ? `${requirement.requirementId} (${requirement.priority}) has ${stale ? "out-of-window" : "unverifiable"} source publication dates for temporal mode ${requirement.temporalScope?.mode}.`
          : `${requirement.requirementId} (${requirement.priority}) has ${stale ? "stale" : "unverifiable"} source freshness for temporal mode ${requirement.temporalScope?.mode}.`,
        mapped[0]?.node.nodeId,
        publicationBound
          ? stale
            ? "Remove or replace direct evidence published outside the allowed publication window; later retrospective sources are not eligible."
            : "Record a source-visible publication date for every direct source, or replace undated material with a dated eligible source."
          : stale
            ? "Collect a source whose publication date or explicitly covered period matches the requirement's temporal window."
            : "Record source publication dates or explicit coverage periods, or replace undated material with a dated authoritative source.",
      ), requirementId: requirement.requirementId });
    }
    return {
      requirementId: requirement.requirementId,
      description: requirement.description,
      priority: requirement.priority,
      mappedReportNodeIds: mapped.map((entry) => entry.node.nodeId),
      groundedReportNodeIds: grounded.map((entry) => entry.node.nodeId),
      status,
      freshnessStatus: freshness.status,
      freshKnowledgeNodeIds: freshness.freshKnowledgeNodeIds,
      latestPublishedAt: freshness.latestPublishedAt,
      latestCoverageEnd: freshness.latestCoverageEnd,
      requiredYears: temporalCoverage?.requiredYears,
      coveredYears: temporalCoverage?.coveredYears,
      missingYears: temporalCoverage?.missingYears,
      requiredEntities: entityCoverage?.requiredEntities,
      coveredEntities: entityCoverage?.coveredEntities,
      missingEntities: entityCoverage?.missingEntities,
      requiredExamples: exampleCoverage?.requiredExamples,
      coveredExamples: exampleCoverage?.coveredExamples,
      missingExamples: exampleCoverage?.missingExamples,
      requiredCells: entityCoverage?.requiredCells,
      coveredCells: entityCoverage?.coveredCells,
      missingCells: entityCoverage?.missingCells,
      requiredMetrics: entityCoverage?.requiredMetrics,
      coveredMetrics: entityCoverage?.coveredMetrics,
      missingMetrics: entityCoverage?.missingMetrics,
      requiredMetricCells: entityCoverage?.requiredMetricCells,
      coveredMetricCells: entityCoverage?.coveredMetricCells,
      missingMetricCells: entityCoverage?.missingMetricCells,
      waiverId: requirementWaiver?.waiverId,
    };
  });
  const must = entries.filter((entry) => entry.priority === "must");
  const covered = entries.filter((entry) => entry.status === "covered");
  const waived = entries.filter((entry) => entry.status === "waived");
  return {
    totalCount: entries.length,
    mustCount: must.length,
    coveredCount: covered.length,
    coveredMustCount: must.filter((entry) => entry.status === "covered").length,
    waivedCount: waived.length,
    waivedMustCount: must.filter((entry) => entry.status === "waived").length,
    // A waiver resolves publication behavior, but it does not turn missing
    // evidence into research coverage. Keep the quality ratio literal.
    coverage: entries.length === 0 ? 1 : round(covered.length / entries.length),
    entries,
  };
}

function requirementTemporalYearCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  mapped: ReportBundle["tree"],
): { requiredYears: number[]; coveredYears: number[]; missingYears: number[] } | undefined {
  const temporal = requirement.temporalScope;
  if (temporal?.mode !== "range" || !temporal.start || !temporal.end) return undefined;
  const startYear = new Date(temporal.start).getUTCFullYear();
  const endYear = new Date(temporal.end).getUTCFullYear();
  if (!Number.isSafeInteger(startYear) || !Number.isSafeInteger(endYear) || startYear > endYear || endYear - startYear > 100) {
    return undefined;
  }
  const requirementText = [
    requirement.description,
    ...requirement.evidenceNeeds,
    ...requirement.successCriteria,
  ].join(" ");
  const explicitYears = uniqueYears(requirementText).filter((year) => year >= startYear && year <= endYear);
  const requiresEveryYear = /每\s*年|逐\s*年|各\s*年|历\s*年|year\s*[- ]?by\s*[- ]?year|each\s+year|every\s+year/iu.test(requirementText);
  const requiredYears = requiresEveryYear
    ? Array.from({ length: endYear - startYear + 1 }, (_, index) => startYear + index)
    : explicitYears.length >= 2
      && requiresConcreteValueCoverage(requirement, requirementText)
      && !describesResearchCorpusWindow(requirementText)
      ? explicitYears
      : [];
  if (requiredYears.length === 0) return undefined;
  const fragments = mapped.flatMap((entry) => [
    ...entry.evidence.flatMap((item) => [item.link.claimText, item.link.evidenceQuote].filter((value): value is string => Boolean(value))),
    ...entry.reportlets
      .filter((reportlet) => reportlet.citedEvidenceLinkIds.length > 0)
      .flatMap((reportlet) => [reportlet.title, reportlet.markdown]),
  ]);
  const coveredYears = requiredYears.filter((year) => fragments.some((fragment) => fragmentHasConcreteYearValue(fragment, year)));
  const coveredSet = new Set(coveredYears);
  return {
    requiredYears,
    coveredYears,
    missingYears: requiredYears.filter((year) => !coveredSet.has(year)),
  };
}

function uniqueYears(value: string): number[] {
  return Array.from(new Set((value.match(/(?:19|20)\d{2}/gu) ?? []).map(Number))).sort((a, b) => a - b);
}

interface RequirementEntityCoverage {
  requiredEntities: string[];
  coveredEntities: string[];
  missingEntities: string[];
  requiredCells: string[];
  coveredCells: string[];
  missingCells: string[];
  requiredMetrics: string[];
  coveredMetrics: string[];
  missingMetrics: string[];
  requiredMetricCells: string[];
  coveredMetricCells: string[];
  missingMetricCells: string[];
}

interface RequirementExampleCoverage {
  requiredExamples: string[];
  coveredExamples: string[];
  missingExamples: string[];
}

function requirementExampleCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  mapped: ReportBundle["tree"],
): RequirementExampleCoverage | undefined {
  const requiredExamples = uniqueCaseInsensitive((requirement.exampleScope ?? [])
    .map((example) => example.replace(/\s+/gu, " ").trim())
    .filter((example) => example.length >= 2 && example.length <= 80));
  if (requiredExamples.length === 0) return undefined;
  const fragments = mapped.flatMap((entry) => [
    ...entry.evidence
      .filter((item) => item.link.relation !== "background")
      .map((item) => [item.link.claimText, item.link.evidenceQuote].filter(Boolean).join(" ")),
    ...entry.reportlets
      .filter((reportlet) => reportlet.citedEvidenceLinkIds.length > 0)
      .map((reportlet) => `${reportlet.title}\n${reportlet.markdown}`),
  ]).filter(Boolean);
  const coveredExamples = requiredExamples.filter((example) => fragments.some((fragment) => (
    hasSubstantiveExampleFragment(fragment, example)
  )));
  const coveredSet = new Set(coveredExamples.map((example) => example.toLocaleLowerCase()));
  return {
    requiredExamples,
    coveredExamples,
    missingExamples: requiredExamples.filter((example) => !coveredSet.has(example.toLocaleLowerCase())),
  };
}

function hasSubstantiveExampleFragment(fragment: string, example: string): boolean {
  const normalizedFragment = normalizeComparableText(fragment);
  const normalizedExample = normalizeComparableText(example);
  if (!normalizedExample || !` ${normalizedFragment} `.includes(` ${normalizedExample} `)) return false;
  const escapedExample = normalizedExample.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const unavailable = new RegExp(
    `(?:${escapedExample}\\s+(?:is\\s+|was\\s+)?(?:missing|unavailable|not\\s+available|not\\s+found)|(?:missing|unavailable|not\\s+available|not\\s+found)\\s+(?:evidence|analysis|information|data)\\s+for\\s+${escapedExample})|(?:${escapedExample}.{0,8}(?:缺失|暂无|未找到|不可得)|(?:缺失|暂无|未找到|不可得)(?:关于|针对)?${escapedExample})`,
    "iu",
  );
  if (unavailable.test(normalizedFragment)) return false;
  const remainder = ` ${normalizedFragment} `.replace(` ${normalizedExample} `, " ").replace(/\s+/gu, " ").trim();
  return remainder.length >= 20
    && !/^(?:missing|unavailable|not available|not found|缺失|暂无|未找到|不可得)\b/iu.test(remainder);
}

function requirementEntityCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  mapped: ReportBundle["tree"],
  temporalCoverage: { requiredYears: number[]; coveredYears: number[]; missingYears: number[] } | undefined,
): RequirementEntityCoverage | undefined {
  if (requirement.entityScopeRole === "groups") {
    return requirementGroupCoverage(requirement, mapped);
  }
  const requirementText = requirementCoverageText(requirement);
  const requiredMetrics = requirementMetrics(requirement);
  if (!requiresEntityValueCoverage(requirement, requirementText, requiredMetrics)) return undefined;
  const requiredEntities = requirementEntities(requirement);
  if (requiredEntities.length < 2) return undefined;
  const fragments = mapped.flatMap((entry) => [
    ...entry.evidence.flatMap((item) => [item.link.claimText, item.link.evidenceQuote].filter((value): value is string => Boolean(value))),
    ...entry.reportlets
      .filter((reportlet) => reportlet.citedEvidenceLinkIds.length > 0)
      .flatMap((reportlet) => [reportlet.title, reportlet.markdown]),
  ]);
  const directlyCoveredEntities = requiredEntities.filter((entity) => fragments.some((fragment) => fragmentHasConcreteEntityValue(fragment, entity, undefined, requiredEntities)));
  const requiredCells = temporalCoverage?.requiredYears.flatMap((year) => requiredEntities.map((entity) => entityCell(entity, year))) ?? [];
  const coveredCells = requiredCells.filter((cell) => {
    const separator = cell.lastIndexOf("|");
    const entity = cell.slice(0, separator);
    const year = Number(cell.slice(separator + 1));
    return fragments.some((fragment) => fragmentHasConcreteEntityValue(fragment, entity, year, requiredEntities));
  });
  const fieldMatrixActive = requiredMetrics.length >= 2 || (hasDeclaredEntityFieldMatrix(requirement) && requiredMetrics.length >= 1);
  const requiredMetricCells = fieldMatrixActive
    ? temporalCoverage?.requiredYears.length
      ? temporalCoverage.requiredYears.flatMap((year) => requiredEntities.flatMap((entity) => (
          requiredMetrics.map((metric) => metricCell(entity, year, metric))
        )))
      : requiredEntities.flatMap((entity) => requiredMetrics.map((metric) => metricCell(entity, undefined, metric)))
    : [];
  const coveredMetricCells = requiredMetricCells.filter((cell) => {
    const { entity, year, metric } = parseMetricCell(cell);
    return fragments.some((fragment) => fragmentHasConcreteMetricValue(
      fragment,
      entity,
      year,
      metric,
      requiredEntities,
      requiredMetrics,
    ));
  });
  const coveredMetricCellSet = new Set(coveredMetricCells);
  const coveredMetrics = requiredMetrics.filter((metric) => coveredMetricCells.some((cell) => cell.endsWith(`|${metric}`)));
  const coveredMetricSet = new Set(coveredMetrics);
  const metricCoveredEntities = fieldMatrixActive && !temporalCoverage?.requiredYears.length
    ? requiredEntities.filter((entity) => requiredMetrics.some((metric) => coveredMetricCellSet.has(metricCell(entity, undefined, metric))))
    : [];
  const coveredEntities = uniqueStrings([...directlyCoveredEntities, ...metricCoveredEntities]);
  const coveredEntitySet = new Set(coveredEntities);
  const missingEntities = requiredEntities.filter((entity) => !coveredEntitySet.has(entity));
  const metricCompletedCells = fieldMatrixActive
    ? requiredCells.filter((cell) => requiredMetrics.every((metric) => coveredMetricCellSet.has(`${cell}|${metric}`)))
    : [];
  const resolvedCoveredCells = uniqueStrings([...coveredCells, ...metricCompletedCells]);
  const coveredCellSet = new Set(resolvedCoveredCells);
  return {
    requiredEntities,
    coveredEntities,
    missingEntities,
    requiredCells,
    coveredCells: resolvedCoveredCells,
    missingCells: requiredCells.filter((cell) => !coveredCellSet.has(cell)),
    requiredMetrics,
    coveredMetrics,
    missingMetrics: requiredMetrics.filter((metric) => !coveredMetricSet.has(metric)),
    requiredMetricCells,
    coveredMetricCells,
    missingMetricCells: requiredMetricCells.filter((cell) => !coveredMetricCellSet.has(cell)),
  };
}

function requirementGroupCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  mapped: ReportBundle["tree"],
): RequirementEntityCoverage | undefined {
  const requiredEntities = requirementEntities(requirement);
  if (requiredEntities.length < 2) return undefined;
  const fragments = mapped.flatMap((entry) => [
    ...entry.evidence
      .filter((item) => item.link.relation !== "background")
      .map((item) => [item.link.claimText, item.link.evidenceQuote].filter(Boolean).join(" ")),
    ...entry.reportlets
      .filter((reportlet) => reportlet.citedEvidenceLinkIds.length > 0)
      .map((reportlet) => `${reportlet.title}\n${reportlet.markdown}`),
  ]).filter(Boolean);
  const coveredEntities = requiredEntities.filter((group) => fragments.some((fragment) => hasSubstantiveGroupFragment(fragment, group)));
  const coveredSet = new Set(coveredEntities);
  return {
    requiredEntities,
    coveredEntities,
    missingEntities: requiredEntities.filter((group) => !coveredSet.has(group)),
    requiredCells: [],
    coveredCells: [],
    missingCells: [],
    requiredMetrics: [],
    coveredMetrics: [],
    missingMetrics: [],
    requiredMetricCells: [],
    coveredMetricCells: [],
    missingMetricCells: [],
  };
}

function hasSubstantiveGroupFragment(fragment: string, group: string): boolean {
  const normalizedFragment = normalizeComparableText(fragment);
  const normalizedGroup = normalizeComparableText(group);
  const paddedFragment = ` ${normalizedFragment} `;
  const paddedGroup = ` ${normalizedGroup} `;
  if (!normalizedGroup || !paddedFragment.includes(paddedGroup)) return false;
  const remainder = paddedFragment.replace(paddedGroup, " ").replace(/\s+/gu, " ").trim();
  return remainder.length >= 20
    && !/^(?:missing|unavailable|not available|not found|缺失|暂无|未找到|不可得)\b/iu.test(remainder);
}

function normalizeComparableText(value: string): string {
  return value
    .replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function requirementCoverageText(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): string {
  return [
    requirement.description,
    ...requirement.evidenceNeeds,
    ...requirement.successCriteria,
  ].join(" ");
}

function requiresConcreteValueCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  text = requirementCoverageText(requirement),
): boolean {
  if ((requirement.metricScope ?? []).some((metric) => normalizeMetric(metric))) return true;
  const quantitativeField = /(?:具体(?:数值|数据)|数值|数据|指标|数量|总数|总量|里程|客运量|客运强度|强度|比率|比例|百分比|增长率|收入|成本|价格|金额|样本量|得分|分数|效应量|p\s*值|value|data|metric|number|count|amount|total|mileage|ridership|intensity|rate|ratio|percentage|revenue|cost|price|sample\s+size|score|effect\s+size)/iu.test(text);
  const structuredDelivery = /(?:逐项|分别|各自|每个|列出|提供|展示|制作|表格|对比|比较|趋势|变化趋势|per\s+(?:item|entity|country|year)|for\s+each|list|provide|show|table|compare|comparison|versus|\bvs\.?\b|trend)/iu.test(text);
  return quantitativeField && structuredDelivery;
}

function requiresEntityValueCoverage(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  text: string,
  metrics: string[],
): boolean {
  if (requirement.entityScopeRole === "groups") return true;
  if (hasDeclaredEntityFieldMatrix(requirement)) return true;
  if ((requirement.metricScope ?? []).some((metric) => normalizeMetric(metric))) return true;
  if (describesResearchCorpusWindow(text)) return false;
  if (metrics.length >= 2) return true;
  return requiresConcreteValueCoverage(requirement, text)
    && /(?:逐项|分别|各自|每个|制作|表格|对比|比较|per\s+(?:item|entity|country)|for\s+each|table|compare|comparison|versus|\bvs\.?\b)/iu.test(text);
}

function hasDeclaredEntityFieldMatrix(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
): boolean {
  if (requirement.entityScopeRole === "groups") return false;
  return (requirement.entityScope ?? []).filter((entity) => entity.trim()).length >= 2
    && (requirement.metricScope ?? []).filter((metric) => metric.trim()).length >= 1;
}

function describesResearchCorpusWindow(text: string): boolean {
  const englishCorpusWindow = /(?:stud(?:y|ies)|research|literature|trial(?:s)?|article(?:s)?|paper(?:s)?|publication(?:s)?|case(?:s)?)\s+(?:published\s+|conducted\s+)?(?:from|between|during|spanning)\s+(?:19|20)\d{2}/iu;
  const englishLeadingWindow = /(?:from|between|during|spanning)\s+(?:19|20)\d{2}[^.!?\n]{0,60}(?:stud(?:y|ies)|research|literature|trial(?:s)?|article(?:s)?|paper(?:s)?|publication(?:s)?|case(?:s)?)/iu;
  const chineseCorpusWindow = /(?:19|20)\d{2}\s*年?\s*(?:至|到|[-–—])\s*(?:19|20)\d{2}\s*年?(?:间|期间)?(?:所)?(?:发表|发布|开展|进行|完成|收录)?(?:的)?(?:实证)?(?:研究|文献|试验|论文|案例)/u;
  const chineseLeadingWindow = /(?:研究|文献|试验|论文|案例)[^。！？\n]{0,40}(?:发表于|发布于|开展于|时间范围为)[^。！？\n]{0,30}(?:19|20)\d{2}\s*年?\s*(?:至|到|[-–—])\s*(?:19|20)\d{2}/u;
  return englishCorpusWindow.test(text)
    || englishLeadingWindow.test(text)
    || chineseCorpusWindow.test(text)
    || chineseLeadingWindow.test(text);
}

function requirementMetrics(requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number]): string[] {
  const declared = uniqueStrings((requirement.metricScope ?? [])
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter((value) => value.length >= 2 && value.length <= 80));
  if (declared.length > 0) return declared;
  const inferred = metricsBeforeUnitParentheses([
    requirement.description,
    ...requirement.evidenceNeeds,
    ...requirement.successCriteria,
  ].join(" "));
  return inferred.length >= 2 ? inferred : declared;
}

function metricsBeforeUnitParentheses(value: string): string[] {
  const metrics: string[] = [];
  for (const match of value.matchAll(/([^。.!?\n（）()]{2,100})[（(]([^（）()]{1,50})[）)]/gu)) {
    const unit = (match[2] ?? "").trim();
    if (!looksLikeUnit(unit)) continue;
    const metric = normalizeMetric(match[1] ?? "");
    if (metric) metrics.push(metric);
  }
  return uniqueStrings(metrics);
}

function looksLikeUnit(value: string): boolean {
  return /%|\/|公里|千米|米|万人|人次|美元|人民币|亿元|元|吨|千瓦|兆瓦|小时|天|日|kg|km|mile|million|billion|percent|ratio|rate|per\b/iu.test(value);
}

function normalizeMetric(value: string): string {
  let metric = value.replace(/\s+/gu, " ").trim();
  metric = metric.split(/[、,，;；|]/u).at(-1)?.trim() ?? metric;
  metric = metric.replace(/^.*(?:和|与|及|以及|and)\s*/iu, "").trim();
  if (/的/u.test(metric)) metric = metric.slice(metric.lastIndexOf("的") + 1).trim();
  metric = metric.replace(/^(?:各|每|全部|所有|the)\s*/iu, "").trim();
  if (metric.length < 2 || metric.length > 40) return "";
  if (/^(?:数据|数值|指标|单位|value|values|metric|metrics)$/iu.test(metric)) return "";
  return metric;
}

function requirementEntities(requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number]): string[] {
  const description = requirementCoverageText(requirement);
  const declared = (requirement.entityScope ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length >= 1 && value.length <= 80)
    .filter((value) => !/^(?:global|worldwide|all|全部|所有|中国内地|中国大陆|全国|世界|effective|ineffective|neutral|yes|no|unknown|not applicable|支持|反对|中立|有效|无效|未知|不适用)$/iu.test(value));
  const scoped = (requirement.geographicScope ?? [])
    .map((value) => value.trim())
    .filter((value) => value.length >= 2 && value.length <= 40)
    .filter((value) => !/^(?:global|worldwide|中国内地|中国大陆|全国|世界)$/iu.test(value))
    .filter((value) => containsPhrase(description, value));
  const parenthetical = Array.from(description.matchAll(/[（(]([^（）()]{3,})[）)]/gu))
    .flatMap((match) => {
      const prefix = description.slice(Math.max(0, (match.index ?? 0) - 80), match.index ?? 0);
      if (!/(?:对象|实体|城市|国家|地区|公司|企业|产品|品牌|平台|模型|方案|机构|学校|entities?|cities?|countries?|regions?|companies?|products?|brands?|platforms?|models?|organizations?|schools?)[^。.!?\n]{0,40}$/iu.test(prefix)) {
        return [];
      }
      const values = splitEntityList(match[1] ?? "");
      return values.length >= 3 ? values : [];
    });
  const inferred = (declared.length > 0 ? [] : [...scoped, ...parenthetical]).filter((value) => (
    value.length >= 1
      && value.length <= 40
      && !/\d{2,4}/u.test(value)
      && !/^(?:年|数据|单位|公里|万人次|万人次\/公里日|each year|every year)$/iu.test(value)
      && !/^(?:effective|ineffective|neutral|yes|no|unknown|not applicable|支持|反对|中立|有效|无效|未知|不适用)$/iu.test(value)
  ));
  return uniqueStrings([...declared, ...inferred]);
}

function splitEntityList(value: string): string[] {
  if (!/[、,，;；|/]/u.test(value)) return [];
  return value.split(/[、,，;；|/]/u).map((item) => item.trim()).filter(Boolean);
}

function containsPhrase(haystack: string, needle: string): boolean {
  return haystack.toLocaleLowerCase().includes(needle.toLocaleLowerCase());
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFKC").toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function entityCell(entity: string, year: number): string {
  return `${entity}|${year}`;
}

function metricCell(entity: string, year: number | undefined, metric: string): string {
  return year === undefined ? `${entity}|${metric}` : `${entity}|${year}|${metric}`;
}

function parseMetricCell(cell: string): { entity: string; year?: number; metric: string } {
  const [entity = "", second = "", ...rest] = cell.split("|");
  if (/^(?:19|20)\d{2}$/u.test(second) && rest.length > 0) {
    return { entity, year: Number(second), metric: rest.join("|") };
  }
  return { entity, metric: [second, ...rest].join("|") };
}

function metricCellKind(cells: string[]): "entity-year-field" | "entity-field" {
  return cells.some((cell) => parseMetricCell(cell).year !== undefined) ? "entity-year-field" : "entity-field";
}

function fragmentHasConcreteMetricValue(
  fragment: string,
  entity: string,
  year: number | undefined,
  metric: string,
  knownEntities: string[],
  knownMetrics: string[],
): boolean {
  if (fragmentHasMarkdownTableFieldValue(fragment, entity, year, metric, knownEntities, knownMetrics)) return true;
  const plain = fragment.replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ");
  if (fragmentHasEntitySectionMetricValue(plain, entity, year, metric)) return true;
  if (fragmentHasGroupedMetricValue(plain, entity, year, metric, knownEntities, knownMetrics)) return true;
  const entityPattern = new RegExp(escapeRegExp(entity), "giu");
  const knownEntityPattern = new RegExp(knownEntities.map(escapeRegExp).join("|"), "giu");
  const entityPositions = Array.from(plain.matchAll(knownEntityPattern)).map((match) => match.index ?? 0);
  for (const entityMatch of plain.matchAll(entityPattern)) {
    const entityIndex = entityMatch.index ?? 0;
    const nextEntity = entityPositions.find((position) => position > entityIndex);
    const rowStart = Math.max(
      plain.lastIndexOf("\n", entityIndex - 1),
      plain.lastIndexOf("。", entityIndex - 1),
      entityIndex - 1,
      entityIndex - 260,
    );
    const rowEndCandidates = [plain.indexOf("\n", entityIndex), plain.indexOf("。", entityIndex)]
      .filter((value) => value >= 0);
    const rowEnd = Math.min(
      rowEndCandidates.length > 0 ? Math.min(...rowEndCandidates) + 1 : plain.length,
      nextEntity ?? plain.length,
      entityIndex + 360,
    );
    const row = plain.slice(Math.max(0, rowStart + 1), rowEnd);
    if (year !== undefined && !new RegExp(`(?<!\\d)${year}(?!\\d)`, "u").test(row)) continue;
    const metricPattern = new RegExp(escapeRegExp(metric), "giu");
    const knownMetricPattern = new RegExp(knownMetrics.map(escapeRegExp).join("|"), "giu");
    const metricPositions = Array.from(row.matchAll(knownMetricPattern)).map((match) => match.index ?? 0);
    for (const metricMatch of row.matchAll(metricPattern)) {
      const metricIndex = metricMatch.index ?? 0;
      const nextMetric = metricPositions.find((position) => position > metricIndex);
      const segmentEndCandidates = [
        row.indexOf("，", metricIndex),
        row.indexOf(",", metricIndex),
        row.indexOf(";", metricIndex),
        row.indexOf("；", metricIndex),
      ].filter((value) => value >= 0 && (nextMetric === undefined || value < nextMetric));
      const segmentEnd = Math.min(
        segmentEndCandidates.length > 0 ? Math.min(...segmentEndCandidates) + 1 : row.length,
        nextMetric ?? row.length,
        metricIndex + 140,
      );
      const segment = row.slice(metricIndex, segmentEnd);
      if (/缺失|暂缺|未(?:能|曾)?(?:获取|获得|提取|找到|提供)|尚未|不可得|missing|unavailable|not\s+(?:available|reported|provided|extracted|found)|could\s+not/iu.test(segment)) continue;
      if (hasConcreteFieldValue(segment.slice(metric.length), year)) return true;
    }
  }
  return false;
}

function fragmentHasEntitySectionMetricValue(
  plain: string,
  entity: string,
  year: number | undefined,
  metric: string,
): boolean {
  const lines = plain.split(/\r?\n/gu);
  const entityPattern = new RegExp(escapeRegExp(entity), "iu");
  const metricPattern = new RegExp(`^(?:[*_~]+)?\\s*${escapeRegExp(metric)}\\s*(?:[*_~]+)?\\s*[:：=\\-–—]\\s*(.+)$`, "iu");
  for (let headingIndex = 0; headingIndex < lines.length; headingIndex += 1) {
    const heading = lines[headingIndex]?.trim() ?? "";
    if (!/^#{1,6}\s+/u.test(heading) || !entityPattern.test(heading)) continue;
    for (let lineIndex = headingIndex + 1; lineIndex < lines.length; lineIndex += 1) {
      const line = lines[lineIndex]?.trim() ?? "";
      if (/^#{1,6}\s+/u.test(line)) break;
      const match = line.match(metricPattern);
      if (!match?.[1]) continue;
      if (year !== undefined && !new RegExp(`(?<!\\d)${year}(?!\\d)`, "u").test(`${heading}\n${line}`)) continue;
      if (hasConcreteFieldValue(match[1], year)) return true;
    }
  }
  return false;
}

function fragmentHasGroupedMetricValue(
  plain: string,
  entity: string,
  year: number | undefined,
  metric: string,
  knownEntities: string[],
  knownMetrics: string[],
): boolean {
  const metricPattern = new RegExp(escapeRegExp(metric), "giu");
  const knownMetricPattern = new RegExp(knownMetrics.map(escapeRegExp).join("|"), "giu");
  const metricPositions = Array.from(plain.matchAll(knownMetricPattern)).map((match) => match.index ?? 0);
  const entityPattern = new RegExp(escapeRegExp(entity), "giu");
  const knownEntityPattern = new RegExp(knownEntities.map(escapeRegExp).join("|"), "giu");
  for (const metricMatch of plain.matchAll(metricPattern)) {
    const metricIndex = metricMatch.index ?? 0;
    const prefix = plain.slice(Math.max(0, metricIndex - 500), metricIndex);
    if (year !== undefined && lastMentionedYear(prefix) !== year) continue;
    const nextMetric = metricPositions.find((position) => position > metricIndex);
    const segment = plain.slice(metricIndex + metric.length, Math.min(nextMetric ?? plain.length, metricIndex + 700));
    const knownEntityPositions = Array.from(segment.matchAll(knownEntityPattern)).map((match) => match.index ?? 0);
    for (const entityMatch of segment.matchAll(entityPattern)) {
      const entityIndex = entityMatch.index ?? 0;
      const nextEntity = knownEntityPositions.find((position) => position > entityIndex);
      const localBreaks = [
        segment.indexOf("、", entityIndex),
        segment.indexOf("，", entityIndex),
        segment.indexOf(",", entityIndex),
        segment.indexOf(";", entityIndex),
        segment.indexOf("；", entityIndex),
        segment.indexOf("。", entityIndex),
        segment.indexOf("\n", entityIndex),
        segment.indexOf("|", entityIndex),
      ].filter((value) => value >= 0);
      const valueContext = segment.slice(entityIndex, Math.min(
        nextEntity ?? segment.length,
        localBreaks.length > 0 ? Math.min(...localBreaks) + 1 : segment.length,
        entityIndex + 100,
      ));
      if (/缺失|暂缺|未(?:能|曾)?(?:获取|获得|提取|找到|提供)|尚未|不可得|missing|unavailable|not\s+(?:available|reported|provided|extracted|found)|could\s+not/iu.test(valueContext)) continue;
      if (hasConcreteFieldValue(valueContext.slice(entity.length), year)) return true;
    }
  }
  return false;
}

function fragmentHasMarkdownTableFieldValue(
  fragment: string,
  entity: string,
  year: number | undefined,
  metric: string,
  knownEntities: string[],
  knownMetrics: string[],
): boolean {
  const lines = fragment.split(/\r?\n/gu);
  const entityLabel = normalizeTableCell(entity);
  const metricLabel = normalizeTableCell(metric);
  if (!entityLabel || !metricLabel) return false;
  for (let headerIndex = 0; headerIndex < lines.length - 2; headerIndex += 1) {
    const header = markdownTableCells(lines[headerIndex] ?? "");
    const separator = markdownTableCells(lines[headerIndex + 1] ?? "");
    if (header.length < 2 || separator.length !== header.length || !separator.every(isMarkdownSeparatorCell)) continue;
    const metricIndex = header.findIndex((cell) => tableLabelsMatch(cell, metricLabel, knownMetrics));
    if (metricIndex < 0) continue;
    for (let rowIndex = headerIndex + 2; rowIndex < lines.length; rowIndex += 1) {
      const rawRow = lines[rowIndex] ?? "";
      if (!rawRow.includes("|")) break;
      const row = markdownTableCells(rawRow);
      if (row.length !== header.length) continue;
      const hasEntity = row.some((cell) => tableEntityMatches(cell, entityLabel, knownEntities));
      if (!hasEntity) continue;
      if (year !== undefined && !row.some((cell) => new RegExp(`(?<!\\d)${year}(?!\\d)`, "u").test(cell))) continue;
      if (hasConcreteFieldValue(row[metricIndex] ?? "", year)) return true;
    }
  }
  return false;
}

function markdownTableCells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return [];
  const body = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  return body.split("|").map((cell) => normalizeTableCell(cell));
}

function normalizeTableCell(value: string): string {
  return value
    .replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ")
    .replace(/<[^>]+>/gu, " ")
    .replace(/[*_`~]/gu, "")
    .replace(/\\([|])/gu, "$1")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase();
}

function isMarkdownSeparatorCell(value: string): boolean {
  return /^:?-{3,}:?$/u.test(value.replace(/\s+/gu, ""));
}

function tableLabelsMatch(headerCell: string, metricLabel: string, knownMetrics: string[]): boolean {
  if (headerCell === metricLabel) return true;
  if (metricLabel.length >= 3 && (headerCell.includes(metricLabel) || metricLabel.includes(headerCell))) {
    const competing = knownMetrics
      .map(normalizeTableCell)
      .filter((candidate) => candidate !== metricLabel && candidate.length >= metricLabel.length)
      .some((candidate) => headerCell.includes(candidate));
    return !competing;
  }
  return false;
}

function tableEntityMatches(cell: string, entityLabel: string, knownEntities: string[]): boolean {
  if (cell === entityLabel) return true;
  if (!cell.includes(entityLabel)) return false;
  return !knownEntities
    .map(normalizeTableCell)
    .filter((candidate) => candidate !== entityLabel && candidate.length > entityLabel.length)
    .some((candidate) => cell.includes(candidate));
}

function hasConcreteFieldValue(value: string, requestedYear: number | undefined): boolean {
  const plain = value
    .replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ")
    .replace(/^[\s:：=\-–—|]+/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (!plain || /^(?:[-–—/]|n\/?a|null|unknown|未知|缺失|暂无|无数据)+$/iu.test(plain)) return false;
  if (/缺失|暂缺|未(?:能|曾)?(?:获取|获得|提取|找到|提供)|尚未|不可得|missing|unavailable|not\s+(?:available|reported|provided|extracted|found)|could\s+not/iu.test(plain)) return false;
  const hasNumber = (plain.match(/\d+(?:\.\d+)?/gu) ?? []).some((token) => {
    const numeric = Number(token);
    return Number.isFinite(numeric) && (requestedYear === undefined || !(numeric >= 1900 && numeric <= 2100));
  });
  if (hasNumber) return true;
  if (!/[\p{L}\p{Script=Han}]/u.test(plain)) return false;
  return !/^(?:value|values|field|fields|metric|metrics|data|值|字段|指标|数据)$/iu.test(plain);
}

function lastMentionedYear(value: string): number | undefined {
  const matches = Array.from(value.matchAll(/(?:19|20)\d{2}/gu));
  const last = matches.at(-1)?.[0];
  return last ? Number(last) : undefined;
}

function fragmentHasConcreteEntityValue(fragment: string, entity: string, year?: number, knownEntities: string[] = [entity]): boolean {
  const plain = fragment.replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ");
  const entityPattern = new RegExp(escapeRegExp(entity), "giu");
  const knownEntityPattern = new RegExp(knownEntities.map(escapeRegExp).join("|"), "giu");
  const entityPositions = Array.from(plain.matchAll(knownEntityPattern)).map((match) => match.index ?? 0);
  const useRowContext = year !== undefined;
  for (const match of plain.matchAll(entityPattern)) {
    const index = match.index ?? 0;
    const nextEntity = entityPositions.find((position) => position > index);
    const startCandidates = [
      plain.lastIndexOf("\n", index - 1),
      plain.lastIndexOf("。", index - 1),
      plain.lastIndexOf(".", index - 1),
      plain.lastIndexOf(";", index - 1),
      plain.lastIndexOf("；", index - 1),
      ...(useRowContext ? [] : [plain.lastIndexOf("，", index - 1), plain.lastIndexOf(",", index - 1)]),
    ];
    const start = Math.max(...startCandidates, index - 220, useRowContext ? index - 1 : -1);
    const endCandidates = [
      plain.indexOf("\n", index),
      plain.indexOf("。", index),
      plain.indexOf(".", index),
      ...(useRowContext ? [] : [plain.indexOf(";", index), plain.indexOf("；", index)]),
      ...(useRowContext ? [] : [plain.indexOf("，", index), plain.indexOf(",", index)]),
    ].filter((value) => value >= 0);
    const end = Math.min(
      endCandidates.length > 0 ? Math.min(...endCandidates) + 1 : plain.length,
      index + 260,
      useRowContext ? nextEntity ?? plain.length : plain.length,
    );
    const context = plain.slice(Math.max(0, start + 1), end);
    if (/缺失|暂缺|未(?:能|曾)?(?:获取|获得|提取|找到|提供)|尚未|不可得|missing|unavailable|not\s+(?:available|reported|provided|extracted|found)|could\s+not/iu.test(context)) continue;
    if (year !== undefined && !new RegExp(`(?<!\\d)${year}(?!\\d)`, "u").test(context)) continue;
    const hasValue = (context.match(/\d+(?:\.\d+)?/gu) ?? []).some((token) => {
      const value = Number(token);
      return Number.isFinite(value) && !(value >= 1900 && value <= 2100);
    });
    if (hasValue) return true;
  }
  return false;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function fragmentHasConcreteYearValue(fragment: string, year: number): boolean {
  const plain = fragment.replace(/\[E:[^\]]+\]|\[C\d+\]/gu, " ");
  const yearPattern = new RegExp(`(?<!\\d)${year}(?!\\d)`, "gu");
  for (const match of plain.matchAll(yearPattern)) {
    const index = match.index ?? 0;
    const lineStart = Math.max(
      plain.lastIndexOf("\n", index - 1),
      plain.lastIndexOf("。", index - 1),
      plain.lastIndexOf(".", index - 1),
      plain.lastIndexOf(";", index - 1),
      plain.lastIndexOf("；", index - 1),
      plain.lastIndexOf("，", index - 1),
      plain.lastIndexOf(",", index - 1),
      index - 180,
    );
    const nextBreaks = [
      plain.indexOf("\n", index),
      plain.indexOf("。", index),
      plain.indexOf(".", index),
      plain.indexOf(";", index),
      plain.indexOf("；", index),
      plain.indexOf("，", index),
      plain.indexOf(",", index),
    ]
      .filter((value) => value >= 0);
    const lineEnd = Math.min(nextBreaks.length > 0 ? Math.min(...nextBreaks) + 1 : plain.length, index + 220);
    const context = plain.slice(Math.max(0, lineStart + 1), lineEnd);
    if (/缺失|暂缺|未(?:能|曾)?(?:获取|获得|提取|找到|提供)|尚未|需(?:要|进一步).*?(?:提取|获取|查找)|不可得|missing|unavailable|not\s+(?:available|reported|provided|extracted|found)|could\s+not/iu.test(context)) {
      continue;
    }
    const hasValue = (context.match(/\d+(?:\.\d+)?/gu) ?? []).some((token) => {
      const value = Number(token);
      return Number.isFinite(value) && value !== year && !(value >= 1900 && value <= 2100);
    });
    if (hasValue) return true;
  }
  return false;
}

function hasUnresolvedRequirementGap(
  entry: ReportBundle["tree"][number],
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  structuredCoverageComplete = false,
): boolean {
  if (!["question", "comparison", "deliverable"].includes(requirement.kind)) return false;
  return entry.openGaps.some((gap) => {
    if (gap.status === "closed" || gap.impact === "low") return false;
    const affected = (gap.affectedRequirementIds ?? []).filter(Boolean);
    if (affected.length > 0 && !affected.includes(requirement.requirementId)) return false;
    // An acknowledged gap that explicitly preserves a narrower safe claim is a
    // publication boundary, not proof that the directly supported requirement
    // is ungrounded. This also applies to unstructured requirements where there
    // is no year/entity matrix capable of setting structuredCoverageComplete.
    if (gap.status === "acknowledged" && gap.claimSafeWithoutMissingEvidence === true) return false;
    // A later repair attempt can fail even though the leaf already has direct
    // evidence. Once that attempt failure is acknowledged, do not let its
    // bookkeeping gap erase the evidence that made this entry directlyGrounded.
    if (gap.status === "acknowledged" && isSupersededAttemptFailureGap(gap.gapType)) return false;
    return true;
  });
}

const SUPERSEDED_ATTEMPT_FAILURE_GAP_TYPES = new Set([
  "missing_source",
  "agent_budget_exceeded",
  "agent_runtime_error",
  "low_quality_sources",
]);

function isSupersededAttemptFailureGap(gapType: string): boolean {
  return SUPERSEDED_ATTEMPT_FAILURE_GAP_TYPES.has(gapType.trim().toLocaleLowerCase());
}

function isIssueWaived(issue: EvidenceQualityIssue, bundle: ReportBundle): boolean {
  return (bundle.constraints.waivers ?? []).some((waiver) => (
    (waiver.issueCode === issue.code || waiver.issueCode === "*")
    && (!waiver.reportNodeId || waiver.reportNodeId === issue.reportNodeId)
  ));
}

function requirementFreshness(
  requirement: NonNullable<ReportBundle["constraints"]["requirements"]>[number],
  grounded: ReportBundle["tree"],
  generatedAt: string,
): {
  status: "not_applicable" | "current" | "stale" | "unknown";
  freshKnowledgeNodeIds: string[];
  latestPublishedAt?: string;
  latestCoverageEnd?: string;
} {
  const temporal = requirement.temporalScope;
  if (temporal?.basis === "source_publication" && temporal.mode !== "timeless") {
    return sourcePublicationWindowFreshness(temporal, grounded, generatedAt);
  }
  if (!temporal || !["current", "as_of"].includes(temporal.mode)) {
    return { status: "not_applicable", freshKnowledgeNodeIds: [] };
  }
  const referenceMs = Date.parse(temporal.mode === "as_of" && temporal.asOf ? temporal.asOf : generatedAt);
  if (!Number.isFinite(referenceMs)) return { status: "unknown", freshKnowledgeNodeIds: [] };
  const inclusiveUpperBound = temporal.mode === "as_of" && temporal.asOf
    ? inclusiveTemporalUpperBound(temporal.asOf)
    : referenceMs + 86_400_000;
  const maxAgeDays = temporal.maxAgeDays ?? (temporal.mode === "current" ? 365 : undefined);
  const allSources = uniqueKnowledge(grounded.flatMap((entry) => entry.evidence
    .filter((item) => item.link.relation !== "background")
    .map((item) => item.knowledge)));
  const exemptSources = allSources.filter((source) => isTemporalExemptSource(temporal, source));
  const exemptIds = exemptSources.map((source) => source.nodeId);
  const exemptIdSet = new Set(exemptIds);
  const sources = allSources.filter((source) => !exemptIdSet.has(source.nodeId));
  const dated = datedKnowledgeSources(sources);
  const latestPublishedAt = [...datedKnowledgeSources(allSources)].sort((a, b) => b.publishedMs - a.publishedMs)[0]?.publishedAt;
  if (sources.length === 0 && exemptSources.length > 0) {
    return { status: "current", freshKnowledgeNodeIds: exemptIds, latestPublishedAt };
  }
  if (temporal.mode === "as_of") {
    const coverage = sources.flatMap((source) => {
      const inferred = inferSourceCoveragePeriod({
        title: source.title,
        url: source.url,
        snippet: source.summary,
        content: typeof source.metadata.contentPreview === "string" ? source.metadata.contentPreview : undefined,
      });
      const coverageStart = typeof source.metadata.coverageStart === "string"
        ? source.metadata.coverageStart
        : inferred.coverageStart;
      const coverageEnd = typeof source.metadata.coverageEnd === "string"
        ? source.metadata.coverageEnd
        : inferred.coverageEnd;
      const startMs = coverageStart ? Date.parse(coverageStart) : Number.NEGATIVE_INFINITY;
      const endMs = coverageEnd ? Date.parse(coverageEnd) : Number.NaN;
      return Number.isFinite(endMs) && startMs <= endMs
        ? [{ source, coverageEnd: coverageEnd!, startMs, endMs }]
        : [];
    });
    if (coverage.length > 0) {
      const toleranceDays = temporal.maxAgeDays ?? 366;
      const lowerCoverageBound = referenceMs - toleranceDays * 86_400_000;
      const futureCoverage = coverage.filter((item) => item.endMs > inclusiveUpperBound);
      const freshCoverage = coverage.filter((item) => (
        item.startMs <= inclusiveUpperBound
        && item.endMs <= inclusiveUpperBound
        && item.endMs >= lowerCoverageBound
      ));
      const coverageSourceIds = new Set(coverage.map((item) => item.source.nodeId));
      const datedWithoutCoverage = dated.filter((item) => !coverageSourceIds.has(item.source.nodeId));
      const lowerPublicationBound = maxAgeDays === undefined ? Number.NEGATIVE_INFINITY : referenceMs - maxAgeDays * 86_400_000;
      const futurePublication = datedWithoutCoverage.filter((item) => item.publishedMs > inclusiveUpperBound);
      const freshPublication = datedWithoutCoverage.filter((item) => (
        item.publishedMs <= inclusiveUpperBound
        && item.publishedMs >= lowerPublicationBound
      ));
      const latestCoverageEnd = [...coverage].sort((a, b) => b.endMs - a.endMs)[0]?.coverageEnd;
      return {
        status: futureCoverage.length > 0 || futurePublication.length > 0
          ? "stale"
          : freshCoverage.length > 0 || freshPublication.length > 0 ? "current" : "stale",
        freshKnowledgeNodeIds: [
          ...exemptIds,
          ...freshCoverage.map((item) => item.source.nodeId),
          ...freshPublication.map((item) => item.source.nodeId),
        ],
        latestPublishedAt,
        latestCoverageEnd,
      };
    }
  }
  if (dated.length === 0) return { status: "unknown", freshKnowledgeNodeIds: exemptIds };
  const lowerBound = maxAgeDays === undefined ? Number.NEGATIVE_INFINITY : referenceMs - maxAgeDays * 86_400_000;
  const future = dated.filter((item) => item.publishedMs > inclusiveUpperBound);
  const fresh = dated.filter((item) => item.publishedMs <= inclusiveUpperBound && item.publishedMs >= lowerBound);
  return {
    status: future.length > 0 ? "stale" : fresh.length > 0 ? "current" : "stale",
    freshKnowledgeNodeIds: [...exemptIds, ...fresh.map((item) => item.source.nodeId)],
    latestPublishedAt,
  };
}

function sourcePublicationWindowFreshness(
  temporal: NonNullable<NonNullable<ReportBundle["constraints"]["requirements"]>[number]["temporalScope"]>,
  grounded: ReportBundle["tree"],
  generatedAt: string,
): {
  status: "not_applicable" | "current" | "stale" | "unknown";
  freshKnowledgeNodeIds: string[];
  latestPublishedAt?: string;
} {
  const currentReference = temporal.mode === "current" ? Date.parse(generatedAt) : Number.NaN;
  const lowerBound = temporal.mode === "range" && temporal.start
    ? Date.parse(temporal.start)
    : temporal.mode === "current" && Number.isFinite(currentReference)
      ? currentReference - (temporal.maxAgeDays ?? 365) * 86_400_000
      : Number.NEGATIVE_INFINITY;
  const upperValue = temporal.mode === "as_of"
    ? temporal.asOf
    : temporal.mode === "range"
      ? temporal.end
      : temporal.mode === "current"
        ? generatedAt
        : undefined;
  const upperBound = upperValue ? inclusiveTemporalUpperBound(upperValue) : Number.NaN;
  if (!Number.isFinite(upperBound) || (temporal.mode === "range" && temporal.start && !Number.isFinite(lowerBound))) {
    return { status: "unknown", freshKnowledgeNodeIds: [] };
  }
  const allSources = uniqueKnowledge(grounded.flatMap((entry) => entry.evidence
    .filter((item) => item.link.relation !== "background")
    .map((item) => item.knowledge)));
  const exemptSources = allSources.filter((source) => isTemporalExemptSource(temporal, source));
  const exemptIds = exemptSources.map((source) => source.nodeId);
  const exemptIdSet = new Set(exemptIds);
  const sources = allSources.filter((source) => !exemptIdSet.has(source.nodeId));
  const dated = datedKnowledgeSources(sources);
  const eligible = dated.filter((item) => item.publishedMs >= lowerBound && item.publishedMs <= upperBound);
  const outOfWindow = dated.filter((item) => item.publishedMs < lowerBound || item.publishedMs > upperBound);
  const latestPublishedAt = [...datedKnowledgeSources(allSources)].sort((a, b) => b.publishedMs - a.publishedMs)[0]?.publishedAt;
  return {
    status: outOfWindow.length > 0
      ? "stale"
      : sources.length === 0 && exemptSources.length > 0
        ? "current"
        : dated.length < sources.length || sources.length === 0 ? "unknown" : "current",
    freshKnowledgeNodeIds: [...exemptIds, ...eligible.map((item) => item.source.nodeId)],
    latestPublishedAt,
  };
}

function datedKnowledgeSources(sources: KnowledgeNode[]): Array<{
  source: KnowledgeNode;
  publishedAt: string;
  publishedMs: number;
}> {
  return sources.flatMap((source) => {
    const publishedAt = typeof source.metadata.publishedAt === "string" ? source.metadata.publishedAt : undefined;
    const publishedMs = publishedAt ? Date.parse(publishedAt) : Number.NaN;
    return Number.isFinite(publishedMs) ? [{ source, publishedAt: publishedAt!, publishedMs }] : [];
  });
}

function isTemporalExemptSource(
  temporal: NonNullable<ResearchRequirement["temporalScope"]>,
  source: KnowledgeNode,
): boolean {
  const sourceKey = normalizeTemporalSourceName(`${source.title} ${source.url ?? ""}`);
  return (temporal.exemptSources ?? []).some((exception) => temporalExceptionNames(exception).some((value) => {
      const exceptionKey = normalizeTemporalSourceName(value);
      return exceptionKey.length >= 6 && (
        sourceKey.includes(exceptionKey)
        || (sourceKey.length >= 12 && exceptionKey.includes(sourceKey))
      );
    }));
}

function temporalExceptionNames(
  exception: NonNullable<NonNullable<ResearchRequirement["temporalScope"]>["exemptSources"]>[number],
): string[] {
  if (typeof exception === "string") return [exception];
  return [exception.title, ...(exception.aliases ?? []), ...(exception.identifiers ?? [])];
}

function normalizeTemporalSourceName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function inclusiveTemporalUpperBound(value: string): number {
  const normalized = /^(?:19|20)\d{2}$/u.test(value) ? `${value}-12-31` : value;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) && /^\d{4}-\d{2}-\d{2}$/u.test(normalized)
    ? parsed + 86_400_000 - 1
    : parsed;
}

function auditLeaf(
  entry: ReportBundle["tree"][number],
  policy: EvidenceQualityPolicy,
  requirements: ResearchRequirement[],
): EvidenceNodeAudit {
  const sources = uniqueKnowledge(entry.evidence.map((item) => item.knowledge));
  const links = entry.evidence.map((item) => item.link);
  const domains = new Set(sources.map(sourceDomain));
  const primaryOrOfficialSourceCount = sources.filter(isPrimaryOrOfficial).length;
  const fetchedSourceCount = sources.filter(hasFetchedContent).length;
  const averageQualityScore = sources.length === 0
    ? 0
    : round(sources.reduce((sum, source) => sum + clamp01(source.qualityScore), 0) / sources.length);
  const supportingCount = links.filter((link) => link.relation === "supports").length;
  const qualifyingCount = links.filter((link) => link.relation === "qualifies").length;
  const contradictingCount = links.filter((link) => link.relation === "contradicts").length;
  const backgroundCount = links.filter((link) => link.relation === "background").length;
  const issues: EvidenceQualityIssue[] = [];
  const reportNodeId = entry.node.nodeId;
  const repairPrefix = `Strengthen evidence for "${entry.node.label}"`;
  const appliedSourcePolicy = namedPrimarySourcePolicyForLeaf(entry, requirements, sources);
  const minSources = appliedSourcePolicy?.minSources ?? policy.minSourcesPerLeaf;
  const minIndependentDomains = appliedSourcePolicy?.minIndependentDomains ?? policy.minIndependentDomainsPerLeaf;

  if (supportingCount + qualifyingCount + contradictingCount === 0) {
    issues.push(issue(
      "no_direct_evidence",
      policy.mode === "advisory" ? "warning" : "error",
      `${entry.node.label} has no direct supporting, qualifying, or contradicting evidence; background links cannot ground a conclusion.`,
      reportNodeId,
      `${repairPrefix} with a source directly addressing the claim, or downplay the node.`,
    ));
  }
  if (sources.length < minSources) {
    issues.push(issue(
      "insufficient_source_depth",
      thresholdSeverity(policy),
      `${entry.node.label} uses ${sources.length} unique source(s); policy requires ${minSources}.`,
      reportNodeId,
      `${repairPrefix} with independent corroborating evidence.`,
    ));
  }
  if (domains.size < minIndependentDomains) {
    issues.push(issue(
      "insufficient_source_independence",
      thresholdSeverity(policy),
      `${entry.node.label} uses ${domains.size} independent source domain(s); policy requires ${minIndependentDomains}.`,
      reportNodeId,
      `${repairPrefix} using a genuinely independent publisher or institution.`,
    ));
  }
  if (primaryOrOfficialSourceCount < policy.minPrimaryOrOfficialSourcesPerLeaf) {
    issues.push(issue(
      "missing_authoritative_source",
      thresholdSeverity(policy),
      `${entry.node.label} has ${primaryOrOfficialSourceCount} primary/official source(s); policy requires ${policy.minPrimaryOrOfficialSourcesPerLeaf}.`,
      reportNodeId,
      `${repairPrefix} with an official record, primary document, dataset, or original research.`,
    ));
  }
  if (averageQualityScore < policy.minAverageQualityScore) {
    const clearlyWeak = averageQualityScore < Math.min(0.4, policy.minAverageQualityScore);
    issues.push(issue(
      "low_average_source_quality",
      clearlyWeak && policy.mode !== "advisory" ? "error" : thresholdSeverity(policy),
      `${entry.node.label} has average source quality ${averageQualityScore}; policy requires ${policy.minAverageQualityScore}.`,
      reportNodeId,
      `${repairPrefix} with higher-quality sources and remove weak links that do not ground a concrete claim.`,
    ));
  }
  if (policy.requireFetchedSourcePerLeaf && fetchedSourceCount === 0) {
    issues.push(issue(
      "search_snippet_only_evidence",
      thresholdSeverity(policy),
      `${entry.node.label} relies only on search snippets or saved summaries; no linked source has fetched content.`,
      reportNodeId,
      `Open and inspect at least one core source for ${entry.node.label} before treating the claim as verified.`,
    ));
  }
  const hasMixedConflict = supportingCount > 0 && contradictingCount > 0;
  const statusConflict = (hasMixedConflict && entry.node.status !== "partially_supported")
    || (contradictingCount > 0 && supportingCount === 0 && ["supported", "verified"].includes(entry.node.status))
    || (contradictingCount === 0 && supportingCount > 0 && entry.node.status === "contradicted");
  if (statusConflict) {
    issues.push(issue(
      "evidence_status_inconsistent",
      policy.mode === "advisory" ? "warning" : "error",
      `${entry.node.label} has evidence relations that are inconsistent with node status ${entry.node.status} (${supportingCount} supporting, ${contradictingCount} contradicting).`,
      reportNodeId,
      hasMixedConflict
        ? "Resolve the conflict explicitly and mark the node partially_supported, or explain why one side is not credible."
        : "Align the node status with the direct evidence relation before drafting.",
    ));
  }
  if (hasMixedConflict && entry.reportlets.length > 0) {
    const citedIds = new Set(entry.reportlets.flatMap((reportlet) => reportlet.citedEvidenceLinkIds));
    const hasCitedSupport = links.some((link) => link.relation === "supports" && citedIds.has(link.linkId));
    const hasCitedContradiction = links.some((link) => link.relation === "contradicts" && citedIds.has(link.linkId));
    if (!hasCitedSupport || !hasCitedContradiction) {
      issues.push(issue(
        "conflict_missing_from_reportlet",
        policy.mode === "strict" ? "error" : "warning",
        `${entry.node.label} has mixed evidence, but its reportlets do not cite both supporting and contradicting sides.`,
        reportNodeId,
        "Rewrite the reportlet to cite and compare both sides of the conflict locally.",
      ));
    }
  }

  const sourceDepthScore = ratioScore(sources.length, minSources);
  const domainScore = ratioScore(domains.size, minIndependentDomains);
  const authorityScore = ratioScore(primaryOrOfficialSourceCount, policy.minPrimaryOrOfficialSourcesPerLeaf);
  const qualityScore = ratioScore(averageQualityScore, policy.minAverageQualityScore);
  const fetchedScore = policy.requireFetchedSourcePerLeaf ? (fetchedSourceCount > 0 ? 1 : 0) : 1;
  const directScore = supportingCount + qualifyingCount + contradictingCount > 0 ? 1 : 0;
  const score = round(100 * (
    sourceDepthScore * 0.22
    + domainScore * 0.2
    + authorityScore * 0.18
    + qualityScore * 0.2
    + fetchedScore * 0.1
    + directScore * 0.1
  ));

  return {
    reportNodeId,
    label: entry.node.label,
    status: entry.node.status,
    sourceCount: sources.length,
    independentDomainCount: domains.size,
    primaryOrOfficialSourceCount,
    fetchedSourceCount,
    supportingCount,
    qualifyingCount,
    contradictingCount,
    backgroundCount,
    averageQualityScore,
    score,
    appliedSourcePolicy,
    issues,
  };
}

function namedPrimarySourcePolicyForLeaf(
  entry: ReportBundle["tree"][number],
  requirements: ResearchRequirement[],
  sources: KnowledgeNode[],
): EvidenceNodeAudit["appliedSourcePolicy"] | undefined {
  const requirementIds = new Set(entry.node.requirementIds ?? []);
  const substantive = requirements.filter((requirement) => (
    requirementIds.has(requirement.requirementId)
    && requirement.evidenceRequired !== false
    && requirement.visibility !== "internal"
    && (!['constraint', 'deliverable'].includes(requirement.kind) || requirement.sourcePolicy?.mode === "named_primary_sufficient")
  ));
  if (substantive.length === 0) return undefined;
  const policies = substantive.map((requirement) => requirement.sourcePolicy);
  if (policies.some((sourcePolicy) => sourcePolicy?.mode !== "named_primary_sufficient" || sourcePolicy.sources.length !== 1)) {
    return undefined;
  }
  const namedSources = policies.map((sourcePolicy) => sourcePolicy!.sources[0]!);
  const identityKeys = namedSources.map((source) => namedSourceIdentityKey(source));
  if (!identityKeys[0] || identityKeys.some((key) => key !== identityKeys[0])) return undefined;
  const matching = sources.filter((source) => isPrimaryOrOfficial(source) && knowledgeMatchesNamedSource(source, namedSources[0]!));
  if (matching.length === 0) return undefined;
  return {
    mode: "named_primary_sufficient",
    namedSourceTitle: namedSources[0]!.title,
    minSources: 1,
    minIndependentDomains: 1,
  };
}

function namedSourceIdentityKey(source: NonNullable<ResearchRequirement["sourcePolicy"]>["sources"][number]): string {
  const identifiers = (source.identifiers ?? []).map(normalizeSourceIdentityText).filter(Boolean).sort();
  return identifiers.join("|") || normalizeSourceIdentityText(source.title);
}

function knowledgeMatchesNamedSource(
  knowledge: KnowledgeNode,
  named: NonNullable<ResearchRequirement["sourcePolicy"]>["sources"][number],
): boolean {
  const canonicalUrl = typeof knowledge.metadata.canonicalUrl === "string" ? knowledge.metadata.canonicalUrl : "";
  const publisher = typeof knowledge.metadata.publisher === "string" ? knowledge.metadata.publisher : "";
  const haystack = normalizeSourceIdentityText([
    knowledge.title,
    knowledge.url ?? "",
    canonicalUrl,
    publisher,
  ].join(" "));
  const identifiers = (named.identifiers ?? []).map(normalizeSourceIdentityText).filter(Boolean);
  if (identifiers.length > 0) return identifiers.every((identifier) => haystack.includes(identifier));
  return [named.title, ...(named.aliases ?? [])]
    .map(normalizeSourceIdentityText)
    .filter((value) => value.length >= 6)
    .some((value) => haystack.includes(value));
}

function normalizeSourceIdentityText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function auditReportGrounding(
  markdown: string,
  citationMap: Record<string, string>,
  citationRequired: boolean,
  policy: EvidenceQualityPolicy,
  issues: EvidenceQualityIssue[],
): ReportGroundingAudit {
  const sentences = reportSentences(markdown);
  const evidenceBearing = sentences.filter((sentence) => isEvidenceBearingSentence(sentence) || hasCitationMarker(sentence));
  const cited = evidenceBearing.filter((sentence) => validCitations(sentence, citationMap).length > 0);
  const uncitedQuantitative = evidenceBearing.filter((sentence) => isQuantitativeSentence(sentence) && validCitations(sentence, citationMap).length === 0);
  const citationCoverage = evidenceBearing.length === 0 ? 1 : round(cited.length / evidenceBearing.length);
  if (citationRequired && citationCoverage < policy.minReportCitationCoverage) {
    const noGrounding = evidenceBearing.length > 0 && cited.length === 0;
    issues.push(issue(
      "low_report_citation_coverage",
      policy.mode === "strict" || (policy.mode === "balanced" && noGrounding) ? "error" : "warning",
      `Only ${Math.round(citationCoverage * 100)}% of detected evidence-bearing sentences have a valid local citation; policy requires ${Math.round(policy.minReportCitationCoverage * 100)}%.`,
      undefined,
      "Add a mapped citation at each evidence-dependent sentence, or rewrite unsupported statements as clearly bounded analysis.",
    ));
  }
  if (citationRequired && uncitedQuantitative.length > 0) {
    issues.push(issue(
      "uncited_quantitative_claim",
      policy.mode === "strict" ? "error" : "warning",
      `${uncitedQuantitative.length} quantitative or dated claim(s) lack a valid local citation.`,
      undefined,
      "Cite every number, date, percentage, ranking, and measured comparison at the sentence where it appears.",
    ));
  }
  return {
    evidenceBearingSentenceCount: evidenceBearing.length,
    citedEvidenceBearingSentenceCount: cited.length,
    citationCoverage,
    uncitedQuantitativeClaimCount: uncitedQuantitative.length,
    uncitedClaimSamples: uncitedQuantitative.slice(0, 5).map((sentence) => sentence.slice(0, 240)),
  };
}

function auditRenderedExclusions(
  markdown: string,
  requirements: ResearchRequirement[],
  issues: EvidenceQualityIssue[],
): void {
  const fragments = markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .split(/[。！？，；.!?,;\n]+/u)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  for (const requirement of requirements) {
    for (const exclusion of requirement.renderedExclusions ?? []) {
      const aliases = [exclusion.scope, ...(exclusion.aliases ?? [])]
        .map((value) => value.normalize("NFKC").toLocaleLowerCase().trim())
        .filter(Boolean);
      const violating = fragments.filter((fragment) => {
        const normalized = fragment.normalize("NFKC").toLocaleLowerCase();
        if (!aliases.some((alias) => normalized.includes(alias))) return false;
        return exclusion.mode === "all_mentions" || /\b\d+(?:[.,]\d+)?\s*%/u.test(normalized);
      });
      if (violating.length === 0) continue;
      issues.push(issue(
        "forbidden_rendered_content",
        "error",
        exclusion.mode === "all_mentions"
          ? `The report mentions explicitly excluded scope "${exclusion.scope}".`
          : `The report attributes quantitative content to explicitly excluded scope "${exclusion.scope}".`,
        undefined,
        exclusion.mode === "all_mentions"
          ? "Remove every reader-facing mention of the excluded scope."
          : "Remove the excluded quantitative values. A qualitative distinction may remain when the user requested one.",
      ));
      issues[issues.length - 1]!.requirementId = requirement.requirementId;
    }
  }
}

function auditUnsupportedMetaCertainty(markdown: string, issues: EvidenceQualityIssue[]): void {
  const absoluteClaims = markdown
    .replace(/```[\s\S]*?```/gu, " ")
    .split(/(?<=[。！？!?])|(?<=[.])(?=\s|$)|\n+/u)
    .map((value) => value.trim())
    .filter((value) => value.length >= 6 && !value.startsWith("#") && !/^\|.*\|$/u.test(value))
    .filter((sentence) => {
    const plain = sentence.replace(/\[(?:C\d+|E:[^\]]+)\]/gu, "");
    return [
      /(?:本报告|本文|本研究|报告)?(?:未发现|不存在|没有发现)[^。！？\n]{0,64}(?:矛盾|冲突|模糊|缺失|遗漏|错误)/u,
      /(?:所有|全部)[^。！？\n]{0,56}(?:经过核对|与原文一致|准确无误|完全可靠)/u,
      /(?:完整|全面)[、,]?准确(?:地)?(?:回答|覆盖|反映)/u,
      /确保(?:了)?[^。！？\n]{0,36}(?:准确|可靠|权威|完整)/u,
      /\b(?:this\s+(?:report|study|analysis)\s+)?(?:found\s+no|there\s+(?:are|were)\s+no)\s+(?:conflicts?|contradictions?|ambiguities|gaps?|errors?|omissions)/iu,
      /\ball\s+(?:data|values|claims|findings)\b[^.!?\n]{0,56}\b(?:verified|accurate|error[- ]free|match(?:es|ed)?\s+the\s+source)/iu,
      /\b(?:completely|fully)\s+and\s+accurately\s+(?:answers?|covers?)\b/iu,
    ].some((pattern) => pattern.test(plain));
    });
  if (absoluteClaims.length === 0) return;
  issues.push(issue(
    "unsupported_meta_certainty",
    "error",
    `${absoluteClaims.length} report-wide certainty claim(s) assert completeness, accuracy, or absence of conflict without a deterministic basis.`,
    undefined,
    "Remove report self-certification. State only the concrete, cited finding or a bounded evidence scope.",
  ));
}

function hasCitationMarker(sentence: string): boolean {
  return /\[(?:C\d+|E:[^\]]+)\]/.test(sentence);
}

function reportSentences(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, " ");
  const body = withoutCode.split(/\n##\s*(?:Evidence Index|References|参考文献|资料索引)(?:\s|\n|$)/i)[0] ?? withoutCode;
  return body
    .split(/(?<=[。！？!?])|(?<=[.])(?=\s|$)|\n+/u)
    .map((value) => value.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/, "").trim())
    .filter((value) => value.length >= 18 && !value.startsWith("#") && !/^\|.*\|$/.test(value));
}

function isEvidenceBearingSentence(sentence: string): boolean {
  const plain = sentence.replace(/\[(?:C\d+|E:[^\]]+)\]/g, "");
  if (isQuantitativeSentence(plain)) return true;
  return /(?:数据显示|研究(?:显示|发现|表明)|报告(?:显示|指出)|统计(?:显示|表明)|增长|下降|上升|减少|增加|导致|促使|相比|高于|低于|占比|according to|stud(?:y|ies) (?:show|find|found)|data (?:show|indicate)|report(?:s|ed)? (?:show|find|found)|increas(?:e|ed)|decreas(?:e|ed)|higher than|lower than|resulted in|led to)/i.test(plain);
}

function isQuantitativeSentence(sentence: string): boolean {
  const plain = sentence.replace(/\[(?:C\d+|E:[^\]]+)\]/g, "");
  return /(?:\b(?:1[5-9]|20)\d{2}\b|\b\d+(?:\.\d+)?\s*%|\b\d+(?:\.\d+)?\s*(?:million|billion|trillion|万人|亿元|万亿元|倍|个|项|年|月|日)\b)/i.test(plain);
}

function validCitations(sentence: string, citationMap: Record<string, string>): string[] {
  return Array.from(sentence.matchAll(/\[(C\d+)\]/g))
    .map((match) => match[1]!)
    .filter((citationId) => Boolean(citationMap[citationId]));
}

function sourceDomain(source: KnowledgeNode): string {
  const canonical = typeof source.metadata.canonicalUrl === "string"
    ? source.metadata.canonicalUrl
    : canonicalizeSourceUrl(source.url);
  return sourcePublisherDomain(canonical || source.url) ?? `unknown:${source.nodeId}`;
}

function isPrimaryOrOfficial(source: KnowledgeNode): boolean {
  return source.sourceTier === "primary" || source.sourceTier === "official";
}

function hasFetchedContent(source: KnowledgeNode): boolean {
  return source.metadata.fetched === true
    || (typeof source.metadata.contentPreview === "string" && source.metadata.contentPreview.trim().length >= 200);
}

function uniqueKnowledge(sources: KnowledgeNode[]): KnowledgeNode[] {
  return Array.from(new Map(sources.map((source) => [source.nodeId, source])).values());
}

function thresholdSeverity(policy: EvidenceQualityPolicy): EvidenceQualityIssue["severity"] {
  return policy.mode === "strict" ? "error" : "warning";
}

function issue(
  code: string,
  severity: EvidenceQualityIssue["severity"],
  message: string,
  reportNodeId?: string,
  suggestedRepair?: string,
  coverage?: Pick<EvidenceQualityIssue, "requiredYears" | "coveredYears" | "missingYears" | "requiredEntities" | "coveredEntities" | "missingEntities" | "requiredExamples" | "coveredExamples" | "missingExamples" | "requiredCells" | "coveredCells" | "missingCells" | "requiredMetrics" | "coveredMetrics" | "missingMetrics" | "requiredMetricCells" | "coveredMetricCells" | "missingMetricCells">,
): EvidenceQualityIssue {
  return { code, severity, message, reportNodeId, suggestedRepair, ...coverage };
}

function ratioScore(actual: number, required: number): number {
  if (required <= 0) return 1;
  return Math.min(1, Math.max(0, actual / required));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
