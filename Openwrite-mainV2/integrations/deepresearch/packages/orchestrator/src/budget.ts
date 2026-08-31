import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  LlmChatRequest,
  LlmChatResponse,
  ProviderFailureSample,
  ProviderOperation,
  ProviderUsageRecord,
  ResearchBudgetAudit,
  ResearchBudgetBreach,
  RuntimeProviderLimit,
} from "@deepresearch/contracts";
import { isoNow, shortId } from "./infra/ids.js";
import type { PhaseContext } from "./types.js";
import { auditEvidenceQuality, resolveEvidenceQualityPolicy } from "./evidence-quality.js";
import { countedRowEvidenceTarget } from "./counted-rows.js";

export class ProviderBudgetExceededError extends Error {
  constructor(readonly breach: ResearchBudgetBreach) {
    super(`${breach.operation} provider budget exceeded: ${breach.provider}.${breach.limit} allowed=${breach.allowed} observed=${breach.observed}`);
    this.name = "ProviderBudgetExceededError";
  }
}

export interface ResearchGainSnapshot {
  knowledgeNodeCount: number;
  evidenceLinkCount: number;
  completedTaskCount: number;
  evidenceQualityScore: number;
  coveredMustRequirementCount: number;
  mustRequirementCount: number;
  activeQualityErrorCount: number;
  blockingGapCount: number;
  blockingNodeCount: number;
}

export async function captureResearchGainSnapshot(ctx: PhaseContext): Promise<ResearchGainSnapshot> {
  const knowledgeNodes = await ctx.stack.kg.listKnowledgeNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const tasks = await ctx.stack.ledger.listAll();
  const nodes = await ctx.stack.kg.listReportNodes();
  const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const rubric = ctx.state.globalRubric;
  const rootId = ctx.state.rootNode?.nodeId ?? "R_root";
  const hasRoot = Boolean(await ctx.stack.kg.getReportNode(rootId));
  const audit = rubric && hasRoot
    ? auditEvidenceQuality(await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, rootId, {
        language: rubric.outputHints.language ?? "zh-CN",
        citationRequired: rubric.outputHints.citationRequired ?? true,
        rubricId: rubric.rubricId,
        rubricText: rubric.rubricText,
        requirements: rubric.requirements,
        waivers: ctx.state.issueWaivers,
      }), resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality), { generatedAt: isoNow(ctx.now) })
    : undefined;
  return {
    knowledgeNodeCount: knowledgeNodes.length,
    evidenceLinkCount: evidenceLinks.length,
    completedTaskCount: tasks.filter((task) => task.status === "completed").length,
    evidenceQualityScore: audit?.score ?? 0,
    coveredMustRequirementCount: audit?.requirementCoverage.coveredMustCount ?? 0,
    mustRequirementCount: audit?.requirementCoverage.mustCount ?? 0,
    activeQualityErrorCount: audit?.issues.filter((issue) => issue.severity === "error").length ?? 0,
    blockingGapCount: gaps.filter((gap) => gap.status === "open" && gap.impact !== "low").length,
    blockingNodeCount: nodes.filter((node) => (
      node.nodeKind === "hypothesis"
      && !["supported", "verified", "partially_supported", "contradicted", "downplayed", "pruned"].includes(node.status)
    )).length,
  };
}

export function recordResearchCycleGain(
  ctx: PhaseContext,
  cycle: number,
  before: ResearchGainSnapshot,
  after: ResearchGainSnapshot,
): void {
  ctx.state.cycleGains.push({
    cycle,
    knowledgeNodeGain: Math.max(0, after.knowledgeNodeCount - before.knowledgeNodeCount),
    evidenceLinkGain: Math.max(0, after.evidenceLinkCount - before.evidenceLinkCount),
    completedTaskGain: Math.max(0, after.completedTaskCount - before.completedTaskCount),
    evidenceQualityScoreGain: roundScore(after.evidenceQualityScore - before.evidenceQualityScore),
    coveredMustRequirementGain: Math.max(0, after.coveredMustRequirementCount - before.coveredMustRequirementCount),
    activeQualityErrorReduction: Math.max(0, before.activeQualityErrorCount - after.activeQualityErrorCount),
    recordedAt: isoNow(ctx.now),
  });
}

export async function applyAdaptiveStopIfSafe(
  ctx: PhaseContext,
  cycle: number,
  snapshot?: ResearchGainSnapshot,
): Promise<boolean> {
  const policy = ctx.state.runtimeProfile.adaptiveBudget;
  if (!policy?.enabled || cycle < policy.minDispatchCycles || ctx.state.adaptiveStop?.stopped) return false;
  const window = ctx.state.cycleGains.slice(-Math.max(1, policy.plateauWindow));
  if (window.length < Math.max(1, policy.plateauWindow)) return false;
  const plateau = window.every((gain) => (
    gain.knowledgeNodeGain < policy.minKnowledgeNodeGain
    && gain.evidenceLinkGain < policy.minEvidenceLinkGain
    && gain.evidenceQualityScoreGain < policy.minQualityScoreGain
    && gain.coveredMustRequirementGain === 0
    && gain.activeQualityErrorReduction === 0
  ));
  if (!plateau) return false;
  const current = snapshot ?? await captureResearchGainSnapshot(ctx);
  const queued = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 })).filter((task) => task.taskId !== "T_root");
  const repairTaskIds = queued
    .filter((task) => /^(T_publish_repair_|T_completion_|T_completion_gap_|T_writer_repair_|T_human_review_)/.test(task.taskId))
    .map((task) => task.taskId);
  const qualitySafe = current.activeQualityErrorCount === 0
    && current.coveredMustRequirementCount >= current.mustRequirementCount
    && current.blockingGapCount === 0
    && current.blockingNodeCount === 0
    && repairTaskIds.length === 0;
  if (!qualitySafe) {
    await ctx.emit({
      eventType: "adaptive_budget_plateau_deferred",
      payload: { cycle, window, snapshot: current, repairTaskIds, reason: "quality_or_repair_gate_still_requires_work" },
    });
    return false;
  }
  const cancelledTaskIds: string[] = [];
  for (const task of queued) {
    await ctx.stack.ledger.updateStatus(task.taskId, "cancelled", "Adaptive budget stopped low-yield exploratory work after all quality gates were already satisfied.");
    cancelledTaskIds.push(task.taskId);
  }
  ctx.state.adaptiveStop = {
    stopped: true,
    reason: `No material evidence or quality gain across ${window.length} dispatch cycles after quality requirements were satisfied.`,
    cycle,
    cancelledTaskIds,
  };
  await ctx.emit({ eventType: "adaptive_budget_stopped", payload: { ...ctx.state.adaptiveStop, window, snapshot: current } });
  return true;
}

const REPEATED_EXTERNAL_BLOCKER = /(?:requires?|needed?|without)\s+(?:registration|login|authentication|credentials?)|not publicly accessible|access (?:is )?(?:denied|restricted)|cannot be (?:accessed|downloaded|performed|computed)|could not be (?:accessed|downloaded|extracted|fetched|retrieved)|no (?:public|pre[- ]?computed|alternative)[^.!\n]{0,80}(?:data|dataset|table|results?|source)|no existing[^.!\n]{0,80}(?:analysis|results?)[^.!\n]{0,30}found|需(?:要)?(?:注册|登录|认证)|无法(?:访问|下载|计算|提取)|未找到[^。\n]{0,40}(?:数据|结果|来源)/iu;
const REPAIR_TASK_ID = /^(?:T_repair_|T_reflect_|T_completion_|T_completion_gap_|T_writer_repair_)/;

/**
 * Stop retrying an externally blocked leaf after two completed attempts.
 * This never marks research as successful: active gaps remain intact and the
 * completion gate will emit a resumable human-review result.
 */
export async function cancelRepeatedExternallyBlockedRepairs(
  ctx: PhaseContext,
  cycle: number,
): Promise<string[]> {
  const baseCycles = Math.max(1, Math.floor(ctx.state.runtimeProfile.phases.dispatchEvidence?.maxCycles ?? 1));
  if (cycle <= baseCycles) return [];
  const queued = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  const candidates = queued.filter((task) => (
    REPAIR_TASK_ID.test(task.taskId) && countedRowEvidenceTarget(task) === undefined
  ));
  if (candidates.length === 0) return [];
  const allTasks = await ctx.stack.ledger.listAll();
  const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const cancelledTaskIds: string[] = [];
  const blockerSamples: Array<{ taskId: string; reportNodeId: string; gap: string; completedAttempts: number }> = [];
  for (const task of candidates) {
    const completedAttempts = allTasks.filter((item) => (
      item.reportNodeId === task.reportNodeId
      && item.taskId !== "T_root"
      && item.taskId !== task.taskId
      && item.status === "completed"
    )).length;
    if (completedAttempts < 2) continue;
    const blocker = gaps.find((gap) => (
      gap.reportNodeId === task.reportNodeId
      && gap.status === "open"
      && gap.impact !== "low"
      && REPEATED_EXTERNAL_BLOCKER.test(`${gap.description} ${gap.suggestedQuery ?? ""}`)
    ));
    if (!blocker) continue;
    await ctx.stack.ledger.updateStatus(
      task.taskId,
      "cancelled",
      "Stopped repeated repair after two completed attempts confirmed an external data/access blocker; preserve the gap for resumable human review.",
    );
    cancelledTaskIds.push(task.taskId);
    blockerSamples.push({
      taskId: task.taskId,
      reportNodeId: task.reportNodeId,
      gap: blocker.description,
      completedAttempts,
    });
  }
  if (cancelledTaskIds.length === 0) return [];
  const remaining = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  if (remaining.length === 0) {
    ctx.state.adaptiveStop = {
      stopped: true,
      reason: "Repeated repair attempts confirmed external access/data blockers; stopped before another redundant provider cycle and preserved gaps for human review.",
      cycle,
      cancelledTaskIds,
    };
  }
  await ctx.emit({
    eventType: "repeated_external_blocker_repairs_cancelled",
    payload: {
      cycle,
      baseCycles,
      cancelledTaskIds,
      remainingQueuedTaskIds: remaining.map((task) => task.taskId),
      blockerSamples,
      adaptiveStop: remaining.length === 0,
    },
  });
  return cancelledTaskIds;
}

/**
 * Stop work queued for a fourth-or-later global dispatch cycle when the leaf
 * already has two completed attempts and the immediately preceding cycle did
 * not improve quality, must coverage, or active errors. Raw source/link growth
 * alone is not enough to justify another repair once it stops changing outcomes.
 * Open gaps remain untouched so the episode ends in resumable human review.
 */
export async function cancelRepeatedLowYieldRepairs(
  ctx: PhaseContext,
  cycle: number,
): Promise<string[]> {
  const policy = ctx.state.runtimeProfile.adaptiveBudget;
  if (!policy?.enabled || ctx.state.adaptiveStop?.stopped) return [];
  const baseCycles = Math.max(1, Math.floor(ctx.state.runtimeProfile.phases.dispatchEvidence?.maxCycles ?? 1));
  if (cycle <= baseCycles + 1) return [];
  const previous = ctx.state.cycleGains.at(-1);
  if (!previous || previous.cycle !== cycle - 1) return [];
  const outcomePlateau = previous.evidenceQualityScoreGain < policy.minQualityScoreGain
    && previous.coveredMustRequirementGain === 0
    && previous.activeQualityErrorReduction === 0;
  if (!outcomePlateau) return [];

  const queued = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  const candidates = queued.filter((task) => (
    REPAIR_TASK_ID.test(task.taskId) && countedRowEvidenceTarget(task) === undefined
  ));
  if (candidates.length === 0) return [];
  const allTasks = await ctx.stack.ledger.listAll();
  const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const cancelledTaskIds: string[] = [];
  const samples: Array<{ taskId: string; reportNodeId: string; completedAttempts: number; openGapCount: number }> = [];
  for (const task of candidates) {
    const completedAttempts = allTasks.filter((item) => (
      item.reportNodeId === task.reportNodeId
      && item.taskId !== "T_root"
      && item.taskId !== task.taskId
      && item.status === "completed"
    )).length;
    if (completedAttempts < 2) continue;
    const openGapCount = gaps.filter((gap) => (
      gap.reportNodeId === task.reportNodeId
      && gap.status === "open"
      && gap.impact !== "low"
    )).length;
    if (openGapCount === 0) continue;
    await ctx.stack.ledger.updateStatus(
      task.taskId,
      "cancelled",
      "Stopped repair work queued for a fourth-or-later global cycle after two completed leaf attempts and no previous-cycle quality, must-coverage, or active-error improvement; preserved open gaps for resumable human review.",
    );
    cancelledTaskIds.push(task.taskId);
    samples.push({ taskId: task.taskId, reportNodeId: task.reportNodeId, completedAttempts, openGapCount });
  }
  if (cancelledTaskIds.length === 0) return [];
  const remaining = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  if (remaining.length === 0) {
    ctx.state.adaptiveStop = {
      stopped: true,
      reason: "Repeated automatic repairs stopped improving evidence quality or requirement coverage; preserved unresolved gaps for human review.",
      cycle,
      cancelledTaskIds,
    };
  }
  await ctx.emit({
    eventType: "repeated_low_yield_repairs_cancelled",
    payload: {
      cycle,
      baseCycles,
      previousCycleGain: previous,
      cancelledTaskIds,
      remainingQueuedTaskIds: remaining.map((task) => task.taskId),
      samples,
      adaptiveStop: remaining.length === 0,
    },
  });
  return cancelledTaskIds;
}

export async function beginProviderRequest(
  ctx: PhaseContext,
  operation: ProviderOperation,
  provider: string,
  phase: string,
): Promise<string> {
  const key = usageKey(operation, provider);
  const usage = ensureUsage(ctx, operation, provider);
  const limit = providerLimit(ctx, operation, provider);
  const episodeLimit = ctx.state.runtimeProfile.providers.episode;
  const breach = findLimitBreach(ctx, usage, limit, operation, provider, phase)
    ?? findEpisodeLimitBreach(ctx, episodeLimit, phase);
  if (breach) {
    await recordBreach(ctx, breach);
    throw new ProviderBudgetExceededError(breach);
  }
  usage.requests += 1;
  return key;
}

export async function finishLlmRequest(
  ctx: PhaseContext,
  key: string,
  request: LlmChatRequest,
  response: LlmChatResponse,
  phase: string,
): Promise<void> {
  const usage = ctx.state.budgetUsage[key]!;
  usage.succeededRequests += 1;
  const tokens = response.usage ?? estimateTokens(request, response);
  if (!response.usage) usage.estimatedTokenRequests += 1;
  usage.promptTokens += nonNegative(tokens.promptTokens);
  usage.completionTokens += nonNegative(tokens.completionTokens);
  usage.totalTokens += nonNegative(tokens.totalTokens || tokens.promptTokens + tokens.completionTokens);
  const limit = providerLimit(ctx, "llm", usage.provider);
  usage.estimatedCostUsd = roundCost(usage.estimatedCostUsd + requestCost(limit, tokens.promptTokens, tokens.completionTokens));
  await recordPostRequestBreaches(ctx, usage, limit, phase);
}

export async function finishProviderRequest(
  ctx: PhaseContext,
  key: string,
  phase: string,
): Promise<void> {
  const usage = ctx.state.budgetUsage[key]!;
  usage.succeededRequests += 1;
  const limit = providerLimit(ctx, usage.operation, usage.provider);
  usage.estimatedCostUsd = roundCost(usage.estimatedCostUsd + nonNegative(limit?.costPerRequestUsd));
  await recordPostRequestBreaches(ctx, usage, limit, phase);
}

const MAX_FAILURE_SAMPLES_PER_PROVIDER = 20;

export function failProviderRequest(ctx: PhaseContext, key: string, sample?: Omit<ProviderFailureSample, "occurredAt">): void {
  const usage = ctx.state.budgetUsage[key];
  if (!usage) return;
  usage.failedRequests += 1;
  if (sample) {
    const samples = usage.failureSamples ??= [];
    if (samples.length < MAX_FAILURE_SAMPLES_PER_PROVIDER) {
      samples.push({ ...sample, occurredAt: isoNow(ctx.now) });
    }
  }
}

export function buildResearchBudgetAudit(ctx: PhaseContext): ResearchBudgetAudit {
  const usage = Object.values(ctx.state.budgetUsage).map((item) => structuredClone(item));
  return {
    version: 1,
    generatedAt: isoNow(ctx.now),
    limits: structuredClone(ctx.state.runtimeProfile.providers),
    usage,
    totals: usage.reduce((totals, item) => ({
      requests: totals.requests + item.requests,
      succeededRequests: totals.succeededRequests + item.succeededRequests,
      failedRequests: totals.failedRequests + item.failedRequests,
      promptTokens: totals.promptTokens + item.promptTokens,
      completionTokens: totals.completionTokens + item.completionTokens,
      totalTokens: totals.totalTokens + item.totalTokens,
      estimatedCostUsd: roundCost(totals.estimatedCostUsd + item.estimatedCostUsd),
    }), {
      requests: 0,
      succeededRequests: 0,
      failedRequests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    }),
    breaches: structuredClone(ctx.state.budgetBreaches),
    cycleGains: structuredClone(ctx.state.cycleGains),
    adaptiveStop: ctx.state.adaptiveStop ? structuredClone(ctx.state.adaptiveStop) : undefined,
  };
}

export async function writeResearchBudgetAudit(ctx: PhaseContext): Promise<string> {
  const dir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "budget-audit.json");
  await writeFile(path, JSON.stringify(buildResearchBudgetAudit(ctx), null, 2), "utf8");
  return path;
}

export function budgetMetricFields(ctx: PhaseContext): Pick<
  import("@deepresearch/contracts").EpisodeResult["metrics"],
  "providerRequestCount" | "totalTokenCount" | "estimatedCostUsd" | "budgetBreachCount" | "adaptiveStopApplied"
> {
  const audit = buildResearchBudgetAudit(ctx);
  return {
    providerRequestCount: audit.totals.requests,
    totalTokenCount: audit.totals.totalTokens,
    estimatedCostUsd: audit.totals.estimatedCostUsd,
    budgetBreachCount: audit.breaches.length,
    adaptiveStopApplied: audit.adaptiveStop?.stopped ?? false,
  };
}

function ensureUsage(ctx: PhaseContext, operation: ProviderOperation, provider: string): ProviderUsageRecord {
  const key = usageKey(operation, provider);
  return ctx.state.budgetUsage[key] ??= {
    operation,
    provider,
    requests: 0,
    succeededRequests: 0,
    failedRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimatedTokenRequests: 0,
    estimatedCostUsd: 0,
  };
}

function usageKey(operation: ProviderOperation, provider: string): string {
  return `${operation}:${provider}`;
}

function providerLimit(
  ctx: PhaseContext,
  operation: ProviderOperation,
  provider: string,
): RuntimeProviderLimit | undefined {
  const limits = ctx.state.runtimeProfile.providers;
  return limits[`${operation}:${provider}`]
    ?? limits[provider]
    ?? limits[`default_${operation}`]
    ?? (operation === "llm" ? limits.default_llm : undefined);
}

function findLimitBreach(
  ctx: PhaseContext,
  usage: ProviderUsageRecord,
  limit: RuntimeProviderLimit | undefined,
  operation: ProviderOperation,
  provider: string,
  phase: string,
): ResearchBudgetBreach | undefined {
  if (!limit) return undefined;
  return breachForValues(ctx, operation, provider, phase, limit, usage);
}

function findEpisodeLimitBreach(
  ctx: PhaseContext,
  limit: RuntimeProviderLimit | undefined,
  phase: string,
): ResearchBudgetBreach | undefined {
  if (!limit) return undefined;
  const totals = buildResearchBudgetAudit(ctx).totals;
  return breachForValues(ctx, "episode", "episode", phase, limit, {
    requests: totals.requests,
    promptTokens: totals.promptTokens,
    completionTokens: totals.completionTokens,
    totalTokens: totals.totalTokens,
    estimatedCostUsd: totals.estimatedCostUsd,
  });
}

function breachForValues(
  ctx: PhaseContext,
  operation: ProviderOperation | "episode",
  provider: string,
  phase: string,
  limit: RuntimeProviderLimit,
  usage: Pick<ProviderUsageRecord, "requests" | "promptTokens" | "completionTokens" | "totalTokens" | "estimatedCostUsd">,
): ResearchBudgetBreach | undefined {
  const checks: Array<[ResearchBudgetBreach["limit"], number | undefined, number]> = [
    ["maxRequests", limit.maxRequests, usage.requests],
    ["maxInputTokens", limit.maxInputTokens, usage.promptTokens],
    ["maxOutputTokens", limit.maxOutputTokens, usage.completionTokens],
    ["maxTotalTokens", limit.maxTotalTokens, usage.totalTokens],
    ["maxCostUsd", limit.maxCostUsd, usage.estimatedCostUsd],
  ];
  const hit = checks.find(([, allowed, observed]) => typeof allowed === "number" && allowed >= 0 && observed >= allowed);
  if (!hit) return undefined;
  return {
    breachId: `BR_${shortId(`${operation}_${provider}_${hit[0]}_${ctx.state.budgetBreaches.length + 1}`)}`,
    operation,
    provider,
    limit: hit[0],
    allowed: hit[1]!,
    observed: hit[2],
    phase,
    occurredAt: isoNow(ctx.now),
  };
}

async function recordPostRequestBreaches(
  ctx: PhaseContext,
  usage: ProviderUsageRecord,
  limit: RuntimeProviderLimit | undefined,
  phase: string,
): Promise<void> {
  const providerBreach = findLimitBreach(ctx, usage, limit, usage.operation, usage.provider, phase);
  if (providerBreach) await recordBreach(ctx, providerBreach);
  const episodeBreach = findEpisodeLimitBreach(ctx, ctx.state.runtimeProfile.providers.episode, phase);
  if (episodeBreach) await recordBreach(ctx, episodeBreach);
}

async function recordBreach(ctx: PhaseContext, breach: ResearchBudgetBreach): Promise<void> {
  const existing = ctx.state.budgetBreaches.some((item) => (
    item.operation === breach.operation && item.provider === breach.provider && item.limit === breach.limit
  ));
  if (existing) return;
  ctx.state.budgetBreaches.push(breach);
  await ctx.emit({ eventType: "provider_budget_exhausted", payload: { ...breach } });
}

function estimateTokens(request: LlmChatRequest, response: LlmChatResponse): NonNullable<LlmChatResponse["usage"]> {
  const promptTokens = Math.ceil(`${request.system ?? ""}\n${request.user}`.length / 4);
  const completionTokens = Math.ceil(`${response.reasoning ?? ""}\n${response.content}`.length / 4);
  return { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens };
}

function requestCost(limit: RuntimeProviderLimit | undefined, promptTokens: number, completionTokens: number): number {
  if (!limit) return 0;
  return nonNegative(promptTokens) * nonNegative(limit.inputCostPerMillionTokensUsd) / 1_000_000
    + nonNegative(completionTokens) * nonNegative(limit.outputCostPerMillionTokensUsd) / 1_000_000
    + nonNegative(limit.costPerRequestUsd);
}

function nonNegative(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function roundCost(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}
