import type { AgentNodePartPlan, AgentRunResult, OpenGap, ReportNode, StructurePatchSuggestion, TaskItem } from "@deepresearch/contracts";
import { runAgentRuntime } from "../agent-runtime.js";
import { countedRowEvidenceTarget, countedRowSourceInventory } from "../counted-rows.js";
import { buildContextPacket } from "../context-builder.js";
import { isExplicitTestLlm } from "../infra/ai.js";
import { isoNow } from "../infra/ids.js";
import { EVIDENCE_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import { countedRowHarvestTool, createPhaseToolRegistry, evidenceTools } from "../tools.js";
import type { PhaseContext } from "../types.js";
import {
  MAX_AGENT_NODE_PARTS,
  agentNodePartPlans,
  evidenceRuntimeHistoryMaxChars,
  evidenceTaskRuntimeBudget,
  localizeEvidenceSummary,
  maxAgentNodeParts,
} from "./evidence-budget.js";
import {
  autoSaveLegacySearchResults,
  runtimeSearchHitCount,
  runtimeSearchSummary,
  stageFetchedCandidatesForRepair,
} from "./evidence-fetch.js";
import {
  addOpenGap,
  agentResultGap,
  closeOpenGaps,
  closeResolvedTargetedGaps,
  isEvidenceSupportedStatus,
  mergeGaps,
} from "./evidence-gaps.js";
import {
  MAX_REPORTLET_EVIDENCE_LINKS,
  collectRuntimeEvidence,
  createEvidenceReportlets,
  missingPlannedReportletGaps,
  missingUnplannedReportletCitationGap,
  normalizeAssessment,
  plannedReportletCount,
  updateReportNodeDraftFromReportlets,
  type EvidenceAssessment,
} from "./evidence-reportlets.js";
import { errorMessage, object, serializeError } from "./evidence-utils.js";

export { agentNodePartPlans, evidenceRuntimeHistoryMaxChars, evidenceTaskRuntimeBudget } from "./evidence-budget.js";
export { stageFetchedCandidatesForRepair } from "./evidence-fetch.js";

export async function dispatchEvidencePhase(ctx: PhaseContext, cycleId = "C_001"): Promise<AgentRunResult[]> {
  const rubric = ctx.state.globalRubric;
  if (!rubric) throw new Error("rubric required before dispatch-evidence");
  const phaseCfg = ctx.state.runtimeProfile.phases.dispatchEvidence;
  const maxParallel = phaseCfg?.maxParallelAgents;
  if (typeof maxParallel !== "number" || maxParallel < 1) {
    throw new Error("RuntimeProfile.phases.dispatchEvidence.maxParallelAgents must be >= 1");
  }
  const maxConcurrent = Math.max(1, Math.min(maxParallel, Math.floor(phaseCfg?.maxConcurrentAgents ?? maxParallel)));
  let tasks = (await ctx.stack.ledger.listByStatus("queued", { limit: maxParallel }))
    .filter((task) => task.taskId !== "T_root");
  const planned = await planQueuedAgentNodeTasks(ctx, tasks, cycleId);
  if (planned > 0) {
    tasks = (await ctx.stack.ledger.listByStatus("queued", { limit: maxParallel }))
      .filter((task) => task.taskId !== "T_root");
  }
  const results = await mapConcurrent(tasks, maxConcurrent, (task) => runEvidenceTaskWithLifecycle(ctx, task, cycleId, rubric));
  ctx.state.agentResults.push(...results);
  return results;
}

async function planQueuedAgentNodeTasks(ctx: PhaseContext, tasks: TaskItem[], cycleId: string): Promise<number> {
  let planned = 0;
  for (const task of tasks) {
    if (task.plannedReportlets?.length) continue;
    const reportNode = await ctx.stack.kg.getReportNode(task.reportNodeId);
    if (!reportNode) continue;
    const rowTarget = countedRowEvidenceTarget(task);
    const requirements = (ctx.state.globalRubric?.requirements ?? []).filter(
      (requirement) => reportNode.requirementIds?.includes(requirement.requirementId),
    );
    const parts = agentNodePartPlans(
      task,
      reportNode,
      Math.max(maxAgentNodeParts(ctx, requirements), rowTarget ?? 0),
      ctx.state.globalRubric?.outputHints.language ?? ctx.state.submission.uiOptions?.outputLanguage ?? "zh-CN",
      requirements,
    );
    if (parts.length < 2) continue;
    await attachAgentNodePartPlan(ctx, task, reportNode, parts, cycleId);
    planned += 1;
  }
  return planned;
}

async function attachAgentNodePartPlan(
  ctx: PhaseContext,
  task: TaskItem,
  reportNode: ReportNode,
  parts: AgentNodePartPlan[],
  cycleId: string,
): Promise<void> {
  const now = isoNow(ctx.now);
  const plannedTask: TaskItem = {
    ...task,
    plannedReportlets: parts,
    acceptanceCriteria: [
      ...task.acceptanceCriteria,
      ...parts.map((part) => `Internal reportlet plan ${part.partId}: ${part.researchQuestion}`),
    ],
    updatedAt: now,
  };
  await ctx.stack.ledger.upsert(plannedTask);
  await traceWrite(ctx, "ledger", "upsert", { task: plannedTask, source: "agent_node_internal_planning" }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId, agentRunId: `A_${cycleId}_${task.taskId}_planner` });
  await ctx.emit({
    eventType: "agent_node_parts_planned",
    taskId: task.taskId,
    reportNodeId: task.reportNodeId,
    branchId: task.branchId,
    agentRunId: `A_${cycleId}_${task.taskId}_planner`,
    payload: {
      reportNodeId: reportNode.nodeId,
      originalTaskId: task.taskId,
      partCount: parts.length,
      mode: "internal_reportlet_plan",
      parts,
    },
  });
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fn(items[index]!);
    }
  }));
  return results;
}

async function runEvidenceTaskWithLifecycle(
  ctx: PhaseContext,
  task: TaskItem,
  cycleId: string,
  rubric: NonNullable<PhaseContext["state"]["globalRubric"]>,
): Promise<AgentRunResult> {
  const meta = { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId, agentRunId: `A_${cycleId}_${task.taskId}` };
  try {
    await ctx.stack.ledger.updateStatus(task.taskId, "running");
    await traceWrite(ctx, "ledger", "updateStatus", { taskId: task.taskId, status: "running" }, meta);
    const reportNode = await ctx.stack.kg.getReportNode(task.reportNodeId);
    const previousNodeStatus = reportNode?.status;
    if (reportNode) {
      const next = { ...reportNode, status: "researching" as const, updatedAt: isoNow(ctx.now) };
      await ctx.stack.kg.updateReportNode(next);
      await traceWrite(ctx, "kg", "updateReportNode", { node: next }, meta);
    }
    const availableTools = countedRowEvidenceTarget(task) ? [...evidenceTools, countedRowHarvestTool] : evidenceTools;
    const contextPacket = await buildContextPacket({
      task,
      globalRubric: rubric,
      runtimeProfile: ctx.state.runtimeProfile,
      kg: ctx.stack.kg,
      ledger: ctx.stack.ledger,
      availableTools,
    });
    // Tool definitions already appear in the runtime request's tool section;
    // carrying a second copy inside contextPacket serializes them again on
    // every ReAct step.
    const { availableTools: _promptDuplicateTools, ...promptContextPacket } = contextPacket;
    await ctx.emit({ eventType: "evidence_agent_started", taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    const result = await runEvidenceTask(ctx, task, cycleId, promptContextPacket, previousNodeStatus);
    await ctx.emit({
      eventType: "evidence_agent_finished",
      taskId: task.taskId,
      reportNodeId: task.reportNodeId,
      branchId: task.branchId,
      agentRunId: result.agentRunId,
      payload: result.turnSummary,
    });
    return result;
  } catch (err) {
    if (ctx.signal?.aborted) throw err;
    return recoverFailedEvidenceTask(ctx, task, cycleId, err, meta);
  }
}

async function runEvidenceTask(
  ctx: PhaseContext,
  task: TaskItem,
  cycleId: string,
  contextPacket: unknown,
  previousNodeStatus?: ReportNode["status"],
): Promise<AgentRunResult> {
  const reportNode = await ctx.stack.kg.getReportNode(task.reportNodeId);
  if (!reportNode) throw new Error(`ReportNode not found: ${task.reportNodeId}`);
  const rowEvidenceTarget = countedRowEvidenceTarget(task);
  const countedRows = rowEvidenceTarget ? await countedRowSourceInventory(ctx) : undefined;
  const defaultQuery = rowEvidenceTarget ? task.objective : reportNode.hypothesis?.evidenceGuidance || task.objective;
  const outputLanguage = ctx.state.globalRubric?.outputHints.language ?? ctx.state.submission.uiOptions?.outputLanguage ?? "zh-CN";
  const llmCfg = ctx.state.runtimeProfile.llm.evidence;
  const meta = { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId, agentRunId: `A_${cycleId}_${task.taskId}` };
  const evidenceCfg = ctx.state.runtimeProfile.agents.evidence;
  const runtimeBudget = evidenceTaskRuntimeBudget(task, evidenceCfg);
  const availableTools = rowEvidenceTarget ? [...evidenceTools, countedRowHarvestTool] : evidenceTools;
  const registry = createPhaseToolRegistry(ctx, {
    phase: "dispatch-evidence.react",
    taskId: task.taskId,
    reportNodeId: reportNode.nodeId,
    branchId: task.branchId,
    agentRunId: meta.agentRunId,
    tools: availableTools,
    countedRowReportNodeIds: countedRows?.reportNodeIds,
    countedRowHarvest: rowEvidenceTarget ? {
      query: defaultQuery,
      target: rowEvidenceTarget,
      excludedUrls: countedRows?.sources.flatMap((source) => source.url ? [source.url] : []) ?? [],
      excludedTitles: countedRows?.sources.map((source) => source.title) ?? [],
      acceptanceCriteria: task.acceptanceCriteria,
      plannedReportlets: (task.plannedReportlets ?? []).map((plan) => ({
        partId: plan.partId,
        expectedHeading: plan.expectedHeading,
      })),
    } : undefined,
  });
  const runtime = await runAgentRuntime({
    agent: {
      agentId: "evidence",
      agentRunId: meta.agentRunId,
      role: "subagent",
      title: `EvidenceAgent ${task.taskId}`,
      objective: task.objective,
      episodeId: ctx.state.episodeId,
      branchId: task.branchId,
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
    },
    llm: ctx.stack.llm,
    system: `${EVIDENCE_SYSTEM_PROMPT}
You are now operating as a ReAct agent. Use tools one at a time and finish only after you have saved/linkable evidence or recorded explicit gaps.
Do not write the final report. Do write concise cited reportlet material for this agent task after saving evidence.
Before calling web_search, review contextPacket.relevantEvidence. It includes a small set of high-relevance sources already saved elsewhere in the research tree. If one may answer the current task, call inspect_knowledge_node, then use link_evidence with its knowledgeNodeId and a claim specific to the current leaf. For a time series or multi-entity table, use inspect_knowledge_nodes to inspect up to four candidate sources in one call. When inspection reports fullContentAvailable=false for an otherwise relevant source, call refresh_knowledge_node once for that knowledgeNodeId; it force-fetches and upgrades the existing node without creating a duplicate. Do not search for, fetch, or save the same source again when fullContentAvailable=true. Search only when the saved sources are insufficient.
For long laws, standards, reports, and PDFs, pass a narrow query or focusTerms to fetch_page using only the requested metric/entity and source-visible article or annex identifiers. Never put a guessed year, percentage, threshold, or answer value into fetch focus. When one fetched passage exposes the exact requested values, immediately link the already saved KnowledgeNode (or save it once) with a source-faithful claim and finish; do not fetch the same document again.
If an owned requirement has exampleScope, treat every listed item as a mandatory cited narrative example. Research and explain each example's distinct facts, role, and relevance; do not merely name it, substitute a sibling example, or force the examples into artificial table rows. These are internal reportlet checks under the current leaf, not separate child agents.
When a task requires Atkinson, Hoover, or Theil distribution indices, call calculate_distribution_indices with exact source-grounded labels, weights, and values in matching order (plus atkinsonEpsilon when the task specifies it). Cite the saved external evidence that supports every input series in the reportlet; the deterministic calculator output is a reproducible derivation, not an external source or a substitute citation. Never guess, silently interpolate, or zero-fill a missing input merely to complete a calculation—record an open gap instead.
When using save_knowledge_node, include title, url, snippet or content, relation, claimText, confidence, and qualityScore. Also capture publishedAt, publisher, and authors when the source exposes them; never guess a publication date.
Also include sourceTier (official|primary|secondary|unknown). Treat confidence as claim support and qualityScore as source reliability; do not copy one value into the other without assessment.
For core claims, prefer at least two genuinely independent domains, including one primary/official source when available, and inspect at least one full source rather than relying only on search snippets. Search explicitly for disconfirming or qualifying evidence before reporting high confidence.
If both supporting and contradicting evidence survive source-quality review, set nodeStatus=partially_supported and write a reportlet that cites and compares both sides. Use nodeStatus=contradicted only for a resolved refutation, not as a synonym for unfinished research.
Be budget-aware: once you have enough credible sources for the current claim, save/link them and finish; when runtime budget is low, stop fetching new pages and return partial findings with open gaps.
For every open gap, return a structured recommendedDisposition: retry when another bounded search is likely to help, qualify when existing cited material remains useful but the claim must be narrowed, or omit when no safe evidence-backed claim remains. Set claimSafeWithoutMissingEvidence=true only when the report can remove the missing fact or state a narrower cited claim without distortion. List affectedRequirementIds from the supplied structured requirements; do not infer IDs from prose.
${rowEvidenceTarget ? `This is a counted row-production task. "Enough" means ${rowEvidenceTarget} distinct, eligible, complete rows across unique primary studies. Continue searching, fetching, and saving until that row target is met or the runtime budget is genuinely exhausted; do not finish after the first useful source. Each row must preserve every requested field and its own citation. The Finding on Effectiveness value must begin with exactly Effective, Ineffective, or Neutral; use Neutral for mixed findings and explain the mixture after that label.` : ""}
${rowEvidenceTarget ? "The countedRowExclusions context lists studies already used by any sibling row batch. Do not search for, save, link, or write another row for those sources. If save_knowledge_node or link_evidence returns counted_row_source_already_used, immediately discard that candidate and continue with a different study." : ""}
${rowEvidenceTarget ? "Call harvest_counted_rows first. It atomically searches, fetches, extracts, validates, deduplicates, and saves complete rows. Rows returned by that tool already contain real KnowledgeNode/EvidenceLink IDs and cited reportlet markdown: do not save or link them again. Finish using the returned rows, and use direct web_search/fetch_page only when savedRowCount is below the requested target." : ""}
Finish with relation, claimText, confidence, nodeStatus, reasoningSummary, reportletMarkdown, completedReportlets, openGaps, and structurePatchSuggestions.
In reportletMarkdown, write a small reusable report fragment for the current task only. Every evidence-dependent sentence must place its saved evidence-link placeholder at the exact supporting position, for example [E:E_task_1]. Copy the complete evidenceLinkId returned by save_knowledge_node/link_evidence verbatim inside the marker; if the returned id is E_T_item_1_1, write [E:E_T_item_1_1], not [E:T_item_1_1]. Implicit citations are not allowed. If the tool result did not expose a valid evidenceLinkId, record an open gap instead of writing the reportlet.
Every list item or table row containing a number, percentage, or date must carry its supporting [E:...] marker on that same item or row, even when the introductory sentence is already cited.
The current reportlet is one subsection of the same final report. Never refer to sibling tasks as "another report" or claim that an owned sibling topic is outside the final report; simply stay within the current leaf's evidence and omit cross-report promises.
For every reportlet, write evidence-grounded content rather than generic assumptions: explain what each cited source specifically contributes, cite only sources whose content is used in that reportlet, and do not cite broad background or unrelated sources merely because the agent saved them.
Keep each reportlet focused and cite no more than ${MAX_REPORTLET_EVIDENCE_LINKS} evidence links. If more sources are relevant, select only those directly used by the reportlet's claims or split the material into planned reportlets.
Avoid phrases like "according to the report hypothesis" unless clearly labeling an unverified assumption. If direct evidence for a planned part is missing, record an open gap instead of writing an unsupported reportlet.
If contextPacket.currentTask.plannedReportlets is present, treat them as this same agent's internal research-and-writing checklist, not as separate child agents. For every planned part you actually researched and wrote, add one item to completedReportlets with partId, title, markdown, citedEvidenceLinkIds, citedKnowledgeNodeIds, and reasoningSummary. Each completedReportlet must be a small cited report for exactly one planned part and must include at least one valid [E:...] marker in its markdown at the supporting claim position. Use evidenceLinkId values returned by save_knowledge_node/link_evidence tool results; do not invent ids and do not wait for the framework to auto-save search results. citedEvidenceLinkIds must exactly describe the markers used by that markdown, not the whole agent evidence set. If a planned part lacks explicit citation markers, it is not completed; leave it out and add an open gap for that part. Once you have saved at least one useful source for a planned part, prefer finishing with its completedReportlet over more browsing.
If contextPacket.currentTask.plannedReportlet is present, strictly follow its researchQuestion, searchGoal, writingGoal, expectedHeading, and evidenceNeeds. Do not broaden the reportlet beyond that planned atomic part.`,
    context: {
      contextPacket,
      defaultQuery,
      countedRowExclusions: countedRows?.sources ?? [],
      outputLanguage,
      languageRules: [
        `Write thoughtSummary, reasoningSummary, claimText, openGaps, and user-visible summaries in ${outputLanguage}.`,
        outputLanguage.startsWith("zh") ? "除专有名词、标题或原文引用外，不要用英文写给用户看的摘要。" : "Use the requested output language for user-visible summaries.",
      ],
    },
    tools: registry,
    budget: runtimeBudget,
    outputSchema: {
      relation: "supports|contradicts|qualifies|background",
      claimText: "string",
      confidence: "number 0..1",
      nodeStatus: "supported|partially_supported|contradicted|insufficient_evidence|downplayed",
      reasoningSummary: "string",
      reportletMarkdown: "string",
      completedReportlets: [{ partId: "string", title: "string", markdown: "string", citedEvidenceLinkIds: ["string"], citedKnowledgeNodeIds: ["string"], reasoningSummary: "string" }],
      openGaps: [{ gapType: "string", description: "string", suggestedQuery: "string", recommendedDisposition: "retry|qualify|omit", claimSafeWithoutMissingEvidence: "boolean", affectedRequirementIds: ["string"] }],
      structurePatchSuggestions: [{ patch: "StructurePatch", rationale: "string", confidence: "number 0..1" }],
    },
    ...llmCfg,
    historyMaxChars: evidenceRuntimeHistoryMaxChars(ctx.state.runtimeProfile.phases.dispatchEvidence?.contextTokenLimit),
    outputRepairAttempts: evidenceCfg?.outputRepairAttempts ?? 1,
    signal: ctx.signal,
    legacyEvidencePromptHints: true,
    chat: (request) => tracedLlmChat(ctx, "dispatch-evidence.react", request, meta),
  });
  if (runtime.status !== "completed" && runtime.status !== "budget_exceeded") {
    throw new Error(runtime.error ?? `Evidence agent runtime ended with status=${runtime.status}`);
  }

  const collected = collectRuntimeEvidence(runtime);
  const finish = object(runtime.finish);
  const budgetGap = runtime.status === "budget_exceeded"
    ? {
        gapType: "agent_budget_exceeded",
        description: `Evidence agent ${task.taskId} reached runtime budget before an explicit finish: ${runtime.error ?? "budget exceeded"}. Partial evidence, if any, was kept.`,
        suggestedQuery: defaultQuery,
        reportNodeId: reportNode.nodeId,
        taskId: task.taskId,
        impact: "medium" as const,
        status: "open" as const,
      }
    : undefined;
  const legacyAssessment = finish.__legacyAssessment === true || runtime.status === "budget_exceeded";
  const searchHitCount = runtimeSearchHitCount(runtime);
  const assessmentInput = runtime.status === "budget_exceeded"
    ? {
        relation: "qualifies" as const,
        claimText: reportNode.hypothesis?.statement || task.objective,
        confidence: collected.knowledgeNodeIds.length > 0 ? 0.55 : 0.2,
        nodeStatus: collected.knowledgeNodeIds.length > 0 ? "partially_supported" as const : "insufficient_evidence" as const,
        reasoningSummary: `子代理到达运行预算后停止。${collected.knowledgeNodeIds.length > 0 ? "已保留预算耗尽前收集到的部分证据。" : "预算耗尽前没有保存可用证据。"}`,
        openGaps: budgetGap ? [budgetGap] : [],
      }
    : finish as EvidenceAssessment;
  const observedHitCount = Math.max(collected.knowledgeNodeIds.length, searchHitCount);
  const assessment = normalizeAssessment(assessmentInput, observedHitCount, task, reportNode, defaultQuery);
  if (collected.completedReportlets.length > 0) {
    const completedByPartId = new Map(assessment.completedReportlets.map((reportlet) => [reportlet.partId, reportlet]));
    for (const reportlet of collected.completedReportlets) completedByPartId.set(reportlet.partId, reportlet);
    assessment.completedReportlets = Array.from(completedByPartId.values()).slice(0, MAX_AGENT_NODE_PARTS);
  }
  const requiresExplicitReportlets = plannedReportletCount(task) > 0;
  const allowLegacyAutosave = isExplicitTestLlm(ctx.stack.llm.name) || assessment.relation === "background";
  const autoSaved = !requiresExplicitReportlets
    && collected.knowledgeNodeIds.length === 0
    && allowLegacyAutosave
    ? await autoSaveLegacySearchResults(ctx, task, reportNode, meta, runtime, assessment)
    : { knowledgeNodeIds: [] as string[], evidenceLinkIds: [] as string[] };
  if (
    !requiresExplicitReportlets
    && collected.knowledgeNodeIds.length === 0
    && searchHitCount > 0
    && !allowLegacyAutosave
  ) {
    await traceWrite(ctx, "kg", "skipEvidenceLink", {
      reason: "explicit_evidence_save_required",
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      searchHitCount,
      relation: assessment.relation,
      claimText: assessment.claimText,
    }, meta);
  }
  const knowledgeNodeIds = [...collected.knowledgeNodeIds, ...autoSaved.knowledgeNodeIds];
  const evidenceLinkIds = [...collected.evidenceLinkIds, ...autoSaved.evidenceLinkIds];
  const stagedCandidateIds = runtime.status === "budget_exceeded" && knowledgeNodeIds.length === 0
    ? await stageFetchedCandidatesForRepair(ctx, task, reportNode, meta, runtime)
    : [];
  if (stagedCandidateIds.length > 0) {
    await traceWrite(ctx, "kg", "stageFetchedCandidatesForRepair", {
      taskId: task.taskId,
      reportNodeId: reportNode.nodeId,
      knowledgeNodeIds: stagedCandidateIds,
      reason: "budget_exhausted_before_claim_linking",
    }, meta);
  }
  const openGaps = mergeGaps(collected.openGaps, assessment.openGaps, task, reportNode, defaultQuery);
  const structurePatchSuggestions = [...collected.structurePatchSuggestions, ...assessment.structurePatchSuggestions];
  const nodeStatus = runtime.status === "budget_exceeded" && knowledgeNodeIds.length > 0
    ? "partially_supported"
    : assessment.nodeStatus;
  const reasoningSummary = runtime.status === "budget_exceeded" && knowledgeNodeIds.length > 0
    ? `${assessment.reasoningSummary} 已保留预算耗尽前收集到的 ${knowledgeNodeIds.length} 个证据节点。`
    : assessment.reasoningSummary;
  const userReasoningSummary = localizeEvidenceSummary(reasoningSummary, outputLanguage, {
    knowledgeNodeCount: knowledgeNodeIds.length,
    evidenceLinkCount: evidenceLinkIds.length,
    openGapCount: openGaps.length,
    nodeStatus,
  });
  if (knowledgeNodeIds.length === 0 && evidenceLinkIds.length === 0) {
    const existingEvidenceLinks = await ctx.stack.kg.listEvidenceLinks(reportNode.nodeId);
    const fallbackStatus: ReportNode["status"] = existingEvidenceLinks.length > 0 && isEvidenceSupportedStatus(previousNodeStatus)
      ? previousNodeStatus!
      : "insufficient_evidence";
    const gap: OpenGap = {
      gapType: "low_quality_sources",
      description: runtime.status === "budget_exceeded"
        ? `子代理 ${task.taskId} 到达运行预算，但没有保存可用来源证据。`
        : `子代理 ${task.taskId} 完成，但没有保存可用来源证据。`,
      suggestedQuery: defaultQuery,
      reportNodeId: reportNode.nodeId,
      taskId: task.taskId,
      impact: "medium",
      status: "open",
    };
    const plannedGaps = missingPlannedReportletGaps(task, reportNode, []);
    const allGaps = [gap, ...openGaps, ...plannedGaps];
    addOpenGap(ctx, gap);
    for (const plannedGap of plannedGaps) addOpenGap(ctx, plannedGap);
    await finalizeNode(ctx, reportNode, fallbackStatus);
    await ctx.stack.ledger.updateStatus(task.taskId, "completed");
    await traceWrite(ctx, "ledger", "updateStatus", { taskId: task.taskId, status: "completed" }, meta);
    return agentResult(task, reportNode, cycleId, [], [], [], allGaps, structurePatchSuggestions, fallbackStatus, gap.description, runtimeSearchSummary(runtime));
  }
  const reportlets = await createEvidenceReportlets(ctx, task, reportNode, meta, evidenceLinkIds, knowledgeNodeIds, assessment);
  const missingReportletGaps = missingPlannedReportletGaps(task, reportNode, reportlets);
  const unplannedReportletGap = missingUnplannedReportletCitationGap(task, reportNode, reportlets, evidenceLinkIds, assessment);
  openGaps.push(...missingReportletGaps, ...(unplannedReportletGap ? [unplannedReportletGap] : []));
  if (reportlets.length > 0) await updateReportNodeDraftFromReportlets(ctx, reportNode, reportlets, meta);
  for (const gap of openGaps) addOpenGap(ctx, gap);
  await closeResolvedTargetedGaps(ctx, task, reportNode, reportlets, openGaps);
  if (openGaps.length === 0 && ["supported", "partially_supported", "verified"].includes(assessment.nodeStatus)) {
    await closeOpenGaps(ctx, reportNode.nodeId, `Evidence task ${task.taskId} resolved without new open gaps.`);
  }
  await finalizeNode(ctx, reportNode, nodeStatus);
  await ctx.stack.ledger.updateStatus(task.taskId, "completed");
  await traceWrite(ctx, "ledger", "updateStatus", { taskId: task.taskId, status: "completed" }, meta);
  return agentResult(task, reportNode, cycleId, knowledgeNodeIds, evidenceLinkIds, reportlets.map((reportlet) => reportlet.reportletId), openGaps, structurePatchSuggestions, nodeStatus, userReasoningSummary, runtimeSearchSummary(runtime));
}

async function finalizeNode(ctx: PhaseContext, node: ReportNode, status: ReportNode["status"]): Promise<void> {
  const current = await ctx.stack.kg.getReportNode(node.nodeId);
  if (!current) return;
  const next = { ...current, status, updatedAt: isoNow(ctx.now) };
  await ctx.stack.kg.updateReportNode(next);
  await traceWrite(ctx, "kg", "updateReportNode", { node: next }, { reportNodeId: node.nodeId });
}

function agentResult(
  task: TaskItem,
  node: ReportNode,
  cycleId: string,
  knowledgeNodeIds: string[],
  evidenceLinkIds: string[],
  reportletIds: string[],
  gaps: OpenGap[],
  structurePatchSuggestions: StructurePatchSuggestion[],
  newStatus: ReportNode["status"],
  summary: string,
  searchSummary: string,
): AgentRunResult {
  return {
    agentRunId: `A_${cycleId}_${task.taskId}`,
    taskId: task.taskId,
    reportNodeId: task.reportNodeId,
    branchId: task.branchId,
    branchOutcome: "done_here",
    knowledgeNodeIds,
    evidenceLinkIds,
    reportletIds,
    nodeUpdates: [{
      reportNodeId: node.nodeId,
      oldStatus: "researching",
      newStatus,
      reason: summary,
      confidence: gaps.length > 0 ? 0.3 : 0.7,
    }],
    openGaps: gaps.map(agentResultGap),
    structurePatchSuggestions,
    turnSummary: {
      actionSummary: summary,
      searchSummary,
      reasoningSummary: summary,
      citedKnowledgeNodeIds: knowledgeNodeIds,
      citedEvidenceLinkIds: evidenceLinkIds,
    },
  };
}

async function recoverFailedEvidenceTask(
  ctx: PhaseContext,
  task: TaskItem,
  cycleId: string,
  err: unknown,
  meta: { taskId?: string; reportNodeId?: string; branchId?: string; agentRunId?: string },
): Promise<AgentRunResult> {
  const message = errorMessage(err);
  const infrastructureFailure = isInfrastructureRuntimeError(message);
  const reportNode = await ctx.stack.kg.getReportNode(task.reportNodeId);
  const existingEvidenceLinks = reportNode ? await ctx.stack.kg.listEvidenceLinks(reportNode.nodeId) : [];
  const nextTaskStatus = infrastructureFailure ? "blocked" as const : "failed" as const;
  const nextNodeStatus: ReportNode["status"] = infrastructureFailure
    ? existingEvidenceLinks.length > 0 ? "partially_supported" : "downplayed"
    : "needs_repair";
  const gap: OpenGap = {
    gapType: infrastructureFailure ? "infrastructure_error" : "agent_runtime_error",
    description: infrastructureFailure
      ? `子代理 ${task.taskId} 因外部服务故障未能完成：${message}`
      : `子代理 ${task.taskId} 未能完成任务：${message}`,
    suggestedQuery: task.objective,
    reportNodeId: task.reportNodeId,
    taskId: task.taskId,
    impact: infrastructureFailure ? "low" : "medium",
    status: "open",
  };
  addOpenGap(ctx, gap);
  await ctx.stack.ledger.updateStatus(task.taskId, nextTaskStatus, message);
  await traceWrite(ctx, "ledger", "updateStatus", { taskId: task.taskId, status: nextTaskStatus, reason: message }, meta);
  if (reportNode) {
    const next = { ...reportNode, status: nextNodeStatus, updatedAt: isoNow(ctx.now) };
    await ctx.stack.kg.updateReportNode(next);
    await traceWrite(ctx, "kg", "updateReportNode", { node: next, reason: message }, meta);
  }
  const result: AgentRunResult = {
    agentRunId: `A_${cycleId}_${task.taskId}`,
    taskId: task.taskId,
    reportNodeId: task.reportNodeId,
    branchId: task.branchId,
    branchOutcome: "failed",
    knowledgeNodeIds: [],
    evidenceLinkIds: [],
    nodeUpdates: [{
      reportNodeId: task.reportNodeId,
      oldStatus: "researching",
      newStatus: nextNodeStatus,
      reason: message,
      confidence: 0,
    }],
    openGaps: [agentResultGap(gap)],
    structurePatchSuggestions: [],
    turnSummary: {
      actionSummary: infrastructureFailure ? `子代理因外部服务故障暂停：${message}` : `子代理失败：${message}`,
      searchSummary: "",
      reasoningSummary: message,
      citedKnowledgeNodeIds: [],
      citedEvidenceLinkIds: [],
    },
  };
  await traceWrite(ctx, "agent", "failed", { task, error: serializeError(err), result }, meta);
  await ctx.emit({
    eventType: "evidence_agent_failed",
    taskId: task.taskId,
    reportNodeId: task.reportNodeId,
    branchId: task.branchId,
    agentRunId: result.agentRunId,
    payload: result.turnSummary,
  });
  return result;
}

function isInfrastructureRuntimeError(message: string): boolean {
  return [
    /Jina search request failed/i,
    /Jina search HTTP (?:429|5\d\d)/i,
    /fetch_page request failed/i,
    /Connect Timeout/i,
    /\bAbortError\b/i,
    /\bfetch failed\b/i,
    /\btimed? out\b/i,
    /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i,
    /Content Exists Risk/i,
    /content risk/i,
    /HTTP 400.*risk/i,
  ].some((pattern) => pattern.test(message));
}
