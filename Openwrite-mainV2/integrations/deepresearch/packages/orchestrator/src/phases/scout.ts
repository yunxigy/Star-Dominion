import type { AgentRunResult } from "@deepresearch/contracts";
import { asNonEmptyStrings, parseLlmJson, truncate } from "../infra/ai.js";
import { SCOUT_SYSTEM_PROMPT } from "../prompts.js";
import { authorityFirstScoutQueries, filterSearchHitsForQuery, interleaveSearchHitLists, rankSearchHitsForResearch } from "../source-discovery.js";
import { canonicalizeSourceUrl } from "../source-identity.js";
import { assessSourceQuality } from "../source-quality.js";
import { saveKnowledgeSource } from "../source-store.js";
import { tracedFetchPage, tracedLlmChat, tracedSearch, traceWrite } from "../trace.js";
import type { PhaseContext } from "../types.js";

interface ScoutPlan {
  queries?: string[];
  sourceStrategy?: string;
  reasoningSummary?: string;
}

interface ScoutSourceSelection {
  highConfidenceIndices?: number[];
  fallbackIndices?: number[];
  reasoningSummary?: string;
}

export const SCOUT_SOURCE_SELECTION_SYSTEM_PROMPT = `You select source leads before any page fetch.
Use only candidate title, URL, and snippet metadata. Do not infer that a source proves a claim.
Put official institutions, original/canonical documents, primary research, peer-reviewed publishers, standards bodies, and reputable academic repositories in highConfidenceIndices.
Prefer sources that directly cover the research requirements and diversify publisher domains.
Classify a source as high confidence only when its metadata shows both credible provenance and direct relevance to at least one required topic; an authoritative host alone is not enough.
Do not promote a source merely because its title mentions the same species or broad field. The requested transfer mechanism, gene, or direction must be explicit in the title or snippet.
Put aggregators, reposts, profiles, commercial commentary, community pages, document portals, and weakly related sources in fallbackIndices, even when their snippets look useful.
Put metadata-ambiguous sources in fallbackIndices instead of highConfidenceIndices.
Ignore clearly irrelevant or low-credibility candidates entirely.
Use fallback sources only as leads when high-confidence sources are insufficient; never select candidates merely to fill the quota.
Return exactly one JSON object matching the requested schema.`;

interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

interface ScoutObservation {
  hit: SearchHit;
  page?: {
    url: string;
    title: string;
    content: string;
    description?: string;
  };
}

export async function scoutPhase(ctx: PhaseContext): Promise<AgentRunResult> {
  const rubric = ctx.state.globalRubric;
  if (!rubric) throw new Error("rubric required before scout");
  await ctx.emit({ eventType: "scout_started", taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" });
  const llmCfg = ctx.state.runtimeProfile.llm.scout;
  const planResponse = await tracedLlmChat(ctx, "scout.plan", {
    system: SCOUT_SYSTEM_PROMPT,
    user: `Plan scout searches for this research task.

User task:
${ctx.state.submission.userInput}

Rubric:
${rubric.rubricText}

Research question hints:
${(rubric.researchQuestionHints ?? []).map((hint) => `- ${hint}`).join("\n")}

Structured requirements and time/geographic scopes:
${JSON.stringify(rubric.requirements ?? [], null, 2)}

Output schema:
{"queries":string[],"sourceStrategy":string,"reasoningSummary":string}`,
    json: true,
    ...llmCfg,
  }, { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" });
  const plan = parseLlmJson<ScoutPlan>("scout", ctx.stack.llm.name, planResponse, () => ({
    queries: [rubric.researchQuestionHints?.[0] ?? ctx.state.submission.userInput],
    sourceStrategy: "Use the primary research question as the scout query.",
    reasoningSummary: "Scout fallback plan for explicit echo mode.",
  }));
  const scoutCfg = ctx.state.runtimeProfile.phases.scout;
  const queryLimit = Math.max(1, scoutCfg?.maxSearchCalls ?? 3);
  const configuredFetchCalls = scoutCfg?.maxFetchCalls;
  const maxOutputItems = Math.max(1, scoutCfg?.maxOutputItems ?? 3);
  const fetchLimit = Math.min(Math.max(0, configuredFetchCalls ?? maxOutputItems), maxOutputItems);
  const fallbackQuery = rubric.researchQuestionHints?.[0] ?? ctx.state.submission.userInput;
  const plannedQueries = asNonEmptyStrings(plan.queries, [fallbackQuery], queryLimit);
  const queries = authorityFirstScoutQueries(rubric.requirements ?? [], plannedQueries, fallbackQuery, queryLimit);
  const topK = ctx.state.runtimeProfile.tools.web_search?.topK;
  if (typeof topK !== "number") throw new Error("RuntimeProfile.tools.web_search.topK is required");
  // Inspect a deeper candidate window before semantic filtering. Academic
  // augmentation interleaves web and index results, so a relevant web hit at
  // rank 11 must not disappear merely because ten generic arXiv hits occupied
  // the other half of a 20-result window. This does not increase search-call
  // count or the number of saved/fetched scout sources.
  const scoutCandidateTopK = 50;
  const searchOutcomes = await Promise.allSettled(queries.map((query) => tracedSearch(
    ctx,
    "scout",
    query,
    scoutCandidateTopK,
    { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" },
    {
      resultFilter: (hits) => filterSearchHitsForQuery(hits, query),
      replenish: false,
    },
  )));
  throwIfScoutAborted(ctx.signal);
  const failedSearches = searchOutcomes.flatMap((outcome, index) => outcome.status === "rejected"
    ? [{ query: queries[index] ?? "", error: errorMessage(outcome.reason) }]
    : []);
  if (failedSearches.length > 0) {
    await ctx.emit({
      eventType: "scout_searches_degraded",
      taskId: "T_root",
      reportNodeId: "R_root",
      branchId: "B_scout",
      payload: {
        attemptedCount: queries.length,
        succeededCount: queries.length - failedSearches.length,
        failedCount: failedSearches.length,
        failedSearches,
        continued: true,
      },
    });
  }
  const rawHitLists = searchOutcomes.map((outcome) => outcome.status === "fulfilled" ? outcome.value : []);
  const hitLists = rawHitLists.map((hits, index) => filterSearchHitsForQuery(hits, queries[index] ?? ""));
  const hits = dedupeHits(interleaveSearchHitLists(hitLists));
  const usableHits = rankSearchHitsForResearch(await filterUsableScoutHits(ctx, hits), true);
  const selectedHits = usableHits.length > 0
    ? await selectScoutHitsBeforeFetch(ctx, usableHits.slice(0, 80), maxOutputItems)
    : [];
  const observations = await fetchScoutObservations(ctx, selectedHits, fetchLimit);
  const knowledgeNodeIds: string[] = [];
  const evidenceLinkIds: string[] = [];
  let idx = 0;
  for (const observation of observations) {
    const hit = observation.hit;
    const page = observation.page;
    idx += 1;
    const saved = await saveKnowledgeSource(ctx, {
      taskId: "T_root",
      reportNodeId: "R_root",
      branchId: "B_scout",
      index: idx,
      title: page?.title || hit.title,
      url: page?.url || hit.url,
      snippet: hit.snippet,
      description: page?.description,
      content: page?.content,
      sourceTier: "secondary",
      qualityScore: 0.65,
    });
    if (!saved) continue;
    knowledgeNodeIds.push(saved.knowledgeNodeId);
  }
  const result: AgentRunResult = {
    agentRunId: "ORCH_scout_001",
    taskId: "T_root",
    reportNodeId: "R_root",
    branchId: "B_scout",
    branchOutcome: "done_here",
    knowledgeNodeIds,
    evidenceLinkIds,
    nodeUpdates: [],
    openGaps: [],
    structurePatchSuggestions: [],
    turnSummary: {
      actionSummary: selectedHits.length > 0 ? "Selected and collected a credibility-screened initial source map." : "Scout produced a plan but no usable search evidence was returned.",
      searchSummary: queries.join(" | "),
      reasoningSummary: `Executed ${queries.length} scout queries and saved ${knowledgeNodeIds.length} source leads; ${observations.filter((observation) => observation.page).length} leads had fetched page content. Scout leads remain unverified until branch evidence agents bind claim-level evidence.`,
      citedKnowledgeNodeIds: knowledgeNodeIds,
      citedEvidenceLinkIds: evidenceLinkIds,
    },
  };
  ctx.state.scoutResult = result;
  await ctx.emit({ eventType: "scout_finished", taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout", agentRunId: result.agentRunId, payload: result.turnSummary });
  return result;
}

function throwIfScoutAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new Error(typeof signal.reason === "string" ? signal.reason : "Research run aborted");
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

async function selectScoutHitsBeforeFetch(ctx: PhaseContext, candidates: SearchHit[], maxOutputItems: number): Promise<SearchHit[]> {
  if (candidates.length <= 1) return candidates.slice(0, maxOutputItems);
  const llmCfg = ctx.state.runtimeProfile.llm.scout;
  const response = await tracedLlmChat(ctx, "scout.select-sources", {
    system: SCOUT_SOURCE_SELECTION_SYSTEM_PROMPT,
    user: `Research task:\n${ctx.state.submission.userInput}\n\nRubric:\n${ctx.state.globalRubric?.rubricText ?? ""}\n\nSelect at most ${maxOutputItems} source leads. Candidate indices are zero-based:\n${JSON.stringify(candidates.map((hit, index) => ({
      index,
      title: hit.title,
      url: hit.url,
      snippet: truncate(hit.snippet, 360),
    })), null, 2)}\n\nOutput schema:\n{"highConfidenceIndices":number[],"fallbackIndices":number[],"reasoningSummary":string}`,
    json: true,
    ...llmCfg,
    temperature: 0,
  }, { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" });
  const selection = parseLlmJson<ScoutSourceSelection>("scout-source-selection", ctx.stack.llm.name, response, () => ({
    highConfidenceIndices: candidates.slice(0, maxOutputItems).map((_, index) => index),
    fallbackIndices: [],
    reasoningSummary: "Deterministic authority-ranked fallback selection.",
  }));
  const proposedHigh = validCandidateIndices(selection.highConfidenceIndices, candidates.length);
  const policyDemoted = proposedHigh.filter((index) => scoutCandidateNeedsFallback(candidates[index]!));
  const high = proposedHigh.filter((index) => !policyDemoted.includes(index));
  const fallback = validCandidateIndices([
    ...(selection.fallbackIndices ?? []),
    ...policyDemoted,
  ], candidates.length).filter((index) => !high.includes(index));
  const selected = resolveScoutSourceSelection({
    ...selection,
    highConfidenceIndices: high,
    fallbackIndices: fallback,
  }, candidates.length, maxOutputItems);
  const selectionAudit = {
    candidateCount: candidates.length,
    candidates: candidates.map((candidate, index) => ({
      index,
      title: candidate.title,
      url: candidate.url,
    })),
    highConfidenceIndices: high,
    fallbackIndices: fallback,
    policyDemotedIndices: policyDemoted,
    selectedIndices: selected,
    reasoningSummary: selection.reasoningSummary,
  };
  // Source selection is a core research decision, not verbose provider
  // telemetry. Keep it in summary traces so benchmark checkpoints can audit
  // which metadata-only candidates the model promoted before any fetch.
  await ctx.emit({
    eventType: "scout_sources_selected",
    taskId: "T_root",
    reportNodeId: "R_root",
    branchId: "B_scout",
    payload: selectionAudit,
  });
  await traceWrite(ctx, "llm", "selectScoutSources", selectionAudit, { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" });
  return selected.map((index) => candidates[index]!).filter(Boolean);
}

export function scoutCandidateNeedsFallback(candidate: SearchHit): boolean {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(candidate.url);
    host = parsed.hostname.toLowerCase().replace(/^www\./u, "");
    path = parsed.pathname.toLowerCase();
  } catch {
    return true;
  }
  if (["researchgate.net", "x-mol.com", "antpedia.com", "scitechdaily.com", "scilit.net", "medlive.cn", "biotecharticles.com", "arstechnica.com"].some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
  if ((host === "scirp.org" || host.endsWith(".scirp.org")) && /papercitationdetails/u.test(path)) return true;
  return /(?:Download Scientific Diagram|Gene Result|Nucleotide Result|Taxonomy Browser|学术报告|学术科研|讲座|通知|新闻|课题组揭示|年度发表学术论文)/iu.test(candidate.title);
}

export function resolveScoutSourceSelection(
  selection: ScoutSourceSelection,
  candidateCount: number,
  maxOutputItems: number,
): number[] {
  const high = validCandidateIndices(selection.highConfidenceIndices, candidateCount);
  const fallback = validCandidateIndices(selection.fallbackIndices, candidateCount).filter((index) => !high.includes(index));
  const minimum = Math.min(2, maxOutputItems, candidateCount);
  const selected = high.slice(0, maxOutputItems);
  for (const index of fallback) {
    if (selected.length >= minimum || selected.length >= maxOutputItems) break;
    selected.push(index);
  }
  if (selected.length === 0) selected.push(...Array.from({ length: minimum }, (_, index) => index));
  return selected;
}

function validCandidateIndices(value: unknown, candidateCount: number): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((index): index is number => (
    Number.isSafeInteger(index) && index >= 0 && index < candidateCount
  ))));
}

async function filterUsableScoutHits(ctx: PhaseContext, hits: SearchHit[]): Promise<SearchHit[]> {
  const out: SearchHit[] = [];
  for (const hit of hits) {
    const quality = assessSourceQuality({ url: hit.url, title: hit.title, snippet: hit.snippet });
    if (quality.usable) {
      out.push(hit);
      continue;
    }
    await traceWriteScoutSkip(ctx, hit, quality.reason);
  }
  return out;
}

async function traceWriteScoutSkip(ctx: PhaseContext, hit: SearchHit, reason: string | undefined): Promise<void> {
  await traceWrite(ctx, "kg", "skipKnowledgeNode", {
    reason: reason ?? "blocked_source_policy",
    title: hit.title,
    url: hit.url,
  }, { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" });
}

async function fetchScoutObservations(ctx: PhaseContext, hits: SearchHit[], fetchLimit: number): Promise<ScoutObservation[]> {
  const fetchCfg = ctx.state.runtimeProfile.tools.fetch_page;
  const fetchable = hits.slice(0, Math.max(0, fetchLimit));
  const fetched: ScoutObservation[] = [];
  const concurrency = Math.min(3, Math.max(1, fetchable.length));
  for (let offset = 0; offset < fetchable.length; offset += concurrency) {
    fetched.push(...await Promise.all(fetchable.slice(offset, offset + concurrency).map(async (hit) => ({
      hit,
      page: await tracedFetchPage(ctx, "scout", hit.url, {
        timeoutMs: fetchCfg?.timeoutMs,
        maxChars: fetchCfg?.maxChars,
      }, { taskId: "T_root", reportNodeId: "R_root", branchId: "B_scout" }),
    }))));
  }
  const fetchedUrls = new Set(fetchable.map((hit) => hit.url));
  return [
    ...fetched,
    ...hits.filter((hit) => !fetchedUrls.has(hit.url)).map((hit) => ({ hit })),
  ];
}

function dedupeHits<T extends { url: string }>(hits: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const hit of hits) {
    const key = canonicalizeSourceUrl(hit.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}
