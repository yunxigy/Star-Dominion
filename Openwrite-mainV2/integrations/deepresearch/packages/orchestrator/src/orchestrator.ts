import type { EpisodeResult, Orchestrator, OrchestratorOptions, TaskSubmission } from "@deepresearch/contracts";
import type { CheckpointCursor } from "./checkpoint.js";
import { restoreResearchCheckpoint, saveResearchCheckpoint, writeCheckpointFailure } from "./checkpoint.js";
import { completionGatePhase } from "./phases/completion-gate.js";
import { cycleReflectionPhase } from "./phases/cycle-reflection.js";
import { dispatchEvidencePhase } from "./phases/dispatch-evidence.js";
import { architectTreePhase } from "./phases/architect-tree.js";
import { initRootPhase } from "./phases/init-root.js";
import { parsePhase } from "./phases/parse.js";
import { publishGatePhase } from "./phases/publish-gate.js";
import { reportPhase } from "./phases/report.js";
import { rubricPhase } from "./phases/rubric.js";
import { scoutPhase } from "./phases/scout.js";
import { structureReviewPhase } from "./phases/structure-review.js";
import { createPhaseContext } from "./phase-runner.js";
import type { PhaseContext, V5OrchestratorOptions } from "./types.js";
import { applyHumanReviewResponse } from "./human-review-response.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  applyAdaptiveStopIfSafe,
  budgetMetricFields,
  cancelRepeatedExternallyBlockedRepairs,
  cancelRepeatedLowYieldRepairs,
  captureResearchGainSnapshot,
  ProviderBudgetExceededError,
  recordResearchCycleGain,
  writeResearchBudgetAudit,
} from "./budget.js";
import { exportFullTrace, exportSummaryTrace, wantsFullTrace } from "./trace.js";
import { resolveEvidenceQualityPolicy } from "./evidence-quality.js";

export class OrchestratorImpl implements Orchestrator {
  constructor(private readonly opts: V5OrchestratorOptions = {}) {}

  async runEpisode(submission: TaskSubmission, opts: OrchestratorOptions = {}): Promise<EpisodeResult> {
    let ctx: PhaseContext | undefined;
    try {
      if (this.opts.resumeCheckpointPath) {
        const restored = await restoreResearchCheckpoint(this.opts.resumeCheckpointPath, {
          ...this.opts,
          runtimeProfile: opts.runtimeProfile ?? this.opts.runtimeProfile,
        });
        ctx = restored.ctx;
        let cursor = restored.cursor;
        if (this.opts.humanReviewResponse) {
          const applied = await applyHumanReviewResponse(ctx, this.opts.humanReviewResponse);
          if (applied.continueResearch && ctx.state.adaptiveStop?.stopped) {
            const previousAdaptiveStop = ctx.state.adaptiveStop;
            ctx.state.adaptiveStop = undefined;
            await ctx.emit({
              eventType: "adaptive_stop_reset_for_human_review",
              payload: { previousAdaptiveStop },
            });
          }
          cursor = {
            ...cursor,
            stage: applied.continueResearch ? "after_human_review" : "after_structure_review",
            draftPath: undefined,
          };
          await saveResearchCheckpoint(ctx, cursor, this.opts);
        }
        return await runFromCheckpointCursor(ctx, cursor, this.opts);
      }

      ctx = createPhaseContext(submission, {
        ...this.opts,
        episodeId: opts.episodeId ?? this.opts.episodeId,
        runtimeProfile: opts.runtimeProfile ?? this.opts.runtimeProfile,
      });
      const cursor = await runMainPlannerFromCursor(ctx, undefined, this.opts);
      return await runFromCheckpointCursor(ctx, cursor, this.opts);
    } catch (err) {
      if (err instanceof CheckpointPauseError) throw err;
      await writeCheckpointFailure(ctx, err, this.opts);
      if (ctx && err instanceof ProviderBudgetExceededError) return await finalizeProviderBudgetExhaustion(ctx, err);
      throw err;
    }
  }
}

async function finalizeProviderBudgetExhaustion(
  ctx: PhaseContext,
  error: ProviderBudgetExceededError,
): Promise<EpisodeResult> {
  const dir = join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId);
  await mkdir(dir, { recursive: true });
  const reportArtifactPath = join(dir, "budget-exhausted.md");
  const tracePath = join(dir, "trace.jsonl");
  const fullTracePath = wantsFullTrace(ctx) ? join(dir, "trace-full.jsonl") : undefined;
  await ctx.emit({ eventType: "episode_budget_exhausted", payload: { ...error.breach } });
  const budgetAuditPath = await writeResearchBudgetAudit(ctx);
  await writeFile(reportArtifactPath, `# Research budget exhausted

The run stopped before issuing another provider request because a configured hard budget was reached.

- Operation: ${error.breach.operation}
- Provider: ${error.breach.provider}
- Limit: ${error.breach.limit}
- Allowed: ${error.breach.allowed}
- Observed: ${error.breach.observed}
- Phase: ${error.breach.phase}

Resume from the latest checkpoint with an explicitly increased provider budget, or reduce the requested research scope. No quality gate was bypassed.
`, "utf8");
  await writeFile(tracePath, await exportSummaryTrace(ctx), "utf8");
  if (fullTracePath) await writeFile(fullTracePath, await exportFullTrace(ctx), "utf8");
  const reportNodes = await ctx.stack.kg.listReportNodes();
  const knowledgeNodes = await ctx.stack.kg.listKnowledgeNodes();
  const evidenceLinks = await ctx.stack.kg.listEvidenceLinks();
  const tasks = await ctx.stack.ledger.listAll();
  const openGaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
  const result: EpisodeResult = {
    episodeId: ctx.state.episodeId,
    status: "failed",
    reportArtifactPath,
    budgetAuditPath,
    tracePath,
    fullTracePath,
    metrics: {
      reportNodeCount: reportNodes.length,
      knowledgeNodeCount: knowledgeNodes.length,
      evidenceLinkCount: evidenceLinks.length,
      completedTaskCount: tasks.filter((task) => task.status === "completed").length,
      openGapCount: openGaps.filter((gap) => gap.status === "open").length,
      citationCount: evidenceLinks.length,
      rubricIssueCount: 0,
      publishGatePassed: false,
      ...budgetMetricFields(ctx),
    },
    closedAt: new Date(ctx.now()).toISOString(),
  };
  ctx.state.result = result;
  return result;
}

async function runFromCheckpointCursor(ctx: PhaseContext, cursor: CheckpointCursor, opts: V5OrchestratorOptions): Promise<EpisodeResult> {
  const maxCycles = ctx.state.runtimeProfile.phases.dispatchEvidence?.maxCycles;
  if (typeof maxCycles !== "number" || maxCycles < 1) {
    throw new Error("RuntimeProfile.phases.dispatchEvidence.maxCycles must be >= 1");
  }
  const publishRepairMaxCycles = Math.max(0, Math.floor(ctx.state.runtimeProfile.phases.publishGate?.maxCycles ?? 0));
  const completionRepairMaxCycles = Math.max(0, Math.floor(ctx.state.runtimeProfile.phases.completionGate?.maxCycles ?? publishRepairMaxCycles));
  const maxCyclesWithCompletionRepair = maxCycles + completionRepairMaxCycles;
  const maxCyclesWithPublishRepair = maxCyclesWithCompletionRepair + publishRepairMaxCycles;
  let nextCycle = cursor.nextCycle;
  let stage: CheckpointCursor["stage"] | undefined = cursor.stage;
  let pass = cursor.pass;

  if (stage === "after_human_review") {
    nextCycle = await dispatchNextCycle(ctx, nextCycle, nextCycle);
    await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
    stage = "after_dispatch";
  }

  if (stage === "after_rubric" || stage === "after_root" || stage === "after_scout") {
    const next = await runMainPlannerFromCursor(ctx, cursor, opts);
    nextCycle = next.nextCycle;
    pass = next.pass;
    stage = next.stage;
  }

  if (stage === "after_report" && cursor.draftPath) {
    const published = await publishGatePhase(ctx, cursor.draftPath);
    if (published.status === "succeeded") return published;
    if (!(await hasAutoRunnablePublishRepairWork(ctx)) || nextCycle > maxCyclesWithPublishRepair) {
      return await finalizePublishOutcome(ctx, cursor.draftPath);
    }
    nextCycle = await dispatchNextCycle(ctx, nextCycle, maxCyclesWithPublishRepair);
    await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
    stage = "after_dispatch";
  }

  if (stage === "after_main_planner") {
    nextCycle = await dispatchNextCycle(ctx, nextCycle, maxCycles);
    await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
    stage = "after_dispatch";
  }

  const maxAdjustmentPasses = Math.max(
    1,
    maxCyclesWithPublishRepair + Math.max(1, ctx.state.runtimeProfile.phases.structureReview?.maxLlmCalls ?? 1),
  );
  for (; pass <= maxAdjustmentPasses; pass++) {
    const activeMaxCycles = await activeDispatchCycleLimit(ctx, nextCycle, maxCycles, maxCyclesWithCompletionRepair, maxCyclesWithPublishRepair);
    if (stage !== "after_structure_review") {
      await structureReviewPhase(ctx, { allowNewResearchTasks: nextCycle <= activeMaxCycles });
      await checkpoint(ctx, { stage: "after_structure_review", nextCycle, pass }, opts);
    }
    stage = undefined;

    if (await hasQueuedEvidenceWork(ctx)) {
      nextCycle = await dispatchNextCycle(ctx, nextCycle, activeMaxCycles);
      await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
      if (nextCycle <= activeMaxCycles) continue;
    }

    const completionBudget = postEvidenceRepairCycleLimit(maxCyclesWithCompletionRepair);
    const completion = await completionGatePhase(ctx, { final: false, allowRepairTasks: nextCycle <= completionBudget });
    if (completion.decision !== "ready_for_report") {
      const retryMaxCycles = await activeDispatchCycleLimit(ctx, nextCycle, maxCycles, maxCyclesWithCompletionRepair, maxCyclesWithPublishRepair);
      if (await hasQueuedEvidenceWork(ctx) && nextCycle <= retryMaxCycles) {
        nextCycle = await dispatchNextCycle(ctx, nextCycle, retryMaxCycles);
        await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
        continue;
      }
      const finalCompletion = await completionGatePhase(ctx, { allowRepairTasks: false });
      if (finalCompletion.decision !== "ready_for_report") {
        if (finalCompletion.result) return finalCompletion.result;
        throw new Error("completion gate returned need_more_work without a final result");
      }
    }
    const report = await reportPhase(ctx);
    await checkpoint(ctx, { stage: "after_report", nextCycle, pass, draftPath: report.draftPath }, opts);
    const published = await publishGatePhase(ctx, report.draftPath);
    if (published.status === "succeeded") return published;
    if (!(await hasAutoRunnablePublishRepairWork(ctx)) || nextCycle > maxCyclesWithPublishRepair) {
      return await finalizePublishOutcome(ctx, report.draftPath);
    }
    nextCycle = await dispatchNextCycle(ctx, nextCycle, maxCyclesWithPublishRepair);
    await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
  }

  const completionBudget = postEvidenceRepairCycleLimit(maxCyclesWithCompletionRepair);
  const completion = await completionGatePhase(ctx, { final: false, allowRepairTasks: nextCycle <= completionBudget });
  if (completion.decision !== "ready_for_report") {
    while (await hasQueuedEvidenceWork(ctx)) {
      const activeMaxCycles = await activeDispatchCycleLimit(ctx, nextCycle, maxCycles, maxCyclesWithCompletionRepair, maxCyclesWithPublishRepair);
      if (nextCycle > activeMaxCycles) break;
      nextCycle = await dispatchNextCycle(ctx, nextCycle, activeMaxCycles);
      await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
      const afterDispatchBudget = postEvidenceRepairCycleLimit(maxCyclesWithCompletionRepair);
      const afterDispatch = await completionGatePhase(ctx, { final: false, allowRepairTasks: nextCycle <= afterDispatchBudget });
      if (afterDispatch.decision === "ready_for_report") {
        const report = await reportPhase(ctx);
        await checkpoint(ctx, { stage: "after_report", nextCycle, pass, draftPath: report.draftPath }, opts);
        const published = await publishGatePhase(ctx, report.draftPath);
        if (published.status === "succeeded") return published;
        if (!(await hasAutoRunnablePublishRepairWork(ctx)) || nextCycle > maxCyclesWithPublishRepair) {
          return await finalizePublishOutcome(ctx, report.draftPath);
        }
        nextCycle = await dispatchNextCycle(ctx, nextCycle, maxCyclesWithPublishRepair);
        await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
        return await runFromCheckpointCursor(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
      }
    }
    const finalCompletion = await completionGatePhase(ctx, { allowRepairTasks: false });
    if (finalCompletion.decision !== "ready_for_report") {
      if (finalCompletion.result) return finalCompletion.result;
      throw new Error("completion gate returned need_more_work without a final result");
    }
  }
  const report = await reportPhase(ctx);
  await checkpoint(ctx, { stage: "after_report", nextCycle, pass, draftPath: report.draftPath }, opts);
  const published = await publishGatePhase(ctx, report.draftPath);
  if (published.status === "succeeded") return published;
  if (!(await hasAutoRunnablePublishRepairWork(ctx)) || nextCycle > maxCyclesWithPublishRepair) {
    return await finalizePublishOutcome(ctx, report.draftPath);
  }
  nextCycle = await dispatchNextCycle(ctx, nextCycle, maxCyclesWithPublishRepair);
  await checkpoint(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
  return await runFromCheckpointCursor(ctx, { stage: "after_dispatch", nextCycle, pass }, opts);
}

async function finalizePublishOutcome(ctx: PhaseContext, draftPath: string): Promise<EpisodeResult> {
  const allowAutomaticDisposition = resolveEvidenceQualityPolicy(ctx.state.runtimeProfile.evidenceQuality).mode !== "strict";
  if (allowAutomaticDisposition) await cancelPendingPublishRepairTasks(ctx);
  return await publishGatePhase(ctx, draftPath, {
    finalize: true,
    forcePublish: allowAutomaticDisposition,
  });
}

async function cancelPendingPublishRepairTasks(ctx: PhaseContext): Promise<void> {
  const queued = await ctx.stack.ledger.listByStatus("queued", { limit: 100 });
  for (const task of queued) {
    if (!task.taskId.startsWith("T_publish_repair_")) continue;
    await ctx.stack.ledger.upsert({
      ...task,
      status: "cancelled",
      updatedAt: new Date(ctx.now()).toISOString(),
    });
  }
}

async function runMainPlannerFromCursor(
  ctx: PhaseContext,
  cursor: CheckpointCursor | undefined,
  opts: V5OrchestratorOptions,
): Promise<CheckpointCursor> {
  let stage = cursor?.stage;
  if (!stage) {
    await parsePhase(ctx);
    await ctx.emit({
      eventType: "main_planner_started",
      taskId: "T_root",
      reportNodeId: "R_root",
      branchId: "B_main",
      agentRunId: "A_main_planner",
      payload: {
        objective: ctx.state.submission.userInput,
        uiOptions: ctx.state.submission.uiOptions ?? {},
      },
    });
    await rubricPhase(ctx);
    await checkpoint(ctx, { stage: "after_rubric", nextCycle: 1, pass: 1 }, opts);
    stage = "after_rubric";
  }
  if (stage === "after_rubric") {
    await initRootPhase(ctx);
    await checkpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, opts);
    stage = "after_root";
  }
  if (stage === "after_root") {
    await scoutPhase(ctx);
    await checkpoint(ctx, { stage: "after_scout", nextCycle: 1, pass: 1 }, opts);
    stage = "after_scout";
  }
  if (stage === "after_scout") {
    const tree = await architectTreePhase(ctx);
    await ctx.emit({
      eventType: "main_planner_finished",
      taskId: "T_root",
      reportNodeId: "R_root",
      branchId: "B_main",
      agentRunId: "A_main_planner",
      payload: {
        rubricId: ctx.state.globalRubric?.rubricId,
        titleHint: ctx.state.globalRubric?.outputHints.titleHint,
        requirements: ctx.state.globalRubric?.requirements ?? [],
        scoutKnowledgeNodeIds: ctx.state.scoutResult?.knowledgeNodeIds ?? [],
        scoutEvidenceLinkIds: ctx.state.scoutResult?.evidenceLinkIds ?? [],
        reportNodeIds: tree.reportNodes.map((node) => node.nodeId),
        taskIds: tree.tasks.map((task) => task.taskId),
      },
    });
    await checkpoint(ctx, { stage: "after_main_planner", nextCycle: 1, pass: 1 }, opts);
    stage = "after_main_planner";
  }
  if (stage !== "after_main_planner") {
    throw new Error(`Cannot resume main planner from stage=${stage}`);
  }
  return { stage: "after_main_planner", nextCycle: cursor?.nextCycle ?? 1, pass: cursor?.pass ?? 1 };
}

async function checkpoint(ctx: PhaseContext, cursor: CheckpointCursor, opts: V5OrchestratorOptions): Promise<void> {
  const path = await saveResearchCheckpoint(ctx, cursor, opts);
  if (!path) return;
  await ctx.emit({
    eventType: "checkpoint_saved",
    payload: {
      path,
      stage: cursor.stage,
      nextCycle: cursor.nextCycle,
      pass: cursor.pass,
      draftPath: cursor.draftPath,
    },
  });
  if (opts.pauseAfterCheckpoint === cursor.stage) {
    throw new CheckpointPauseError(cursor.stage, path);
  }
}

export class CheckpointPauseError extends Error {
  override readonly name = "CheckpointPauseError";

  constructor(readonly stage: CheckpointCursor["stage"], readonly checkpointPath: string) {
    super(`Paused after checkpoint ${stage}: ${checkpointPath}`);
  }
}

async function dispatchNextCycle(ctx: PhaseContext, startCycle: number, maxCycles: number): Promise<number> {
  let cycle = startCycle;
  if (cycle > maxCycles) return cycle;
  await cancelRepeatedExternallyBlockedRepairs(ctx, cycle);
  await cancelRepeatedLowYieldRepairs(ctx, cycle);
  if (!(await hasQueuedEvidenceWork(ctx))) {
    if (ctx.state.adaptiveStop?.stopped) {
      await ctx.emit({
        eventType: "adaptive_stop_advanced_cycle_limit",
        payload: {
          cycle,
          maxCycles,
          nextCycle: maxCycles + 1,
          adaptiveStop: ctx.state.adaptiveStop,
        },
      });
      return maxCycles + 1;
    }
    return cycle;
  }
  const gainBefore = await captureResearchGainSnapshot(ctx);
  const cycleId = `C_${String(cycle).padStart(3, "0")}`;
  const queuedBefore = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  await ctx.emit({
    eventType: "dispatch_cycle_started",
    payload: { cycleId, cycle, maxCycles, queuedTaskIds: queuedBefore.map((task) => task.taskId) },
  });
  const results = await dispatchEvidencePhase(ctx, cycleId);
  const reflection = await cycleReflectionPhase(ctx, results, { currentCycle: cycle, maxCycles });
  const gainAfter = await captureResearchGainSnapshot(ctx);
  recordResearchCycleGain(ctx, cycle, gainBefore, gainAfter);
  const adaptiveStopped = await applyAdaptiveStopIfSafe(ctx, cycle, gainAfter);
  const queuedAfter = (await ctx.stack.ledger.listByStatus("queued", { limit: 100 }))
    .filter((task) => task.taskId !== "T_root");
  const queuedBeforeIds = new Set(queuedBefore.map((task) => task.taskId));
  const newlyQueuedTaskIds = queuedAfter.map((task) => task.taskId).filter((taskId) => !queuedBeforeIds.has(taskId));
  const atCycleLimit = cycle >= maxCycles;
  const stopReason = adaptiveStopped
    ? "adaptive_plateau_after_quality_satisfied"
    : queuedAfter.length === 0
    ? "no_queued_tasks"
    : atCycleLimit
      ? "cycle_limit_reached"
      : reflection.continueDispatch
        ? "queued_for_next_cycle"
        : "queued_despite_reflection_stop";
  await ctx.emit({
    eventType: "dispatch_cycle_finished",
    payload: {
      cycleId,
      cycle,
      maxCycles,
      agentRuns: results.length,
      continueDispatch: reflection.continueDispatch,
      queuedTaskIds: queuedAfter.map((task) => task.taskId),
      newlyQueuedTaskIds,
      atCycleLimit,
      adaptiveStopped,
      stopReason,
    },
  });
  cycle += 1;
  return cycle;
}

async function hasQueuedEvidenceWork(ctx: PhaseContext): Promise<boolean> {
  const queued = await ctx.stack.ledger.listByStatus("queued", { limit: 2 });
  return queued.some((task) => task.taskId !== "T_root");
}

async function hasAutoRunnablePublishRepairWork(ctx: PhaseContext): Promise<boolean> {
  const queued = await ctx.stack.ledger.listByStatus("queued", { limit: 100 });
  return queued.some((task) =>
    task.taskId.startsWith("T_publish_repair_")
    && task.reportNodeId !== "R_root"
    && task.taskId !== "T_root"
  );
}

async function activeDispatchCycleLimit(
  ctx: PhaseContext,
  nextCycle: number,
  maxCycles: number,
  maxCyclesWithCompletionRepair: number,
  maxCyclesWithPublishRepair: number,
): Promise<number> {
  if (nextCycle <= maxCycles) return maxCycles;
  const queued = await ctx.stack.ledger.listByStatus("queued", { limit: 100 });
  if (queued.some((task) => task.taskId.startsWith("T_publish_repair_") || task.parentTaskId?.startsWith("T_publish_repair_"))) {
    return maxCyclesWithPublishRepair;
  }
  if (queued.some((task) => task.taskId !== "T_root")) return maxCyclesWithCompletionRepair;
  return maxCycles;
}

function postEvidenceRepairCycleLimit(maxCyclesWithCompletionRepair: number): number {
  return maxCyclesWithCompletionRepair;
}

export class InMemoryOrchestrator extends OrchestratorImpl {}

export class SqliteOrchestrator extends OrchestratorImpl {}

export function createInMemoryOrchestrator(opts: V5OrchestratorOptions = {}): InMemoryOrchestrator {
  return new InMemoryOrchestrator(opts);
}

export function createSqliteOrchestrator(opts: V5OrchestratorOptions = {}): SqliteOrchestrator {
  return new SqliteOrchestrator(opts);
}
