import type { ReportArtifact, ReportBundle } from "@deepresearch/contracts";
import { truncate } from "../infra/ai.js";
import { isReaderHiddenRequirement } from "../requirement-policy.js";
import { canonicalizeSourceUrl } from "../source-identity.js";
import type { PhaseContext } from "../types.js";

const REPORT_WRITER_CONTEXT_FRACTION = 0.55;
const REPORT_FALLBACK_TOTAL_EVIDENCE_LIMIT = 120;
const REPORT_SUBTREE_TOTAL_EVIDENCE_LIMIT = 80;
const REPORT_NODE_EVIDENCE_LIMIT = 28;
const REPORT_NODE_GAP_LIMIT = 8;
const REPORT_SOURCE_SUMMARY_CHARS = 700;
const REPORT_CLAIM_TEXT_CHARS = 420;
const REPORT_SOURCE_METADATA_TEXT_CHARS = 360;
const REPORT_CITATION_SUMMARY_CHARS = 360;
const REPORT_CITATION_LIST_LIMIT = 80;
const REPORT_SOURCE_EXCERPT_CHARS = 9000;
const REPORT_SOURCE_EXCERPT_TOTAL_CHARS = 18000;

interface LeafFirstPlan {
  leaves: ReportBundle["tree"];
  sections: Array<{ nodeId: string; title: string; leafNodeIds: string[] }>;
  requiredCalls: number;
}

type ReportEvidenceItem = ReportBundle["tree"][number]["evidence"][number];

interface LeafEvidenceBatch {
  batchIndex: number;
  totalBatches: number;
  totalEvidence: number;
  evidence: ReportEvidenceItem[];
}

function compactBundle(bundle: ReportBundle): unknown {
  let remainingEvidence = REPORT_FALLBACK_TOTAL_EVIDENCE_LIMIT;
  return {
    root: bundle.root,
    tree: bundle.tree.map((entry) => {
      const evidence = takeReportEvidence(entry.evidence);
      return {
        node: entry.node,
        reportlets: compactReportlets(bundle, entry.reportlets),
        evidence: evidence.map((item) => compactEvidenceItem(bundle, item)),
        evidenceOmitted: Math.max(0, entry.evidence.length - evidence.length),
        openGaps: reportableLowImpactGaps(entry.openGaps).slice(0, REPORT_NODE_GAP_LIMIT),
      };
    }),
  };
  function takeReportEvidence<T>(items: T[]): T[] {
    const taken = items.slice(0, Math.max(0, Math.min(REPORT_NODE_EVIDENCE_LIMIT, remainingEvidence)));
    remainingEvidence -= taken.length;
    return taken;
  }
}

function sectionNodeSummary(bundle: ReportBundle, nodeId: string): unknown {
  const entry = bundle.tree.find((item) => item.node.nodeId === nodeId);
  if (!entry) return { nodeId };
  return {
    node: entry.node,
    children: entry.children.map((childId) => {
      const child = bundle.tree.find((item) => item.node.nodeId === childId);
      return child
        ? {
            nodeId: child.node.nodeId,
            label: child.node.label,
            status: child.node.status,
            coverage: child.node.coverage,
          }
        : { nodeId: childId };
    }),
  };
}

function reportableLowImpactGaps(gaps: ReportBundle["tree"][number]["openGaps"]): ReportBundle["tree"][number]["openGaps"] {
  return gaps.filter((gap) => gap.status !== "closed" && gap.status === "acknowledged" && gap.impact === "low");
}

function compactSubtreeBundle(bundle: ReportBundle, nodeId: string): unknown {
  const descendantIds = subtreeNodeIds(bundle, nodeId);
  let remainingEvidence = REPORT_SUBTREE_TOTAL_EVIDENCE_LIMIT;
  return {
    root: bundle.tree.find((entry) => entry.node.nodeId === nodeId)?.node ?? bundle.root,
    nodes: bundle.tree.filter((entry) => descendantIds.has(entry.node.nodeId)).map((entry) => {
      const evidence = takeReportEvidence(entry.evidence);
      return {
        node: entry.node,
        children: entry.children,
        reportlets: compactReportlets(bundle, entry.reportlets),
        evidence: evidence.map((item) => compactEvidenceItem(bundle, item)),
        evidenceOmitted: Math.max(0, entry.evidence.length - evidence.length),
        openGaps: reportableLowImpactGaps(entry.openGaps).slice(0, REPORT_NODE_GAP_LIMIT),
      };
    }),
  };
  function takeReportEvidence<T>(items: T[]): T[] {
    const taken = items.slice(0, Math.max(0, Math.min(REPORT_NODE_EVIDENCE_LIMIT, remainingEvidence)));
    remainingEvidence -= taken.length;
    return taken;
  }
}

function compactNodeBundle(bundle: ReportBundle, nodeId: string, batch?: LeafEvidenceBatch): unknown {
  const entry = bundle.tree.find((item) => item.node.nodeId === nodeId);
  if (!entry) return undefined;
  const evidence = batch?.evidence ?? entry.evidence.slice(0, REPORT_NODE_EVIDENCE_LIMIT);
  return {
    node: entry.node,
    reportlets: compactReportlets(bundle, entry.reportlets),
    evidence: evidence.map((item) => compactEvidenceItem(bundle, item)),
    evidenceBatch: batch ? {
      batchIndex: batch.batchIndex,
      totalBatches: batch.totalBatches,
      totalEvidence: batch.totalEvidence,
      includedEvidence: batch.evidence.length,
      remainingEvidence: Math.max(0, batch.totalEvidence - batch.batchIndex * REPORT_NODE_EVIDENCE_LIMIT),
    } : undefined,
    evidenceOmitted: batch ? 0 : Math.max(0, entry.evidence.length - REPORT_NODE_EVIDENCE_LIMIT),
    openGaps: reportableLowImpactGaps(entry.openGaps).slice(0, REPORT_NODE_GAP_LIMIT),
  };
}

function leafEvidenceBatches(leaf: ReportBundle["tree"][number]): LeafEvidenceBatch[] {
  if (leaf.evidence.length === 0) {
    return [{ batchIndex: 1, totalBatches: 1, totalEvidence: 0, evidence: [] }];
  }
  const totalBatches = Math.ceil(leaf.evidence.length / REPORT_NODE_EVIDENCE_LIMIT);
  return Array.from({ length: totalBatches }, (_, index) => {
    const start = index * REPORT_NODE_EVIDENCE_LIMIT;
    return {
      batchIndex: index + 1,
      totalBatches,
      totalEvidence: leaf.evidence.length,
      evidence: leaf.evidence.slice(start, start + REPORT_NODE_EVIDENCE_LIMIT),
    };
  });
}

function compactEvidenceItem(
  bundle: ReportBundle,
  item: ReportBundle["tree"][number]["evidence"][number],
): Record<string, unknown> {
  return {
    citationId: citationForKnowledge(bundle, item.knowledge),
    relation: item.link.relation,
    claimText: truncate(String(item.link.claimText ?? ""), REPORT_CLAIM_TEXT_CHARS),
    confidence: item.link.confidence,
    source: {
      title: truncate(item.knowledge.title, REPORT_SOURCE_SUMMARY_CHARS),
      url: item.knowledge.url,
      sourceTier: item.knowledge.sourceTier,
      summary: truncate(item.knowledge.summary ?? "", REPORT_SOURCE_SUMMARY_CHARS),
      metadata: compactKnowledgeMetadata(item.knowledge.metadata),
    },
  };
}

type ReportletItem = ReportBundle["tree"][number]["reportlets"][number];

function compactReportlets(bundle: ReportBundle, reportlets: ReportletItem[]): Array<Record<string, unknown>> {
  return reportlets.map((reportlet) => ({
    reportletId: reportlet.reportletId,
    taskId: reportlet.taskId,
    title: reportlet.title,
    markdown: normalizeReportletCitations(bundle, reportlet.markdown),
    citationIds: citationIdsForReportlet(bundle, reportlet),
    citedEvidenceLinkIds: reportlet.citedEvidenceLinkIds,
    plannedReportlet: reportlet.plannedReportlet,
  }));
}

function formatReportlets(bundle: ReportBundle, reportlets: ReportletItem[]): string {
  if (reportlets.length === 0) return "[]";
  return JSON.stringify(compactReportlets(bundle, reportlets), null, 2);
}

function normalizeReportletCitations(bundle: ReportBundle, markdown: string): string {
  return markdown.replace(/\[E:([^\]]+)\]/g, (placeholder, evidenceLinkId: string) => {
    const citationId = citationForEvidenceLinkId(bundle, evidenceLinkId.trim());
    return citationId ? `[${citationId}]` : placeholder;
  });
}

function compactKnowledgeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const out: Record<string, unknown> = {};
  for (const key of ["canonicalUrl", "searchTitle", "searchSnippet", "description", "fetched", "fetchProvider", "reusedByTaskIds"] as const) {
    const value = metadata[key];
    if (typeof value === "string") out[key] = truncate(value, REPORT_SOURCE_METADATA_TEXT_CHARS);
    else if (Array.isArray(value)) out[key] = value.filter((item): item is string => typeof item === "string").slice(0, 8);
    else if (typeof value === "boolean") out[key] = value;
  }
  const aliases = Array.isArray(metadata.aliases) ? metadata.aliases.filter((item): item is string => typeof item === "string").slice(0, 5) : [];
  if (aliases.length > 0) out.aliases = aliases;
  return out;
}

export function relatedSupplementalEvidence(
  bundle: ReportBundle,
  leaf: ReportBundle["tree"][number],
  excludedCitationIds: Set<string>,
  limit = 16,
): ReportEvidenceItem[] {
  const ownedRequirements = requirementsForNode(bundle, leaf.node.nodeId);
  const targetParts = [
    leaf.node.label,
    leaf.node.scopeNote,
    leaf.node.hypothesis?.statement,
    leaf.node.hypothesis?.researchBrief,
    ...ownedRequirements.flatMap((requirement) => [requirement.description, ...requirement.evidenceNeeds, ...requirement.successCriteria]),
  ].filter((item): item is string => Boolean(item));
  const target = targetParts.join(" ");
  const coverageTargets = requirementCoverageTargets(ownedRequirements);
  const byKnowledge = new Map<string, { evidence: ReportEvidenceItem; text: string; score: number }>();
  for (const entry of bundle.tree) {
    for (const evidence of entry.evidence) {
      const citationId = citationForKnowledge(bundle, evidence.knowledge);
      if (!citationId || excludedCitationIds.has(citationId)) continue;
      const sourceTier = evidence.knowledge.sourceTier;
      if (
        (evidence.knowledge.qualityScore ?? 0) < 0.6
        && sourceTier !== "official"
        && sourceTier !== "primary"
      ) continue;
      const candidateText = [
        evidence.knowledge.title,
        evidence.knowledge.summary,
      ].filter(Boolean).join(" ");
      const score = reportTextOverlap(target, candidateText);
      if (score <= 0) continue;
      const previous = byKnowledge.get(evidence.knowledge.nodeId);
      if (!previous || score > previous.score) byKnowledge.set(evidence.knowledge.nodeId, { evidence, text: candidateText, score });
    }
  }
  const candidates = [...byKnowledge.values()];
  const selected: typeof candidates = [];
  const selectedIds = new Set<string>();
  for (const coverageTarget of coverageTargets) {
    const best = candidates
      .filter((candidate) => !selectedIds.has(candidate.evidence.knowledge.nodeId))
      .map((candidate) => ({ candidate, score: reportTextOverlap(coverageTarget, candidate.text) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || evidenceCandidateQuality(b.candidate.evidence) - evidenceCandidateQuality(a.candidate.evidence))[0]?.candidate;
    if (!best) continue;
    selected.push(best);
    selectedIds.add(best.evidence.knowledge.nodeId);
    if (selected.length >= limit) return selected.map((item) => item.evidence);
  }
  for (const candidate of candidates.sort((a, b) => b.score - a.score || evidenceCandidateQuality(b.evidence) - evidenceCandidateQuality(a.evidence))) {
    if (selectedIds.has(candidate.evidence.knowledge.nodeId)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.evidence.knowledge.nodeId);
    if (selected.length >= limit) break;
  }
  return selected.map((item) => item.evidence);
}

function requirementCoverageTargets(requirements: NonNullable<ReportBundle["constraints"]["requirements"]>): string[] {
  const targets: string[] = [];
  for (const requirement of requirements) {
    targets.push(...(requirement.entityScope ?? []), ...(requirement.metricScope ?? []));
    for (const value of [requirement.description, ...requirement.successCriteria]) {
      targets.push(value);
      const tail = value.match(/(?:dimensions?|columns?|rows?|including|include|across)\s*:?\s*(.+)$/i)?.[1];
      if (!tail) continue;
      targets.push(...tail
        .split(/[,;、，]/u)
        .map((item) => item.replace(/^(?:and|or)\s+/i, "").trim())
        .filter((item) => item.length >= 3 && item.length <= 80));
    }
  }
  return Array.from(new Set(targets.map((item) => item.toLowerCase().replace(/\s+/g, " ").trim())))
    .filter(Boolean)
    .slice(0, 24);
}

function evidenceCandidateQuality(evidence: ReportEvidenceItem): number {
  const tier = evidence.knowledge.sourceTier === "official"
    ? 1
    : evidence.knowledge.sourceTier === "primary"
      ? 0.9
      : evidence.knowledge.sourceTier === "secondary"
        ? 0.6
        : 0.3;
  return tier + (evidence.knowledge.qualityScore ?? 0) + evidence.link.confidence * 0.5;
}

function reportTextOverlap(left: string, right: string): number {
  const leftTokens = reportTextTokens(left);
  const rightTokens = reportTextTokens(right);
  let score = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) score += token.length >= 5 ? 2 : 1;
  return score;
}

function reportTextTokens(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const words = normalized.split(/\s+/).filter((token) => token.length >= 3 && !REPORT_STOP_WORDS.has(token));
  const chinese = Array.from(normalized.matchAll(/[\p{Script=Han}]{2,}/gu)).flatMap((match) => {
    const chars = Array.from(match[0]);
    return chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  });
  return new Set([...words, ...chinese]);
}

const REPORT_STOP_WORDS = new Set(["the", "and", "for", "with", "from", "this", "that", "into", "using", "report", "table", "requirement"]);

function citationMapFromBundle(bundle: ReportBundle): Record<string, string> {
  const citationMap: Record<string, string> = {};
  for (const item of bundle.globalEvidenceIndex) citationMap[item.citationId] = item.knowledgeNodeId;
  return citationMap;
}

function citationForKnowledge(bundle: ReportBundle, knowledge: { nodeId: string; url?: string; metadata?: Record<string, unknown> }): string | undefined {
  const byId = bundle.globalEvidenceIndex.find((citation) => citation.knowledgeNodeId === knowledge.nodeId);
  if (byId) return byId.citationId;
  const canonical = typeof knowledge.metadata?.canonicalUrl === "string" ? knowledge.metadata.canonicalUrl : canonicalizeSourceUrl(knowledge.url);
  const byCanonical = bundle.globalEvidenceIndex.find((citation) => citation.canonicalUrl && citation.canonicalUrl === canonical);
  if (byCanonical) return byCanonical.citationId;
  const byUrl = bundle.globalEvidenceIndex.find((citation) => citation.url && canonicalizeSourceUrl(citation.url) === canonical);
  return byUrl?.citationId;
}

function formatCitationList(bundle: ReportBundle, citationIds?: Iterable<string>): string {
  const allowed = citationIds ? new Set(citationIds) : undefined;
  const items = allowed
    ? bundle.globalEvidenceIndex.filter((item) => allowed.has(item.citationId)).slice(0, REPORT_CITATION_LIST_LIMIT)
    : bundle.globalEvidenceIndex.slice(0, REPORT_CITATION_LIST_LIMIT);
  if (items.length === 0) return "[]";
  const lines = items
    .map((item) => {
      const summary = item.summary ? `\n  摘要: ${truncate(item.summary, REPORT_CITATION_SUMMARY_CHARS)}` : "";
      const provenance = [item.sourceTier, item.publishedAt, item.publisher].filter(Boolean).join(" | ");
      return `- [${item.citationId}] ${item.title}${provenance ? ` (${provenance})` : ""}${item.url ? ` ${item.url}` : ""}${summary}`;
    })
    .join("\n");
  const omitted = allowed ? Math.max(0, allowed.size - items.length) : Math.max(0, bundle.globalEvidenceIndex.length - items.length);
  return omitted > 0 ? `${lines}\n- ... omitted ${omitted} additional citations from writer context` : lines;
}

function citationIdsForEntry(bundle: ReportBundle, entry: ReportBundle["tree"][number]): string[] {
  return Array.from(new Set([
    ...citationIdsForEvidence(bundle, entry.evidence),
    ...citationIdsForReportlets(bundle, entry.reportlets),
  ]));
}

function citationIdsForEvidence(bundle: ReportBundle, evidence: ReportEvidenceItem[]): string[] {
  return evidence
    .map((item) => citationForKnowledge(bundle, item.knowledge))
    .filter((item): item is string => Boolean(item));
}

function citationIdsForReportlets(bundle: ReportBundle, reportlets: ReportletItem[]): string[] {
  return Array.from(new Set(reportlets.flatMap((reportlet) => citationIdsForReportlet(bundle, reportlet))));
}

function citationIdsForReportlet(bundle: ReportBundle, reportlet: ReportletItem): string[] {
  const fromEvidence = reportlet.citedEvidenceLinkIds
    .map((evidenceLinkId) => citationForEvidenceLinkId(bundle, evidenceLinkId))
    .filter((item): item is string => Boolean(item));
  const fromKnowledge = reportlet.citedKnowledgeNodeIds
    .map((knowledgeNodeId) => bundle.globalEvidenceIndex.find((item) => item.knowledgeNodeId === knowledgeNodeId)?.citationId)
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set([...fromEvidence, ...fromKnowledge]));
}

function citationForEvidenceLinkId(bundle: ReportBundle, evidenceLinkId: string): string | undefined {
  for (const entry of bundle.tree) {
    const evidence = entry.evidence.find((item) => item.link.linkId === evidenceLinkId);
    if (evidence) return citationForKnowledge(bundle, evidence.knowledge);
  }
  return undefined;
}

function citationIdsForSubtree(bundle: ReportBundle, nodeId: string): string[] {
  const descendantIds = subtreeNodeIds(bundle, nodeId);
  const ids = bundle.tree
    .filter((entry) => descendantIds.has(entry.node.nodeId))
    .flatMap((entry) => citationIdsForEntry(bundle, entry));
  return Array.from(new Set(ids));
}

function citationIdsFromMarkdown(markdown: string): string[] {
  return Array.from(new Set(Array.from(markdown.matchAll(/\[C(\d+)\]/g)).map((match) => `C${match[1]}`)));
}

function diagnosticsForBundle(bundle: ReportBundle): ReportArtifact["diagnostics"] {
  const diagnostics: ReportArtifact["diagnostics"] = [];
  if (bundle.globalEvidenceIndex.length === 0 && bundle.constraints.citationRequired) {
    diagnostics.push({ code: "no_evidence", severity: "warning", message: "Citation-required report has no evidence index." });
  }
  return diagnostics;
}

function buildLeafFirstPlan(bundle: ReportBundle): LeafFirstPlan {
  const nonPruned = bundle.tree.filter((entry) => isReportableEntry(bundle, entry));
  const childIdsByParent = childMapFromParents(bundle);
  const entriesById = new Map(bundle.tree.map((entry) => [entry.node.nodeId, entry]));
  const hasNonPrunedChild = (nodeId: string) => (childIdsByParent.get(nodeId) ?? [])
    .some((childId) => {
      const entry = entriesById.get(childId);
      return entry ? isReportableEntry(bundle, entry) : false;
    });
  const leaves = nonPruned.filter((entry) => entry.node.nodeId !== bundle.root.nodeId && !hasNonPrunedChild(entry.node.nodeId));
  const topLevelAspects = nonPruned.filter((entry) => entry.node.nodeKind === "aspect" && entry.node.parentNodeId === bundle.root.nodeId);
  const coveredLeafIds = new Set<string>();
  const sections = topLevelAspects.map((section) => {
    const descendants = subtreeNodeIds(bundle, section.node.nodeId);
    const leafNodeIds = leaves
      .filter((leaf) => descendants.has(leaf.node.nodeId))
      .map((leaf) => leaf.node.nodeId);
    for (const leafNodeId of leafNodeIds) coveredLeafIds.add(leafNodeId);
    return {
      nodeId: section.node.nodeId,
      title: section.node.label,
      leafNodeIds,
    };
  }).filter((section) => section.leafNodeIds.length > 0);
  const rootEntry = entriesById.get(bundle.root.nodeId);
  const ungroupedLeafNodeIds = leaves.map((leaf) => leaf.node.nodeId).filter((nodeId) => !coveredLeafIds.has(nodeId));
  if (rootEntry && (sections.length === 0 || ungroupedLeafNodeIds.length > 0)) {
    sections.push({
      nodeId: rootEntry.node.nodeId,
      title: rootEntry.node.label,
      leafNodeIds: ungroupedLeafNodeIds.length > 0 ? ungroupedLeafNodeIds : leaves.map((leaf) => leaf.node.nodeId),
    });
  }
  return {
    leaves,
    sections,
    requiredCalls: leaves.reduce((sum, leaf) => sum + leafDraftCallCount(leaf), 0)
      + sections.filter((section) => section.leafNodeIds.length > 1).length
      + 1,
  };
}

function isReportableEntry(bundle: ReportBundle, entry: ReportBundle["tree"][number]): boolean {
  if (entry.node.status === "pruned" || entry.node.status === "downplayed") return false;
  const requirementIds = entry.node.requirementIds ?? [];
  return requirementIds.length === 0
    || requirementIds.some((requirementId) => requirementDisposition(bundle, requirementId) !== "omit");
}

function leafDraftCallCount(leaf: ReportBundle["tree"][number]): number {
  return leaf.reportlets.length > 0 ? 1 : leafEvidenceBatches(leaf).length;
}

function nearestContainingAspect(bundle: ReportBundle, nodeId: string): ReportBundle["tree"][number] | undefined {
  const entriesById = new Map(bundle.tree.map((entry) => [entry.node.nodeId, entry]));
  let cursor = entriesById.get(nodeId)?.node.parentNodeId;
  while (cursor) {
    const entry = entriesById.get(cursor);
    if (!entry) return undefined;
    if (entry.node.nodeKind === "aspect") return entry;
    cursor = entry.node.parentNodeId;
  }
  return undefined;
}

function subtreeNodeIds(bundle: ReportBundle, nodeId: string): Set<string> {
  const childIdsByParent = childMapFromParents(bundle);
  const ids = new Set<string>([nodeId]);
  const queue = [...(childIdsByParent.get(nodeId) ?? [])];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    queue.push(...(childIdsByParent.get(current) ?? []));
  }
  return ids;
}

function requirementsForNode(bundle: ReportBundle, nodeId: string, includeDescendants = false): NonNullable<ReportBundle["constraints"]["requirements"]> {
  const requirements = readerFacingRequirements(bundle);
  const targetIds = includeDescendants ? subtreeNodeIds(bundle, nodeId) : new Set([nodeId]);
  const requirementIds = new Set(bundle.tree
    .filter((entry) => targetIds.has(entry.node.nodeId))
    .flatMap((entry) => entry.node.requirementIds ?? []));
  return requirements.filter((requirement) => requirementIds.has(requirement.requirementId));
}

function readerFacingRequirements(bundle: ReportBundle): NonNullable<ReportBundle["constraints"]["requirements"]> {
  return (bundle.constraints.requirements ?? []).filter((requirement) => (
    !isReaderHiddenRequirement(requirement)
    && requirementDisposition(bundle, requirement.requirementId) !== "omit"
  ));
}

function writerConstraints(bundle: ReportBundle): ReportBundle["constraints"] {
  const requirements = readerFacingRequirements(bundle);
  return {
    ...bundle.constraints,
    rubricText: requirements.map((requirement) => requirement.description).join("\n"),
    requirements,
  };
}

function writerConstraintsForNode(bundle: ReportBundle, nodeId: string): ReportBundle["constraints"] {
  const requirements = requirementsForNode(bundle, nodeId);
  const requirementIds = new Set(requirements.map((requirement) => requirement.requirementId));
  return {
    ...bundle.constraints,
    rubricText: requirements.map((requirement) => requirement.description).join("\n"),
    requirements,
    waivers: bundle.constraints.waivers?.filter((waiver) => waiver.requirementIds?.some((requirementId) => requirementIds.has(requirementId))),
  };
}

function requirementDisposition(
  bundle: ReportBundle,
  requirementId: string,
): "downplay" | "omit" | "accept_risk" | undefined {
  return bundle.constraints.waivers?.find((waiver) => waiver.requirementIds?.includes(requirementId))?.action;
}

function childMapFromParents(bundle: ReportBundle): Map<string, string[]> {
  const childIdsByParent = new Map<string, string[]>();
  for (const entry of bundle.tree) {
    const parentNodeId = entry.node.parentNodeId;
    if (!parentNodeId) continue;
    const children = childIdsByParent.get(parentNodeId) ?? [];
    children.push(entry.node.nodeId);
    childIdsByParent.set(parentNodeId, children);
  }
  return childIdsByParent;
}

function positiveOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function reportContextBudget(ctx: PhaseContext): { maxPromptChars: number; leafPromptChars: number; sectionPromptChars: number; synthesisPromptChars: number } {
  const configuredTokens = ctx.state.runtimeProfile.phases.report?.contextTokenLimit ?? 96000;
  const maxPromptChars = Math.max(24000, Math.min(360000, Math.floor(configuredTokens * REPORT_WRITER_CONTEXT_FRACTION)));
  return {
    maxPromptChars,
    leafPromptChars: Math.min(maxPromptChars, 90000),
    sectionPromptChars: Math.min(maxPromptChars, 120000),
    synthesisPromptChars: Math.min(maxPromptChars, 150000),
  };
}

function limitReportPrompt(prompt: string, maxChars: number): string {
  if (prompt.length <= maxChars) return prompt;
  const marker = "\n\n[Writer context trimmed to stay below the model context window. Use the visible citations and summarized evidence only.]\n";
  return `${prompt.slice(0, Math.max(0, maxChars - marker.length - 3)).trimEnd()}...${marker}`;
}

export {
  REPORT_CLAIM_TEXT_CHARS,
  REPORT_NODE_EVIDENCE_LIMIT,
  REPORT_NODE_GAP_LIMIT,
  REPORT_SOURCE_EXCERPT_CHARS,
  REPORT_SOURCE_EXCERPT_TOTAL_CHARS,
  REPORT_SOURCE_SUMMARY_CHARS,
  buildLeafFirstPlan,
  citationForKnowledge,
  citationIdsForEvidence,
  citationIdsForReportlets,
  citationIdsFromMarkdown,
  citationMapFromBundle,
  compactBundle,
  compactKnowledgeMetadata,
  compactNodeBundle,
  diagnosticsForBundle,
  formatCitationList,
  formatReportlets,
  isReportableEntry,
  leafEvidenceBatches,
  limitReportPrompt,
  nearestContainingAspect,
  positiveOptional,
  readerFacingRequirements,
  reportContextBudget,
  reportableLowImpactGaps,
  requirementDisposition,
  requirementsForNode,
  sectionNodeSummary,
  writerConstraints,
  writerConstraintsForNode,
};
export type { LeafEvidenceBatch, LeafFirstPlan, ReportEvidenceItem };
