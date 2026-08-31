import {
  ValidationError,
  type EvidenceLink,
  type KnowledgeNode,
  type OpenGap,
  type ReportBundle,
  type Reportlet,
  type ReportNode,
} from "@deepresearch/contracts";

export interface KgSnapshot {
  version: 5;
  reportNodes: ReportNode[];
  knowledgeNodes: KnowledgeNode[];
  evidenceLinks: EvidenceLink[];
  openGaps: OpenGap[];
  reportlets?: Reportlet[];
}

export function sameOpenGap(a: OpenGap, b: OpenGap): boolean {
  if ((a.reportNodeId ?? "") !== (b.reportNodeId ?? "")) return false;
  const exact = normalizeGapText(a.gapType) === normalizeGapText(b.gapType)
    && normalizeGapText(a.description) === normalizeGapText(b.description);
  const bothActive = a.status !== "closed" && b.status !== "closed";
  return exact || (bothActive && (semanticallySameEvidenceGap(a, b) || semanticallySameTemporalDataGap(a, b)));
}

export function mergeOpenGap(existing: OpenGap, incoming: OpenGap): OpenGap {
  const exactIdentity = normalizeGapText(existing.gapType) === normalizeGapText(incoming.gapType)
    && normalizeGapText(existing.description) === normalizeGapText(incoming.description);
  const temporalIdentity = !exactIdentity && semanticallySameTemporalDataGap(existing, incoming);
  const preferredTemporal = temporalIdentity ? narrowerTemporalGap(existing, incoming) : undefined;
  return {
    ...existing,
    ...incoming,
    gapType: exactIdentity ? incoming.gapType : preferredTemporal?.gapType ?? existing.gapType,
    description: exactIdentity ? incoming.description : preferredTemporal?.description ?? existing.description,
    impact: higherImpact(existing.impact, incoming.impact),
    status: incoming.status ?? existing.status ?? "open",
    suggestedQuery: preferredTemporal?.suggestedQuery || incoming.suggestedQuery || existing.suggestedQuery,
    taskId: preferredTemporal?.taskId || incoming.taskId || existing.taskId,
  };
}

const GENERIC_EVIDENCE_GAP_TYPES = new Set(["evidence_gap", "evidence_missing", "missing_evidence", "missing_source"]);
const TEMPORAL_DATA_GAP_TYPES = new Set(["missing_data", "data_gap", "temporal_coverage"]);

const COUNTRY_PATTERNS: Array<[string, RegExp]> = [
  ["india", /印度|\bindia\b/i],
  ["pakistan", /巴基斯坦|\bpakistan\b/i],
  ["bangladesh", /孟加拉国|\bbangladesh\b/i],
  ["nepal", /尼泊尔|\bnepal\b/i],
  ["sri_lanka", /斯里兰卡|\bsri\s*lanka\b/i],
];

const FACET_PATTERNS: Array<[string, RegExp]> = [
  ["drivers", /驱动|推动因素|driver|success factor/i],
  ["challenges", /挑战|障碍|barrier|challenge/i],
  ["skills", /技能|劳动力能力|skill|competenc/i],
  ["financial", /财务|融资|资本投入|financial|financ|capital investment/i],
  ["regulatory", /监管|法规|政策框架|regulat/i],
  ["infrastructure", /基础设施|宽带|infrastructure|broadband/i],
  ["training", /培训|再培训|发展项目|training|upskill|reskill/i],
  ["citation", /引用|引文|citation/i],
  ["time", /时间范围|截止|年份|时效|time scope|as of|date range/i],
  ["wef", /世界经济论坛|\bwef\b|world economic forum/i],
  ["table", /表格|列对比|table|column/i],
  ["explanation", /详细解释|具体能力|具体组成|一句话解释|explanation|explain|components?/i],
];

function semanticallySameEvidenceGap(a: OpenGap, b: OpenGap): boolean {
  if (!GENERIC_EVIDENCE_GAP_TYPES.has(normalizeGapText(a.gapType))
    || !GENERIC_EVIDENCE_GAP_TYPES.has(normalizeGapText(b.gapType))) return false;
  if (!sameStringSet(extractLabels(a.description, COUNTRY_PATTERNS), extractLabels(b.description, COUNTRY_PATTERNS))) return false;
  if (!sameStringSet(extractLabels(a.description, FACET_PATTERNS), extractLabels(b.description, FACET_PATTERNS))) return false;
  if (!sameStringSet(extractGapNumbers(a.description), extractGapNumbers(b.description))) return false;

  const left = semanticGapTokens(a.description);
  const right = semanticGapTokens(b.description);
  if (left.size < 6 || right.size < 6) return false;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = intersection / Math.min(left.size, right.size);
  return jaccard >= 0.66 || containment >= 0.84;
}

function semanticallySameTemporalDataGap(a: OpenGap, b: OpenGap): boolean {
  if (!TEMPORAL_DATA_GAP_TYPES.has(normalizeGapText(a.gapType))
    || !TEMPORAL_DATA_GAP_TYPES.has(normalizeGapText(b.gapType))) return false;
  const leftYears = extractGapYears(a.description);
  const rightYears = extractGapYears(b.description);
  if (leftYears.size === 0 || rightYears.size === 0) return false;
  if (!isSubset(leftYears, rightYears) && !isSubset(rightYears, leftYears)) return false;
  if (temporalScopePrefix(a.description) !== temporalScopePrefix(b.description)) return false;

  const left = semanticGapTokens(missingDataClause(a.description));
  const right = semanticGapTokens(missingDataClause(b.description));
  if (left.size < 4 || right.size < 4) return false;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  const jaccard = union > 0 ? intersection / union : 0;
  const containment = intersection / Math.min(left.size, right.size);
  return jaccard >= 0.65 && containment >= 0.9;
}

function temporalScopePrefix(value: string): string {
  const clause = missingDataClause(value);
  const firstYear = clause.search(/\b(?:19|20)\d{2}\b/u);
  if (firstYear < 0) return "";
  return clause.slice(0, firstYear)
    .toLowerCase()
    .replace(/未找到|没有找到|缺少|缺乏|不足|尚无|需要补充|需查找|missing|lacks?|without|insufficient/giu, "")
    .replace(/[\s,，、:：;；()（）[\]【】_-]+/gu, "")
    .trim();
}

function narrowerTemporalGap(a: OpenGap, b: OpenGap): OpenGap {
  const leftYears = extractGapYears(a.description);
  const rightYears = extractGapYears(b.description);
  if (leftYears.size < rightYears.size) return a;
  if (rightYears.size < leftYears.size) return b;
  return b;
}

function extractGapYears(value: string): Set<string> {
  const clause = missingDataClause(value);
  const years = new Set<string>();
  const rangePattern = /\b((?:19|20)\d{2})\s*(?:年\s*)?(?:至|到|[-–—~～])\s*((?:19|20)\d{2})\b/gu;
  for (const match of clause.matchAll(rangePattern)) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 50) continue;
    for (let year = start; year <= end; year += 1) years.add(String(year));
  }
  for (const match of clause.matchAll(/\b(?:19|20)\d{2}\b/gu)) years.add(match[0]!);
  return years;
}

function missingDataClause(value: string): string {
  return value
    .split(/[。.!?！？]|已获取|已找到|仅找到|however|while/iu, 1)[0]
    ?.trim() || value;
}

function isSubset(left: Set<string>, right: Set<string>): boolean {
  return left.size <= right.size && Array.from(left).every((item) => right.has(item));
}

function extractLabels(value: string, patterns: Array<[string, RegExp]>): Set<string> {
  return new Set(patterns.filter(([, pattern]) => pattern.test(value)).map(([label]) => label));
}

function extractGapNumbers(value: string): Set<string> {
  const arabic = Array.from(value.matchAll(/\b(?:19|20)\d{2}\b|\b\d+\b|\bP[_-]?\d+\b/gi), (match) => match[0]!.toLowerCase());
  const chinese = Array.from(value.matchAll(/[一二三四五六七八九十]+(?=类|国|项|个|列)/g), (match) => match[0]!);
  return new Set([...arabic, ...chinese]);
}

function sameStringSet(a: Set<string>, b: Set<string>): boolean {
  return a.size === b.size && Array.from(a).every((item) => b.has(item));
}

function semanticGapTokens(value: string): Set<string> {
  const canonical = value.toLowerCase()
    .replace(/未找到|没有找到|缺少|缺乏|不足|尚无|需要补充|需查找/g, " gap ")
    .replace(/权威|官方/g, " authority ")
    .replace(/证据|来源|报告|研究|调查|文献/g, " evidence ")
    .replace(/直接针对|针对|直接/g, " direct ")
    .replace(/not found|missing|lacks?|without|insufficient|needs? more/gi, " gap ")
    .replace(/authoritative|official/gi, " authority ")
    .replace(/sources?|evidence|reports?|stud(?:y|ies)|research|survey|literature/gi, " evidence ")
    .replace(/directly|direct/gi, " direct ");
  const tokens = new Set<string>();
  for (const word of canonical.match(/[a-z][a-z0-9_-]{2,}/g) ?? []) {
    const stemmed = word.replace(/(?:ing|ed|es|s)$/, "");
    if (!["the", "and", "for", "from", "with", "that", "this", "into", "about"].includes(stemmed)) tokens.add(stemmed);
  }
  for (const run of canonical.match(/[\u3400-\u9fff]{2,}/g) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) tokens.add(run.slice(index, index + 2));
  }
  return tokens;
}

function normalizeGapText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function higherImpact(a: OpenGap["impact"], b: OpenGap["impact"]): OpenGap["impact"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const left = a ?? "medium";
  const right = b ?? "medium";
  return rank[right] > rank[left] ? right : left;
}

export function validateKnowledgeNode(node: KnowledgeNode): void {
  if (!node.nodeId) throw new ValidationError("KnowledgeNode.nodeId is required", "nodeId");
  if (!node.nodeType) throw new ValidationError("KnowledgeNode.nodeType is required", "nodeType");
  if (!node.title) throw new ValidationError("KnowledgeNode.title is required", "title");
  if (!node.contentHash) throw new ValidationError("KnowledgeNode.contentHash is required", "contentHash");
  if (typeof node.summary !== "string") throw new ValidationError("KnowledgeNode.summary must be string", "summary");
  if (!node.sourceTier) throw new ValidationError("KnowledgeNode.sourceTier is required", "sourceTier");
  if (typeof node.qualityScore !== "number" || node.qualityScore < 0 || node.qualityScore > 1) {
    throw new ValidationError("KnowledgeNode.qualityScore must be in [0,1]", "qualityScore");
  }
  if (!node.retrievedByTaskId) throw new ValidationError("KnowledgeNode.retrievedByTaskId is required", "retrievedByTaskId");
  if (!node.retrievedAt) throw new ValidationError("KnowledgeNode.retrievedAt is required", "retrievedAt");
  if (!node.metadata) throw new ValidationError("KnowledgeNode.metadata is required", "metadata");
}

export function validateReportNode(node: ReportNode): void {
  if (!node.nodeId) throw new ValidationError("ReportNode.nodeId is required", "nodeId");
  if (!["root", "aspect", "hypothesis"].includes(node.nodeKind)) {
    throw new ValidationError(`ReportNode.nodeKind invalid: ${node.nodeKind}`, "nodeKind");
  }
  if (!node.label) throw new ValidationError("ReportNode.label is required", "label");
  if (node.parentNodeId === undefined) {
    throw new ValidationError("ReportNode.parentNodeId is required", "parentNodeId");
  }
  if (typeof node.scopeNote !== "string") throw new ValidationError("ReportNode.scopeNote must be string", "scopeNote");
  if (!node.status) throw new ValidationError("ReportNode.status is required", "status");
  if (node.requirementIds !== undefined && (!Array.isArray(node.requirementIds) || node.requirementIds.some((id) => typeof id !== "string" || !id.trim()))) {
    throw new ValidationError("ReportNode.requirementIds must contain non-empty strings", "requirementIds");
  }
  if (!node.coverage) throw new ValidationError("ReportNode.coverage is required", "coverage");
  if (typeof node.coverage.supportingCount !== "number") {
    throw new ValidationError("ReportNode.coverage.supportingCount must be number", "coverage.supportingCount");
  }
  if (typeof node.coverage.contradictingCount !== "number") {
    throw new ValidationError("ReportNode.coverage.contradictingCount must be number", "coverage.contradictingCount");
  }
  if (typeof node.coverage.openGapCount !== "number") {
    throw new ValidationError("ReportNode.coverage.openGapCount must be number", "coverage.openGapCount");
  }
  if (node.nodeKind === "hypothesis" && !node.hypothesis) {
    throw new ValidationError("Hypothesis ReportNode must include hypothesis", "hypothesis");
  }
  if (node.draftSummary !== undefined && typeof node.draftSummary !== "string") {
    throw new ValidationError("ReportNode.draftSummary must be string", "draftSummary");
  }
  if (node.draftMarkdown !== undefined && typeof node.draftMarkdown !== "string") {
    throw new ValidationError("ReportNode.draftMarkdown must be string", "draftMarkdown");
  }
  if (!node.createdAt) throw new ValidationError("ReportNode.createdAt is required", "createdAt");
  if (!node.updatedAt) throw new ValidationError("ReportNode.updatedAt is required", "updatedAt");
}

export function validateEvidenceLink(link: EvidenceLink): void {
  if (!link.linkId) throw new ValidationError("EvidenceLink.linkId is required", "linkId");
  if (!link.reportNodeId) throw new ValidationError("EvidenceLink.reportNodeId is required", "reportNodeId");
  if (!link.knowledgeNodeId) throw new ValidationError("EvidenceLink.knowledgeNodeId is required", "knowledgeNodeId");
  if (!link.relation) throw new ValidationError("EvidenceLink.relation is required", "relation");
  if (!link.claimText) throw new ValidationError("EvidenceLink.claimText is required", "claimText");
  if (typeof link.confidence !== "number" || link.confidence < 0 || link.confidence > 1) {
    throw new ValidationError("EvidenceLink.confidence must be in [0,1]", "confidence");
  }
  if (!link.createdByTaskId) throw new ValidationError("EvidenceLink.createdByTaskId is required", "createdByTaskId");
  if (!link.createdAt) throw new ValidationError("EvidenceLink.createdAt is required", "createdAt");
}

export function validateReportlet(reportlet: Reportlet): void {
  if (!reportlet.reportletId) throw new ValidationError("Reportlet.reportletId is required", "reportletId");
  if (!reportlet.reportNodeId) throw new ValidationError("Reportlet.reportNodeId is required", "reportNodeId");
  if (!reportlet.taskId) throw new ValidationError("Reportlet.taskId is required", "taskId");
  if (!reportlet.title) throw new ValidationError("Reportlet.title is required", "title");
  if (typeof reportlet.markdown !== "string" || !reportlet.markdown.trim()) {
    throw new ValidationError("Reportlet.markdown is required", "markdown");
  }
  if (!Array.isArray(reportlet.citedEvidenceLinkIds)) {
    throw new ValidationError("Reportlet.citedEvidenceLinkIds must be array", "citedEvidenceLinkIds");
  }
  if (!Array.isArray(reportlet.citedKnowledgeNodeIds)) {
    throw new ValidationError("Reportlet.citedKnowledgeNodeIds must be array", "citedKnowledgeNodeIds");
  }
  if (reportlet.plannedReportlet) {
    if (!reportlet.plannedReportlet.partId) throw new ValidationError("Reportlet.plannedReportlet.partId is required", "plannedReportlet.partId");
    if (!reportlet.plannedReportlet.researchQuestion) throw new ValidationError("Reportlet.plannedReportlet.researchQuestion is required", "plannedReportlet.researchQuestion");
    if (!reportlet.plannedReportlet.writingGoal) throw new ValidationError("Reportlet.plannedReportlet.writingGoal is required", "plannedReportlet.writingGoal");
  }
  if (!reportlet.createdAt) throw new ValidationError("Reportlet.createdAt is required", "createdAt");
  if (!reportlet.updatedAt) throw new ValidationError("Reportlet.updatedAt is required", "updatedAt");
}

export function sortEvidenceKnowledge(items: Array<{ link: EvidenceLink; knowledge: KnowledgeNode }>): Array<{ link: EvidenceLink; knowledge: KnowledgeNode }> {
  const rank = (tier: string): number => {
    if (tier === "official") return 0;
    if (tier === "primary") return 1;
    if (tier === "secondary") return 2;
    return 3;
  };
  return [...items].sort((a, b) => rank(a.knowledge.sourceTier) - rank(b.knowledge.sourceTier) || a.knowledge.title.localeCompare(b.knowledge.title));
}

export function buildReportBundleFromState(state: {
  episodeId: string;
  rootNodeId: string;
  reportNodes: ReportNode[];
  knowledgeNodes: KnowledgeNode[];
  evidenceLinks: EvidenceLink[];
  openGaps: OpenGap[];
  reportlets?: Reportlet[];
  constraints: ReportBundle["constraints"];
}): ReportBundle {
  const root = state.reportNodes.find((node) => node.nodeId === state.rootNodeId);
  if (!root) throw new ValidationError(`Root report node not found: ${state.rootNodeId}`, "rootNodeId");

  const knowledgeById = new Map(state.knowledgeNodes.map((node) => [node.nodeId, node]));
  const reportEvidenceLinks = state.evidenceLinks.filter((link) => link.reportNodeId !== state.rootNodeId);
  const tree = state.reportNodes.map((node) => {
    const children = state.reportNodes
      .filter((candidate) => candidate.parentNodeId === node.nodeId)
      .map((child) => child.nodeId);
    const evidence = sortEvidenceKnowledge(reportEvidenceLinks
      .filter((link) => link.reportNodeId === node.nodeId)
      .flatMap((link) => {
        const knowledge = knowledgeById.get(link.knowledgeNodeId);
        return knowledge ? [{ link, knowledge }] : [];
    }));
    const openGaps = state.openGaps.filter((gap) => gap.reportNodeId === node.nodeId);
    const reportlets = (state.reportlets ?? [])
      .filter((reportlet) => reportlet.reportNodeId === node.nodeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.reportletId.localeCompare(b.reportletId));
    return { node, children, evidence, reportlets, openGaps };
  });

  const reportletKnowledgeNodeIds = new Set((state.reportlets ?? []).flatMap((reportlet) => reportlet.citedKnowledgeNodeIds));
  const citationKnowledgeNodeIds = new Set([
    ...reportEvidenceLinks.map((link) => link.knowledgeNodeId),
    ...reportletKnowledgeNodeIds,
  ]);
  const citationNodes = dedupeKnowledgeNodesForCitations(state.knowledgeNodes.filter((node) => citationKnowledgeNodeIds.has(node.nodeId)));
  const globalEvidenceIndex = citationNodes.map((node, index) => ({
    citationId: `C${index + 1}`,
    knowledgeNodeId: node.nodeId,
    title: node.title,
    url: node.url,
    canonicalUrl: canonicalKey(node),
    sourceTier: node.sourceTier,
    qualityScore: node.qualityScore,
    publishedAt: typeof node.metadata.publishedAt === "string" ? node.metadata.publishedAt : undefined,
    publisher: typeof node.metadata.publisher === "string" ? node.metadata.publisher : undefined,
    authors: Array.isArray(node.metadata.authors) ? node.metadata.authors.filter((author): author is string => typeof author === "string") : undefined,
    summary: node.summary,
    retrievedAt: node.retrievedAt,
  }));

  return {
    episodeId: state.episodeId,
    root,
    tree,
    globalEvidenceIndex,
    constraints: state.constraints,
  };
}

function dedupeKnowledgeNodesForCitations(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const byKey = new Map<string, KnowledgeNode>();
  for (const node of nodes) {
    const key = canonicalKey(node) || node.contentHash || node.nodeId;
    const existing = byKey.get(key);
    if (!existing || sourceRank(node) < sourceRank(existing) || (sourceRank(node) === sourceRank(existing) && node.summary.length > existing.summary.length)) {
      byKey.set(key, node);
    }
  }
  return Array.from(byKey.values());
}

function canonicalKey(node: KnowledgeNode): string {
  const explicit = node.metadata?.canonicalUrl;
  if (typeof explicit === "string" && explicit) return explicit;
  if (!node.url) return "";
  try {
    const parsed = new URL(node.url);
    parsed.hash = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      const lower = key.toLowerCase();
      if (lower.startsWith("utm_") || ["spm", "from", "source", "share", "ref", "ref_src"].includes(lower)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hostname = parsed.hostname.toLowerCase();
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) parsed.pathname = parsed.pathname.slice(0, -1);
    if (!parsed.searchParams.toString()) parsed.search = "";
    return parsed.toString();
  } catch {
    return node.url;
  }
}

function sourceRank(node: KnowledgeNode): number {
  if (node.sourceTier === "official") return 0;
  if (node.sourceTier === "primary") return 1;
  if (node.sourceTier === "secondary") return 2;
  return 3;
}
