import type { AgentRuntimeResult, ReportNode, TaskItem, ToolCallResult } from "@deepresearch/contracts";
import { canonicalizeSourceUrl } from "../source-identity.js";
import { recordSourceGuard, saveKnowledgeSource, saveSourceEvidence } from "../source-store.js";
import { traceWrite, tracedFetchPage } from "../trace.js";
import type { PhaseContext } from "../types.js";
import type { NormalizedEvidenceAssessment } from "./evidence-reportlets.js";
import { object, stringOrUndefined } from "./evidence-utils.js";

interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

interface FetchedObservation {
  hit: SearchHit;
  page?: {
    url: string;
    title: string;
    content: string;
    description?: string;
  };
}

const MAX_BACKGROUND_AUTOSAVE_HITS = 2;
const MIN_BACKGROUND_AUTOSAVE_CONFIDENCE = 0.25;

async function fetchEvidenceObservations(
  ctx: PhaseContext,
  hits: SearchHit[],
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
): Promise<FetchedObservation[]> {
  const fetchCfg = ctx.state.runtimeProfile.tools.fetch_page;
  const fetchLimit = Math.min(
    hits.length,
    Math.max(0, ctx.state.runtimeProfile.agents.evidence?.maxFetchCalls ?? ctx.state.runtimeProfile.phases.dispatchEvidence?.maxOutputItems ?? hits.length),
  );
  const fetchable = hits.slice(0, fetchLimit);
  const fetched = await Promise.all(fetchable.map(async (hit) => {
    const page = await tracedFetchPage(ctx, "dispatch-evidence", hit.url, {
      timeoutMs: fetchCfg?.timeoutMs,
      maxChars: fetchCfg?.maxChars,
    }, meta);
    return { hit, page };
  }));
  const fetchedUrls = new Set(fetchable.map((hit) => hit.url));
  return [
    ...fetched,
    ...hits.filter((hit) => !fetchedUrls.has(hit.url)).map((hit) => ({ hit })),
  ];
}

async function autoSaveLegacySearchResults(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
  runtime: AgentRuntimeResult,
  assessment: NormalizedEvidenceAssessment,
): Promise<{ knowledgeNodeIds: string[]; evidenceLinkIds: string[] }> {
  const maxOutputItems = Math.max(1, ctx.state.runtimeProfile.phases.dispatchEvidence?.maxOutputItems ?? 3);
  const saveLimit = assessment.relation === "background"
    ? Math.min(MAX_BACKGROUND_AUTOSAVE_HITS, maxOutputItems)
    : maxOutputItems;
  const hits = dedupeHits(runtime.steps.flatMap((step) => searchHitsFromResult(step.toolResult)))
    .slice(0, saveLimit);
  if (assessment.relation === "background" && assessment.confidence < MIN_BACKGROUND_AUTOSAVE_CONFIDENCE) {
    for (const [index, hit] of hits.entries()) {
      recordSourceGuard(ctx, {
        taskId: task.taskId,
        reportNodeId: reportNode.nodeId,
        branchId: task.branchId,
        agentRunId: meta.agentRunId,
        index: index + 1,
        title: hit.title,
        url: hit.url,
        snippet: hit.snippet,
        sourceTier: "secondary",
        qualityScore: assessment.confidence,
        relation: assessment.relation,
        claimText: assessment.claimText,
        confidence: assessment.confidence,
      }, "low_signal_background_autosave");
    }
    await traceWrite(ctx, "kg", "skipEvidenceLink", {
      reason: "low_signal_background_autosave",
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      confidence: assessment.confidence,
      claimText: assessment.claimText,
    }, meta);
    return { knowledgeNodeIds: [], evidenceLinkIds: [] };
  }
  if (hits.length === 0) return { knowledgeNodeIds: [], evidenceLinkIds: [] };
  const observations = await fetchEvidenceObservations(ctx, hits, meta);
  const knowledgeNodeIds: string[] = [];
  const evidenceLinkIds: string[] = [];
  for (let i = 0; i < observations.length; i++) {
    const observation = observations[i]!;
    const hit = observation.hit;
    const page = observation.page;
    const saved = await saveSourceEvidence(ctx, {
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      branchId: task.branchId,
      agentRunId: meta.agentRunId,
      index: i + 1,
      title: page?.title || hit.title,
      url: page?.url || hit.url,
      snippet: hit.snippet,
      description: page?.description,
      content: page?.content,
      sourceTier: "secondary",
      qualityScore: fallbackSourceQualityScore(observation),
      relation: assessment.relation,
      claimText: assessment.claimText,
      confidence: assessment.confidence,
    });
    if (!saved) continue;
    knowledgeNodeIds.push(saved.knowledgeNodeId);
    evidenceLinkIds.push(saved.evidenceLinkId);
  }
  return { knowledgeNodeIds, evidenceLinkIds };
}

export async function stageFetchedCandidatesForRepair(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
  runtime: AgentRuntimeResult,
): Promise<string[]> {
  const seen = new Set<string>();
  const savedIds: string[] = [];
  for (const step of runtime.steps) {
    if (step.toolResult?.toolName !== "fetch_page" || !step.toolResult.ok) continue;
    const page = object(step.toolResult.output);
    const url = stringOrUndefined(page.url);
    const title = stringOrUndefined(page.title);
    const content = stringOrUndefined(page.content);
    if (!url || !title || !content || content.trim().length < 200) continue;
    const canonical = canonicalizeSourceUrl(url) || url;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const saved = await saveKnowledgeSource(ctx, {
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      branchId: task.branchId,
      agentRunId: meta.agentRunId,
      index: savedIds.length + 1,
      title,
      url,
      description: stringOrUndefined(page.description),
      content,
      sourceTier: "secondary",
      qualityScore: content.length >= 2_000 ? 0.72 : 0.65,
    });
    if (!saved) continue;
    savedIds.push(saved.knowledgeNodeId);
    if (savedIds.length >= 3) break;
  }
  return savedIds;
}

function fallbackSourceQualityScore(observation: FetchedObservation): number {
  const contentLength = observation.page?.content?.trim().length ?? 0;
  if (contentLength >= 2000) return 0.75;
  if (contentLength >= 200) return 0.68;
  if (observation.hit.snippet.trim().length >= 150) return 0.58;
  return 0.5;
}

function searchHitsFromResult(result: ToolCallResult | undefined): SearchHit[] {
  if (!result?.ok || result.toolName !== "web_search") return [];
  const output = Array.isArray(result.output)
    ? result.output
    : Array.isArray(object(result.output).results)
      ? object(result.output).results as unknown[]
      : [];
  return output
    .map((item) => object(item))
    .filter((item) => typeof item.url === "string" && typeof item.title === "string")
    .map((item) => ({
      url: String(item.url),
      title: String(item.title),
      snippet: typeof item.snippet === "string" ? item.snippet : "",
    }));
}

function runtimeSearchSummary(runtime: AgentRuntimeResult): string {
  const queries = runtime.steps
    .filter((step) => step.decision.toolName === "web_search")
    .map((step) => stringOrUndefined(object(step.decision.args).query))
    .filter((item): item is string => Boolean(item));
  return queries.length ? queries.join(" | ") : runtime.steps.map((step) => step.decision.toolName).filter(Boolean).join(" -> ");
}

function runtimeSearchHitCount(runtime: AgentRuntimeResult): number {
  return dedupeHits(runtime.steps.flatMap((step) => searchHitsFromResult(step.toolResult))).length;
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

export { autoSaveLegacySearchResults, runtimeSearchHitCount, runtimeSearchSummary };
