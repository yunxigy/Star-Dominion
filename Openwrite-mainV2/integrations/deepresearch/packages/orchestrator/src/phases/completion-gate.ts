import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { EpisodeResult, EvidenceQualityAudit, NewTaskRequest, OpenGap, ReportNode, ResearchIssueWaiver, TaskItem } from "@deepresearch/contracts";
import { auditEvidenceQuality, resolveEvidenceQualityPolicy } from "../evidence-quality.js";
import { isoNow, shortId } from "../infra/ids.js";
import { traceWrite } from "../trace.js";
import { exportFullTrace, exportSummaryTrace, wantsFullTrace } from "../trace.js";
import type { PhaseContext } from "../types.js";
import { createHumanReviewRequest, type HumanReviewConcern } from "./human-review.js";
import { budgetMetricFields, writeResearchBudgetAudit } from "../budget.js";
import { consolidateCountedRowGaps } from "../counted-rows.js";
import { isNonWaivableRequirement } from "../requirement-policy.js";

export type CompletionGateDecision =
  | { decision: "ready_for_report"; reason?: string; newTasks?: NewTaskRequest[] }
  | { decision: "need_more_work"; reason: string; newTasks?: NewTaskRequest[]; result?: EpisodeResult };

const MAX_COMPLETION_REPAIR_TASKS_PER_NODE = 6;
const MAX_COMPLETION_GAP_REPAIR_TASKS_PER_GAP = 3;

export async function completionGatePhase(ctx: PhaseContext, opts: { final?: boolean; allowRepairTasks?: boolean } = {}): Promise<CompletionGateDecision> {
  await consolidateCountedRowGaps(ctx);
  let nodes = await ctx.stack.kg.listReportNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const tasks = await ctx.stack.ledger.listAll();
  const restoredPrunedNodes = await restorePrunedSupportedNodes(ctx, nodes, evidenceLinks);
  if (restoredPrunedNodes > 0) nodes = await ctx.stack.kg.listReportNodes();
  const promotedNodes = await promoteEvidenceBackedBlockingNodes(ctx, nodes, evidenceLinks, tasks);
  if (promotedNodes > 0) nodes = await ctx.stack.kg.listReportNodes();
  let gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const autoAcknowledged = await acknowledgeResolvedMediumGaps(ctx, nodes, evidenceLinks, tasks, gaps);
  if (autoAcknowledged > 0) {
    nodes = await ctx.stack.kg.listReportNodes();
    gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  }
  const debugAcknowledged = await acknowledgeSingleBranchDebugMediumGaps(ctx, nodes, evidenceLinks, gaps);
  if (debugAcknowledged > 0) {
    nodes = await ctx.stack.kg.listReportNodes();
    gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  }
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const activeGaps = gaps.filter((gap) => isCompletionBlockingGap(gap, nodesById));
  const blockingGaps = activeGaps.filter((gap) => gap.impact !== "low");
  const blockingStatuses = new Set(["planned", "researching", "needs_review", "needs_repair", "insufficient_evidence"]);
  const nonTerminal = nodes.filter((node) => node.nodeKind === "hypothesis" && node.status !== "pruned" && node.status !== "downplayed")
    .filter((node) => blockingStatuses.has(node.status));
  const uncovered = nodes.filter((node) => node.nodeKind === "hypothesis" && node.status !== "downplayed" && node.status !== "pruned")
    .filter((node) => !evidenceLinks.some((link) => link.reportNodeId === node.nodeId));
  const queuedOrRunning = tasks.filter((task) => task.taskId !== "T_root" && ["queued", "running"].includes(task.status));
  const failedResearchTasks = tasks.filter((task) => task.taskId !== "T_root" && task.status === "failed");
  const evidenceQualityAudit = await buildCompletionEvidenceAudit(ctx);
  const qualityBlockingNodeIds = new Set(
    evidenceQualityAudit?.issues
      .filter((issue) => issue.severity === "error" && issue.reportNodeId)
      .map((issue) => issue.reportNodeId!) ?? [],
  );
  const qualityBlocked = nodes.filter((node) => qualityBlockingNodeIds.has(node.nodeId));
  const qualityGlobalErrors = evidenceQualityAudit?.issues.filter((issue) => issue.severity === "error" && !issue.reportNodeId) ?? [];
  await emitCompletionGateDiagnostics(ctx, {
    nodes,
    evidenceLinks,
    gaps,
    activeGaps,
    blockingGaps,
    nonTerminal,
    uncovered,
    queuedOrRunning,
    failedResearchTasks,
    evidenceQualityAudit,
    qualityBlocked,
    qualityGlobalErrors,
  });
  if (nonTerminal.length === 0 && uncovered.length === 0 && blockingGaps.length === 0 && queuedOrRunning.length === 0 && failedResearchTasks.length === 0 && qualityBlocked.length === 0 && qualityGlobalErrors.length === 0) {
    const debugPartial = Boolean(ctx.state.runtimeProfile.debug?.singleBranch);
    const ready = {
      decision: "ready_for_report" as const,
      ...(debugPartial ? {
        reason: "Single-branch debug run: ready to draft the explored branch only; this is not a complete report for the original prompt.",
        debugPartial: true,
      } : {}),
    };
    await ctx.emit({ eventType: "completion_gate", payload: { ...ready } });
    return ready;
  }
  const basicDecision = {
    decision: "need_more_work" as const,
    reason: completionReason(nonTerminal.length, uncovered.length, blockingGaps.length, queuedOrRunning.length, failedResearchTasks.length, qualityBlocked.length, qualityGlobalErrors.length),
  };
  const qualityRepairIssues = evidenceQualityAudit?.issues.filter((issue) => issue.severity === "error" && issue.reportNodeId) ?? [];
  const repairTasksRequested = opts.final === false && opts.allowRepairTasks !== false;
  const allowRepairTasks = repairTasksRequested && !ctx.state.adaptiveStop?.stopped;
  if (repairTasksRequested && !allowRepairTasks) {
    await ctx.emit({
      eventType: "completion_repair_suppressed_by_adaptive_stop",
      payload: { adaptiveStop: ctx.state.adaptiveStop },
    });
  }
  const createdTasks = allowRepairTasks
    ? await createCompletionRepairTaskBatch(ctx, blockingGaps, nodesById, tasks, nonTerminal, uncovered, failedResearchTasks, qualityRepairIssues)
    : [];
  await ctx.emit({ eventType: "completion_gate", payload: { ...basicDecision } });
  if (opts.final === false) return { ...basicDecision, newTasks: createdTasks.map(toNewTaskRequest) };
  const qualityMode = resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality).mode;
  const blockedRequirementIds = new Set((ctx.state.globalRubric?.requirements ?? [])
    .filter(isNonWaivableRequirement)
    .map((requirement) => requirement.requirementId));
  const nonSkippableQualityFailure = qualityMode === "strict"
    || (evidenceQualityAudit?.issues ?? []).some((issue) => (
      issue.severity === "error" && issue.requirementId && blockedRequirementIds.has(issue.requirementId)
    ));
  if (!nonSkippableQualityFailure) {
    const skipped = await autoSkipUnresolvedCompletionIssues(ctx, {
      blockingGaps,
      nonTerminal,
      uncovered: uniqueNodes([...uncovered, ...qualityBlocked]),
      failedResearchTasks,
      evidenceLinks,
      evidenceQualityAudit,
    });
    const ready = {
      decision: "ready_for_report" as const,
      reason: `Balanced evidence policy exhausted the repair budget and omitted or qualified ${skipped.issueCount} unresolved issue(s).`,
    };
    await ctx.emit({ eventType: "completion_gate_auto_skipped", payload: { ...ready, ...skipped } });
    return ready;
  }
  return {
    ...basicDecision,
    result: await closeIncompleteEpisode(ctx, basicDecision.reason),
  };
}

async function autoSkipUnresolvedCompletionIssues(ctx: PhaseContext, input: {
  blockingGaps: OpenGap[];
  nonTerminal: ReportNode[];
  uncovered: ReportNode[];
  failedResearchTasks: TaskItem[];
  evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>;
  evidenceQualityAudit?: EvidenceQualityAudit;
}): Promise<{ issueCount: number; acknowledgedGapCount: number; downplayedNodeIds: string[]; qualifiedNodeIds: string[]; failedTaskIds: string[]; frameworkWaiverIds: string[] }> {
  const reason = "Balanced evidence policy: bounded repair is exhausted; omit unsupported material or qualify the supported subset in the final report.";
  const gapMatches = input.blockingGaps.map((gap) => ({ reportNodeId: gap.reportNodeId, description: gap.description, reason }));
  const acknowledgedGapCount = await ctx.stack.kg.acknowledgeOpenGaps?.(gapMatches) ?? 0;
  const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];
  const directEvidenceLinks = input.evidenceLinks.filter((link) => link.relation !== "background");
  const directEvidenceLinkIds = new Set(directEvidenceLinks.map((link) => link.linkId));
  const evidenceByNode = new Set(directEvidenceLinks.map((link) => link.reportNodeId));
  const reportletsByNode = new Set(reportlets
    .filter((reportlet) => reportlet.citedEvidenceLinkIds.some((linkId) => directEvidenceLinkIds.has(linkId)))
    .map((reportlet) => reportlet.reportNodeId));
  const nodesById = new Map<string, ReportNode>();
  for (const node of [...input.nonTerminal, ...input.uncovered]) nodesById.set(node.nodeId, node);
  for (const task of input.failedResearchTasks) {
    if (!task.reportNodeId || nodesById.has(task.reportNodeId)) continue;
    const node = await ctx.stack.kg.getReportNode(task.reportNodeId);
    if (node?.nodeKind === "hypothesis") nodesById.set(node.nodeId, node);
  }
  const downplayedNodeIds: string[] = [];
  const qualifiedNodeIds: string[] = [];
  const frameworkWaiverIds: string[] = [];
  const now = isoNow(ctx.now);
  for (const node of nodesById.values()) {
    const hasUsableMaterial = evidenceByNode.has(node.nodeId) || reportletsByNode.has(node.nodeId);
    const status = hasUsableMaterial ? "partially_supported" as const : "downplayed" as const;
    const note = hasUsableMaterial
      ? "自动模式：补证预算耗尽，相关结论仅作为证据有限的限定性内容保留。"
      : "自动模式：补证预算耗尽且缺少可用证据，本分支已从最终核心结论中省略。";
    await ctx.stack.kg.updateReportNode({
      ...node,
      status,
      draftSummary: appendBoundaryNote(node.draftSummary, note),
      updatedAt: now,
    });
    if (status === "downplayed") downplayedNodeIds.push(node.nodeId);
    else {
      qualifiedNodeIds.push(node.nodeId);
      for (const issue of input.evidenceQualityAudit?.issues ?? []) {
        if (issue.severity !== "error" || issue.reportNodeId !== node.nodeId || issue.requirementId) continue;
        frameworkWaiverIds.push(addFrameworkWaiver(ctx, {
          issueCode: issue.code,
          action: "downplay",
          rationale: `${reason} ${issue.message}`,
          reportNodeId: node.nodeId,
        }).waiverId);
      }
    }
  }
  const rubricRequirements = new Map((ctx.state.globalRubric?.requirements ?? []).map((requirement) => [requirement.requirementId, requirement]));
  for (const entry of input.evidenceQualityAudit?.requirementCoverage.entries ?? []) {
    if (entry.status === "covered" || entry.status === "waived") continue;
    const requirement = rubricRequirements.get(entry.requirementId);
    if (!requirement || isNonWaivableRequirement(requirement)) continue;
    const hasUsableMaterial = entry.mappedReportNodeIds.some((nodeId) => evidenceByNode.has(nodeId) || reportletsByNode.has(nodeId));
    const matchingIssue = input.evidenceQualityAudit?.issues.find((issue) => issue.requirementId === entry.requirementId);
    frameworkWaiverIds.push(addFrameworkWaiver(ctx, {
      issueCode: matchingIssue?.code ?? `${entry.status}_research_requirement`,
      action: hasUsableMaterial ? "downplay" : "omit",
      rationale: `Framework disposition after bounded repair exhaustion: ${entry.requirementId} remains ${entry.status}. Preserve only cited, verified material and state the coverage limit without claiming the original requirement was fully met.`,
      requirementIds: [entry.requirementId],
    }).waiverId);
  }
  await traceWrite(ctx, "kg", "autoSkipUnresolvedCompletionIssues", {
    reason,
    acknowledgedGapCount,
    downplayedNodeIds,
    qualifiedNodeIds,
    failedTaskIds: input.failedResearchTasks.map((task) => task.taskId),
    frameworkWaiverIds,
  });
  return {
    issueCount: input.blockingGaps.length + nodesById.size + input.failedResearchTasks.length + frameworkWaiverIds.length,
    acknowledgedGapCount,
    downplayedNodeIds,
    qualifiedNodeIds,
    failedTaskIds: input.failedResearchTasks.map((task) => task.taskId),
    frameworkWaiverIds,
  };
}

function addFrameworkWaiver(
  ctx: PhaseContext,
  input: Pick<ResearchIssueWaiver, "issueCode" | "action" | "rationale" | "reportNodeId" | "requirementIds">,
): ResearchIssueWaiver {
  const requirementKey = [...(input.requirementIds ?? [])].sort().join(",");
  const existing = ctx.state.issueWaivers.find((waiver) => (
    waiver.decidedBy === "framework"
    && waiver.issueCode === input.issueCode
    && waiver.reportNodeId === input.reportNodeId
    && [...(waiver.requirementIds ?? [])].sort().join(",") === requirementKey
  ));
  if (existing) return existing;
  const identity = `${input.issueCode}_${input.reportNodeId ?? "global"}_${requirementKey || "none"}`;
  const waiver: ResearchIssueWaiver = {
    ...input,
    waiverId: `W_auto_${shortId(identity)}`,
    questionId: `auto_${shortId(identity)}`,
    decidedBy: "framework",
    decidedAt: isoNow(ctx.now),
  };
  ctx.state.issueWaivers.push(waiver);
  return waiver;
}

function appendBoundaryNote(existing: string | undefined, note: string): string {
  if (!existing?.trim()) return note;
  if (existing.includes(note)) return existing;
  return `${existing.trim()}\n\n${note}`;
}

async function emitCompletionGateDiagnostics(
  ctx: PhaseContext,
  input: {
    nodes: ReportNode[];
    evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>;
    gaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>;
    activeGaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>;
    blockingGaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>;
    nonTerminal: ReportNode[];
    uncovered: ReportNode[];
    queuedOrRunning: TaskItem[];
    failedResearchTasks: TaskItem[];
    evidenceQualityAudit?: EvidenceQualityAudit;
    qualityBlocked: ReportNode[];
    qualityGlobalErrors: EvidenceQualityAudit["issues"];
  },
): Promise<void> {
  const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];
  const reportletCountByNode = new Map<string, number>();
  for (const reportlet of reportlets) {
    reportletCountByNode.set(reportlet.reportNodeId, (reportletCountByNode.get(reportlet.reportNodeId) ?? 0) + 1);
  }
  const supportByNode = new Map<string, number>();
  for (const link of input.evidenceLinks) {
    if (link.relation !== "supports") continue;
    supportByNode.set(link.reportNodeId, (supportByNode.get(link.reportNodeId) ?? 0) + 1);
  }
  const nodeStatusCounts = countBy(input.nodes, (node) => `${node.nodeKind}:${node.status}`);
  const gapStatusCounts = countBy(input.gaps, (gap) => `${gap.status ?? "open"}:${gap.impact ?? "medium"}:${gap.gapType}`);
  await ctx.emit({
    eventType: "completion_gate_diagnostics",
    payload: {
      debugSingleBranch: Boolean(ctx.state.runtimeProfile.debug?.singleBranch),
      nodeStatusCounts,
      gapStatusCounts,
      totals: {
        reportNodes: input.nodes.length,
        evidenceLinks: input.evidenceLinks.length,
        reportlets: reportlets.length,
        allGaps: input.gaps.length,
        activeGaps: input.activeGaps.length,
        blockingGaps: input.blockingGaps.length,
        nonTerminal: input.nonTerminal.length,
        uncovered: input.uncovered.length,
        queuedOrRunning: input.queuedOrRunning.length,
        failedResearchTasks: input.failedResearchTasks.length,
        evidenceQualityErrors: input.evidenceQualityAudit?.summary.errorCount ?? 0,
        evidenceQualityWarnings: input.evidenceQualityAudit?.summary.warningCount ?? 0,
        qualityBlockedNodes: input.qualityBlocked.length,
        evidenceQualityGlobalErrors: input.qualityGlobalErrors.length,
      },
      blockingGapSamples: input.blockingGaps.slice(0, 12).map((gap) => ({
        reportNodeId: gap.reportNodeId,
        taskId: gap.taskId,
        gapType: gap.gapType,
        impact: gap.impact ?? "medium",
        status: gap.status ?? "open",
        description: gap.description,
        nodeStatus: gap.reportNodeId ? input.nodes.find((node) => node.nodeId === gap.reportNodeId)?.status : undefined,
        supportingEvidence: gap.reportNodeId ? supportByNode.get(gap.reportNodeId) ?? 0 : 0,
        reportletCount: gap.reportNodeId ? reportletCountByNode.get(gap.reportNodeId) ?? 0 : 0,
      })),
      nonTerminalSamples: input.nonTerminal.slice(0, 12).map((node) => ({
        reportNodeId: node.nodeId,
        nodeKind: node.nodeKind,
        status: node.status,
        label: node.label,
        coverage: node.coverage,
        supportingEvidence: supportByNode.get(node.nodeId) ?? 0,
        reportletCount: reportletCountByNode.get(node.nodeId) ?? 0,
      })),
      uncoveredSamples: input.uncovered.slice(0, 12).map((node) => ({
        reportNodeId: node.nodeId,
        nodeKind: node.nodeKind,
        status: node.status,
        label: node.label,
        coverage: node.coverage,
        reportletCount: reportletCountByNode.get(node.nodeId) ?? 0,
      })),
      queuedOrRunningTaskIds: input.queuedOrRunning.slice(0, 20).map((task) => task.taskId),
      failedTaskIds: input.failedResearchTasks.slice(0, 20).map((task) => task.taskId),
      evidenceQuality: input.evidenceQualityAudit ? {
        mode: input.evidenceQualityAudit.mode,
        score: input.evidenceQualityAudit.score,
        issues: input.evidenceQualityAudit.issues.slice(0, 20),
      } : undefined,
    },
  });
}

async function createCompletionRepairTaskBatch(
  ctx: PhaseContext,
  blockingGaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>,
  nodesById: Map<string, ReportNode>,
  tasks: TaskItem[],
  nonTerminal: ReportNode[],
  uncovered: ReportNode[],
  failedResearchTasks: TaskItem[],
  qualityIssues: EvidenceQualityAudit["issues"],
): Promise<TaskItem[]> {
  const gapNodes = blockingGaps.map((gap) => gap.reportNodeId ? nodesById.get(gap.reportNodeId) : undefined).filter((node): node is ReportNode => Boolean(node));
  const failedTaskNodes = failedResearchTasks.map((task) => nodesById.get(task.reportNodeId)).filter((node): node is ReportNode => Boolean(node));
  const gapRepairTasks = await createCompletionGapRepairTasks(ctx, blockingGaps, nodesById, tasks);
  const alreadyTargetedNodeIds = new Set([...gapNodes, ...nonTerminal, ...uncovered, ...failedTaskNodes].map((node) => node.nodeId));
  const qualityRepairTasks = await createCompletionQualityRepairTasks(
    ctx,
    qualityIssues.filter((issue) => (
      issue.code === "incomplete_temporal_coverage"
        || issue.code === "incomplete_entity_coverage"
        || issue.code === "incomplete_example_coverage"
        || !issue.reportNodeId
        || !alreadyTargetedNodeIds.has(issue.reportNodeId)
    )),
    nodesById,
    [...tasks, ...gapRepairTasks],
  );
  return [
    ...gapRepairTasks,
    ...qualityRepairTasks,
    ...await createCompletionRepairTasks(ctx, [...nonTerminal, ...uncovered, ...gapNodes, ...failedTaskNodes], [...tasks, ...gapRepairTasks, ...qualityRepairTasks]),
  ];
}

async function createCompletionQualityRepairTasks(
  ctx: PhaseContext,
  issues: EvidenceQualityAudit["issues"],
  nodesById: Map<string, ReportNode>,
  tasks: TaskItem[],
): Promise<TaskItem[]> {
  const out: TaskItem[] = [];
  const matrixRepairNodeIds = new Set(issues
    .filter((issue) => issue.code === "incomplete_entity_coverage" && issue.reportNodeId)
    .map((issue) => issue.reportNodeId!));
  for (const originalIssue of issues) {
    const issueBatches = completionQualityIssueBatches(originalIssue);
    for (const [batchIndex, issue] of issueBatches.entries()) {
    if (!issue.reportNodeId) continue;
    if (issue.code === "incomplete_temporal_coverage" && matrixRepairNodeIds.has(issue.reportNodeId)) {
      await traceWrite(ctx, "ledger", "skipCompletionQualityRepair", {
        reportNodeId: issue.reportNodeId,
        sourceIssue: issue,
        reason: "temporal_gap_is_already_covered_by_entity_year_metric_matrix_repair",
      }, { reportNodeId: issue.reportNodeId });
      continue;
    }
    const node = nodesById.get(issue.reportNodeId);
    if (!node || node.nodeKind !== "hypothesis") continue;
    const signature = `[quality:${issue.code}${issueBatches.length > 1 ? `:batch_${batchIndex + 1}_of_${issueBatches.length}` : ""}]`;
    const previous = [...tasks, ...out].filter((task) => task.reportNodeId === node.nodeId && task.objective.includes(signature));
    if (previous.length >= MAX_COMPLETION_GAP_REPAIR_TASKS_PER_GAP) continue;
    const task = completionTaskForGap(ctx, node, {
      gapType: issue.code,
      description: `${signature} ${issue.message}`,
      suggestedQuery: issue.suggestedRepair || node.hypothesis?.evidenceGuidance || node.label,
      reportNodeId: node.nodeId,
      impact: "high",
      qualityIssue: issue,
    }, [...tasks, ...out]);
    await ctx.stack.ledger.upsert(task);
    await traceWrite(ctx, "ledger", "upsert", {
      task,
      source: "completion_quality_repair",
      sourceIssue: issue,
    }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    out.push(task);
    }
  }
  return out;
}

function completionQualityIssueBatches(
  issue: EvidenceQualityAudit["issues"][number],
): EvidenceQualityAudit["issues"] {
  const entities = issue.missingEntities ?? [];
  if (issue.code !== "incomplete_entity_coverage" || entities.length <= 5) return [issue];
  const batches: EvidenceQualityAudit["issues"] = [];
  for (let start = 0; start < entities.length; start += 5) {
    const missingEntities = entities.slice(start, start + 5);
    const entitySet = new Set(missingEntities.map((entity) => entity.normalize("NFKC").toLocaleLowerCase()));
    const ownsCell = (cell: string): boolean => entitySet.has((cell.split("|")[0] ?? "").normalize("NFKC").toLocaleLowerCase());
    batches.push({
      ...issue,
      message: `${issue.message} Focus this repair batch on: ${missingEntities.join(", ")}.`,
      suggestedRepair: `${issue.suggestedRepair ?? "Repair incomplete entity coverage."} Cover only this batch: ${missingEntities.join(", ")}.`,
      missingEntities,
      missingCells: issue.missingCells?.filter(ownsCell),
      missingMetricCells: issue.missingMetricCells?.filter(ownsCell),
    });
  }
  return batches;
}

async function acknowledgeSingleBranchDebugMediumGaps(
  ctx: PhaseContext,
  nodes: ReportNode[],
  evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>,
  gaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>,
): Promise<number> {
  if (!ctx.state.runtimeProfile.debug?.singleBranch) return 0;
  const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];
  if (reportlets.length === 0) return 0;
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const supportByNode = new Map<string, number>();
  for (const link of evidenceLinks) {
    if (link.relation !== "supports") continue;
    supportByNode.set(link.reportNodeId, (supportByNode.get(link.reportNodeId) ?? 0) + 1);
  }
  const reportletCountByNode = new Map<string, number>();
  for (const reportlet of reportlets) {
    reportletCountByNode.set(reportlet.reportNodeId, (reportletCountByNode.get(reportlet.reportNodeId) ?? 0) + 1);
  }
  const matches = gaps
    .filter((gap) => gap.status === "open" && (gap.impact ?? "medium") === "medium" && gap.reportNodeId)
    .filter((gap) => isDebugAcknowledgableGapType(gap.gapType))
    .filter((gap) => {
      const node = nodesById.get(gap.reportNodeId!);
      if (!node || node.nodeKind !== "hypothesis") return false;
      if (!["supported", "partially_supported", "verified"].includes(node.status)) return false;
      const supportingCount = supportByNode.get(node.nodeId) ?? node.coverage.supportingCount;
      return supportingCount > 0 && (reportletCountByNode.get(node.nodeId) ?? 0) > 0;
    })
    .map((gap) => ({
      reportNodeId: gap.reportNodeId,
      description: gap.description,
      reason: "Single-branch debug run: this medium-impact residual gap is acknowledged as a debug caveat because the explored branch already has supporting evidence and written reportlets.",
    }));
  if (matches.length === 0) return 0;
  const acknowledged = await (ctx.stack.kg as { acknowledgeOpenGaps?: (matches: Array<{ reportNodeId?: string; description: string; reason: string }>) => Promise<number> }).acknowledgeOpenGaps?.(matches);
  const count = acknowledged ?? 0;
  if (count > 0) await traceWrite(ctx, "kg", "acknowledgeSingleBranchDebugGaps", { acknowledged: count, matches });
  return count;
}

function isDebugAcknowledgableGapType(gapType: string): boolean {
  return [
    "coverage",
    "data_gap",
    "data_mismatch",
    "data_quality",
    "detail",
    "detail_gap",
    "missing_context",
    "missing_data",
    "missing_detail",
    "missing_direct_evidence",
    "missing_direct_source",
    "missing_evidence",
    "missing_primary_source",
    "missing_quantitative_data",
    "missing_source",
    "specific_data",
    "specific_detail",
    "specificity",
    "temporal",
  ].includes(gapType);
}

function countBy<T>(items: T[], keyFn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const key = keyFn(item);
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

async function acknowledgeResolvedMediumGaps(
  ctx: PhaseContext,
  nodes: ReportNode[],
  evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>,
  tasks: TaskItem[],
  gaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>,
): Promise<number> {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];
  const reportletCountByNode = new Map<string, number>();
  for (const reportlet of reportlets) {
    reportletCountByNode.set(reportlet.reportNodeId, (reportletCountByNode.get(reportlet.reportNodeId) ?? 0) + 1);
  }
  const supportByNode = new Map<string, number>();
  for (const link of evidenceLinks) {
    if (link.relation !== "supports") continue;
    supportByNode.set(link.reportNodeId, (supportByNode.get(link.reportNodeId) ?? 0) + 1);
  }
  const repairCountByNode = new Map<string, number>();
  for (const task of tasks) {
    if (!/^(T_reflect_|T_gap_|T_repair_|T_completion_)/.test(task.taskId)) continue;
    repairCountByNode.set(task.reportNodeId, (repairCountByNode.get(task.reportNodeId) ?? 0) + 1);
  }
  const matches = gaps
    .filter((gap) => gap.status === "open" && (gap.impact ?? "medium") === "medium" && gap.reportNodeId)
    .filter((gap) => {
      const node = nodesById.get(gap.reportNodeId!);
      if (!node || !["supported", "partially_supported", "verified"].includes(node.status)) return false;
      const supportingCount = supportByNode.get(gap.reportNodeId!) ?? node.coverage.supportingCount;
      if (supportingCount < 3) return false;
      const repairCount = repairCountByNode.get(gap.reportNodeId!) ?? 0;
      if (gap.gapType === "planned_reportlet_not_completed") {
        return repairCount >= 1 && (reportletCountByNode.get(gap.reportNodeId!) ?? 0) > 0;
      }
      if (node.nodeKind === "root" && isNonBlockingRootResidualGap(gap.description, gap.gapType, supportingCount, repairCount)) return true;
      return isNonBlockingResidualGap(gap.description, gap.gapType, supportingCount, repairCount, node.status);
    })
    .map((gap) => ({
      reportNodeId: gap.reportNodeId,
      description: gap.description,
      reason: "Supported node already has sufficient evidence; this residual medium-impact gap is kept as a report caveat instead of blocking completion.",
    }));
  if (matches.length === 0) return 0;
  const acknowledged = await (ctx.stack.kg as { acknowledgeOpenGaps?: (matches: Array<{ reportNodeId?: string; description: string; reason: string }>) => Promise<number> }).acknowledgeOpenGaps?.(matches);
  const count = acknowledged ?? 0;
  if (count > 0) await traceWrite(ctx, "kg", "autoAcknowledgeResolvedGaps", { acknowledged: count, matches });
  return count;
}

async function promoteEvidenceBackedBlockingNodes(
  ctx: PhaseContext,
  nodes: ReportNode[],
  evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>,
  tasks: TaskItem[],
): Promise<number> {
  const reportlets = await ctx.stack.kg.listReportlets?.() ?? [];
  const reportletCountByNode = new Map<string, number>();
  for (const reportlet of reportlets) {
    reportletCountByNode.set(reportlet.reportNodeId, (reportletCountByNode.get(reportlet.reportNodeId) ?? 0) + 1);
  }
  const supportByNode = new Map<string, number>();
  const contradictByNode = new Map<string, number>();
  for (const link of evidenceLinks) {
    if (link.relation === "supports") supportByNode.set(link.reportNodeId, (supportByNode.get(link.reportNodeId) ?? 0) + 1);
    if (link.relation === "contradicts") contradictByNode.set(link.reportNodeId, (contradictByNode.get(link.reportNodeId) ?? 0) + 1);
  }
  const repairCountByNode = repairCountByNodeFromTasks(tasks);
  const promotableStatuses = new Set<ReportNode["status"]>(["planned", "researching", "needs_review", "needs_repair", "insufficient_evidence"]);
  let promoted = 0;
  for (const node of nodes) {
    if (node.nodeKind !== "hypothesis" || !promotableStatuses.has(node.status)) continue;
    const supportingCount = supportByNode.get(node.nodeId) ?? node.coverage.supportingCount;
    const contradictingCount = contradictByNode.get(node.nodeId) ?? node.coverage.contradictingCount;
    if (supportingCount < 3 || contradictingCount > 0) continue;
    if ((reportletCountByNode.get(node.nodeId) ?? 0) === 0 && (repairCountByNode.get(node.nodeId) ?? 0) === 0) continue;
    const nextStatus: ReportNode["status"] = node.coverage.openGapCount > 0 ? "partially_supported" : "supported";
    const next = {
      ...node,
      status: nextStatus,
      coverage: { ...node.coverage, supportingCount, contradictingCount },
      updatedAt: new Date(ctx.now()).toISOString(),
    };
    await ctx.stack.kg.updateReportNode(next);
    await traceWrite(ctx, "kg", "promoteEvidenceBackedBlockingNode", {
      reportNodeId: node.nodeId,
      previousStatus: node.status,
      nextStatus,
      supportingCount,
      contradictingCount,
      reportletCount: reportletCountByNode.get(node.nodeId) ?? 0,
      repairCount: repairCountByNode.get(node.nodeId) ?? 0,
      reason: "Completion gate found the node now has enough supporting evidence/reportlets after repair; stale blocking status should not prevent report drafting.",
    }, { reportNodeId: node.nodeId });
    promoted++;
  }
  return promoted;
}

function isNonBlockingRootResidualGap(description: string, gapType: string, supportingCount: number, repairCount: number): boolean {
  if (supportingCount < 20 || repairCount < 2) return false;
  if (!["coverage", "detail", "missing_detail", "missing_evidence", "missing_source"].includes(gapType)) return false;
  if (/局限|限制|数据稀缺|证据可信度|研究反思|方法论|未来研究|缺乏直接讨论|专门讨论|可能缺少|limitations?|data scarcity|evidence confidence/i.test(description)) return true;
  return repairCount >= 4;
}

function isNonBlockingResidualGap(description: string, gapType: string, supportingCount: number, repairCount: number, nodeStatus: ReportNode["status"]): boolean {
  if (/已满足当前任务要求|任务要求.*已满足|现有证据已足够|已得到其他来源充分支持|不影响整体结论|非阻塞|可作为.*限制|更全面、更新的资料|可后续处理|暂不处理/i.test(description) && supportingCount >= 1) return true;
  if (/无法访问|无效|尚未获取|未能获取|可能不是有效URL|URL inaccessible|not fetched/i.test(description) && supportingCount >= 3) return true;
  if (gapType === "low_quality_sources" && repairCount >= 2 && supportingCount >= 3) return true;
  if (["coverage", "detail", "detail_gap", "comparative_analysis", "missing_quantitative_data", "specificity", "temporal", "depth"].includes(gapType) && supportingCount >= 3 && repairCount >= 1) return true;
  if (["data_gap", "missing_context", "missing_detail"].includes(gapType) && supportingCount >= 3 && repairCount >= 2) return true;
  if (gapType === "missing_direct_source" && isAlternativeSourceResidual(description) && supportingCount >= 3 && repairCount >= 2) return true;
  if (gapType === "missing_source" && isAlternativeSourceResidual(description) && supportingCount >= 3 && repairCount >= 2) return true;
  if (isResidualEvidenceGapType(gapType) && supportingCount >= 8 && repairCount >= 3) return true;
  if (["supported", "verified"].includes(nodeStatus) && supportingCount >= 12 && repairCount >= MAX_COMPLETION_REPAIR_TASKS_PER_NODE) return true;
  return false;
}

function isAlternativeSourceResidual(description: string): boolean {
  return /替代|同属|相关|高度相关|强相关|来源权威|权威性高|等效权威|已使用其他权威|alternative|equivalent authoritative|related authoritative/i.test(description);
}

function isResidualEvidenceGapType(gapType: string): boolean {
  return [
    "channel_role",
    "comparison",
    "comparative_study",
    "comparative_analysis",
    "detail",
    "detail_gap",
    "specific_detail",
    "missing_detail",
    "missing_direct_citation",
    "missing_direct_source",
    "missing_evidence",
    "missing_primary_source",
    "missing_quantitative_data",
    "missing_comparative_data",
    "missing_data",
    "outdated_data",
    "missing_direct_evidence",
    "specific_impact",
    "specific_quote",
    "specificity",
    "tension_analysis",
    "global_governance_impact",
    "coverage",
    "evidence_gap",
    "quantitative_data",
    "case_study",
    "depth",
    "international_comparison",
    "specific_data",
    "specific_policy",
    "temporal",
  ].includes(gapType);
}

async function restorePrunedSupportedNodes(
  ctx: PhaseContext,
  nodes: ReportNode[],
  evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>,
): Promise<number> {
  const nodesById = new Map(nodes.map((node) => [node.nodeId, node]));
  const childrenByParent = new Map<string, ReportNode[]>();
  for (const node of nodes) {
    if (!node.parentNodeId) continue;
    const children = childrenByParent.get(node.parentNodeId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentNodeId, children);
  }
  let restored = 0;
  for (const node of nodes) {
    if ((node.nodeKind !== "aspect" && node.nodeKind !== "hypothesis") || node.status !== "pruned") continue;
    const hasDirectSupport = evidenceLinks.some((link) => link.reportNodeId === node.nodeId && link.relation === "supports");
    const hasStrongDirectSupport = hasDirectSupport && node.coverage.supportingCount >= (node.nodeKind === "hypothesis" ? 3 : 1);
    const hasSupportedChild = node.nodeKind === "aspect" && (childrenByParent.get(node.nodeId) ?? []).some((child) => child.status !== "pruned" && ["supported", "partially_supported", "verified"].includes(child.status));
    if (!hasStrongDirectSupport && !hasSupportedChild && node.coverage.supportingCount < (node.nodeKind === "hypothesis" ? 3 : 1)) continue;
    const parent = node.parentNodeId ? nodesById.get(node.parentNodeId) : undefined;
    if (parent?.status === "pruned") continue;
    const next = { ...node, status: "supported" as const, updatedAt: new Date(ctx.now()).toISOString() };
    await ctx.stack.kg.updateReportNode(next);
    await traceWrite(ctx, "kg", "restorePrunedSupportedNode", {
      reportNodeId: node.nodeId,
      nodeKind: node.nodeKind,
      previousStatus: "pruned",
      nextStatus: next.status,
      reason: "Pruned report node has supporting evidence or supported children and should remain visible to the report writer.",
    }, { reportNodeId: node.nodeId });
    restored++;
  }
  return restored;
}

function isBlockingGap(gap: { status?: string; impact?: string }): boolean {
  return gap.status === "open" || (gap.status === "acknowledged" && gap.impact === "high");
}

function isCompletionBlockingGap(gap: { status?: string; impact?: string; reportNodeId?: string }, nodesById: Map<string, ReportNode>): boolean {
  if (!isBlockingGap(gap)) return false;
  const node = gap.reportNodeId ? nodesById.get(gap.reportNodeId) : undefined;
  if (!node || !["pruned", "downplayed"].includes(node.status)) return true;
  return gap.impact === "high";
}

async function createCompletionRepairTasks(ctx: PhaseContext, nodes: ReportNode[], tasks: TaskItem[]): Promise<TaskItem[]> {
  const uniqueNodes = new Map(nodes.map((node) => [node.nodeId, node]));
  const activeByNode = new Set(tasks
    .filter((task) => task.taskId !== "T_root" && ["queued", "running"].includes(task.status))
    .map((task) => task.reportNodeId));
  const completionRepairCountByNode = repairCountByNodeFromTasks(tasks);
  const created: TaskItem[] = [];
  for (const node of uniqueNodes.values()) {
    if (node.nodeKind === "root") {
      await traceWrite(ctx, "ledger", "skipCompletionRepair", {
        reportNodeId: node.nodeId,
        reason: "root_report_node_is_not_an_evidence_leaf",
      }, { reportNodeId: node.nodeId });
      continue;
    }
    if (activeByNode.has(node.nodeId)) continue;
    if ((completionRepairCountByNode.get(node.nodeId) ?? 0) >= MAX_COMPLETION_REPAIR_TASKS_PER_NODE) {
      await traceWrite(ctx, "ledger", "skipCompletionRepair", {
        reportNodeId: node.nodeId,
        reason: "completion_repair_task_cap_reached_for_node",
        maxCompletionRepairTasksPerNode: MAX_COMPLETION_REPAIR_TASKS_PER_NODE,
      }, { reportNodeId: node.nodeId });
      continue;
    }
    const task = completionTaskForNode(ctx, node, tasks);
    await ctx.stack.ledger.upsert(task);
    await traceWrite(ctx, "ledger", "upsert", { task, source: "completion_gate" }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    activeByNode.add(node.nodeId);
    completionRepairCountByNode.set(node.nodeId, (completionRepairCountByNode.get(node.nodeId) ?? 0) + 1);
    created.push(task);
  }
  return created;
}

async function createCompletionGapRepairTasks(
  ctx: PhaseContext,
  gaps: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>,
  nodesById: Map<string, ReportNode>,
  tasks: TaskItem[],
): Promise<TaskItem[]> {
  const activeByNode = new Set(tasks
    .filter((task) => task.taskId !== "T_root" && ["queued", "running"].includes(task.status))
    .map((task) => task.reportNodeId));
  const created: TaskItem[] = [];
  const orderedGaps = [...gaps].sort((left, right) => (
    completionGapAttemptCount(tasks, left) - completionGapAttemptCount(tasks, right)
    || gapDispatchPriority(right) - gapDispatchPriority(left)
    || left.description.localeCompare(right.description)
  ));
  for (const gap of orderedGaps) {
    if (!gap.reportNodeId) continue;
    const routed = routeCompletionGap(gap, nodesById);
    const node = routed.node;
    if (!node || node.status === "pruned" || node.status === "downplayed") continue;
    if (node.nodeKind === "root") {
      await traceWrite(ctx, "ledger", "skipCompletionGapRepair", {
        reportNodeId: gap.reportNodeId,
        gap,
        reason: "root_report_node_is_not_an_evidence_leaf",
      }, { reportNodeId: gap.reportNodeId });
      continue;
    }
    if (activeByNode.has(node.nodeId)) continue;
    if (routed.routedFromRoot) {
      await traceWrite(ctx, "ledger", "routeCompletionGapRepair", {
        fromReportNodeId: gap.reportNodeId,
        toReportNodeId: node.nodeId,
        gap,
        reason: "root_gap_routed_to_best_matching_report_branch",
      }, { reportNodeId: node.nodeId });
    }
    const routedGap = { ...gap, reportNodeId: node.nodeId };
    const existingGapRepairs = tasks.filter((task) => task.taskId.startsWith("T_completion_gap_") && sameGapTask(task, routedGap));
    if (existingGapRepairs.length >= MAX_COMPLETION_GAP_REPAIR_TASKS_PER_GAP) {
      await traceWrite(ctx, "ledger", "skipCompletionGapRepair", {
        reportNodeId: node.nodeId,
        gap: routedGap,
        reason: "completion_gap_repair_task_cap_reached_for_gap",
        maxCompletionGapRepairTasksPerGap: MAX_COMPLETION_GAP_REPAIR_TASKS_PER_GAP,
      }, { reportNodeId: node.nodeId });
      continue;
    }
    const task = completionTaskForGap(ctx, node, routedGap, [...tasks, ...created]);
    await ctx.stack.ledger.upsert(task);
    await traceWrite(ctx, "ledger", "upsert", { task, source: "completion_gate_gap", sourceGap: routedGap }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    activeByNode.add(node.nodeId);
    created.push(task);
  }
  return created;
}

function completionGapAttemptCount(tasks: TaskItem[], gap: { reportNodeId?: string; description: string; gapType: string }): number {
  return tasks.filter((task) => task.taskId.startsWith("T_completion_gap_") && sameGapTask(task, gap)).length;
}

function gapDispatchPriority(gap: { impact?: string; gapType: string }): number {
  const impact = gap.impact === "high" ? 30 : gap.impact === "low" ? 0 : 20;
  const deliverable = gap.gapType === "planned_reportlet_not_completed" ? 8 : 0;
  const constraint = /temporal|blocked|citation|language/i.test(gap.gapType) ? 6 : 0;
  return impact + deliverable + constraint;
}

function routeCompletionGap(
  gap: Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>[number],
  nodesById: Map<string, ReportNode>,
): { node?: ReportNode; routedFromRoot: boolean } {
  const current = gap.reportNodeId ? nodesById.get(gap.reportNodeId) : undefined;
  if (current && current.nodeKind !== "root") return { node: current, routedFromRoot: false };
  if (!current || current.nodeKind !== "root") return { node: current, routedFromRoot: false };
  const candidates = Array.from(nodesById.values())
    .filter((node) => node.nodeKind === "hypothesis")
    .filter((node) => node.status !== "pruned" && node.status !== "downplayed");
  if (candidates.length === 0) return { node: current, routedFromRoot: false };
  const text = `${gap.gapType}\n${gap.description}\n${gap.suggestedQuery}`.toLowerCase();
  const ranked = candidates
    .map((node) => ({ node, score: branchMatchScore(text, node) }))
    .sort((a, b) => b.score - a.score || weaknessScore(b.node) - weaknessScore(a.node));
  const best = ranked[0];
  return { node: best?.node ?? current, routedFromRoot: true };
}

function branchMatchScore(text: string, node: ReportNode): number {
  const fields = [
    node.nodeId,
    node.label,
    node.scopeNote,
    node.hypothesis?.statement,
    node.hypothesis?.researchBrief,
    node.hypothesis?.evidenceGuidance,
  ].filter((value): value is string => Boolean(value));
  let score = 0;
  for (const field of fields) {
    const normalized = field.toLowerCase();
    for (const token of tokenSet(normalized)) {
      if (token.length >= 2 && text.includes(token)) score += token.length > 4 ? 2 : 1;
    }
  }
  return score;
}

function tokenSet(text: string): string[] {
  const ascii = text.match(/[a-z0-9_]{3,}/gi) ?? [];
  const cjk = text.match(/[\u4e00-\u9fff]{2,}/gu) ?? [];
  const cjkChunks = cjk.flatMap((chunk) => {
    const out: string[] = [];
    for (let i = 0; i < chunk.length - 1; i++) out.push(chunk.slice(i, i + 2));
    for (let i = 0; i < chunk.length - 3; i++) out.push(chunk.slice(i, i + 4));
    return out;
  });
  return Array.from(new Set([...ascii, ...cjkChunks]));
}

function weaknessScore(node: ReportNode): number {
  const statusScore = {
    planned: 8,
    researching: 7,
    needs_review: 6,
    needs_repair: 6,
    insufficient_evidence: 5,
    partially_supported: 4,
    contradicted: 4,
    supported: 1,
    verified: 0,
    downplayed: -2,
    pruned: -3,
  } as Record<string, number>;
  return (statusScore[node.status] ?? 0) + Math.max(0, 4 - (node.coverage?.supportingCount ?? 0));
}

function sameGapTask(task: TaskItem, gap: { reportNodeId?: string; description: string; gapType: string }): boolean {
  return task.reportNodeId === gap.reportNodeId
    && task.objective.includes(gap.description)
    && task.objective.includes(`Gap type: ${gap.gapType}`);
}

function repairCountByNodeFromTasks(tasks: TaskItem[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const task of tasks) {
    if (!/^(T_reflect_|T_gap_|T_repair_|T_completion_)/.test(task.taskId)) continue;
    out.set(task.reportNodeId, (out.get(task.reportNodeId) ?? 0) + 1);
  }
  return out;
}

function completionTaskForNode(ctx: PhaseContext, node: ReportNode, tasks: TaskItem[]): TaskItem {
  const now = isoNow(ctx.now);
  const hash = createHash("sha1").update(`${node.nodeId}\n${node.label}\n${now}`).digest("hex").slice(0, 10);
  const baseSuffix = `${shortId(`${node.nodeId}_${node.label}`).slice(0, 40)}_${hash}`;
  const existing = new Set(tasks.map((task) => task.taskId));
  let suffix = baseSuffix;
  for (let i = 1; existing.has(`T_completion_${suffix}`); i++) {
    suffix = `${baseSuffix}_${i}`;
  }
  return {
    taskId: `T_completion_${suffix}`,
    parentTaskId: parentTaskIdForNode(tasks, node.nodeId),
    reportNodeId: node.nodeId,
    title: `Complete evidence for ${node.label}`,
    objective: node.hypothesis?.evidenceGuidance || node.hypothesis?.researchBrief || `Find sufficient evidence for ${node.label}.`,
    requirementIds: node.requirementIds,
    status: "queued",
    priority: 82,
    branchId: `B_completion_${suffix}`,
    acceptanceCriteria: [
      "Find at least one usable source directly tied to this hypothesis.",
      "Create an EvidenceLink to the current ReportNode or justify downplaying the hypothesis.",
      "Record any unresolved high-impact gap explicitly.",
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function completionTaskForGap(ctx: PhaseContext, node: ReportNode, gap: { gapType: string; description: string; suggestedQuery: string; reportNodeId?: string; impact?: string; taskId?: string; affectedRequirementIds?: string[]; qualityIssue?: EvidenceQualityAudit["issues"][number] }, tasks: TaskItem[]): TaskItem {
  const now = isoNow(ctx.now);
  const hash = createHash("sha1").update(`${node.nodeId}\n${gap.gapType}\n${gap.description}\n${now}`).digest("hex").slice(0, 10);
  const baseSuffix = `${shortId(`${node.nodeId}_${gap.gapType}`).slice(0, 40)}_${hash}`;
  const existing = new Set(tasks.map((task) => task.taskId));
  let suffix = baseSuffix;
  for (let i = 1; existing.has(`T_completion_gap_${suffix}`); i++) {
    suffix = `${baseSuffix}_${i}`;
  }
  const sourceTask = gap.taskId ? tasks.find((task) => task.taskId === gap.taskId) : undefined;
  const requirementIds = gap.qualityIssue?.requirementId
    ? [gap.qualityIssue.requirementId]
    : gap.affectedRequirementIds?.length
      ? uniqueRequirementIds(gap.affectedRequirementIds)
      : sourceTask?.requirementIds?.length
        ? uniqueRequirementIds(sourceTask.requirementIds)
        : node.requirementIds;
  const partId = gap.gapType === "planned_reportlet_not_completed"
    ? gap.description.match(/(?:报告任务|report\s+part)\s+([A-Za-z0-9_-]+)/iu)?.[1]
    : undefined;
  const sourcePlans = sourceTask?.plannedReportlets?.length
    ? sourceTask.plannedReportlets
    : sourceTask?.plannedReportlet ? [sourceTask.plannedReportlet] : [];
  const plannedReportlet = partId ? sourcePlans.find((plan) => plan.partId === partId) : undefined;
  const missingYears = gap.qualityIssue?.missingYears ?? [];
  const missingEntities = gap.qualityIssue?.missingEntities ?? [];
  const missingExamples = gap.qualityIssue?.missingExamples ?? [];
  const missingCells = gap.qualityIssue?.missingCells ?? [];
  const missingMetrics = gap.qualityIssue?.missingMetrics ?? [];
  const missingMetricCells = gap.qualityIssue?.missingMetricCells ?? [];
  const missingFieldCellKind = coverageFieldCellKind(missingMetricCells);
  const temporalRepair = gap.qualityIssue?.code === "incomplete_temporal_coverage" && missingYears.length > 0;
  const entityRepair = gap.qualityIssue?.code === "incomplete_entity_coverage"
    && (missingEntities.length > 0 || missingCells.length > 0 || missingMetrics.length > 0 || missingMetricCells.length > 0);
  const exampleRepair = gap.qualityIssue?.code === "incomplete_example_coverage" && missingExamples.length > 0;
  const title = temporalRepair
    ? `Repair missing years for ${node.label}: ${missingYears.join(", ")}`
    : exampleRepair
    ? `Repair missing examples for ${node.label}: ${compactCoverageLabel(missingExamples)}`
    : entityRepair
    ? `Repair incomplete table for ${node.label}: ${compactCoverageLabel(missingEntities.length > 0 ? missingEntities : missingMetrics.length > 0 ? missingMetrics : missingMetricCells.length > 0 ? missingMetricCells : missingCells)}`
    : `Close completion gap: ${node.label}`;
  const objectiveLines = temporalRepair
    ? [
        `Repair the incomplete temporal coverage for report node "${node.label}".`,
        `Missing years requiring concrete cited values: ${missingYears.join(", ")}.`,
        "First reuse already saved annual-report sources and inspect complete cached正文.",
        "If a saved source is only a shallow cache, refresh that existing source in place.",
        "Search for a new source only after the saved annual reports and refresh path cannot cover the missing years.",
      ]
    : exampleRepair
    ? [
        `Repair incomplete narrative-example coverage for report node "${node.label}".`,
        `Missing narrative examples requiring cited analysis: ${missingExamples.join(", ")}.`,
        "First reuse relevant primary texts, authoritative editions, and scholarly sources already saved elsewhere in the research tree.",
        "Inspect complete cached sources before fetching or searching again.",
        "For each missing example, explain its distinct evidence, role, mechanism, and relevance to the parent analysis rather than merely naming it.",
      ]
    : entityRepair
    ? [
        `Repair incomplete entity coverage for report node "${node.label}".`,
        missingEntities.length > 0 ? `Missing entities requiring concrete cited values: ${missingEntities.join(", ")}.` : undefined,
        missingCells.length > 0 ? `Missing entity-year cells requiring concrete cited values: ${missingCells.join(", ")}.` : undefined,
        missingMetrics.length > 0 ? `Missing fields requiring concrete cited values: ${missingMetrics.join(", ")}.` : undefined,
        missingMetricCells.length > 0 ? `Missing ${missingFieldCellKind} cells requiring concrete cited values: ${missingMetricCells.join(", ")}.` : undefined,
        "First reuse relevant sources already saved elsewhere in the research tree.",
        "Batch-inspect complete cached sources before any new fetch.",
        "If a saved source is shallow, refresh that existing source in place before searching.",
        "Search for a new source only after saved sources and refresh cannot cover the missing entities, metrics, or cells.",
      ]
    : [
        `Resolve the completion-blocking evidence gap for report node "${node.label}".`,
        `Gap type: ${gap.gapType}`,
        `Gap impact: ${gap.impact ?? "medium"}`,
        `Gap: ${gap.description}`,
        `Suggested query: ${gap.suggestedQuery}`,
      ];
  return {
    taskId: `T_completion_gap_${suffix}`,
    parentTaskId: gap.taskId ?? parentTaskIdForNode(tasks, node.nodeId),
    reportNodeId: node.nodeId,
    title,
    requirementIds,
    objective: [
      ...objectiveLines,
      `Gap type: ${gap.gapType}`,
      `Gap impact: ${gap.impact ?? "medium"}`,
      `Gap: ${gap.description}`,
      `Suggested query: ${gap.suggestedQuery}`,
      node.hypothesis?.evidenceGuidance ? `Node evidence guidance: ${node.hypothesis.evidenceGuidance}` : undefined,
      node.hypothesis?.researchBrief ? `Node research brief: ${node.hypothesis.researchBrief}` : undefined,
    ].filter((line): line is string => Boolean(line)).join("\n"),
    plannedReportlet: plannedReportlet ? structuredClone(plannedReportlet) : undefined,
    status: "queued",
    priority: gap.impact === "high" ? 96 : 88,
    branchId: `B_completion_gap_${suffix}`,
    acceptanceCriteria: temporalRepair
      ? [
          `Provide a concrete value with a citation for every missing year: ${missingYears.join(", ")}.`,
          "Prefer an existing complete annual report; refresh an existing shallow cache before any new search.",
          "Create EvidenceLinks or cited reportlet content that ties each repaired year to the current ReportNode.",
          "Do not count missing, unavailable, or not-provided statements as year coverage.",
          "If a missing year cannot be closed, record the grounded limitation and narrow or downplay the claim.",
        ]
      : exampleRepair
      ? [
          `Provide cited substantive analysis for every missing narrative example: ${missingExamples.join(", ")}.`,
          "Do not turn narrative examples into artificial table rows or substitute a sibling example.",
          "Prefer relevant saved sources and inspect complete caches before searching for new material.",
          "Create EvidenceLinks or cited reportlet content tying each repaired example to the current ReportNode.",
          "If an example cannot be substantiated, record the grounded limitation and narrow or downplay the claim.",
        ]
      : entityRepair
      ? [
          missingEntities.length > 0
            ? `Provide a concrete value with a citation for every missing entity: ${missingEntities.join(", ")}.`
            : "Provide concrete cited values for the missing entity-year cells.",
          ...(missingCells.length > 0 ? [`Cover every missing entity-year cell: ${missingCells.join(", ")}.`] : []),
          ...(missingMetrics.length > 0 ? [`Provide a concrete cited value for every missing field: ${missingMetrics.join(", ")}.`] : []),
          ...(missingMetricCells.length > 0 ? [`Cover every missing ${missingFieldCellKind} cell: ${missingMetricCells.join(", ")}.`] : []),
          "Prefer relevant sources already saved elsewhere in the research tree and batch-inspect complete caches before searching.",
          "Refresh an existing shallow cache in place before issuing a new search.",
          "Create EvidenceLinks or cited reportlet content tying each repaired entity or cell to the current ReportNode.",
          "If a missing entity, metric, or cell cannot be closed, record the grounded limitation and narrow or downplay the claim.",
        ]
      : [
          "Directly address the named completion-blocking gap.",
          "Create new EvidenceLinks to the current ReportNode when stronger evidence is found.",
          "If the gap cannot be closed, provide a grounded reason and suggest downplaying or narrowing the claim.",
          "Do not repeat generic source discovery without connecting the result to this exact gap.",
        ],
    createdAt: now,
    updatedAt: now,
  };
}

function compactCoverageLabel(values: string[]): string {
  if (values.length <= 3) return values.join(", ");
  return `${values.slice(0, 3).join(", ")} (+${values.length - 3} more)`;
}

function coverageFieldCellKind(cells: string[]): "entity-year-field" | "entity-field" {
  return cells.some((cell) => /^(?:[^|]+)\|(?:19|20)\d{2}\|/u.test(cell)) ? "entity-year-field" : "entity-field";
}

function parentTaskIdForNode(tasks: TaskItem[], reportNodeId: string): string {
  const branchTasks = tasks
    .filter((task) => task.reportNodeId === reportNodeId && task.taskId !== "T_root")
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
  return branchTasks[0]?.taskId ?? "T_root";
}

function toNewTaskRequest(task: TaskItem): NewTaskRequest {
  return {
    parentTaskId: task.parentTaskId,
    reportNodeId: task.reportNodeId,
    title: task.title,
    objective: task.objective,
    priority: task.priority,
    acceptanceCriteria: task.acceptanceCriteria,
  };
}

function completionReason(nonTerminalCount: number, uncoveredCount: number, openGapCount: number, queuedOrRunningCount: number, failedTaskCount: number, evidenceQualityBlockedCount: number, evidenceQualityGlobalErrorCount: number): string {
  const parts: string[] = [];
  if (nonTerminalCount > 0) parts.push(`${nonTerminalCount} blocked hypothesis nodes`);
  if (uncoveredCount > 0) parts.push(`${uncoveredCount} key hypothesis nodes have no evidence links`);
  if (openGapCount > 0) parts.push(`${openGapCount} medium/high-impact open evidence gaps`);
  if (queuedOrRunningCount > 0) parts.push(`${queuedOrRunningCount} queued or running tasks`);
  if (failedTaskCount > 0) parts.push(`${failedTaskCount} failed research tasks`);
  if (evidenceQualityBlockedCount > 0) parts.push(`${evidenceQualityBlockedCount} hypothesis nodes fail the evidence quality policy`);
  if (evidenceQualityGlobalErrorCount > 0) parts.push(`${evidenceQualityGlobalErrorCount} global research requirements fail coverage checks`);
  return `Research is not ready for report: ${parts.join(", ")}.`;
}

async function buildCompletionEvidenceAudit(ctx: PhaseContext): Promise<EvidenceQualityAudit | undefined> {
  const rubric = ctx.state.globalRubric;
  const rootId = ctx.state.rootNode?.nodeId ?? "R_root";
  if (!rubric || !(await ctx.stack.kg.getReportNode(rootId))) return undefined;
  const bundle = await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, rootId, {
    language: rubric.outputHints.language ?? "zh-CN",
    citationRequired: rubric.outputHints.citationRequired ?? true,
    rubricId: rubric.rubricId,
    rubricText: rubric.rubricText,
    requirements: rubric.requirements,
    waivers: ctx.state.issueWaivers,
  });
  return auditEvidenceQuality(bundle, resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality), {
    generatedAt: new Date(ctx.now()).toISOString(),
  });
}

function uniqueNodes(nodes: ReportNode[]): ReportNode[] {
  return Array.from(new Map(nodes.map((node) => [node.nodeId, node])).values());
}

function uniqueRequirementIds(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

async function closeIncompleteEpisode(ctx: PhaseContext, reason: string): Promise<EpisodeResult> {
  const dir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  await mkdir(dir, { recursive: true });
  const reportArtifactPath = join(dir, "incomplete-report.md");
  const evidenceIndexPath = join(dir, "evidence-index.json");
  const evidenceQualityAuditPath = join(dir, "evidence-quality-audit.json");
  const tracePath = join(dir, "trace.jsonl");
  const fullTracePath = wantsFullTrace(ctx) ? join(dir, "trace-full.jsonl") : undefined;
  const humanReviewPath = join(dir, "human-review.json");
  const rubric = ctx.state.globalRubric;
  const rootId = ctx.state.rootNode?.nodeId ?? "R_root";
  const bundle = rubric
    ? await ctx.stack.kg.buildReportBundle(ctx.state.episodeId, rootId, {
        language: rubric.outputHints.language ?? "zh-CN",
        citationRequired: rubric.outputHints.citationRequired ?? true,
        rubricId: rubric.rubricId,
        rubricText: rubric.rubricText,
        requirements: rubric.requirements,
        waivers: ctx.state.issueWaivers,
      })
    : undefined;
  const humanReview = await createHumanReviewRequest(
    ctx,
    "completion_gate",
    reason,
    await completionReviewConcerns(ctx),
  );
  await writeFile(reportArtifactPath, formatHumanReviewReport(reason, humanReview), "utf8");
  await writeFile(evidenceIndexPath, JSON.stringify(bundle?.globalEvidenceIndex ?? [], null, 2), "utf8");
  const evidenceQualityAudit = bundle
    ? auditEvidenceQuality(bundle, resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality), {
        generatedAt: new Date(ctx.now()).toISOString(),
      })
    : undefined;
  if (evidenceQualityAudit) await writeFile(evidenceQualityAuditPath, JSON.stringify(evidenceQualityAudit, null, 2), "utf8");
  await writeFile(humanReviewPath, JSON.stringify(humanReview, null, 2), "utf8");
  await ctx.emit({ eventType: "human_review_requested", payload: { reason, humanReview, humanReviewPath, reportArtifactPath } });
  await ctx.emit({ eventType: "episode_needs_more_work", payload: { reason, reportArtifactPath, evidenceIndexPath, tracePath, humanReviewPath } });
  const budgetAuditPath = await writeResearchBudgetAudit(ctx);
  await writeFile(tracePath, await exportSummaryTrace(ctx), "utf8");
  if (fullTracePath) await writeFile(fullTracePath, await exportFullTrace(ctx), "utf8");
  const result: EpisodeResult = {
    episodeId: ctx.state.episodeId,
    status: "needs_human_review",
    reportArtifactPath,
    evidenceIndexPath,
    evidenceQualityAuditPath: evidenceQualityAudit ? evidenceQualityAuditPath : undefined,
    budgetAuditPath,
    tracePath,
    fullTracePath,
    humanReview,
    humanReviewPath,
    humanReviewResponsePath: ctx.state.humanReviewResponsePath,
    metrics: await metrics(ctx, false, 1),
    closedAt: new Date(ctx.now()).toISOString(),
  };
  ctx.state.result = result;
  return result;
}

async function completionReviewConcerns(ctx: PhaseContext): Promise<HumanReviewConcern[]> {
  const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const nodes = new Map((await ctx.stack.kg.listReportNodes()).map((node) => [node.nodeId, node]));
  const concerns = gaps
    .filter((gap) => gap.status !== "closed" && gap.status !== "acknowledged" && gap.impact !== "low")
    .slice(0, 10)
    .map((gap, index) => ({
      id: `gap_${index + 1}`,
      title: nodes.get(gap.reportNodeId ?? "")?.label || gap.gapType || `证据缺口 ${index + 1}`,
      description: gap.description,
      reportNodeId: gap.reportNodeId,
      impact: gap.impact,
      suggestedAction: gap.impact === "high" ? "继续研究" : "降级保留",
      issueCode: gap.gapType,
      requirementIds: gap.reportNodeId ? nodes.get(gap.reportNodeId)?.requirementIds : undefined,
    } satisfies HumanReviewConcern));
  const evidenceQualityAudit = await buildCompletionEvidenceAudit(ctx);
  const qualityConcerns = (evidenceQualityAudit?.issues ?? [])
    .filter((issue) => issue.severity === "error")
    .slice(0, Math.max(0, 10 - concerns.length))
    .map((issue, index) => ({
      id: `quality_${index + 1}`,
      title: issue.code,
      description: issue.message,
      reportNodeId: issue.reportNodeId,
      impact: "high" as const,
      suggestedAction: issue.suggestedRepair || "继续研究",
      issueCode: issue.code,
      requirementIds: requirementIdsForQualityIssue(ctx, issue),
    } satisfies HumanReviewConcern));
  if (concerns.length > 0 || qualityConcerns.length > 0) return [...concerns, ...qualityConcerns];
  return (await ctx.stack.kg.listReportNodes())
    .filter((node) => node.nodeKind === "hypothesis" && ["planned", "researching", "needs_review", "needs_repair", "insufficient_evidence"].includes(node.status))
    .slice(0, 5)
    .map((node, index) => ({
      id: `node_${index + 1}`,
      title: node.label,
      description: node.scopeNote || node.label,
      reportNodeId: node.nodeId,
      impact: "medium",
      suggestedAction: "降级保留",
      issueCode: "blocking_report_node",
      requirementIds: node.requirementIds,
    }));
}

function requirementIdsForQualityIssue(ctx: PhaseContext, issue: EvidenceQualityAudit["issues"][number]): string[] | undefined {
  if (issue.requirementId) return [issue.requirementId];
  const nodeIds = issue.reportNodeId
    ? ctx.state.globalRubric?.requirements?.filter((requirement) => issue.message.includes(requirement.requirementId)).map((requirement) => requirement.requirementId)
    : ctx.state.globalRubric?.requirements?.filter((requirement) => issue.message.includes(requirement.requirementId)).map((requirement) => requirement.requirementId);
  if (nodeIds?.length) return nodeIds;
  return undefined;
}

function formatHumanReviewReport(reason: string, review: Awaited<ReturnType<typeof createHumanReviewRequest>>): string {
  const questions = review.questions.map((question, index) => {
    const options = question.options?.length ? `\n可选回答：${question.options.join(" / ")}` : "";
    const recommended = question.recommendedAnswer ? `\n建议：${question.recommendedAnswer}` : "";
    return `## ${index + 1}. ${question.title}\n\n${question.question}\n\n为什么需要决定：${question.whyNeeded}\n\n回答格式：${question.answerFormat}${options}${recommended}`;
  }).join("\n\n");
  return `# 需要你的决定\n\n${review.summary || reason}\n\n${questions}\n\n## 如何继续\n\n${review.responseInstructions}\n`;
}

async function metrics(ctx: PhaseContext, publishGatePassed: boolean, rubricIssueCount: number): Promise<EpisodeResult["metrics"]> {
  const reportNodes = await ctx.stack.kg.listReportNodes();
  const knowledgeNodes = await ctx.stack.kg.listKnowledgeNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const tasks = await ctx.stack.ledger.listAll();
  const nodesById = new Map(reportNodes.map((node) => [node.nodeId, node]));
  const gaps = (await ctx.stack.kg.listOpenGaps?.() ?? []).filter((gap) => isCompletionBlockingGap(gap, nodesById));
  const evidenceQualityAudit = await buildCompletionEvidenceAudit(ctx);
  return {
    reportNodeCount: reportNodes.length,
    knowledgeNodeCount: knowledgeNodes.length,
    evidenceLinkCount: evidenceLinks.length,
    completedTaskCount: tasks.filter((task) => task.status === "completed").length,
    openGapCount: gaps.length,
    citationCount: evidenceLinks.length,
    rubricIssueCount,
    publishGatePassed,
    evidenceQualityScore: evidenceQualityAudit?.score,
    evidenceQualityIssueCount: evidenceQualityAudit?.issues.length,
    requirementCoverage: evidenceQualityAudit?.requirementCoverage.coverage,
    mustRequirementCount: evidenceQualityAudit?.requirementCoverage.mustCount,
    coveredMustRequirementCount: evidenceQualityAudit?.requirementCoverage.coveredMustCount,
    ...budgetMetricFields(ctx),
  };
}
