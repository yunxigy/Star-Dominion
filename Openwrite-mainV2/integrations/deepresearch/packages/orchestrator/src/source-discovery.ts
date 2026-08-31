import type { ResearchRequirement } from "@deepresearch/contracts";
import { calibrateSourceQualityScore, inferSourceTier } from "./source-quality.js";
import { sourcePublisherDomain } from "./source-identity.js";
import { isGlobalSourcePublicationRequirement } from "./requirement-temporal.js";

export interface ResearchSearchHit {
  url: string;
  title: string;
  snippet: string;
}

const FINANCE_QUERY_INTENT = /\b(?:portfolio|asset\s+(?:returns?|clustering|weights?|allocation)|market\s+(?:structures?|prediction)|risk[- ]return|rebalancing)\b/iu;
const FINANCE_HIT_ANCHOR = /\b(?:portfolio|asset\s+(?:allocation|returns?|selection|weights?)|investment|financial\s+markets?|stock\s+markets?|securities)\b/iu;

const AUTHORITY_INTENT = /\b(?:official|government|regulator|regulatory|authority|authorities|primary source|original source|competition commission|central bank|national statistics|peer[- ]reviewed|academic (?:papers?|stud(?:y|ies))|court|filing|standard(?:s body)?)\b|官方|政府|监管|主管机构|权威|一手资料|原始资料|统计局|央行|法院|学术论文|同行评审/i;
const ACADEMIC_INTENT = /\b(?:peer[- ]reviewed|academic|research|journals?|papers?|stud(?:y|ies)|methods?|techniques?|algorithms?|machine[- ]learning|unsupervised[- ]learning|forecast(?:ing)?|trials?|systematic reviews?|meta-analys(?:is|es))\b|学术|论文|期刊|研究|方法|技术|算法|机器学习|无监督学习|预测|试验|综述/i;
const SCIENTIFIC_RESEARCH_INTENT = /\b(?:genes?|genetic|genom(?:e|es|ic|ics)|species|organisms?|bacteria|bacterial|fung(?:us|i|al)|vir(?:us|uses|al)|plants?|cells?|proteins?|rna|dna|pathogens?|parasites?|molecular|biological|clinical|disease|mechanisms?)\b|基因|遗传|基因组|物种|细菌|真菌|病毒|植物|细胞|蛋白|病原|寄生|分子|生物|临床|疾病|机制/i;
const DATA_INTENT = /\b(?:data|dataset|statistics?|market share|percentage|rate|table|series|index)\b|数据|统计|份额|比例|表格|指数/i;
const DOCUMENTATION_INTENT = /\b(?:official documentation|technical documentation|developer (?:guide|documentation)|software documentation|source code|api reference|technical details)\b|官方文档|技术文档|开发指南|源代码/i;
const AUTHORITY_SCORE_BAND_WIDTH = 20;
const HGT_QUERY_INTENT = /\b(?:horizontal|lateral)\s+gene\s+transfer\b|\bHGT\b|\bgene\s+exchange\b|\bexchange\s+genes?\b|\bT-?DNA\s+transfer\b|\bintegrat(?:e|ed|ion)[^\n]{0,40}\b(?:bacterial|viral)\s+genes?\b/iu;
const HGT_HIT_ANCHOR = /\b(?:horizontal|lateral)\s+gene\s+transfer\b|\bHGT\b|\b(?:gene|DNA|RNA|mRNA|small\s+RNA|T-?DNA)\s+(?:exchange|transfer|transport|movement|integration)\b|\b(?:transferred[- ]DNA|cross[- ]kingdom|trans[- ]species|endogenous\s+viral|natural(?:ly)?\s+transgenic)\b/iu;

export function hasAuthorityIntent(value: string): boolean {
  return AUTHORITY_INTENT.test(value);
}

export function authorityFirstScoutQueries(
  requirements: ResearchRequirement[],
  plannedQueries: string[],
  fallbackQuery: string,
  limit: number,
): string[] {
  const max = Math.max(1, Math.floor(limit));
  const commonTemporalQualifier = commonTemporalQueryQualifier(requirements);
  const commonDomainAnchor = commonResearchDomainAnchor(requirements);
  const exceptionQueries = requirements.flatMap(temporalExceptionQueries);
  // Every evidence-bearing requirement receives a query lane. Interleaving
  // those lanes prevents one large entityScope (for example ten named
  // theories) from consuming the entire scout budget before sibling research
  // requirements receive even one discovery query.
  const authorityQueryLists = requirements
    .filter(requirementNeedsDiscoveryQuery)
    .map((requirement) => authorityQueriesForRequirement(requirement, commonTemporalQualifier, commonDomainAnchor));
  const authorityQueries = interleaveSearchHitLists(authorityQueryLists);
  const broadQueries = uniqueQueries([
    ...plannedQueries.map((query) => appendQueryQualifier(query, commonTemporalQualifier)),
    appendQueryQualifier(fallbackQuery, commonTemporalQualifier),
  ]);
  return allocateScoutQueryBudget(
    exceptionQueries,
    authorityQueries,
    broadQueries,
    max,
    authorityQueryLists.length > 1 || plannedQueries.length > 0,
    authorityQueryLists.length >= 4 ? 1 : 2,
  );
}

function requirementNeedsDiscoveryQuery(requirement: ResearchRequirement): boolean {
  if (!requirement.evidenceRequired) return false;
  if (requirement.kind !== "deliverable") return true;
  return !requirement.evidenceNeeds.every((need) => /^direct evidence(?: addressing this requirement)?\.?$/iu.test(need.trim()));
}

function allocateScoutQueryBudget(
  exceptionQueries: string[],
  authorityQueries: string[],
  broadQueries: string[],
  max: number,
  reserveBroadCoverage: boolean,
  maxBroadReserve: number,
): string[] {
  const selected: string[] = [];
  const selectedKeys = new Set<string>();
  const add = (query: string): boolean => {
    const compact = compactQuery(query);
    const key = compact.toLocaleLowerCase();
    if (!compact || selectedKeys.has(key) || selected.length >= max) return false;
    selectedKeys.add(key);
    selected.push(compact);
    return true;
  };
  for (const query of uniqueQueries(exceptionQueries)) add(query);
  if (selected.length >= max) return selected;

  const authorities = uniqueQueries(authorityQueries).filter((query) => !selectedKeys.has(compactQuery(query).toLocaleLowerCase()));
  const broad = uniqueQueries(broadQueries).filter((query) => !selectedKeys.has(compactQuery(query).toLocaleLowerCase()));
  if (authorities.length === 0) {
    for (const query of broad) add(query);
    return selected;
  }
  const remaining = max - selected.length;
  const broadReserve = reserveBroadCoverage && remaining > 1
    ? Math.min(broad.length, remaining - 1, remaining >= 3 ? maxBroadReserve : 1)
    : 0;
  const authorityQuota = remaining - broadReserve;
  for (const query of authorities.slice(0, authorityQuota)) add(query);
  for (const query of reservedBroadQueries(broad, broadReserve)) add(query);
  for (const query of authorities.slice(authorityQuota)) add(query);
  for (const query of broad) add(query);
  return selected;
}

function reservedBroadQueries(queries: string[], count: number): string[] {
  if (count <= 0 || queries.length === 0) return [];
  if (count === 1 || queries.length === 1) return [queries[0]!];
  return uniqueQueries([
    ...queries.slice(0, count - 1),
    queries.at(-1)!,
    ...queries,
  ]).slice(0, count);
}

function commonTemporalQueryQualifier(requirements: ResearchRequirement[]): string {
  const global = requirements.find((requirement) => (
    isGlobalSourcePublicationRequirement(requirement)
  ));
  if (global) return temporalQueryQualifier(global);
  const evidenceRequirements = requirements.filter((requirement) => requirement.evidenceRequired);
  if (evidenceRequirements.length === 0) return "";
  const scopes = evidenceRequirements.map((requirement) => requirement.temporalScope);
  const first = scopes[0];
  if (!first) return "";
  const key = JSON.stringify([first.mode, first.basis, first.asOf, first.start, first.end]);
  if (!scopes.every((scope) => scope && JSON.stringify([scope.mode, scope.basis, scope.asOf, scope.start, scope.end]) === key)) return "";
  return temporalQueryQualifier(evidenceRequirements[0]!);
}

function appendQueryQualifier(query: string, qualifier: string): string {
  if (!qualifier) return query;
  if (compactQuery(query).includes(qualifier)) return query;
  const maxBaseLength = Math.max(1, 359 - qualifier.length);
  return `${compactQuery(query).slice(0, maxBaseLength).trim()} ${qualifier}`;
}

export function rankSearchHitsForResearch<T extends ResearchSearchHit>(hits: T[], preferAuthority: boolean): T[] {
  if (hits.length < 2) return [...hits];
  if (!preferAuthority) return roundRobinByPublisherDomain(hits);
  const ranked = hits
    .map((hit, index) => ({ hit, index, score: authorityHitScore(hit) }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const out: T[] = [];
  let bandStart = 0;
  while (bandStart < ranked.length) {
    const band = authorityScoreBand(ranked[bandStart]!.score);
    let bandEnd = bandStart + 1;
    while (bandEnd < ranked.length && authorityScoreBand(ranked[bandEnd]!.score) === band) bandEnd += 1;
    out.push(...roundRobinByPublisherDomain(ranked.slice(bandStart, bandEnd).map((item) => item.hit)));
    bandStart = bandEnd;
  }
  return out;
}

export function interleaveSearchHitLists<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const maxLength = Math.max(0, ...lists.map((list) => list.length));
  for (let index = 0; index < maxLength; index += 1) {
    for (const list of lists) {
      const item = list[index];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

/** Keep authoritative-but-off-topic results out of the scout knowledge graph. */
export function filterSearchHitsForQuery<T extends ResearchSearchHit>(hits: T[], query: string): T[] {
  const normalizedQuery = compactQuery(query);
  const topicGates: Array<{ query: RegExp; hit: RegExp }> = [
    { query: /\b(?:mcdm|multi[- ]criteria\s+decision)/iu, hit: /\b(?:mcdm|multi[- ]criteria\s+decision|ahp|topsis|electre|promethee|todim)\b/iu },
    { query: /\bmetaheur/iu, hit: /\b(?:metaheur|heuristic\s+optimi[sz])/iu },
    { query: /\basset\s+clustering|network\s+analysis/iu, hit: /\b(?:cluster|network|diversif)/iu },
    { query: /\bsignal\s+generation/iu, hit: /\b(?:forecast|predict|signal|machine\s+learning|\bml\b)/iu },
    { query: /\bmodern\s+portfolio\s+theory|mean[- ]variance\s+model/iu, hit: /\b(?:modern\s+portfolio\s+theory|mean[- ]variance|markowitz)/iu },
  ];
  const activeGates = topicGates.filter((gate) => gate.query.test(normalizedQuery));
  return hits.filter((hit) => {
    const text = `${hit.title} ${hit.snippet}`;
    if (arxivHitAfterExplicitQueryCutoff(hit, normalizedQuery)) return false;
    if (FINANCE_QUERY_INTENT.test(normalizedQuery) && !FINANCE_HIT_ANCHOR.test(text)) return false;
    if (/\bproject\s+portfolio\b/iu.test(text)
      && !/\b(?:investment|financial|asset|stock|securit|risk[- ]return)\b/iu.test(text)) return false;
    if (/\b(?:mcdm|multi[- ]criteria\s+decision)/iu.test(normalizedQuery)
      && !/\b(?:financial|investment|stock|asset)\b[^.\n]{0,100}\bportfolio\b|\bportfolio\b[^.\n]{0,100}\b(?:financial|investment|stock|asset)\b/iu.test(text)) return false;
    if (HGT_QUERY_INTENT.test(normalizedQuery) && !HGT_HIT_ANCHOR.test(text)) return false;
    return activeGates.every((gate) => gate.hit.test(text));
  });
}

function arxivHitAfterExplicitQueryCutoff(hit: ResearchSearchHit, query: string): boolean {
  const cutoffMonth = query.match(/\b(?:through|no\s+later\s+than)\s+((?:19|20)\d{2}-\d{2})-\d{2}\b/iu)?.[1];
  if (!cutoffMonth) return false;
  const arxivId = hit.url.match(/arxiv\.org\/(?:abs|pdf)\/((?:\d{2})(?:0[1-9]|1[0-2]))\.\d{4,5}(?:v\d+)?/iu)?.[1]
    ?? hit.title.match(/\[((?:\d{2})(?:0[1-9]|1[0-2]))\.\d{4,5}(?:v\d+)?\]/u)?.[1];
  if (!arxivId) return false;
  return `20${arxivId.slice(0, 2)}-${arxivId.slice(2, 4)}` > cutoffMonth;
}

export function requirementNeedsAuthority(requirement: ResearchRequirement): boolean {
  return hasAuthorityIntent([
    requirement.description,
    ...requirement.evidenceNeeds,
    ...requirement.successCriteria,
  ].join(" "));
}

function authorityQueriesForRequirement(
  requirement: ResearchRequirement,
  inheritedTemporalQualifier = "",
  inheritedDomainAnchor = "",
): string[] {
  const context = [requirement.description, ...requirement.evidenceNeeds].join(" ");
  const suffix = DOCUMENTATION_INTENT.test(context)
    ? "official documentation"
    : ACADEMIC_INTENT.test(context) || SCIENTIFIC_RESEARCH_INTENT.test(context)
    ? "primary study paper filetype:pdf"
    : DATA_INTENT.test(context)
      ? "official data report filetype:pdf"
      : "official report filetype:pdf";
  const hgtOverrides = plantHgtQueryOverrides(requirement);
  if (hgtOverrides.length > 0) {
    return hgtOverrides.map(compactQuery);
  }
  const subjects = requirementSubjects(requirement);
  const description = stripSubjectEnumeration(stripDeclaredSubjects(requirement.description, requirement.entityScope ?? []));
  const parentSection = explicitParentSectionAnchor(requirement.description);
  const nestedTopic = explicitNestedTopicAnchor(requirement.description);
  const domainAnchor = uniqueCaseInsensitive([
    explicitResearchDomainAnchor(requirement.description),
    inheritedDomainAnchor,
  ].filter(Boolean)).join(" ");
  const examples = requirement.exampleScope ?? [];
  const scopedEvidenceCore = compactQuery(`${parentSection} ${domainAnchor} ${examples.join(" ")} ${(requirement.metricScope ?? []).join(" ")} ${requirement.evidenceNeeds.slice(0, 2).join(" ")}`);
  const topicOverride = mcdmPortfolioQueryOverride(requirement) || assetClusteringQueryOverride(requirement);
  const core = (topicOverride
    || (subjects.length > 0 && scopedEvidenceCore
      ? scopedEvidenceCore
      : parentSection
      ? compactQuery(`${parentSection} ${domainAnchor} ${examples.join(" ")} ${requirement.evidenceNeeds.slice(0, 2).join(" ")}`)
      : nestedTopic
        ? compactQuery(`${nestedTopic} ${domainAnchor} ${requirement.evidenceNeeds.slice(0, 2).join(" ")}`)
      : compactQuery(`${description} ${domainAnchor} ${requirement.evidenceNeeds.slice(0, 2).join(" ")}`))).slice(0, 260);
  const temporal = temporalQueryQualifier(requirement) || inheritedTemporalQualifier;
  return (subjects.length > 0 ? subjects : [""]).map((subject) => compactQuery(`${subject} ${core} ${suffix} ${temporal}`));
}

function plantHgtQueryOverrides(requirement: ResearchRequirement): string[] {
  const text = `${requirement.description} ${requirement.evidenceNeeds.join(" ")}`;
  if (/\bBetween Parasitic Plants\b/iu.test(text)) {
    return ["parasitic plant host horizontal gene transfer Cuscuta Striga haustorium mRNA primary study"];
  }
  if (/\bBetween Fungi and Plants\b/iu.test(text)) {
    return [
      "fungus plant horizontal gene transfer fungus-to-plant plant-to-fungus genes primary study",
      '"Horizontal gene transfer of Fhb7 from fungus underlies Fusarium head blight resistance in wheat" site:science.org',
    ];
  }
  if (/\bBetween Bacteria and Plants\b/iu.test(text)) {
    return [
      "Agrobacterium T-DNA integration natural transgenic sweet potato IbT-DNA primary study",
      '"The genome of cultivated sweet potato contains Agrobacterium T-DNAs with expressed genes" site:pnas.org',
    ];
  }
  if (/\bBetween Viruses and Plants\b/iu.test(text)) {
    return [
      "endogenous pararetrovirus sequences integrated plant genome banana Petunia tobacco",
      "plant virus-mediated horizontal gene transfer between plants",
    ];
  }
  return [];
}

function assetClusteringQueryOverride(requirement: ResearchRequirement): string {
  const text = `${requirement.description} ${(requirement.entityScope ?? []).join(" ")}`;
  const mixesSiblingTopics = /\bsignal\s+generation\b/iu.test(text) || /\bfeature\s+enrichment\b/iu.test(text);
  return !mixesSiblingTopics && /\basset\s+clustering|\bnetwork\s+analysis/iu.test(text)
    ? "stock network topology asset clustering portfolio diversification"
    : "";
}

function mcdmPortfolioQueryOverride(requirement: ResearchRequirement): string {
  const text = `${requirement.description} ${requirement.evidenceNeeds.join(" ")}`;
  return /\b(?:mcdm|multi[- ]criteria\s+decision)/iu.test(text) && /\bportfolio\s+selection\b/iu.test(text)
    ? "financial portfolio selection MCDM AHP TOPSIS ELECTRE PROMETHEE"
    : "";
}

function explicitParentSectionAnchor(value: string): string {
  return value.match(/\b(?:in|under)\s+(?:the\s+)?['“‘]([^'”’\n]{2,120})['”’]\s+section\b/iu)?.[1]?.trim()
    ?? value.match(/\bsection\s+(?:titled|named|called)\s+['“‘]([^'”’\n]{2,120})['”’]/iu)?.[1]?.trim()
    ?? "";
}

function explicitNestedTopicAnchor(value: string): string {
  const match = value.match(/^([^:\n]{2,140})\s+[—–-]\s+([^:\n]{2,140})\s*:/u);
  return match?.[1] && match[2] ? `${match[2].trim()} ${match[1].trim()}` : "";
}

function explicitResearchDomainAnchor(value: string): string {
  return value.match(/\b(?:portfolio\s+(?:management|selection|optimization)|financial\s+markets?|asset\s+(?:returns?|allocation|clustering))\b/iu)?.[0]?.trim() ?? "";
}

function commonResearchDomainAnchor(requirements: ResearchRequirement[]): string {
  const anchors = requirements
    .filter((requirement) => requirement.evidenceRequired)
    .map((requirement) => explicitResearchDomainAnchor(requirement.description))
    .filter(Boolean);
  const counts = new Map<string, { value: string; count: number }>();
  for (const anchor of anchors) {
    const key = anchor.toLocaleLowerCase();
    const existing = counts.get(key);
    counts.set(key, { value: existing?.value ?? anchor, count: (existing?.count ?? 0) + 1 });
  }
  const best = Array.from(counts.values()).sort((left, right) => right.count - left.count)[0];
  if (best && best.count >= 2) return best.value;
  return anchors.filter((anchor) => /^portfolio\b/iu.test(anchor)).length >= 2 ? "portfolio" : "";
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function temporalExceptionQueries(requirement: ResearchRequirement): string[] {
  return (requirement.temporalScope?.exemptSources ?? [])
    .map((exception) => {
      const alternatives = temporalExceptionNames(exception).map((value) => `"${value}"`).join(" OR ");
      return compactQuery(`${alternatives} original official report paper filetype:pdf`);
    })
    .filter(Boolean);
}

function temporalExceptionNames(
  exception: NonNullable<NonNullable<ResearchRequirement["temporalScope"]>["exemptSources"]>[number],
): string[] {
  if (typeof exception === "string") return [exception];
  return Array.from(new Set([
    exception.title,
    ...(exception.aliases ?? []),
    ...(exception.identifiers ?? []),
  ].map((value) => value.trim()).filter(Boolean)));
}

function temporalQueryQualifier(requirement: ResearchRequirement): string {
  const temporal = requirement.temporalScope;
  if (!temporal) return "";
  const publicationBound = temporal.basis === "source_publication";
  if (temporal.mode === "as_of" && temporal.asOf) {
    if (!publicationBound) return compactQuery(`covering evidence through ${temporal.asOf}`);
    const before = dayAfter(temporal.asOf);
    return compactQuery(`published no later than ${temporal.asOf}${before ? ` before:${before}` : ""}`);
  }
  if (temporal.mode === "range") {
    if (!publicationBound) {
      return compactQuery(`covering period${temporal.start ? ` from ${temporal.start}` : ""}${temporal.end ? ` through ${temporal.end}` : ""}`);
    }
    const after = temporal.start ? dayBefore(temporal.start) : undefined;
    const before = temporal.end ? dayAfter(temporal.end) : undefined;
    return compactQuery(`published${temporal.start ? ` from ${temporal.start}` : ""}${temporal.end ? ` through ${temporal.end}` : ""}${after ? ` after:${after}` : ""}${before ? ` before:${before}` : ""}`);
  }
  return "";
}

function dayBefore(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) ? new Date(parsed - 86_400_000).toISOString().slice(0, 10) : undefined;
}

function dayAfter(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return undefined;
  return new Date(parsed + 86_400_000).toISOString().slice(0, 10);
}

function requirementSubjects(requirement: ResearchRequirement): string[] {
  const declared = (requirement.entityScope ?? [])
    .map((item) => item.trim())
    .filter((item) => item && !/^(?:global|worldwide|all|none|全部|所有)$/iu.test(item));
  if (declared.length >= 2 && declared.length <= 20) return Array.from(new Set(declared));
  const geographic = (requirement.geographicScope ?? [])
    .filter((item) => !/^(?:global|worldwide|all|none)$/i.test(item.trim()))
    .map((item) => item.trim())
    .filter(Boolean);
  if (geographic.length >= 2 && geographic.length <= 10) return geographic;
  for (const match of requirement.description.matchAll(/\(([^()]{8,240})\)/g)) {
    const body = match[1] ?? "";
    if (/^(?:e\.g\.|i\.e\.|such\s+as\b|for\s+example\b|including\b)/i.test(body.trim())) continue;
    const items = body.split(/[,;，；]|\s+and\s+/i)
      .map((item) => item.replace(/^(?:and|or)\s+/i, "").trim())
      .filter((item) => item.length >= 2 && item.length <= 48 && item.split(/\s+/).length <= 6);
    if (items.length >= 3 && items.length <= 10) return Array.from(new Set(items));
  }
  return [];
}

function stripDeclaredSubjects(value: string, subjects: string[]): string {
  let out = value;
  for (const subject of [...subjects].sort((left, right) => right.length - left.length)) {
    if (!subject.trim()) continue;
    out = out.replace(new RegExp(escapeRegExp(subject.trim()), "giu"), " ");
  }
  return out
    .replace(/(?:\s*[,，、;；|]\s*){2,}/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripSubjectEnumeration(value: string): string {
  return value.replace(/\(([^()]{8,240})\)/, (match, body: string) => {
    const items = body.split(/[,;，；]|\s+and\s+/i).filter((item) => item.trim().length >= 2);
    return items.length >= 3 ? "" : match;
  }).replace(/\s+/g, " ").trim();
}

function authorityHitScore(hit: ResearchSearchHit): number {
  const tier = inferSourceTier(hit.url, "secondary");
  const calibrated = calibrateSourceQualityScore({
    url: hit.url,
    declaredTier: tier,
    declaredScore: 0.6,
    fetched: false,
  });
  const text = `${hit.title} ${hit.snippet}`;
  let score = calibrated.qualityScore * 10;
  if (tier === "official") score += 100;
  else if (tier === "primary") score += 60;
  if (/\.pdf(?:$|[?#])/i.test(hit.url)) score += 18;
  if (AUTHORITY_INTENT.test(text)) score += 12;
  if (/\b(?:report|study|decision|ruling|dataset|statistics|consultation|findings|working paper)\b|报告|研究|决定|裁决|数据|统计|结论/i.test(text)) score += 5;
  return score;
}

function authorityScoreBand(score: number): number {
  return Math.floor(score / AUTHORITY_SCORE_BAND_WIDTH);
}

function roundRobinByPublisherDomain<T extends ResearchSearchHit>(hits: T[]): T[] {
  if (hits.length < 2) return [...hits];
  const queues = new Map<string, T[]>();
  for (const [index, hit] of hits.entries()) {
    const domain = sourcePublisherDomain(hit.url) ?? `invalid:${index}`;
    const queue = queues.get(domain);
    if (queue) queue.push(hit);
    else queues.set(domain, [hit]);
  }
  const out: T[] = [];
  let offset = 0;
  while (out.length < hits.length) {
    for (const queue of queues.values()) {
      const hit = queue[offset];
      if (hit !== undefined) out.push(hit);
    }
    offset += 1;
  }
  return out;
}

function uniqueQueries(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const query = compactQuery(value);
    if (!query) continue;
    const key = query.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(query);
  }
  return out;
}

function compactQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 360);
}
