import type {
  ContextPacket,
  EvidenceLink,
  GlobalRubric,
  KnowledgeNode,
  KgService,
  RuntimeProfile,
  TaskItem,
  TaskLedger,
  ToolDefinition,
} from "@deepresearch/contracts";

export interface BuildContextPacketInput {
  task: TaskItem;
  globalRubric: GlobalRubric;
  runtimeProfile: RuntimeProfile;
  kg: KgService;
  ledger: TaskLedger;
  availableTools: ToolDefinition[];
}

export async function buildContextPacket(input: BuildContextPacketInput): Promise<ContextPacket> {
  const reportNode = await input.kg.getReportNode(input.task.reportNodeId);
  if (!reportNode) throw new Error(`ReportNode not found for context: ${input.task.reportNodeId}`);
  const parent = reportNode.parentNodeId ? await input.kg.getReportNode(reportNode.parentNodeId) : null;
  const allReportNodes = await input.kg.listReportNodes();
  const siblingReportNodeIds = new Set(allReportNodes
    .filter((node) => node.nodeId !== reportNode.nodeId && node.parentNodeId === reportNode.parentNodeId)
    .map((node) => node.nodeId));
  const siblingTasks = (await input.ledger.listAll())
    .filter((task) => task.taskId !== input.task.taskId)
    .filter((task) => siblingReportNodeIds.has(task.reportNodeId))
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || b.priority - a.priority)
    .slice(0, 5)
    .map((task) => ({ taskId: task.taskId, title: task.title, status: task.status }));

  const evidence = await relevantEvidence(
    input.kg,
    reportNode.nodeId,
    reportNode.parentNodeId,
    allReportNodes,
    evidenceRelevanceText(input.task, reportNode, input.globalRubric),
  );
  const reportlets = await relevantReportlets(input.kg, reportNode.nodeId, reportNode.parentNodeId, allReportNodes);
  const agentBudget = input.runtimeProfile.agents.evidence;
  if (!agentBudget) throw new Error("RuntimeProfile.agents.evidence is required");
  if (typeof agentBudget.maxToolCalls !== "number") throw new Error("RuntimeProfile.agents.evidence.maxToolCalls is required");
  if (typeof agentBudget.maxSearchCalls !== "number") throw new Error("RuntimeProfile.agents.evidence.maxSearchCalls is required");
  if (typeof agentBudget.maxFetchCalls !== "number") throw new Error("RuntimeProfile.agents.evidence.maxFetchCalls is required");

  return {
    globalRubric: {
      rubricText: input.globalRubric.rubricText,
      outputHints: input.globalRubric.outputHints,
      requirements: input.globalRubric.requirements?.filter((requirement) => reportNode.requirementIds?.includes(requirement.requirementId)),
    },
    currentTask: {
      taskId: input.task.taskId,
      branchId: input.task.branchId,
      reportNodeId: input.task.reportNodeId,
      objective: input.task.objective,
      acceptanceCriteria: input.task.acceptanceCriteria.filter(
        (criterion) => !criterion.startsWith("Internal reportlet plan "),
      ),
      plannedReportlet: input.task.plannedReportlet ? structuredClone(input.task.plannedReportlet) : undefined,
      plannedReportlets: input.task.plannedReportlets ? structuredClone(input.task.plannedReportlets) : undefined,
    },
    currentReportNode: {
      nodeId: reportNode.nodeId,
      nodeKind: reportNode.nodeKind,
      label: reportNode.label,
      scopeNote: reportNode.scopeNote,
      hypothesis: reportNode.hypothesis,
      requirementIds: reportNode.requirementIds,
    },
    parentContext: parent ? { nodeId: parent.nodeId, label: parent.label, scopeNote: parent.scopeNote } : undefined,
    siblingTasks,
    relevantEvidence: evidence,
    relevantReportlets: reportlets,
    budget: {
      maxReactSteps: agentBudget.maxReactSteps,
      maxToolCalls: agentBudget.maxToolCalls,
      maxSearchCalls: agentBudget.maxSearchCalls,
      maxFetchCalls: agentBudget.maxFetchCalls,
      targetReactSteps: agentBudget.targetReactSteps,
      targetToolCalls: agentBudget.targetToolCalls,
      targetSearchCalls: agentBudget.targetSearchCalls,
      targetFetchCalls: agentBudget.targetFetchCalls,
    },
    availableTools: input.availableTools,
    bindingContext: {
      currentReportNodeId: input.task.reportNodeId,
      currentTaskId: input.task.taskId,
      currentBranchId: input.task.branchId,
    },
  };
}

async function relevantReportlets(kg: KgService, reportNodeId: string, parentNodeId: string | null, allReportNodes: Array<{ nodeId: string; parentNodeId: string | null }>): Promise<NonNullable<ContextPacket["relevantReportlets"]>> {
  if (!kg.listReportlets) return [];
  const siblingNodeIds = new Set(allReportNodes
    .filter((node) => node.nodeId !== reportNodeId && node.parentNodeId === parentNodeId)
    .map((node) => node.nodeId));
  const candidates = [
    ...await kg.listReportlets(reportNodeId),
    ...(parentNodeId ? await kg.listReportlets(parentNodeId) : []),
    ...(await kg.listReportlets()).filter((reportlet) => siblingNodeIds.has(reportlet.reportNodeId)),
  ];
  const byId = new Map(candidates.map((reportlet) => [reportlet.reportletId, reportlet]));
  return Array.from(byId.values())
    .sort((a, b) => localityRank(a.reportNodeId, reportNodeId, parentNodeId) - localityRank(b.reportNodeId, reportNodeId, parentNodeId) || a.createdAt.localeCompare(b.createdAt))
    .slice(0, 12)
    .map((reportlet) => ({
      reportletId: reportlet.reportletId,
      reportNodeId: reportlet.reportNodeId,
      title: reportlet.title,
      markdown: truncate(reportlet.markdown, 1000),
      citedEvidenceLinkIds: reportlet.citedEvidenceLinkIds.slice(0, 12),
      citedKnowledgeNodeIds: reportlet.citedKnowledgeNodeIds.slice(0, 12),
      plannedReportlet: reportlet.plannedReportlet ? structuredClone(reportlet.plannedReportlet) : undefined,
    }));
}

async function relevantEvidence(
  kg: KgService,
  reportNodeId: string,
  parentNodeId: string | null,
  allReportNodes: Array<{ nodeId: string; parentNodeId: string | null }>,
  relevanceText: string,
): Promise<ContextPacket["relevantEvidence"]> {
  const siblingNodeIds = new Set(allReportNodes
    .filter((node) => node.nodeId !== reportNodeId && node.parentNodeId === parentNodeId)
    .map((node) => node.nodeId));
  const allLinks = await kg.listEvidenceLinks();
  const knowledgeById = new Map((await kg.listKnowledgeNodes()).map((knowledge) => [knowledge.nodeId, knowledge]));
  const relevanceTokens = semanticTokens(relevanceText);
  const directKnowledge = dedupeKnowledge(allLinks
    .filter((link) => link.reportNodeId === reportNodeId || link.reportNodeId === parentNodeId)
    .flatMap((link) => knowledgeById.get(link.knowledgeNodeId) ? [knowledgeById.get(link.knowledgeNodeId)!] : []));
  const candidateLinks = dedupeEvidenceLinks(allLinks.filter((link) => (
    link.reportNodeId === reportNodeId
    || link.reportNodeId === parentNodeId
    || (siblingNodeIds.has(link.reportNodeId) && sourceReuseRelevance(
      relevanceTokens,
      knowledgeById.get(link.knowledgeNodeId),
      directKnowledge,
    ) >= 0.16)
  )));
  const out: Array<ContextPacket["relevantEvidence"][number] & { sourceReportNodeId?: string }> = [];
  for (const link of candidateLinks.slice(0, 36)) {
    const knowledge = knowledgeById.get(link.knowledgeNodeId);
    if (!knowledge) continue;
    out.push({
      knowledgeNodeId: knowledge.nodeId,
      title: knowledge.title,
      url: knowledge.url,
      sourceTier: knowledge.sourceTier,
      qualityScore: knowledge.qualityScore,
      publishedAt: typeof knowledge.metadata.publishedAt === "string" ? knowledge.metadata.publishedAt : undefined,
      summary: truncate(knowledge.summary, 200),
      relation: link.relation,
      sourceReportNodeId: link.reportNodeId,
    });
  }
  const sortedLocal = out.sort((a, b) => {
    const locality = localityRank(a.sourceReportNodeId, reportNodeId, parentNodeId) - localityRank(b.sourceReportNodeId, reportNodeId, parentNodeId);
    return locality || sourceRank(a.sourceTier) - sourceRank(b.sourceTier);
  });
  const local = dedupeContextEvidenceByKnowledge(sortedLocal).slice(0, 18);
  const direct = local.filter((item) => item.sourceReportNodeId === reportNodeId || item.sourceReportNodeId === parentNodeId);
  const sibling = local.filter((item) => item.sourceReportNodeId !== reportNodeId && item.sourceReportNodeId !== parentNodeId);
  const localKnowledgeNodeIds = new Set(local.map((item) => item.knowledgeNodeId));
  const representativeLinkByKnowledge = representativeEvidenceLinkByKnowledge(allLinks);
  const requestedYears = yearsFromText(relevanceText);
  const requestedYearRange = yearRangeFromYears(requestedYears);
  const directYears = new Set(directKnowledge.map((knowledge) => sourcePeriodYear(knowledge.title)).filter((year): year is number => year !== undefined));
  const reusableCandidates = Array.from(knowledgeById.values())
    .filter((knowledge) => !localKnowledgeNodeIds.has(knowledge.nodeId))
    .map((knowledge) => reusableSourceCandidate(
      knowledge,
      relevanceTokens,
      directKnowledge,
      representativeLinkByKnowledge.get(knowledge.nodeId),
      requestedYears,
    ))
    .filter((candidate) => sourceYearsWithinRange(candidate.years, requestedYearRange))
    .filter((candidate) => candidate.relevance >= 0.16)
    .sort((a, b) => (
      Number(b.matchesRequestedYear) - Number(a.matchesRequestedYear)
      || b.relevance - a.relevance
      || sourceRank(a.knowledge.sourceTier) - sourceRank(b.knowledge.sourceTier)
      || b.knowledge.qualityScore - a.knowledge.qualityScore
      || a.knowledge.nodeId.localeCompare(b.knowledge.nodeId)
    ));
  const reusable = selectReusableSourceCandidates(reusableCandidates, directYears, 6)
    .map(({ knowledge, link }) => ({
      knowledgeNodeId: knowledge.nodeId,
      title: knowledge.title,
      url: knowledge.url,
      sourceTier: knowledge.sourceTier,
      qualityScore: knowledge.qualityScore,
      publishedAt: typeof knowledge.metadata.publishedAt === "string" ? knowledge.metadata.publishedAt : undefined,
      summary: truncate(knowledge.summary, 200),
      relation: link?.relation ?? "background",
    }));
  return [
    ...direct.map(({ sourceReportNodeId: _sourceReportNodeId, ...item }) => item),
    ...reusable,
    ...sibling.map(({ sourceReportNodeId: _sourceReportNodeId, ...item }) => item),
  ];
}

interface ReusableSourceCandidate {
  knowledge: KnowledgeNode;
  link?: EvidenceLink;
  relevance: number;
  seriesSimilarity: number;
  year?: number;
  years: number[];
  matchesRequestedYear: boolean;
}

function reusableSourceCandidate(
  knowledge: KnowledgeNode,
  queryTokens: Set<string>,
  directKnowledge: KnowledgeNode[],
  link: EvidenceLink | undefined,
  requestedYears: Set<number>,
): ReusableSourceCandidate {
  const semantic = sourceRelevance(queryTokens, knowledge);
  const year = sourcePeriodYear(knowledge.title);
  const years = sourceYearsInTitle(knowledge.title);
  const seriesSimilarity = directKnowledge.reduce(
    (best, reference) => Math.max(best, titleSeriesSimilarity(knowledge.title, reference.title)),
    0,
  );
  return {
    knowledge,
    link,
    relevance: Math.max(semantic, seriesSimilarity >= 0.42 ? seriesSimilarity * 0.55 : 0),
    seriesSimilarity,
    year,
    years,
    matchesRequestedYear: years.some((candidateYear) => requestedYears.has(candidateYear)),
  };
}

function selectReusableSourceCandidates(
  candidates: ReusableSourceCandidate[],
  directYears: Set<number>,
  limit: number,
): ReusableSourceCandidate[] {
  const selected: ReusableSourceCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedSeriesYears = new Set<number>();
  const seriesCandidates = candidates
    .filter((candidate) => candidate.seriesSimilarity >= 0.42)
    .sort((a, b) => (
      b.seriesSimilarity - a.seriesSimilarity
      || (b.year ?? 0) - (a.year ?? 0)
      || b.relevance - a.relevance
    ));
  for (const candidate of seriesCandidates) {
    if (selected.length >= Math.min(3, limit)) break;
    if (candidate.year !== undefined && (directYears.has(candidate.year) || selectedSeriesYears.has(candidate.year))) continue;
    selected.push(candidate);
    selectedIds.add(candidate.knowledge.nodeId);
    if (candidate.year !== undefined) selectedSeriesYears.add(candidate.year);
  }
  for (const candidate of candidates) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.knowledge.nodeId)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.knowledge.nodeId);
  }
  return selected;
}

function yearsFromText(value: string): Set<number> {
  return new Set((value.match(/(?:19|20)\d{2}/gu) ?? [])
    .map(Number)
    .filter((year) => year >= 1900 && year <= 2100));
}

function yearRangeFromYears(years: Set<number>): { start: number; end: number } | undefined {
  const values = Array.from(years);
  if (values.length === 0) return undefined;
  return { start: Math.min(...values), end: Math.max(...values) };
}

function sourcePeriodYear(title: string): number | undefined {
  const annual = title.match(/((?:19|20)\d{2})\s*年度/u);
  const years = sourceYearsInTitle(title);
  const year = Number(annual?.[1] ?? years.at(-1));
  return Number.isInteger(year) ? year : undefined;
}

function sourceYearsInTitle(title: string): number[] {
  return (title.match(/(?:19|20)\d{2}/gu) ?? []).map(Number);
}

function sourceYearsWithinRange(
  years: number[],
  range: { start: number; end: number } | undefined,
): boolean {
  return years.length === 0 || range === undefined || years.some((year) => year >= range.start && year <= range.end);
}

function evidenceRelevanceText(
  task: TaskItem,
  reportNode: { label: string; scopeNote: string; hypothesis?: { statement: string; researchBrief: string; evidenceGuidance: string }; requirementIds?: string[] },
  rubric: GlobalRubric,
): string {
  const requirementIds = new Set(reportNode.requirementIds ?? []);
  const requirements = (rubric.requirements ?? []).filter((requirement) => requirementIds.has(requirement.requirementId));
  return [
    task.title,
    task.objective,
    ...task.acceptanceCriteria,
    reportNode.label,
    reportNode.scopeNote,
    reportNode.hypothesis?.statement,
    reportNode.hypothesis?.researchBrief,
    reportNode.hypothesis?.evidenceGuidance,
    ...requirements.flatMap((requirement) => [
      requirement.description,
      ...requirement.evidenceNeeds,
      ...requirement.successCriteria,
      ...(requirement.geographicScope ?? []),
    ]),
  ].filter(Boolean).join(" ");
}

function representativeEvidenceLinkByKnowledge(links: EvidenceLink[]): Map<string, EvidenceLink> {
  const byKnowledge = new Map<string, EvidenceLink>();
  for (const link of links) {
    const existing = byKnowledge.get(link.knowledgeNodeId);
    if (!existing || evidenceRelationRank(link.relation) < evidenceRelationRank(existing.relation)) {
      byKnowledge.set(link.knowledgeNodeId, link);
    }
  }
  return byKnowledge;
}

function evidenceRelationRank(relation: string): number {
  if (relation === "supports") return 0;
  if (relation === "qualifies") return 1;
  if (relation === "contradicts") return 2;
  return 3;
}

const LOW_SIGNAL_SEMANTIC_TOKENS = new Set([
  "分析", "数据", "报告", "研究", "年度", "情况", "整理", "提供", "来源", "结果", "要求", "进行",
  "中国", "城市", "市轨", "轨道", "道交", "交通", "城轨", "协会", "统计",
  "城市轨", "市轨道", "轨道交", "道交通", "城市轨道", "市轨道交", "轨道交通",
  "每年", "年份", "分别", "列出", "制作", "表格", "包含", "单位", "明确", "部分", "需要",
  "analysis", "data", "report", "research", "source", "results", "annual", "year",
]);

function semanticTokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase();
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9][a-z0-9._-]{2,}/gu) ?? []) {
    if (!LOW_SIGNAL_SEMANTIC_TOKENS.has(word)) tokens.add(word);
  }
  for (const sequence of normalized.match(/\p{Script=Han}{2,}/gu) ?? []) {
    for (let index = 0; index < sequence.length - 1; index++) {
      const token = sequence.slice(index, index + 2);
      if (!LOW_SIGNAL_SEMANTIC_TOKENS.has(token)) tokens.add(token);
    }
    for (let index = 0; index < sequence.length - 3; index++) {
      const token = sequence.slice(index, index + 4);
      if (!LOW_SIGNAL_SEMANTIC_TOKENS.has(token)) tokens.add(token);
    }
  }
  return tokens;
}

function sourceRelevance(queryTokens: Set<string>, source: KnowledgeNode): number {
  if (queryTokens.size === 0) return 0;
  const titleScore = semanticOverlapScore(queryTokens, semanticTokens(source.title), 10);
  const summaryScore = semanticOverlapScore(queryTokens, semanticTokens(source.summary), 16);
  const publisherScore = typeof source.metadata.publisher === "string"
    ? semanticOverlapScore(queryTokens, semanticTokens(source.metadata.publisher), 8)
    : 0;
  return Math.max(titleScore, summaryScore, publisherScore);
}

function semanticOverlapScore(queryTokens: Set<string>, sourceTokens: Set<string>, denominatorCap: number): number {
  if (sourceTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of sourceTokens) if (queryTokens.has(token)) overlap += 1;
  return overlap / Math.min(sourceTokens.size, denominatorCap);
}

function sourceReuseRelevance(
  queryTokens: Set<string>,
  source: KnowledgeNode | undefined,
  directKnowledge: KnowledgeNode[],
): number {
  if (!source) return 0;
  const semantic = sourceRelevance(queryTokens, source);
  const series = directKnowledge.reduce(
    (best, reference) => Math.max(best, titleSeriesSimilarity(source.title, reference.title)),
    0,
  );
  return Math.max(semantic, series >= 0.42 ? series * 0.55 : 0);
}

function titleSeriesSimilarity(left: string, right: string): number {
  if (!isPeriodicReportTitle(left) || !isPeriodicReportTitle(right)) return 0;
  const leftTokens = titleSeriesTokens(left);
  const rightTokens = titleSeriesTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.min(leftTokens.size, rightTokens.size);
}

function isPeriodicReportTitle(value: string): boolean {
  const normalized = value.normalize("NFKC").toLowerCase();
  return /(?:年度.{0,16}(?:报告|综述)|统计.{0,16}(?:报告|综述)|annual.{0,24}report)/u.test(normalized);
}

function titleSeriesTokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLowerCase().replace(/\d+/gu, "");
  const compact = normalized.replace(/[^a-z\p{Script=Han}]+/gu, "");
  const tokens = new Set<string>();
  for (let index = 0; index < compact.length - 1; index++) {
    tokens.add(compact.slice(index, index + 2));
  }
  return tokens;
}

function dedupeKnowledge(items: KnowledgeNode[]): KnowledgeNode[] {
  const byId = new Map(items.map((item) => [item.nodeId, item]));
  return Array.from(byId.values());
}

function dedupeContextEvidenceByKnowledge<T extends { knowledgeNodeId: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.knowledgeNodeId)) return false;
    seen.add(item.knowledgeNodeId);
    return true;
  });
}

function dedupeEvidenceLinks(links: EvidenceLink[]): EvidenceLink[] {
  const out = new Map<string, EvidenceLink>();
  for (const link of links) out.set(link.linkId, link);
  return Array.from(out.values());
}

function localityRank(sourceReportNodeId: string | undefined, currentReportNodeId: string, parentNodeId: string | null): number {
  if (sourceReportNodeId === currentReportNodeId) return 0;
  if (parentNodeId && sourceReportNodeId === parentNodeId) return 1;
  return 2;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 3)}...`;
}

function sourceRank(tier: string): number {
  if (tier === "official") return 0;
  if (tier === "primary") return 1;
  if (tier === "secondary") return 2;
  return 3;
}

function statusRank(status: string): number {
  if (status === "completed") return 0;
  if (status === "running") return 1;
  if (status === "queued") return 2;
  return 3;
}
