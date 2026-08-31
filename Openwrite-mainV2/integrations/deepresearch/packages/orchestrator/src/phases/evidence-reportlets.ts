import { createHash } from "node:crypto";
import type { AgentRuntimeResult, OpenGap, Reportlet, ReportNode, StructurePatchSuggestion, TaskItem } from "@deepresearch/contracts";
import { isoNow, shortId } from "../infra/ids.js";
import { traceWrite } from "../trace.js";
import type { PhaseContext } from "../types.js";
import { MAX_AGENT_NODE_PARTS } from "./evidence-budget.js";
import { gapFromObject } from "./evidence-gaps.js";
import { clamp01, numberOr, object, pushUnique, stringArray, stringOr, stringOrUndefined, uniqueStrings } from "./evidence-utils.js";

interface EvidenceAssessment {
  relation?: "supports" | "contradicts" | "qualifies" | "background";
  claimText?: string;
  confidence?: number;
  nodeStatus?: ReportNode["status"];
  reasoningSummary?: string;
  reportletMarkdown?: string;
  completedReportlets?: CompletedReportletAssessment[];
  openGaps?: Array<{
    gapType?: string;
    description?: string;
    suggestedQuery?: string;
    recommendedDisposition?: "retry" | "qualify" | "omit";
    claimSafeWithoutMissingEvidence?: boolean;
    affectedRequirementIds?: string[];
  }>;
  structurePatchSuggestions?: StructurePatchSuggestion[];
}

interface CompletedReportletAssessment {
  partId?: string;
  title?: string;
  markdown?: string;
  citedEvidenceLinkIds?: string[];
  citedKnowledgeNodeIds?: string[];
  reasoningSummary?: string;
}

interface NormalizedCompletedReportlet {
  partId: string;
  markdown: string;
  title?: string;
  citedEvidenceLinkIds?: string[];
  citedKnowledgeNodeIds?: string[];
  reasoningSummary?: string;
}

interface NormalizedEvidenceAssessment {
  relation: "supports" | "contradicts" | "qualifies" | "background";
  claimText: string;
  confidence: number;
  nodeStatus: ReportNode["status"];
  reasoningSummary: string;
  reportletMarkdown?: string;
  completedReportlets: NormalizedCompletedReportlet[];
  openGaps: OpenGap[];
  structurePatchSuggestions: StructurePatchSuggestion[];
}

const MAX_REPORTLET_EVIDENCE_LINKS = 6;

async function createEvidenceReportlets(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
  evidenceLinkIds: string[],
  knowledgeNodeIds: string[],
  assessment: NormalizedEvidenceAssessment,
): Promise<Reportlet[]> {
  if (evidenceLinkIds.length === 0 || !ctx.stack.kg.upsertReportlet) return [];
  const validKnowledgeNodeIds = uniqueStrings([
    ...knowledgeNodeIds,
    ...await knowledgeNodeIdsForEvidenceLinks(ctx, evidenceLinkIds),
  ]);
  const now = isoNow(ctx.now);
  const plans = task.plannedReportlets?.length
    ? task.plannedReportlets
    : task.plannedReportlet
      ? [task.plannedReportlet]
      : [];
  const reportlets: Reportlet[] = [];
  const base = {
    reportNodeId: reportNode.nodeId,
    taskId: task.taskId,
    reasoningSummary: assessment.reasoningSummary,
    createdAt: now,
    updatedAt: now,
  };
  const completedByPartId = new Map(assessment.completedReportlets.map((item) => [item.partId, item]));
  if (plans.length > 0 && completedByPartId.size > 0) {
    for (const plan of plans) {
      const completed = completedByPartId.get(plan.partId);
      if (!completed) continue;
      const markdown = sanitizeReportletEvidenceRefs(completed.markdown, evidenceLinkIds);
      const citedEvidenceLinkIds = explicitReportletEvidenceLinkIds({
        markdown,
        evidenceLinkIds,
      });
      if (!validReportletCitationCount(citedEvidenceLinkIds)) {
        await emitReportletCitationRejected(ctx, task, reportNode, meta, plan.partId, citedEvidenceLinkIds, evidenceLinkIds);
        continue;
      }
      reportlets.push({
        ...base,
        reportletId: reportletIdFor(task, plan.partId, markdown),
        title: completed.title || plan.expectedHeading || reportNode.label,
        markdown,
        citedEvidenceLinkIds,
        citedKnowledgeNodeIds: await selectReportletKnowledgeNodeIds(ctx, citedEvidenceLinkIds, validKnowledgeNodeIds),
        reasoningSummary: completed.reasoningSummary || assessment.reasoningSummary,
        plannedReportlet: structuredClone(plan),
      });
    }
  } else if (plans.length === 0) {
    const markdown = sanitizeReportletEvidenceRefs(reportletMarkdown(assessment, reportNode, task, evidenceLinkIds), evidenceLinkIds);
    const citedEvidenceLinkIds = explicitReportletEvidenceLinkIds({ markdown, evidenceLinkIds });
    if (!validReportletCitationCount(citedEvidenceLinkIds)) {
      await emitReportletCitationRejected(ctx, task, reportNode, meta, "single", citedEvidenceLinkIds, evidenceLinkIds);
      return [];
    }
    reportlets.push({
      ...base,
      reportletId: reportletIdFor(task, "single", `${citedEvidenceLinkIds.join("_")}\n${markdown}`),
      title: reportNode.label,
      markdown,
      citedEvidenceLinkIds,
      citedKnowledgeNodeIds: await selectReportletKnowledgeNodeIds(ctx, citedEvidenceLinkIds, validKnowledgeNodeIds),
      plannedReportlet: undefined,
    });
  }
  for (const reportlet of reportlets) {
    await ctx.stack.kg.upsertReportlet(reportlet);
    await traceWrite(ctx, "kg", "upsertReportlet", { reportlet }, meta);
    await ctx.emit({
      eventType: "reportlet_citation_bound",
      ...meta,
      payload: {
        reportletId: reportlet.reportletId,
        reportNodeId: reportlet.reportNodeId,
        taskId: reportlet.taskId,
        citedEvidenceLinkIds: reportlet.citedEvidenceLinkIds,
        citedKnowledgeNodeIds: reportlet.citedKnowledgeNodeIds,
        citationCount: reportlet.citedEvidenceLinkIds.length,
      },
    });
  }
  return reportlets;
}

function reportletIdFor(task: TaskItem, partId: string, discriminator: string): string {
  const readable = shortId(`${task.taskId}_${partId}`);
  const hash = createHash("sha1").update(`${task.taskId}\n${partId}\n${discriminator}`).digest("hex").slice(0, 10);
  return `RL_${readable}_${hash}`;
}

function evidenceLinkIdsFromMarkdown(markdown: string): string[] {
  return uniqueStrings(Array.from(markdown.matchAll(/\[E:([^\]]+)\]/g)).map((match) => match[1]?.trim() || ""));
}

function sanitizeReportletEvidenceRefs(markdown: string, validEvidenceLinkIds: string[]): string {
  const allowed = new Set(validEvidenceLinkIds);
  return markdown.replace(/\[E:([^\]]+)\]/g, (placeholder, rawId: string) => {
    const id = rawId.trim();
    if (allowed.has(id)) return `[E:${id}]`;
    const normalizedId = id.startsWith("E_") ? id : `E_${id}`;
    return allowed.has(normalizedId) ? `[E:${normalizedId}]` : "";
  }).replace(/[ \t]{2,}/g, " ").trim();
}

function explicitReportletEvidenceLinkIds(opts: {
  markdown: string;
  evidenceLinkIds: string[];
}): string[] {
  const allowed = new Set(opts.evidenceLinkIds);
  return uniqueStrings(evidenceLinkIdsFromMarkdown(opts.markdown).filter((id) => allowed.has(id)));
}

function validReportletCitationCount(evidenceLinkIds: string[]): boolean {
  return evidenceLinkIds.length > 0 && evidenceLinkIds.length <= MAX_REPORTLET_EVIDENCE_LINKS;
}

async function emitReportletCitationRejected(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
  partId: string,
  citedEvidenceLinkIds: string[],
  availableEvidenceLinkIds: string[],
): Promise<void> {
  await ctx.emit({
    eventType: "reportlet_citation_rejected",
    ...meta,
    payload: {
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      partId,
      reason: citedEvidenceLinkIds.length === 0 ? "missing_explicit_evidence_marker" : "too_many_evidence_markers",
      citationCount: citedEvidenceLinkIds.length,
      maxCitationCount: MAX_REPORTLET_EVIDENCE_LINKS,
      citedEvidenceLinkIds,
      availableEvidenceLinkCount: availableEvidenceLinkIds.length,
    },
  });
}

function missingUnplannedReportletCitationGap(
  task: TaskItem,
  reportNode: ReportNode,
  reportlets: Reportlet[],
  evidenceLinkIds: string[],
  assessment: NormalizedEvidenceAssessment,
): OpenGap | undefined {
  if (task.plannedReportlets?.length || task.plannedReportlet || evidenceLinkIds.length === 0 || reportlets.length > 0) return undefined;
  return {
    gapType: "reportlet_missing_explicit_citation",
    description: assessment.reportletMarkdown
      ? `报告片段未保存：正文没有有效的 [E:evidenceLinkId] 位置引用，或单片段引用超过 ${MAX_REPORTLET_EVIDENCE_LINKS} 条。`
      : "报告片段未保存：证据任务已有证据，但没有返回带 [E:evidenceLinkId] 位置引用的 reportletMarkdown。",
    suggestedQuery: task.objective,
    reportNodeId: reportNode.nodeId,
    taskId: task.taskId,
    impact: "medium",
    status: "open",
    affectedRequirementIds: task.requirementIds,
  };
}

async function selectReportletKnowledgeNodeIds(
  ctx: PhaseContext,
  evidenceLinkIds: string[],
  validKnowledgeNodeIds: string[],
): Promise<string[]> {
  const allowed = new Set(validKnowledgeNodeIds);
  return uniqueStrings((await knowledgeNodeIdsForEvidenceLinks(ctx, evidenceLinkIds)).filter((id) => allowed.has(id)));
}

function missingPlannedReportletGaps(task: TaskItem, reportNode: ReportNode, reportlets: Reportlet[]): OpenGap[] {
  const plans = task.plannedReportlets?.length
    ? task.plannedReportlets
    : task.plannedReportlet
      ? [task.plannedReportlet]
      : [];
  if (plans.length === 0) return [];
  const completed = new Set(reportlets.map((reportlet) => reportlet.plannedReportlet?.partId).filter(Boolean));
  return plans
    .filter((plan) => !completed.has(plan.partId))
    .map((plan): OpenGap => ({
      gapType: "planned_reportlet_not_completed",
      description: `报告任务 ${plan.partId} 未完成：${plan.expectedHeading || plan.researchQuestion}`,
      suggestedQuery: plan.searchGoal || plan.researchQuestion || task.objective,
      reportNodeId: reportNode.nodeId,
      taskId: task.taskId,
      impact: "medium",
      status: "open",
      affectedRequirementIds: task.requirementIds,
    }));
}

function plannedReportletCount(task: TaskItem): number {
  if (task.plannedReportlets?.length) return task.plannedReportlets.length;
  return task.plannedReportlet ? 1 : 0;
}

async function updateReportNodeDraftFromReportlets(
  ctx: PhaseContext,
  reportNode: ReportNode,
  reportlets: Reportlet[],
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
): Promise<void> {
  const current = await ctx.stack.kg.getReportNode(reportNode.nodeId);
  if (!current) return;
  const now = isoNow(ctx.now);
  const allReportlets = ctx.stack.kg.listReportlets
    ? await ctx.stack.kg.listReportlets(reportNode.nodeId)
    : reportlets;
  const draftReportlets = allReportlets.length > 0 ? allReportlets : reportlets;
  const draft = synthesizeReportNodeDraft(current, draftReportlets);
  const next: ReportNode = {
    ...current,
    draftSummary: draft.summary,
    draftMarkdown: draft.markdown,
    updatedAt: now,
  };
  await ctx.stack.kg.updateReportNode(next);
  await traceWrite(ctx, "kg", "updateReportNode", {
    node: next,
    source: "agent_reportlet_draft",
    reportletIds: draftReportlets.map((reportlet) => reportlet.reportletId),
  }, meta);
  await ctx.emit({
    eventType: "report_node_draft_updated",
    taskId: meta.taskId,
    reportNodeId: reportNode.nodeId,
    branchId: meta.branchId,
    agentRunId: meta.agentRunId,
    payload: {
      reportNodeId: reportNode.nodeId,
      reportletIds: draftReportlets.map((reportlet) => reportlet.reportletId),
      reportlets: draftReportlets.map(compactReportletForDraftEvent),
      draftSummary: draft.summary,
    },
  });
}

function compactReportletForDraftEvent(reportlet: Reportlet): Record<string, unknown> {
  return {
    reportletId: reportlet.reportletId,
    reportNodeId: reportlet.reportNodeId,
    taskId: reportlet.taskId,
    title: reportlet.title,
    markdownPreview: reportlet.markdown.slice(0, 1200),
    citedEvidenceLinkIds: reportlet.citedEvidenceLinkIds,
    citedKnowledgeNodeIds: reportlet.citedKnowledgeNodeIds,
    reasoningSummary: reportlet.reasoningSummary,
    plannedReportlet: reportlet.plannedReportlet,
    createdAt: reportlet.createdAt,
    updatedAt: reportlet.updatedAt,
  };
}

function synthesizeReportNodeDraft(node: ReportNode, reportlets: Reportlet[]): { summary: string; markdown: string } {
  const ordered = [...reportlets].sort((a, b) => {
    const left = a.plannedReportlet?.partId || a.reportletId;
    const right = b.plannedReportlet?.partId || b.reportletId;
    return left.localeCompare(right, undefined, { numeric: true });
  });
  const titles = ordered.map((reportlet) => reportlet.plannedReportlet?.expectedHeading || reportlet.title).filter(Boolean);
  const citationCount = new Set(ordered.flatMap((reportlet) => [...reportlet.citedEvidenceLinkIds, ...reportlet.citedKnowledgeNodeIds])).size;
  const summary = [
    `已由 ${ordered.length} 个报告任务片段回填。`,
    titles.length ? `覆盖：${titles.slice(0, 6).join("；")}${titles.length > 6 ? "等" : ""}。` : "",
    `引用资料/证据标记 ${citationCount} 个。`,
  ].filter(Boolean).join("");
  const markdown = [
    `### ${node.label}`,
    "",
    summary,
    "",
    ...ordered.flatMap((reportlet) => [reportlet.markdown.trim(), ""]),
  ].join("\n").trim();
  return { summary, markdown };
}

async function knowledgeNodeIdsForEvidenceLinks(ctx: PhaseContext, evidenceLinkIds: string[]): Promise<string[]> {
  const links = await Promise.all(evidenceLinkIds.map((evidenceLinkId) => ctx.stack.kg.getEvidenceLink(evidenceLinkId)));
  return links.filter((link): link is NonNullable<typeof link> => Boolean(link)).map((link) => link.knowledgeNodeId);
}

function reportletMarkdown(
  assessment: NormalizedEvidenceAssessment,
  reportNode: ReportNode,
  task: TaskItem,
  evidenceLinkIds: string[],
): string {
  const provided = assessment.reportletMarkdown?.trim();
  if (provided) return provided;
  return "";
}

function collectRuntimeEvidence(runtime: AgentRuntimeResult): {
  knowledgeNodeIds: string[];
  evidenceLinkIds: string[];
  completedReportlets: NormalizedCompletedReportlet[];
  openGaps: OpenGap[];
  structurePatchSuggestions: StructurePatchSuggestion[];
} {
  const knowledgeNodeIds: string[] = [];
  const evidenceLinkIds: string[] = [];
  const completedReportlets: NormalizedCompletedReportlet[] = [];
  const openGaps: OpenGap[] = [];
  const structurePatchSuggestions: StructurePatchSuggestion[] = [];
  for (const step of runtime.steps) {
    const result = step.toolResult;
    if (!result?.ok) continue;
    const output = object(result.output);
    if (result.toolName === "save_knowledge_node") {
      pushUnique(knowledgeNodeIds, stringOrUndefined(output.knowledgeNodeId));
      pushUnique(evidenceLinkIds, stringOrUndefined(output.evidenceLinkId));
    }
    if (result.toolName === "link_evidence") {
      pushUnique(evidenceLinkIds, stringOrUndefined(output.evidenceLinkId));
    }
    if (result.toolName === "harvest_counted_rows" && Array.isArray(output.rows)) {
      for (const rowValue of output.rows) {
        const row = object(rowValue);
        const knowledgeNodeId = stringOrUndefined(row.knowledgeNodeId);
        const evidenceLinkId = stringOrUndefined(row.evidenceLinkId);
        const partId = stringOrUndefined(row.partId);
        const markdown = stringOrUndefined(row.markdown);
        if (!knowledgeNodeId || !evidenceLinkId || !partId || !markdown) continue;
        pushUnique(knowledgeNodeIds, knowledgeNodeId);
        pushUnique(evidenceLinkIds, evidenceLinkId);
        completedReportlets.push({
          partId,
          title: stringOrUndefined(row.title),
          markdown,
          citedEvidenceLinkIds: [evidenceLinkId],
          citedKnowledgeNodeIds: [knowledgeNodeId],
          reasoningSummary: stringOrUndefined(row.reasoningSummary) ?? "Atomically harvested and validated a complete counted row.",
        });
      }
    }
    if (result.toolName === "open_gap") {
      const gap = object(output.gap);
      const normalized = gapFromObject(gap);
      if (normalized) openGaps.push(normalized);
    }
    if (result.toolName === "suggest_patch") {
      const suggestion = object(output.suggestion);
      const patch = object(suggestion.patch);
      if (typeof patch.op === "string") {
        structurePatchSuggestions.push({
          patch: patch as StructurePatchSuggestion["patch"],
          rationale: stringOr(suggestion.rationale, "Suggested by evidence agent."),
          confidence: clamp01(numberOr(suggestion.confidence, 0.5)),
        });
      }
    }
  }
  return { knowledgeNodeIds, evidenceLinkIds, completedReportlets, openGaps, structurePatchSuggestions };
}

function normalizeAssessment(input: EvidenceAssessment, hitCount: number, task: TaskItem, node: ReportNode, defaultQuery: string): NormalizedEvidenceAssessment {
  const relation = ["supports", "contradicts", "qualifies", "background"].includes(String(input.relation)) ? input.relation! : hitCount > 0 ? "supports" : "qualifies";
  const confidence = typeof input.confidence === "number" && Number.isFinite(input.confidence)
    ? Math.max(0, Math.min(1, input.confidence))
    : hitCount > 0 ? 0.7 : 0.3;
  const allowedStatuses: ReportNode["status"][] = ["supported", "partially_supported", "contradicted", "insufficient_evidence", "downplayed"];
  const nodeStatus = allowedStatuses.includes(input.nodeStatus as ReportNode["status"])
    ? input.nodeStatus as ReportNode["status"]
    : hitCount === 0 ? "insufficient_evidence" : relation === "contradicts" ? "contradicted" : relation === "qualifies" ? "partially_supported" : "supported";
  const openGaps = Array.isArray(input.openGaps)
    ? input.openGaps
        .filter((gap) => gap && typeof gap.description === "string")
        .slice(0, 5)
        .map((gap): OpenGap => ({
          gapType: gap.gapType || "missing_source",
          description: gap.description!,
          suggestedQuery: gap.suggestedQuery || defaultQuery,
          reportNodeId: node.nodeId,
          taskId: task.taskId,
          impact: "medium",
          status: "open",
          recommendedDisposition: gap.recommendedDisposition === "retry" || gap.recommendedDisposition === "qualify" || gap.recommendedDisposition === "omit"
            ? gap.recommendedDisposition
            : undefined,
          claimSafeWithoutMissingEvidence: typeof gap.claimSafeWithoutMissingEvidence === "boolean" ? gap.claimSafeWithoutMissingEvidence : undefined,
          affectedRequirementIds: Array.isArray(gap.affectedRequirementIds)
            ? gap.affectedRequirementIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
            : task.requirementIds,
        }))
    : [];
  if (hitCount === 0 && openGaps.length === 0) {
    openGaps.push({
      gapType: "missing_source",
      description: `No search evidence was available for task ${task.taskId}.`,
      suggestedQuery: defaultQuery,
      reportNodeId: node.nodeId,
      taskId: task.taskId,
      impact: "medium",
      status: "open",
      affectedRequirementIds: task.requirementIds,
    });
  }
  return {
    relation,
    claimText: input.claimText || node.hypothesis?.statement || task.objective,
    confidence,
    nodeStatus,
    reasoningSummary: input.reasoningSummary || "Evidence assessment completed.",
    reportletMarkdown: typeof input.reportletMarkdown === "string" && input.reportletMarkdown.trim() ? input.reportletMarkdown.trim() : undefined,
    completedReportlets: normalizeCompletedReportlets(input.completedReportlets),
    openGaps,
    structurePatchSuggestions: Array.isArray(input.structurePatchSuggestions) ? input.structurePatchSuggestions.slice(0, 5) : [],
  };
}

function normalizeCompletedReportlets(value: unknown): NormalizedEvidenceAssessment["completedReportlets"] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => object(item))
    .flatMap((item): NormalizedCompletedReportlet[] => {
      const partId = stringOrUndefined(item.partId);
      const markdown = stringOrUndefined(item.markdown);
      if (!partId || !markdown) return [];
      return [{
        partId,
        markdown,
        title: stringOrUndefined(item.title),
        citedEvidenceLinkIds: stringArray(item.citedEvidenceLinkIds),
        citedKnowledgeNodeIds: stringArray(item.citedKnowledgeNodeIds),
        reasoningSummary: stringOrUndefined(item.reasoningSummary),
      }];
    })
    .slice(0, MAX_AGENT_NODE_PARTS);
}

export {
  MAX_REPORTLET_EVIDENCE_LINKS,
  collectRuntimeEvidence,
  createEvidenceReportlets,
  missingPlannedReportletGaps,
  missingUnplannedReportletCitationGap,
  normalizeAssessment,
  plannedReportletCount,
  updateReportNodeDraftFromReportlets,
};
export type { EvidenceAssessment, NormalizedCompletedReportlet, NormalizedEvidenceAssessment };
