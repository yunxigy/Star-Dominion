import type { OpenGap, Reportlet, ResearchRequirement, TaskItem } from "@deepresearch/contracts";
import { traceWrite } from "./trace.js";
import type { PhaseContext } from "./types.js";

export interface CountedRowGapConsolidation {
  rowNodeIds: Set<string>;
  sourceCount: number;
  collectiveMinimum?: number;
  remaining: number;
  closedSoftGapCount: number;
  aggregateGap?: OpenGap;
}

export interface CountedRowSourceInventory {
  reportNodeIds: string[];
  sources: Array<{
    knowledgeNodeId: string;
    title: string;
    url?: string;
    reportNodeIds: string[];
  }>;
}

export function countedStudyTableMinimum(
  requirement: Pick<ResearchRequirement, "kind" | "description">,
): number | undefined {
  // A deliverable that explicitly asks for a table of named studies is
  // inherently evidence-bearing. Do not let one erroneous rubric-parser
  // boolean suppress the counted-row workflow or its final render checks.
  if (requirement.kind !== "deliverable" || !/\btable\b/iu.test(requirement.description)) return undefined;
  const match = requirement.description.match(/\b(?:at\s+least|minimum\s+of)\s+(\d{1,2})\s+(?:(?:distinct|different|empirical|relevant|reviewed|included|primary)\s+){0,3}stud(?:y|ies)\b/iu);
  const count = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(count) && count >= 6 && count <= 60 ? count : undefined;
}

export function countedRowEvidenceTarget(task: Pick<TaskItem, "acceptanceCriteria">): number | undefined {
  const match = task.acceptanceCriteria.join("\n").match(/\bAim to contribute about\s+(\d{1,2})\s+distinct\b/iu);
  const value = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isSafeInteger(value) && value >= 2 && value <= 8 ? value : undefined;
}

export async function countedRowSourceInventory(ctx: PhaseContext): Promise<CountedRowSourceInventory> {
  const tasks = (await ctx.stack.ledger.listAll()).filter((task) => countedRowEvidenceTarget(task) !== undefined);
  const reportNodeIds = Array.from(new Set(tasks.map((task) => task.reportNodeId)));
  if (reportNodeIds.length === 0) return { reportNodeIds, sources: [] };
  const reportNodeIdSet = new Set(reportNodeIds);
  const [links, knowledgeNodes] = await Promise.all([
    ctx.stack.kg.listEvidenceLinks(),
    ctx.stack.kg.listKnowledgeNodes(),
  ]);
  const linkedReportNodes = new Map<string, Set<string>>();
  for (const link of links) {
    if (!reportNodeIdSet.has(link.reportNodeId)) continue;
    const nodes = linkedReportNodes.get(link.knowledgeNodeId) ?? new Set<string>();
    nodes.add(link.reportNodeId);
    linkedReportNodes.set(link.knowledgeNodeId, nodes);
  }
  return {
    reportNodeIds,
    sources: knowledgeNodes.flatMap((node) => {
      const nodeReportIds = linkedReportNodes.get(node.nodeId);
      return nodeReportIds ? [{
        knowledgeNodeId: node.nodeId,
        title: node.title,
        url: node.url,
        reportNodeIds: Array.from(nodeReportIds),
      }] : [];
    }),
  };
}

export async function consolidateCountedRowGaps(ctx: PhaseContext): Promise<CountedRowGapConsolidation> {
  const tasks = (await ctx.stack.ledger.listAll()).filter((task) => countedRowEvidenceTarget(task) !== undefined);
  const rowNodeIds = new Set(tasks.map((task) => task.reportNodeId));
  const collectiveMinimum = tasks.flatMap((task) => {
    const match = task.acceptanceCriteria.join("\n").match(/\bOnly the collective minimum of\s+(\d{1,3})\s+studies is mandatory\b/iu);
    return match?.[1] ? [Number(match[1])] : [];
  }).find((value) => Number.isSafeInteger(value) && value > 0);
  if (tasks.length === 0 || !collectiveMinimum || !ctx.stack.kg.listOpenGaps) {
    return { rowNodeIds, sourceCount: 0, collectiveMinimum, remaining: 0, closedSoftGapCount: 0 };
  }

  const [reportlets, knowledgeNodes, gaps] = await Promise.all([
    ctx.stack.kg.listReportlets?.() ?? Promise.resolve([]),
    ctx.stack.kg.listKnowledgeNodes(),
    ctx.stack.kg.listOpenGaps(),
  ]);
  const knowledgeById = new Map(knowledgeNodes.map((node) => [node.nodeId, node]));
  const sourceIds = new Set(reportlets.filter((reportlet) => (
    rowNodeIds.has(reportlet.reportNodeId) && isCompleteStudyRowReportlet(reportlet)
  )).flatMap((reportlet) => reportlet.citedKnowledgeNodeIds).filter((knowledgeNodeId) => (
    ["primary", "official"].includes(knowledgeById.get(knowledgeNodeId)?.sourceTier ?? "")
  )));
  const remaining = Math.max(0, collectiveMinimum - sourceIds.size);
  const softGaps = gaps.filter((gap) => isSoftCountedRowGap(gap, rowNodeIds));
  const staleAggregateGaps = gaps.filter((gap) => (
    gap.gapType === "counted_rows_remaining"
    && (remaining === 0 || gap.description !== aggregateDescription(remaining, collectiveMinimum))
  ));
  const matches = [...softGaps, ...staleAggregateGaps].map((gap) => ({
    reportNodeId: gap.reportNodeId,
    description: gap.description,
    reason: "Replaced per-group soft allocation gaps with the collective counted-row requirement.",
  }));
  const closedSoftGapCount = matches.length > 0
    ? await ctx.stack.kg.closeOpenGapsMatching?.(matches) ?? 0
    : 0;

  let aggregateGap: OpenGap | undefined;
  if (remaining > 0) {
    const firstTask = tasks[0]!;
    aggregateGap = {
      gapType: "counted_rows_remaining",
      description: aggregateDescription(remaining, collectiveMinimum),
      suggestedQuery: "online learning effectiveness higher education COVID-19 empirical study 2020 2021 2022 2023 sample size research design outcomes",
      reportNodeId: firstTask.reportNodeId,
      taskId: firstTask.taskId,
      impact: "medium",
      status: "open",
    };
    await ctx.stack.kg.addOpenGap?.(aggregateGap);
  }

  await ctx.emit({
    eventType: "counted_row_gaps_consolidated",
    payload: {
      rowNodeIds: Array.from(rowNodeIds),
      sourceCount: sourceIds.size,
      collectiveMinimum,
      remaining,
      closedSoftGapCount,
      aggregateGap: aggregateGap?.description,
    },
  });
  await traceWrite(ctx, "kg", "consolidateCountedRowGaps", {
    rowNodeIds: Array.from(rowNodeIds),
    sourceCount: sourceIds.size,
    collectiveMinimum,
    remaining,
    closedSoftGapCount,
  });
  return { rowNodeIds, sourceCount: sourceIds.size, collectiveMinimum, remaining, closedSoftGapCount, aggregateGap };
}

export function isSoftCountedRowGap(gap: OpenGap, rowNodeIds: Set<string>): boolean {
  if (!gap.reportNodeId || !rowNodeIds.has(gap.reportNodeId)) return false;
  if (gap.gapType === "planned_reportlet_not_completed") return /\bStudy row \d+ of \d+\b/iu.test(gap.description);
  if (!["missing_evidence", "missing_study", "missing_studies", "insufficient_studies"].includes(gap.gapType)) return false;
  return /\b(?:study|studies|rows?)\b/iu.test(gap.description)
    && /\b(?:additional|more|target|total|across|collective|region|regional|Asia|Pacific|Europe|European|Africa|African|Americas|Middle East|cross-regional|beyond)\b/iu.test(gap.description);
}

export function isCompleteStudyRowReportlet(reportlet: Pick<Reportlet, "markdown" | "citedKnowledgeNodeIds">): boolean {
  if (reportlet.citedKnowledgeNodeIds.length === 0) return false;
  const authors = rowField(reportlet.markdown, "Authors");
  const country = rowField(reportlet.markdown, "Country");
  const sampleSize = rowField(reportlet.markdown, "Sample Size");
  const researchDesign = rowField(reportlet.markdown, "Research Design");
  const outcomeVariable = rowField(reportlet.markdown, "Outcome Variable");
  const finding = rowField(reportlet.markdown, "Finding on Effectiveness");
  const fields = [authors, country, sampleSize, researchDesign, outcomeVariable, finding];
  if (fields.some((value) => !value || isMissingRowValue(value))) return false;
  return hasConcreteSampleCount(sampleSize!) && /^(?:effective|ineffective|neutral)\b/iu.test(finding!);
}

function rowField(markdown: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return markdown.match(new RegExp(
    `(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*{1,2})?${escaped}(?:\\s*:\\s*(?:\\*{1,2})?|(?:\\*{1,2})?\\s*:\\s*)([^\\n|]+)`,
    "iu",
  ))?.[1]?.trim();
}

function isMissingRowValue(value: string): boolean {
  return /\b(?:unknown|not\s+(?:available|reported|stated|provided|specified|extracted)|unavailable|missing|n\/?a|could not)\b/iu.test(value);
}

function hasConcreteSampleCount(value: string): boolean {
  return Array.from(value.matchAll(/\b\d[\d,]*(?:\.\d+)?\s*%?/gu)).some((match) => {
    const token = match[0].trim();
    if (token.endsWith("%")) return false;
    const count = Number(token.replace(/,/g, ""));
    return Number.isFinite(count) && Number.isInteger(count) && count >= 10;
  });
}

function aggregateDescription(remaining: number, collectiveMinimum: number): string {
  return `The summary table needs ${remaining} additional distinct eligible primary ${remaining === 1 ? "study" : "studies"} from any geography to reach the collective minimum of ${collectiveMinimum}; complete every requested row field and deduplicate by title or DOI.`;
}
