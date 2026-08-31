import { createHash } from "node:crypto";
import type { AgentRunResult, EvidenceLink, NewTaskRequest, OpenGap, TaskItem, TaskUpdate, ToolCallRequest, ToolCallResult, ToolDefinition, ToolRegistry } from "@deepresearch/contracts";
import { runAgentRuntime } from "../agent-runtime.js";
import { consolidateCountedRowGaps, isSoftCountedRowGap } from "../counted-rows.js";
import { evidenceRuntimeHistoryMaxChars } from "./evidence-budget.js";
import { isExplicitTestLlm, truncate } from "../infra/ai.js";
import { isoNow, shortId } from "../infra/ids.js";
import { CYCLE_REFLECTION_SYSTEM_PROMPT } from "../prompts.js";
import { traceWrite, tracedLlmChat } from "../trace.js";
import type { PhaseContext } from "../types.js";

export interface CycleReflectionJson {
  continueDispatch?: boolean;
  taskUpdates?: TaskUpdate[];
  newTasks?: NewTaskRequest[];
  skipReasons?: ReflectionGapDisposition[];
}

interface ReflectionGapDisposition {
  gap: string;
  reason: string;
  disposition?: "qualify" | "omit";
  claimSafeWithoutMissingEvidence?: boolean;
  affectedRequirementIds?: string[];
}

const MAX_REPAIR_TASKS_PER_REFLECTION = 5;

export interface CycleReflectionOptions {
  currentCycle?: number;
  maxCycles?: number;
}

export async function cycleReflectionPhase(ctx: PhaseContext, results: AgentRunResult[], opts: CycleReflectionOptions = {}): Promise<{ continueDispatch: boolean }> {
  const countedRows = await consolidateCountedRowGaps(ctx);
  const queuedBefore = await ctx.stack.ledger.listByStatus("queued", { limit: 20 });
  const allGaps: OpenGap[] = results.flatMap((result) => result.openGaps.map((gap) => ({
    ...gap,
    reportNodeId: result.reportNodeId,
    taskId: result.taskId,
    status: "open" as const,
  }))).filter((gap) => !isSoftCountedRowGap(gap, countedRows.rowNodeIds));
  if (countedRows.aggregateGap && !allGaps.some((gap) => gap.description === countedRows.aggregateGap?.description)) {
    allGaps.push(countedRows.aggregateGap);
  }
  const infrastructureGaps = allGaps.filter(isInfrastructureGap);
  const gaps = allGaps.filter((gap) => !isInfrastructureGap(gap));
  if (infrastructureGaps.length > 0) {
    await acknowledgeInfrastructureGaps(ctx, infrastructureGaps);
  }
  await ctx.emit({
    eventType: "reflection_scheduler_started",
    payload: {
      agentRuns: results.length,
      completed: results.filter((result) => result.branchOutcome === "done_here").length,
      failed: results.filter((result) => result.branchOutcome === "failed").length,
      queuedBeforeTaskIds: queuedBefore.filter((task) => task.taskId !== "T_root").map((task) => task.taskId),
      gaps: gaps.length,
      infrastructureGaps: infrastructureGaps.length,
      currentCycle: opts.currentCycle,
      maxCycles: opts.maxCycles,
      atCycleLimit: atCycleLimit(opts),
    },
  });
  let reflection = enforceCycleBudget(
    normalizeReflection(await runReflectionSchedulerAgent(ctx, results, queuedBefore, gaps, opts)),
    gaps,
    opts,
  );
  reflection = await consolidateCountedRowRepairRequests(ctx, reflection, countedRows, queuedBefore, opts);
  // One repair agent per branch per cycle: fold multiple same-node repair
  // requests into a single task so that agent settles every open gap of its
  // branch in one run instead of multiplying identical context across agents.
  reflection = { ...reflection, newTasks: consolidateSameNodeNewTasks(reflection.newTasks ?? []) };
  const createdTasks: TaskItem[] = [];
  const skippedNewTasks: Array<{ request: NewTaskRequest | TaskUpdate; reason: string }> = [];
  let remainingRepairSlots = MAX_REPAIR_TASKS_PER_REFLECTION;
  for (const update of reflection.taskUpdates) {
    if (update.newStatus === "queued") {
      const existingTask = await ctx.stack.ledger.getById(update.taskId);
      if (existingTask && await shouldDeferRepairForReportNode(ctx, existingTask.reportNodeId)) {
        await traceWrite(ctx, "ledger", "skipTaskUpdate", { update, reason: "planned_agent_node_exploration_incomplete" }, { taskId: update.taskId, reportNodeId: existingTask.reportNodeId });
        skippedNewTasks.push({ request: update, reason: "planned_agent_node_exploration_incomplete" });
        continue;
      }
      if (remainingRepairSlots <= 0) {
        await traceWrite(ctx, "ledger", "skipTaskUpdate", { update, reason: "reflection_repair_task_cap_reached" });
        skippedNewTasks.push({ request: update, reason: "reflection_repair_task_cap_reached" });
        continue;
      }
      remainingRepairSlots -= 1;
    }
    const created = await applyTaskUpdate(ctx, update);
    if (created) createdTasks.push(created);
  }
  for (let i = 0; i < reflection.newTasks.length; i++) {
    const req = await routeReflectionTaskRequest(ctx, reflection.newTasks[i]!);
    if (!req) {
      await traceWrite(ctx, "ledger", "skipNewTask", { request: reflection.newTasks[i], reason: "root_report_node_is_not_an_evidence_leaf" }, { reportNodeId: reflection.newTasks[i]?.reportNodeId });
      continue;
    }
    if (await shouldDeferRepairForReportNode(ctx, req.reportNodeId)) {
      await traceWrite(ctx, "ledger", "skipNewTask", { request: req, reason: "planned_agent_node_exploration_incomplete" }, { reportNodeId: req.reportNodeId });
      skippedNewTasks.push({ request: req, reason: "planned_agent_node_exploration_incomplete" });
      continue;
    }
    if (remainingRepairSlots <= 0) {
      await traceWrite(ctx, "ledger", "skipNewTask", { request: req, reason: "reflection_repair_task_cap_reached" }, { reportNodeId: req.reportNodeId });
      skippedNewTasks.push({ request: req, reason: "reflection_repair_task_cap_reached" });
      continue;
    }
    if (!await shouldCreateReflectionTask(ctx, req)) {
      await traceWrite(ctx, "ledger", "skipNewTask", { request: req, reason: "repair_task_cap_reached_for_evidenced_node" }, { reportNodeId: req.reportNodeId });
      skippedNewTasks.push({ request: req, reason: "repair_task_cap_reached_for_evidenced_node" });
      continue;
    }
    const task = taskFromRequest(ctx, req, i + 1);
    await ctx.stack.ledger.upsert(task);
    createdTasks.push(task);
    remainingRepairSlots -= 1;
    await traceWrite(ctx, "ledger", "upsert", { task }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  }
  await acknowledgeSkippedGaps(ctx, gaps, reflection.skipReasons);
  const blockingGapsAfterAcknowledgement = await listUnacknowledgedBlockingGaps(ctx, gaps);
  const synthesisCandidateGaps = mergeGaps([...gaps, ...blockingGapsAfterAcknowledgement]);
  const shouldSynthesizeGapTasks = !atCycleLimit(opts) && (reflection.continueDispatch || blockingGapsAfterAcknowledgement.length > 0);
  if (shouldSynthesizeGapTasks) {
    for (const task of await synthesizeGapTasks(ctx, synthesisCandidateGaps, createdTasks, remainingRepairSlots)) {
      createdTasks.push(task);
    }
  } else {
    await cancelRemainingQueuedAtCycleLimit(ctx);
  }
  await ctx.emit({
    eventType: "cycle_reflection",
    payload: {
      completed: results.filter((result) => result.branchOutcome === "done_here").length,
      gaps: gaps.length,
      infrastructureGaps: infrastructureGaps.length,
      taskUpdates: reflection.taskUpdates,
      newTasks: reflection.newTasks,
      createdTaskIds: createdTasks.map((task) => task.taskId),
      skippedNewTasks,
      repairTaskLimit: MAX_REPAIR_TASKS_PER_REFLECTION,
      skipReasons: reflection.skipReasons,
    },
  });
  const remaining = await ctx.stack.ledger.listByStatus("queued", { limit: 1 });
  const continueDispatch = !atCycleLimit(opts) && (remaining.some((task) => task.taskId !== "T_root") || (reflection.continueDispatch && createdTasks.length > 0));
  await ctx.emit({
    eventType: "reflection_scheduler_finished",
    payload: {
      continueDispatch,
      createdTaskIds: createdTasks.map((task) => task.taskId),
      skippedNewTasks,
      repairTaskLimit: MAX_REPAIR_TASKS_PER_REFLECTION,
      taskUpdates: reflection.taskUpdates,
      newTasks: reflection.newTasks,
      skipReasons: reflection.skipReasons,
    },
  });
  return { continueDispatch };
}

async function acknowledgeInfrastructureGaps(ctx: PhaseContext, gaps: OpenGap[]): Promise<void> {
  const matches = gaps.map((gap) => ({
    reportNodeId: gap.reportNodeId,
    description: gap.description,
    reason: "External provider outage or content-safety response; this is not a research-content gap and should not trigger repair loops.",
  }));
  const acknowledged = await (ctx.stack.kg as { acknowledgeOpenGaps?: (matches: Array<{ reportNodeId?: string; description: string; reason: string }>) => Promise<number> }).acknowledgeOpenGaps?.(matches);
  await traceWrite(ctx, "kg", "acknowledgeInfrastructureGaps", { acknowledged: acknowledged ?? 0, gaps: matches });
}

async function runReflectionSchedulerAgent(
  ctx: PhaseContext,
  results: AgentRunResult[],
  queuedBefore: TaskItem[],
  gaps: OpenGap[],
  opts: CycleReflectionOptions,
): Promise<CycleReflectionJson> {
  const llmCfg = ctx.state.runtimeProfile.llm.reflection;
  const agentCfg = ctx.state.runtimeProfile.agents.reflection;
  const agentRunId = `A_reflection_${String(opts.currentCycle ?? 1).padStart(3, "0")}`;
  const registry = new ReflectionSchedulerToolRegistry(ctx, results, queuedBefore, gaps);
  const writtenBranchDrafts = await listWrittenBranchDrafts(ctx, results.map((result) => result.reportNodeId));
  const runtime = await runAgentRuntime({
    agent: {
      agentId: "reflection_scheduler",
      agentRunId,
      role: "main_dispatcher",
      title: "ReflectionSchedulerAgent",
      objective: "Review the completed evidence-agent batch, identify gaps or duplication, and decide whether to redispatch repair tasks.",
      episodeId: ctx.state.episodeId,
    },
    llm: ctx.stack.llm,
    system: `${CYCLE_REFLECTION_SYSTEM_PROMPT}
You are now operating as a ReAct scheduling agent after all EvidenceAgents in the current batch have settled.
Use inspection tools when you need the current tree, queue, open gaps, evidence, or worker run details.
Do not search the web and do not write the report.
Finish with the reflection scheduler JSON: continueDispatch, taskUpdates, newTasks, skipReasons. Every skipReason must include a qualify/omit disposition, claimSafeWithoutMissingEvidence, and affectedRequirementIds.`,
    context: {
      instruction: "Decide whether the next dispatch cycle should run, which completed tasks need repair follow-ups, which gaps should become new tasks, and which gaps should be explicitly acknowledged instead.",
      dispatchBudget: { currentCycle: opts.currentCycle, maxCycles: opts.maxCycles, atCycleLimit: atCycleLimit(opts) },
      queuedTaskIdsBeforeReflection: queuedBefore.filter((task) => task.taskId !== "T_root").map((task) => task.taskId),
      batchSummary: summarizeAgentResults(results),
      structuredRequirements: ctx.state.globalRubric?.requirements ?? [],
      writtenBranchDrafts,
      gaps,
      rules: [
        "Run only after the whole EvidenceAgent batch is finished.",
        "Review writtenBranchDrafts before creating repair tasks: these are the report sub-branch drafts already written from the agent reportlets.",
        "If a branch draft already covers the assigned scope with citations and only has low-impact caveats, avoid redispatch and acknowledge the caveat when appropriate.",
        "If a branch draft is missing one of the assigned report tasks, has uncited central claims, or leaves a medium/high-impact gap, create one targeted repair task for that report node.",
        `Create at most ${MAX_REPAIR_TASKS_PER_REFLECTION} total new or requeued repair tasks in one reflection cycle, including taskUpdates, newTasks, and synthesized gap tasks.`,
        "Prioritize failed agents, publish-gate errors, high-impact gaps, and unsupported central claims.",
        "Use this order for unresolved evidence: reuse saved/cache evidence first; request at most one bounded targeted repair when it is likely to add material evidence; then qualify or omit when further searching is unlikely to help. Human review is not a default evidence-repair action.",
        "Before stopping, verify every priority=must structured requirement is mapped to a report node and has direct evidence; create a targeted repair task when a mapped must requirement is still ungrounded.",
        "Never invent a numeric method, entity, row, source, or coverage quota. A repair task may use a numeric threshold only when that exact threshold is stated in structuredRequirements, the original task acceptance criteria, or an explicit quality policy. Otherwise ask for the missing category or field without fabricating a count.",
        "Do not create duplicate repair tasks for the same report node unless the second task covers a clearly different blocking issue.",
        "Prefer one targeted repair task per unresolved high-impact gap.",
        "Avoid duplicate tasks for the same report node and same evidence gap.",
        "Acknowledge low-impact caveats and medium-impact residual caveats only when the node already has adequate supporting evidence or the gap text itself says the current task requirements are satisfied.",
        "Medium/high-impact gaps that still affect the central claim should become targeted repair tasks while dispatch budget remains.",
        "If a saved KnowledgeNode is a broad or synthetic source that semantically supports multiple hypothesis report nodes, use link_evidence to add real EvidenceLinks to those nodes. Do this only when the source summary directly supports the target node, and explain the claimText.",
        "At the cycle limit, do not create new work; acknowledge only non-blocking caveats and leave truly blocking medium/high-impact gaps open.",
        "For skipReasons, use disposition=qualify only when cited material remains useful under a narrower claim, and disposition=omit only when removing the unsupported material leaves the rest of the report coherent. Set claimSafeWithoutMissingEvidence=true only for those safe cases.",
        "Use taskUpdates only to mark existing tasks or request a follow-up from completed work.",
      ],
    },
    tools: registry,
    budget: {
      maxReactSteps: Math.max(1, agentCfg?.maxReactSteps ?? 6),
      maxToolCalls: Math.max(0, agentCfg?.maxToolCalls ?? 8),
      targetReactSteps: positiveOptional(agentCfg?.targetReactSteps),
      targetToolCalls: positiveOptional(agentCfg?.targetToolCalls),
    },
    outputSchema: {
      continueDispatch: "boolean",
      taskUpdates: [{ taskId: "string", newStatus: "completed|queued|blocked|failed|cancelled", reason: "string" }],
      newTasks: [{ parentTaskId: "string|null", reportNodeId: "string", title: "string", objective: "string", priority: "number", acceptanceCriteria: ["string"] }],
      skipReasons: [{ gap: "string", reason: "string", disposition: "qualify|omit", claimSafeWithoutMissingEvidence: "boolean", affectedRequirementIds: ["string"] }],
    },
    ...llmCfg,
    historyMaxChars: evidenceRuntimeHistoryMaxChars(),
    outputRepairAttempts: agentCfg?.outputRepairAttempts ?? 1,
    signal: ctx.signal,
    chat: (request) => tracedLlmChat(ctx, "cycle-reflection.react", request, { agentRunId }),
    onVisualEvent: (event) => ctx.emit({
      eventType: "agent_runtime_visual",
      agentRunId: event.actor.agentRunId,
      taskId: event.actor.taskId,
      reportNodeId: event.actor.reportNodeId,
      payload: { visual: event },
    }),
  });
  if (runtime.status === "completed") return object(runtime.finish) as CycleReflectionJson;
  await ctx.emit({
    eventType: "cycle_reflection_parse_repair",
    payload: {
      provider: ctx.stack.llm.name,
      reason: runtime.error ?? `ReflectionSchedulerAgent ended with status=${runtime.status}`,
      fallback: "deterministic_gap_reschedule",
    },
  });
  return reflectionFallback(ctx, queuedBefore, gaps, opts);
}

export async function shouldCreateReflectionTask(ctx: PhaseContext, req: NewTaskRequest): Promise<boolean> {
  if (req.title === "Fill global summary-table row deficit") {
    const existing = (await ctx.stack.ledger.listAll()).filter((task) => task.title === req.title);
    return !await shouldDeferRepairForReportNode(ctx, req.reportNodeId)
      && !existing.some((task) => ["queued", "running"].includes(task.status))
      && existing.length < 3;
  }
  return !await shouldDeferRepairForReportNode(ctx, req.reportNodeId)
    && await hasRepairTaskCapacity(ctx, req.reportNodeId);
}

function consolidateSameNodeNewTasks(requests: NewTaskRequest[]): NewTaskRequest[] {
  const indexByNode = new Map<string, number>();
  const out: NewTaskRequest[] = [];
  for (const req of requests) {
    if (!req.reportNodeId) {
      out.push(req);
      continue;
    }
    const existing = indexByNode.get(req.reportNodeId);
    if (existing === undefined) {
      indexByNode.set(req.reportNodeId, out.length);
      out.push({ ...req });
      continue;
    }
    const base = out[existing]!;
    out[existing] = {
      ...base,
      priority: Math.max(base.priority ?? 0, req.priority ?? 0),
      objective: [base.objective, req.objective].filter(Boolean).join("\nAdditionally: "),
      acceptanceCriteria: [...new Set([...(base.acceptanceCriteria ?? []), ...(req.acceptanceCriteria ?? [])])].slice(0, 12),
    };
  }
  return out;
}

async function hasRepairTaskCapacity(ctx: PhaseContext, reportNodeId: string): Promise<boolean> {
  // One reflection repair agent per report branch: unresolved gaps afterwards
  // are settled by qualify/omit dispositions instead of an unbounded repair
  // chain. Completion-gap repairs (T_completion_*) are exempt: they are the
  // final publish backstop and already bounded by completionRepairCycles.
  const existing = (await ctx.stack.ledger.listByReportNode(reportNodeId))
    .filter((task) => /^(T_reflect_|T_gap_|T_repair_)/.test(task.taskId));
  return existing.length < 1;
}

async function shouldDeferRepairForReportNode(ctx: PhaseContext, reportNodeId: string): Promise<boolean> {
  const existing = await ctx.stack.ledger.listByReportNode(reportNodeId);
  return existing.some((task) => {
    const hasInternalPlan = task.plannedReportlets?.length || task.taskId.startsWith("T_part_");
    return hasInternalPlan && (task.status === "queued" || task.status === "running");
  });
}

async function cancelRemainingQueuedAtCycleLimit(ctx: PhaseContext): Promise<void> {
  const queued = (await ctx.stack.ledger.listByStatus("queued", { limit: 1000 })).filter((task) => task.taskId !== "T_root");
  for (const task of queued) {
    await ctx.stack.ledger.updateStatus(task.taskId, "cancelled", "Dispatch cycle budget exhausted before this queued task could run.");
    await traceWrite(ctx, "ledger", "updateStatus", {
      taskId: task.taskId,
      status: "cancelled",
      reason: "Dispatch cycle budget exhausted before this queued task could run.",
    }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  }
  if (queued.length > 0) {
    await ctx.emit({
      eventType: "cycle_budget_exhausted",
      payload: { cancelledTaskIds: queued.map((task) => task.taskId) },
    });
  }
}

function reflectionFallback(
  ctx: PhaseContext,
  queuedBefore: TaskItem[],
  gaps: OpenGap[],
  opts: CycleReflectionOptions,
): CycleReflectionJson {
  const atLimit = atCycleLimit(opts);
  return {
    continueDispatch: !atLimit && (queuedBefore.some((task) => task.taskId !== "T_root") || gaps.length > 0),
    taskUpdates: [],
    newTasks: [],
    skipReasons: atLimit
      ? gaps.filter((gap) => gap.impact === "low").map((gap) => ({
          gap: gap.description,
          reason: "Dispatch cycle budget is exhausted and this is a low-impact caveat.",
          disposition: gap.recommendedDisposition === "omit" ? "omit" as const : "qualify" as const,
          claimSafeWithoutMissingEvidence: true,
          affectedRequirementIds: gap.affectedRequirementIds ?? [],
        }))
      : isExplicitTestLlm(ctx.stack.llm.name)
      ? gaps.map((gap) => ({ gap: gap.description, reason: "Explicit echo mode leaves gap documented." }))
      : [],
  };
}

async function listWrittenBranchDrafts(ctx: PhaseContext, preferredReportNodeIds: string[]): Promise<Array<{
  reportNodeId: string;
  label: string;
  status: string;
  coverage: unknown;
  draftSummary: string;
  draftMarkdownPreview: string;
  reportletCount: number;
}>> {
  const preferred = new Set(preferredReportNodeIds.filter(Boolean));
  const nodes = await ctx.stack.kg.listReportNodes();
  const candidates = nodes
    .filter((node) => node.draftSummary || node.draftMarkdown)
    .sort((a, b) => {
      const preferredCompare = Number(preferred.has(b.nodeId)) - Number(preferred.has(a.nodeId));
      return preferredCompare || b.updatedAt.localeCompare(a.updatedAt);
    })
    .slice(0, 16);
  const out = [];
  for (const node of candidates) {
    const reportlets = await ctx.stack.kg.listReportlets?.(node.nodeId) ?? [];
    out.push({
      reportNodeId: node.nodeId,
      label: node.label,
      status: node.status,
      coverage: node.coverage,
      draftSummary: node.draftSummary ?? "",
      draftMarkdownPreview: node.draftMarkdown ? truncate(node.draftMarkdown, 1800) : "",
      reportletCount: reportlets.length,
    });
  }
  return out;
}

function isInfrastructureGap(gap: OpenGap): boolean {
  if (gap.gapType === "infrastructure_error") return true;
  if (gap.impact === "low" && /Jina search request failed|Connect Timeout|AbortError|fetch failed|Content Exists Risk|content risk/i.test(gap.description)) return true;
  return false;
}

function enforceCycleBudget(reflection: Required<CycleReflectionJson>, gaps: OpenGap[], opts: CycleReflectionOptions): Required<CycleReflectionJson> {
  if (!atCycleLimit(opts)) return reflection;
  const skipped = new Set(reflection.skipReasons.map((item) => item.gap));
  return {
    continueDispatch: false,
    taskUpdates: reflection.taskUpdates.filter((update) => update.newStatus !== "queued"),
    newTasks: [],
    skipReasons: [
      ...reflection.skipReasons.filter((skip) => {
        const gap = gaps.find((item) => item.description === skip.gap || item.description.includes(skip.gap) || skip.gap.includes(item.description));
        return gap?.impact === "low" || isSafeStructuredDisposition(skip);
      }),
      ...gaps
        .filter((gap) => !skipped.has(gap.description))
        .filter((gap) => gap.impact === "low")
        .map((gap) => ({
          gap: gap.description,
          reason: "Dispatch cycle budget is exhausted and this is a low-impact caveat.",
          disposition: gap.recommendedDisposition === "omit" ? "omit" as const : "qualify" as const,
          claimSafeWithoutMissingEvidence: true,
          affectedRequirementIds: gap.affectedRequirementIds ?? [],
        })),
    ],
  };
}

export async function consolidateCountedRowRepairRequests(
  ctx: PhaseContext,
  reflection: Required<CycleReflectionJson>,
  countedRows: Awaited<ReturnType<typeof consolidateCountedRowGaps>>,
  queuedBefore: TaskItem[],
  opts: CycleReflectionOptions,
): Promise<Required<CycleReflectionJson>> {
  if (!countedRows.aggregateGap || countedRows.remaining <= 0) return reflection;
  const filteredNewTasks = reflection.newTasks.filter((request) => !isRegionalRowQuantityRepair(
    request.reportNodeId,
    `${request.title} ${request.objective} ${request.acceptanceCriteria.join(" ")}`,
    countedRows.rowNodeIds,
  ));
  const filteredUpdates: TaskUpdate[] = [];
  let filteredUpdateCount = 0;
  for (const update of reflection.taskUpdates) {
    if (update.newStatus !== "queued") {
      filteredUpdates.push(update);
      continue;
    }
    const task = await ctx.stack.ledger.getById(update.taskId);
    if (task && isRegionalRowQuantityRepair(task.reportNodeId, `${task.title} ${task.objective} ${update.reason}`, countedRows.rowNodeIds)) {
      filteredUpdateCount += 1;
      continue;
    }
    filteredUpdates.push(update);
  }
  const alreadyQueued = queuedBefore.some((task) => task.title === "Fill global summary-table row deficit")
    || filteredNewTasks.some((task) => task.title === "Fill global summary-table row deficit");
  const target = Math.min(5, countedRows.remaining);
  const globalTask: NewTaskRequest | undefined = atCycleLimit(opts) || alreadyQueued
    ? undefined
    : {
      parentTaskId: "T_root",
      reportNodeId: countedRows.aggregateGap.reportNodeId!,
      title: "Fill global summary-table row deficit",
      objective: `Find ${target} additional distinct eligible primary studies from any geography to reduce the global summary-table deficit. Extract complete row fields and avoid every study already linked to any sibling row batch.`,
      priority: 95,
      acceptanceCriteria: [
        `Aim to contribute about ${target} distinct eligible primary studies from any geography; this is a global repair allocation, not a regional quota. Only the collective minimum of ${countedRows.collectiveMinimum} studies is mandatory.`,
        "For every study, extract Authors, Country, Sample Size, Research Design, Outcome Variable, and Finding on Effectiveness.",
        "Use only eligible primary studies in the requested time window and deduplicate by title or DOI across all row batches.",
        "Save and link each completed row to the assigned report node with an exact citation marker.",
      ],
    };
  const filteredNewTaskCount = reflection.newTasks.length - filteredNewTasks.length;
  const remainingNewTaskSlots = Math.max(0, MAX_REPAIR_TASKS_PER_REFLECTION - filteredUpdates.filter((update) => update.newStatus === "queued").length);
  const prioritizedNewTasks = (globalTask ? [globalTask, ...filteredNewTasks] : filteredNewTasks).slice(0, remainingNewTaskSlots);
  await ctx.emit({
    eventType: "counted_row_repair_tasks_consolidated",
    payload: {
      remaining: countedRows.remaining,
      filteredNewTaskCount,
      filteredUpdateCount,
      globalTaskAdded: prioritizedNewTasks.some((task) => task.title === "Fill global summary-table row deficit"),
    },
  });
  return {
    ...reflection,
    continueDispatch: reflection.continueDispatch || prioritizedNewTasks.length > 0,
    taskUpdates: filteredUpdates,
    newTasks: prioritizedNewTasks,
  };
}

function isRegionalRowQuantityRepair(reportNodeId: string, text: string, rowNodeIds: Set<string>): boolean {
  return rowNodeIds.has(reportNodeId)
    && /\b(?:study|studies|rows?)\b/iu.test(text)
    && /\b(?:additional|more|deficit|reach|target|complete rows?|summary table|Asia|Pacific|Europe|European|Africa|African|Americas|Middle East|cross-regional)\b/iu.test(text);
}

function atCycleLimit(opts: CycleReflectionOptions): boolean {
  return typeof opts.currentCycle === "number" && typeof opts.maxCycles === "number" && opts.currentCycle >= opts.maxCycles;
}

function normalizeReflection(input: CycleReflectionJson): Required<CycleReflectionJson> {
  const queuedUpdates = Array.isArray(input.taskUpdates) ? input.taskUpdates.filter((item) => item.taskId && item.newStatus && item.reason && item.newStatus === "queued") : [];
  const nonQueuedUpdates = Array.isArray(input.taskUpdates) ? input.taskUpdates.filter((item) => item.taskId && item.newStatus && item.reason && item.newStatus !== "queued") : [];
  const taskUpdates = [...queuedUpdates.slice(0, MAX_REPAIR_TASKS_PER_REFLECTION), ...nonQueuedUpdates.slice(0, 10)];
  const remainingNewTaskSlots = Math.max(0, MAX_REPAIR_TASKS_PER_REFLECTION - queuedUpdates.slice(0, MAX_REPAIR_TASKS_PER_REFLECTION).length);
  return {
    continueDispatch: input.continueDispatch ?? true,
    taskUpdates,
    newTasks: Array.isArray(input.newTasks)
      ? input.newTasks.filter((item) => item.reportNodeId && item.title && item.objective).slice(0, remainingNewTaskSlots).map((item) => ({
          ...item,
          priority: typeof item.priority === "number" ? item.priority : 50,
          acceptanceCriteria: item.acceptanceCriteria?.length ? item.acceptanceCriteria : ["Complete the follow-up evidence task."],
        }))
      : [],
    skipReasons: Array.isArray(input.skipReasons) ? input.skipReasons
      .filter((item) => item.gap && item.reason)
      .slice(0, 20)
      .map((item) => ({
        gap: item.gap,
        reason: item.reason,
        disposition: item.disposition === "qualify" || item.disposition === "omit" ? item.disposition : undefined,
        claimSafeWithoutMissingEvidence: item.claimSafeWithoutMissingEvidence === true,
        affectedRequirementIds: Array.isArray(item.affectedRequirementIds)
          ? item.affectedRequirementIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
          : [],
      })) : [],
  };
}

function taskFromRequest(ctx: PhaseContext, req: NewTaskRequest, index = 0): TaskItem {
  const now = isoNow(ctx.now);
  const suffix = uniqueSuffix(`${req.reportNodeId}_${req.title}`, `${req.objective}_${now}_${index}`);
  return {
    taskId: `T_reflect_${suffix}`,
    parentTaskId: req.parentTaskId ?? "T_root",
    reportNodeId: req.reportNodeId,
    title: req.title,
    objective: req.objective,
    status: "queued",
    priority: req.priority,
    branchId: `B_reflect_${suffix}`,
    acceptanceCriteria: req.acceptanceCriteria.length > 0 ? req.acceptanceCriteria : ["Complete the follow-up evidence task."],
    createdAt: now,
    updatedAt: now,
  };
}

async function applyTaskUpdate(ctx: PhaseContext, update: TaskUpdate): Promise<TaskItem | undefined> {
  const task = await ctx.stack.ledger.getById(update.taskId);
  if (!task) {
    await traceWrite(ctx, "ledger", "updateStatusSkipped", { update, reason: "task_not_found" });
    return undefined;
  }
  if (task.status === update.newStatus) {
    await traceWrite(ctx, "ledger", "updateStatusSkipped", { update, reason: "status_already_set" }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    return undefined;
  }
  if (task.status === "completed" && update.newStatus === "queued") {
    const followUp = followUpTaskFromUpdate(ctx, task, update);
    await ctx.stack.ledger.upsert(followUp);
    await traceWrite(ctx, "ledger", "upsert", { task: followUp, sourceUpdate: update }, { taskId: followUp.taskId, reportNodeId: followUp.reportNodeId, branchId: followUp.branchId });
    return followUp;
  }
  if (isTerminalTaskStatus(task.status)) {
    await traceWrite(ctx, "ledger", "updateStatusSkipped", { update, currentStatus: task.status, reason: "illegal_terminal_task_update" }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    return undefined;
  }
  try {
    await ctx.stack.ledger.updateStatus(update.taskId, update.newStatus, update.reason);
    await traceWrite(ctx, "ledger", "updateStatus", { update }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  } catch (err) {
    await traceWrite(ctx, "ledger", "updateStatusSkipped", {
      update,
      currentStatus: task.status,
      reason: "illegal_status_transition",
      error: err instanceof Error ? err.message : String(err),
    }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
  }
  return undefined;
}

function isTerminalTaskStatus(status: TaskItem["status"]): boolean {
  return status === "completed" || status === "cancelled";
}

function followUpTaskFromUpdate(ctx: PhaseContext, original: TaskItem, update: TaskUpdate): TaskItem {
  const now = isoNow(ctx.now);
  const suffix = uniqueSuffix(`${original.reportNodeId}_${original.title}`, `${update.reason}_${now}`);
  return {
    taskId: `T_repair_${suffix}`,
    parentTaskId: original.taskId,
    reportNodeId: original.reportNodeId,
    title: `Repair: ${original.title}`,
    objective: update.reason,
    status: "queued",
    priority: Math.max(original.priority + 5, 80),
    branchId: `B_repair_${suffix}`,
    acceptanceCriteria: [
      update.reason,
      "Resolve the reported evidence gap or explicitly document why it cannot be closed.",
      "Update the report node with stronger evidence, contradiction, or a justified downplay decision.",
    ],
    createdAt: now,
    updatedAt: now,
  };
}

async function synthesizeGapTasks(ctx: PhaseContext, gaps: OpenGap[], createdTasks: TaskItem[], availableSlots: number): Promise<TaskItem[]> {
  if (availableSlots <= 0) return [];
  const skippedDescriptions = new Set((await ctx.stack.kg.listOpenGaps?.() ?? [])
    .filter((gap) => gap.status === "acknowledged")
    .map((gap) => `${gap.reportNodeId ?? ""}:${gap.description}`));
  const existingTasks = await ctx.stack.ledger.listAll();
  const openGaps = gaps
    .filter((gap) => gap.status !== "closed" && gap.reportNodeId && !skippedDescriptions.has(`${gap.reportNodeId}:${gap.description}`))
    .sort((left, right) => (
      reflectionGapAttemptCount(existingTasks, left) - reflectionGapAttemptCount(existingTasks, right)
      || reflectionGapPriority(right) - reflectionGapPriority(left)
      || left.description.localeCompare(right.description)
    ));
  const out: TaskItem[] = [];
  const coveredNodes = new Set(createdTasks.map((task) => task.reportNodeId));
  for (const gap of openGaps) {
    const routedGap = await routeReflectionGap(ctx, gap);
    if (!routedGap?.reportNodeId) {
      await traceWrite(ctx, "ledger", "skipNewTask", { gap, reason: "root_report_node_is_not_an_evidence_leaf" }, { reportNodeId: gap.reportNodeId });
      continue;
    }
    const reportNodeId = routedGap.reportNodeId;
    if (coveredNodes.has(reportNodeId)) continue;
    if (await shouldDeferRepairForReportNode(ctx, reportNodeId)) {
      await traceWrite(ctx, "ledger", "skipNewTask", { gap: routedGap, reason: "planned_agent_node_exploration_incomplete" }, { reportNodeId });
      continue;
    }
    if (!await hasRepairTaskCapacity(ctx, reportNodeId)) {
      await traceWrite(ctx, "ledger", "skipNewTask", { gap: routedGap, reason: "repair_task_cap_reached_for_node" }, { reportNodeId });
      continue;
    }
    const existing = await ctx.stack.ledger.listByReportNode(reportNodeId);
    if (existing.some((task) => ["queued", "running"].includes(task.status) && task.taskId !== "T_root")) continue;
    const task = taskFromGap(ctx, routedGap, existing);
    await ctx.stack.ledger.upsert(task);
    await traceWrite(ctx, "ledger", "upsert", { task, sourceGap: routedGap }, { taskId: task.taskId, reportNodeId: task.reportNodeId, branchId: task.branchId });
    coveredNodes.add(reportNodeId);
    out.push(task);
    if (out.length >= availableSlots) break;
  }
  return out;
}

function reflectionGapAttemptCount(tasks: TaskItem[], gap: OpenGap): number {
  return tasks.filter((task) => (
    /^(T_gap_|T_repair_)/.test(task.taskId)
    && task.reportNodeId === gap.reportNodeId
    && task.objective.includes(gap.description)
  )).length;
}

function reflectionGapPriority(gap: OpenGap): number {
  const impact = gap.impact === "high" ? 30 : gap.impact === "low" ? 0 : 20;
  const deliverable = gap.gapType === "planned_reportlet_not_completed" ? 8 : 0;
  const constraint = /temporal|blocked|citation|language/i.test(gap.gapType) ? 6 : 0;
  return impact + deliverable + constraint;
}

async function routeReflectionTaskRequest(ctx: PhaseContext, req: NewTaskRequest): Promise<NewTaskRequest | undefined> {
  if (req.reportNodeId !== "R_root") return req;
  const node = await bestBranchForText(ctx, `${req.title}\n${req.objective}\n${req.acceptanceCriteria.join("\n")}`);
  if (!node) return undefined;
  const parentTaskId = await latestTaskIdForNode(ctx, node.nodeId);
  await traceWrite(ctx, "ledger", "routeReflectionTask", {
    fromReportNodeId: req.reportNodeId,
    toReportNodeId: node.nodeId,
    request: req,
    reason: "root_reflection_task_routed_to_best_matching_report_branch",
  }, { reportNodeId: node.nodeId });
  return { ...req, reportNodeId: node.nodeId, parentTaskId };
}

async function routeReflectionGap(ctx: PhaseContext, gap: OpenGap): Promise<OpenGap | undefined> {
  if (gap.reportNodeId !== "R_root") return gap;
  const node = await bestBranchForText(ctx, `${gap.gapType}\n${gap.description}\n${gap.suggestedQuery}`);
  if (!node) return undefined;
  await traceWrite(ctx, "ledger", "routeReflectionGap", {
    fromReportNodeId: gap.reportNodeId,
    toReportNodeId: node.nodeId,
    gap,
    reason: "root_gap_routed_to_best_matching_report_branch",
  }, { reportNodeId: node.nodeId });
  return { ...gap, reportNodeId: node.nodeId };
}

async function bestBranchForText(ctx: PhaseContext, text: string): Promise<{ nodeId: string } | undefined> {
  const nodes = (await ctx.stack.kg.listReportNodes())
    .filter((node) => node.nodeKind === "hypothesis")
    .filter((node) => node.status !== "pruned" && node.status !== "downplayed");
  if (nodes.length === 0) return undefined;
  const lower = text.toLowerCase();
  return nodes
    .map((node) => ({ nodeId: node.nodeId, score: reflectionBranchScore(lower, node), weakness: reflectionWeaknessScore(node) }))
    .sort((a, b) => b.score - a.score || b.weakness - a.weakness)[0];
}

function reflectionBranchScore(text: string, node: { nodeId: string; label: string; scopeNote?: string; hypothesis?: { statement?: string; researchBrief?: string; evidenceGuidance?: string } }): number {
  const fields = [node.nodeId, node.label, node.scopeNote, node.hypothesis?.statement, node.hypothesis?.researchBrief, node.hypothesis?.evidenceGuidance]
    .filter((value): value is string => Boolean(value));
  let score = 0;
  for (const field of fields) {
    for (const token of reflectionTokens(field.toLowerCase())) {
      if (token.length >= 2 && text.includes(token)) score += token.length > 4 ? 2 : 1;
    }
  }
  return score;
}

function reflectionTokens(text: string): string[] {
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

function reflectionWeaknessScore(node: { status: string; coverage?: { supportingCount?: number } }): number {
  const statusScore: Record<string, number> = {
    planned: 8,
    researching: 7,
    needs_review: 6,
    needs_repair: 6,
    insufficient_evidence: 5,
    partially_supported: 4,
    contradicted: 4,
    supported: 1,
    verified: 0,
  };
  return (statusScore[node.status] ?? 0) + Math.max(0, 4 - (node.coverage?.supportingCount ?? 0));
}

async function latestTaskIdForNode(ctx: PhaseContext, reportNodeId: string): Promise<string> {
  const tasks = await ctx.stack.ledger.listByReportNode(reportNodeId);
  const latest = tasks
    .filter((task) => task.taskId !== "T_root")
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))[0];
  return latest?.taskId ?? "T_root";
}

async function acknowledgeSkippedGaps(
  ctx: PhaseContext,
  gaps: OpenGap[],
  skipReasons: ReflectionGapDisposition[],
): Promise<void> {
  if (skipReasons.length === 0) return;
  const storedGaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const supportByNode = supportCountByNode(evidenceLinks);
  const matches: Array<{ reportNodeId?: string; description: string; reason: string } | undefined> = skipReasons.map((skip) => {
    const gap = [...storedGaps, ...gaps].find((item) => item.description === skip.gap || item.description.includes(skip.gap) || skip.gap.includes(item.description));
    if (gap && !canAcknowledgeReflectionGap(gap, supportByNode.get(gap.reportNodeId ?? "") ?? 0, skip)) return undefined;
    return {
      reportNodeId: gap?.reportNodeId,
      description: gap?.description ?? skip.gap,
      reason: skip.reason,
    };
  });
  const validMatches = matches.filter((item): item is { reportNodeId?: string; description: string; reason: string } => Boolean(item));
  const acknowledged = await (ctx.stack.kg as { acknowledgeOpenGaps?: (matches: Array<{ reportNodeId?: string; description: string; reason: string }>) => Promise<number> }).acknowledgeOpenGaps?.(validMatches);
  if (acknowledged) {
    await traceWrite(ctx, "kg", "acknowledgeOpenGaps", { acknowledged, skipReasons });
    await ctx.emit({ eventType: "gap_skipped", payload: { acknowledged, skipReasons } });
  }
}

async function listUnacknowledgedBlockingGaps(ctx: PhaseContext, batchGaps: OpenGap[]): Promise<OpenGap[]> {
  const stored = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const storedStatus = new Map(stored.map((gap) => [`${gap.reportNodeId ?? ""}:${gap.description}`, gap.status]));
  return mergeGaps([...batchGaps, ...stored]).filter((gap) => {
    if (!gap.reportNodeId) return false;
    const status = storedStatus.get(`${gap.reportNodeId}:${gap.description}`) ?? gap.status;
    return status === "open" && (gap.impact ?? "medium") !== "low";
  });
}

function mergeGaps(gaps: OpenGap[]): OpenGap[] {
  const out = new Map<string, OpenGap>();
  for (const gap of gaps) {
    const key = `${gap.reportNodeId ?? ""}:${gap.description}`;
    const existing = out.get(key);
    if (!existing) {
      out.set(key, gap);
      continue;
    }
    out.set(key, {
      ...existing,
      ...gap,
      impact: highestImpact(existing.impact, gap.impact),
      status: existing.status === "open" || gap.status === "open" ? "open" : gap.status ?? existing.status,
      suggestedQuery: gap.suggestedQuery || existing.suggestedQuery,
      taskId: gap.taskId || existing.taskId,
    });
  }
  return [...out.values()];
}

function highestImpact(a: OpenGap["impact"] | undefined, b: OpenGap["impact"] | undefined): OpenGap["impact"] {
  const rank = { low: 0, medium: 1, high: 2 };
  const av = a ?? "medium";
  const bv = b ?? "medium";
  return rank[bv] > rank[av] ? bv : av;
}

function supportCountByNode(evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>): Map<string, number> {
  const out = new Map<string, number>();
  for (const link of evidenceLinks) {
    if (link.relation !== "supports") continue;
    out.set(link.reportNodeId, (out.get(link.reportNodeId) ?? 0) + 1);
  }
  return out;
}

function canAcknowledgeReflectionGap(gap: OpenGap, supportingCount: number, disposition: ReflectionGapDisposition): boolean {
  if (gap.impact === "low") return true;
  if (gap.impact === "high") return false;
  if (isSafeStructuredDisposition(disposition)) return supportingCount >= 1 || disposition.disposition === "omit";
  const text = `${gap.description}\n${disposition.reason}`;
  if (/已满足当前任务要求|任务要求.*已满足|不影响.*结论|非阻塞|可作为.*限制|caveat|not required for the central conclusion/i.test(text)) {
    return supportingCount >= 1;
  }
  return false;
}

function isSafeStructuredDisposition(disposition: ReflectionGapDisposition): boolean {
  return disposition.claimSafeWithoutMissingEvidence === true
    && (disposition.disposition === "qualify" || disposition.disposition === "omit");
}

function taskFromGap(ctx: PhaseContext, gap: OpenGap, existingTasks: TaskItem[] = []): TaskItem {
  const now = isoNow(ctx.now);
  const label = `${gap.reportNodeId}_${gap.gapType}`;
  const existing = new Set(existingTasks.map((task) => task.taskId));
  let attempt = 1;
  let suffix = uniqueSuffix(label, `${gap.description}_attempt_${attempt}`);
  while (existing.has(`T_gap_${suffix}`)) {
    attempt += 1;
    suffix = uniqueSuffix(label, `${gap.description}_attempt_${attempt}`);
  }
  const sourceTask = gap.taskId ? existingTasks.find((task) => task.taskId === gap.taskId) : undefined;
  const partId = gap.gapType === "planned_reportlet_not_completed"
    ? gap.description.match(/(?:报告任务|report\s+part)\s+([A-Za-z0-9_-]+)/iu)?.[1]
    : undefined;
  const sourcePlans = sourceTask?.plannedReportlets?.length
    ? sourceTask.plannedReportlets
    : sourceTask?.plannedReportlet ? [sourceTask.plannedReportlet] : [];
  const plannedReportlet = partId ? sourcePlans.find((plan) => plan.partId === partId) : undefined;
  return {
    taskId: `T_gap_${suffix}`,
    parentTaskId: gap.taskId ?? "T_root",
    reportNodeId: gap.reportNodeId!,
    title: `Close evidence gap: ${gap.gapType}`,
    objective: `${gap.description}\nSuggested query: ${gap.suggestedQuery}`,
    requirementIds: gap.affectedRequirementIds?.length ? [...gap.affectedRequirementIds] : sourceTask?.requirementIds,
    plannedReportlet: plannedReportlet ? structuredClone(plannedReportlet) : undefined,
    status: "queued",
    priority: gap.impact === "high" ? 95 : gap.impact === "low" ? 70 : 85,
    branchId: `B_gap_${suffix}`,
    acceptanceCriteria: [
      "Find additional evidence that directly resolves the open gap.",
      "If the gap cannot be closed, provide a grounded reason and mark the related claim as downplayed or insufficient evidence.",
    ],
    createdAt: now,
    updatedAt: now,
  };
}

function uniqueSuffix(label: string, discriminator: string): string {
  const readable = shortId(label).slice(0, 40);
  const hash = createHash("sha1").update(`${label}\n${discriminator}`).digest("hex").slice(0, 10);
  return `${readable}_${hash}`;
}

const reflectionSchedulerTools: ToolDefinition[] = [
  { toolName: "list_report_tree", description: "List current report nodes with status and coverage." },
  { toolName: "list_queued_tasks", description: "List queued tasks before the reflection decision." },
  { toolName: "list_open_gaps", description: "List open gaps from the completed batch and knowledge graph." },
  { toolName: "list_cycle_agent_results", description: "List summarized EvidenceAgent outputs from the just-completed batch." },
  { toolName: "list_relevant_evidence", description: "List evidence links and source summaries for a report node." },
  { toolName: "link_evidence", description: "Create a real EvidenceLink from an existing KnowledgeNode to a semantically supported hypothesis report node." },
];

class ReflectionSchedulerToolRegistry implements ToolRegistry {
  constructor(
    private readonly ctx: PhaseContext,
    private readonly results: AgentRunResult[],
    private readonly queuedBefore: TaskItem[],
    private readonly batchGaps: OpenGap[],
  ) {}

  listTools(): ToolDefinition[] {
    return reflectionSchedulerTools;
  }

  async invoke(req: ToolCallRequest): Promise<ToolCallResult> {
    const startedAt = Date.now();
    try {
      switch (req.toolName) {
        case "list_report_tree":
          return ok(req.toolName, startedAt, await this.listReportTree());
        case "list_queued_tasks":
          return ok(req.toolName, startedAt, this.queuedBefore.filter((task) => task.taskId !== "T_root"));
        case "list_open_gaps":
          return ok(req.toolName, startedAt, {
            batchGaps: this.batchGaps,
            storedGaps: await this.ctx.stack.kg.listOpenGaps?.() ?? [],
          });
        case "list_cycle_agent_results":
          return ok(req.toolName, startedAt, summarizeAgentResults(this.results));
        case "list_relevant_evidence":
          return ok(req.toolName, startedAt, await this.listRelevantEvidence(req));
        case "link_evidence":
          return ok(req.toolName, startedAt, await this.linkEvidence(req));
        default:
          return fail(req.toolName, startedAt, `Tool is not available in ReflectionSchedulerAgent: ${req.toolName}`);
      }
    } catch (err) {
      return fail(req.toolName, startedAt, err instanceof Error ? err.message : String(err));
    }
  }

  private async listReportTree(): Promise<unknown> {
    return (await this.ctx.stack.kg.listReportNodes()).map((node) => ({
      nodeId: node.nodeId,
      parentNodeId: node.parentNodeId,
      nodeKind: node.nodeKind,
      label: node.label,
      status: node.status,
      coverage: node.coverage,
      draftSummary: node.draftSummary,
      draftMarkdownPreview: node.draftMarkdown ? truncate(node.draftMarkdown, 1200) : undefined,
    }));
  }

  private async listRelevantEvidence(req: ToolCallRequest): Promise<unknown> {
    const ids = requestedReportNodeIds(req.args);
    const links = ids.length
      ? (await Promise.all(ids.map((id) => this.ctx.stack.kg.listEvidenceLinks(id)))).flat()
      : (await this.ctx.stack.kg.listEvidenceLinks()).slice(0, 80);
    const reportlets = this.ctx.stack.kg.listReportlets
      ? ids.length
        ? (await Promise.all(ids.map((id) => this.ctx.stack.kg.listReportlets?.(id) ?? []))).flat()
        : (await this.ctx.stack.kg.listReportlets()).slice(0, 40)
      : [];
    const out = [];
    for (const link of links) {
      const knowledge = await this.ctx.stack.kg.getKnowledgeNode(link.knowledgeNodeId);
      out.push({
        link,
        knowledge: knowledge
          ? {
              nodeId: knowledge.nodeId,
              title: knowledge.title,
              url: knowledge.url,
              sourceTier: knowledge.sourceTier,
              qualityScore: knowledge.qualityScore,
              summary: knowledge.summary,
            }
          : null,
      });
    }
    return { evidence: out, reportlets };
  }

  private async linkEvidence(req: ToolCallRequest): Promise<unknown> {
    const args = object(req.args);
    const reportNodeId = requiredString(args.reportNodeId, "reportNodeId");
    const knowledgeNodeId = requiredString(args.knowledgeNodeId, "knowledgeNodeId");
    const node = await this.ctx.stack.kg.getReportNode(reportNodeId);
    if (!node) throw new Error(`ReportNode not found: ${reportNodeId}`);
    if (node.nodeKind !== "hypothesis") throw new Error(`link_evidence target must be a hypothesis report node: ${reportNodeId}`);
    const knowledge = await this.ctx.stack.kg.getKnowledgeNode(knowledgeNodeId);
    if (!knowledge) throw new Error(`KnowledgeNode not found: ${knowledgeNodeId}`);
    const existing = await this.ctx.stack.kg.listEvidenceLinks(reportNodeId);
    const duplicate = existing.find((link) => link.knowledgeNodeId === knowledgeNodeId);
    if (duplicate) return { evidenceLinkId: duplicate.linkId, link: duplicate, reused: true };
    const relation = relationOr(args.relation);
    const link: EvidenceLink = {
      linkId: stringOrUndefined(args.linkId) ?? `E_reflect_${uniqueSuffix(reportNodeId, knowledgeNodeId)}`,
      reportNodeId,
      knowledgeNodeId,
      relation,
      claimText: requiredString(args.claimText, "claimText"),
      confidence: clamp01(numberOr(args.confidence, 0.55)),
      createdByTaskId: "T_reflection_link_evidence",
      createdAt: isoNow(this.ctx.now),
    };
    await this.ctx.stack.kg.upsertEvidenceLink(link);
    await traceWrite(this.ctx, "kg", "upsertEvidenceLink", { link, source: "reflection_scheduler" }, { reportNodeId });
    return { evidenceLinkId: link.linkId, link, reused: false };
  }
}

function summarizeAgentResults(results: AgentRunResult[]): unknown[] {
  return results.map((result) => ({
    agentRunId: result.agentRunId,
    taskId: result.taskId,
    reportNodeId: result.reportNodeId,
    branchOutcome: result.branchOutcome,
    knowledgeNodeIds: result.knowledgeNodeIds,
    evidenceLinkIds: result.evidenceLinkIds,
    reportletIds: result.reportletIds ?? [],
    nodeUpdates: result.nodeUpdates,
    openGaps: result.openGaps,
    structurePatchSuggestions: result.structurePatchSuggestions,
    turnSummary: result.turnSummary,
  }));
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const out = stringOrUndefined(value);
  if (!out) throw new Error(`${field} is required`);
  return out;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function relationOr(value: unknown): EvidenceLink["relation"] {
  return ["supports", "contradicts", "qualifies", "background"].includes(String(value))
    ? String(value) as EvidenceLink["relation"]
    : "supports";
}

function positiveOptional(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function requestedReportNodeIds(args: unknown): string[] {
  const raw = object(args);
  const ids = [
    stringOrUndefined(raw.reportNodeId),
    stringOrUndefined(raw.nodeId),
    ...(Array.isArray(raw.reportNodeIds) ? raw.reportNodeIds.map(stringOrUndefined) : []),
    ...(Array.isArray(raw.nodeIds) ? raw.nodeIds.map(stringOrUndefined) : []),
  ].filter((value): value is string => Boolean(value));
  return Array.from(new Set(ids));
}

function ok(toolName: string, startedAt: number, output: unknown): ToolCallResult {
  return { toolName, ok: true, output, durationMs: Date.now() - startedAt };
}

function fail(toolName: string, startedAt: number, error: string): ToolCallResult {
  return { toolName, ok: false, error, durationMs: Date.now() - startedAt };
}
