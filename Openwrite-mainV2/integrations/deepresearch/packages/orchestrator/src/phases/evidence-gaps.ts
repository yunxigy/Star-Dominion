import type { AgentRunResult, OpenGap, Reportlet, ReportNode, TaskItem } from "@deepresearch/contracts";
import { traceWrite } from "../trace.js";
import type { PhaseContext } from "../types.js";
import { stringOr, stringOrUndefined } from "./evidence-utils.js";

async function closeResolvedTargetedGaps(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  reportlets: Reportlet[],
  newGaps: OpenGap[],
): Promise<void> {
  if (reportlets.length === 0 || !/^(T_gap_|T_repair_|T_completion_gap_)/.test(task.taskId)) return;
  const stored = await ctx.stack.kg.listOpenGaps?.(reportNode.nodeId) ?? [];
  const completedPartIds = new Set(reportlets.map((reportlet) => reportlet.plannedReportlet?.partId).filter((value): value is string => Boolean(value)));
  const targets = stored.filter((gap) => {
    if (gap.status === "closed" || !task.objective.includes(gap.description)) return false;
    if (gap.gapType === "planned_reportlet_not_completed") {
      const partId = gap.description.match(/(?:报告任务|report\s+part)\s+([A-Za-z0-9_-]+)/iu)?.[1];
      if (!partId || !completedPartIds.has(partId)) return false;
    }
    return !newGaps.some((candidate) => sameGapConcern(gap, candidate));
  });
  if (targets.length === 0) return;
  const matches = targets.map((gap) => ({
    reportNodeId: gap.reportNodeId,
    description: gap.description,
    reason: `Evidence repair ${task.taskId} produced a cited reportlet without reasserting this gap.`,
  }));
  const closed = await ctx.stack.kg.closeOpenGapsMatching?.(matches) ?? 0;
  if (closed > 0) await traceWrite(ctx, "kg", "closeOpenGapsMatching", { taskId: task.taskId, closed, matches }, { taskId: task.taskId, reportNodeId: reportNode.nodeId });
}

function sameGapConcern(left: OpenGap, right: OpenGap): boolean {
  const leftText = normalizeGapText(left.description);
  const rightText = normalizeGapText(right.description);
  if (leftText.includes(rightText) || rightText.includes(leftText)) return true;
  const a = gapTopicTokens(leftText);
  const b = gapTopicTokens(rightText);
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return overlap / Math.min(a.size, b.size) >= 0.45;
}

function normalizeGapText(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function gapTopicTokens(value: string): Set<string> {
  const stop = new Set(["about", "additional", "direct", "evidence", "missing", "needed", "source", "support", "仍需", "原始", "直接", "缺少", "证据", "资料", "文献", "来源", "补充"]);
  const ascii = (value.match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? []).filter((token) => !stop.has(token));
  const cjk = value.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const bigrams = cjk.flatMap((chunk) => Array.from({ length: Math.max(0, chunk.length - 1) }, (_, index) => chunk.slice(index, index + 2)))
    .filter((token) => !stop.has(token));
  return new Set([...ascii, ...bigrams]);
}

function mergeGaps(
  collected: OpenGap[],
  assessed: OpenGap[],
  task: TaskItem,
  reportNode: ReportNode,
  defaultQuery: string,
): OpenGap[] {
  const seen = new Set<string>();
  const out: OpenGap[] = [];
  for (const gap of [...collected, ...assessed]) {
    const normalized: OpenGap = {
      gapType: gap.gapType || "missing_source",
      description: gap.description,
      suggestedQuery: gap.suggestedQuery || defaultQuery,
      reportNodeId: gap.reportNodeId ?? reportNode.nodeId,
      taskId: gap.taskId ?? task.taskId,
      impact: gap.impact ?? "medium",
      status: gap.status ?? "open",
      recommendedDisposition: gap.recommendedDisposition,
      claimSafeWithoutMissingEvidence: gap.claimSafeWithoutMissingEvidence,
      affectedRequirementIds: gap.affectedRequirementIds,
    };
    const key = `${normalized.reportNodeId}:${normalized.description}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function isEvidenceSupportedStatus(status: ReportNode["status"] | undefined): boolean {
  return status === "supported" || status === "partially_supported" || status === "verified";
}

function addOpenGap(ctx: PhaseContext, gap: OpenGap): void {
  void (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.(gap);
  void traceWrite(ctx, "kg", "addOpenGap", { gap }, { taskId: gap.taskId, reportNodeId: gap.reportNodeId });
}

async function closeOpenGaps(ctx: PhaseContext, reportNodeId: string, reason: string): Promise<void> {
  const closed = await (ctx.stack.kg as { closeOpenGaps?: (reportNodeId: string, reason?: string) => Promise<number> }).closeOpenGaps?.(reportNodeId, reason);
  if (closed) await traceWrite(ctx, "kg", "closeOpenGaps", { reportNodeId, closed, reason }, { reportNodeId });
}

function gapFromObject(value: Record<string, unknown>): OpenGap | undefined {
  const description = stringOrUndefined(value.description);
  if (!description) return undefined;
  return {
    gapType: stringOr(value.gapType, "missing_source"),
    description,
    suggestedQuery: stringOr(value.suggestedQuery, description),
    reportNodeId: stringOrUndefined(value.reportNodeId),
    taskId: stringOrUndefined(value.taskId),
    impact: value.impact === "low" || value.impact === "medium" || value.impact === "high" ? value.impact : "medium",
    status: value.status === "acknowledged" || value.status === "closed" ? value.status : "open",
    recommendedDisposition: value.recommendedDisposition === "retry" || value.recommendedDisposition === "qualify" || value.recommendedDisposition === "omit"
      ? value.recommendedDisposition
      : undefined,
    claimSafeWithoutMissingEvidence: typeof value.claimSafeWithoutMissingEvidence === "boolean" ? value.claimSafeWithoutMissingEvidence : undefined,
    affectedRequirementIds: Array.isArray(value.affectedRequirementIds)
      ? value.affectedRequirementIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : undefined,
  };
}

function agentResultGap(gap: OpenGap): AgentRunResult["openGaps"][number] {
  return {
    gapType: gap.gapType,
    description: gap.description,
    suggestedQuery: gap.suggestedQuery,
    recommendedDisposition: gap.recommendedDisposition,
    claimSafeWithoutMissingEvidence: gap.claimSafeWithoutMissingEvidence,
    affectedRequirementIds: gap.affectedRequirementIds,
  };
}

export { addOpenGap, agentResultGap, closeOpenGaps, closeResolvedTargetedGaps, gapFromObject, isEvidenceSupportedStatus, mergeGaps };
