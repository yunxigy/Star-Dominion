import { describe, expect, it } from "vitest";
import type { EvidenceLink, KnowledgeNode, ReportNode, ResearchRequirement, TaskItem } from "@deepresearch/contracts";
import { applyAdaptiveStopIfSafe, cancelRepeatedExternallyBlockedRepairs, cancelRepeatedLowYieldRepairs, captureResearchGainSnapshot } from "../budget.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";

describe("adaptive research budget", () => {
  it("cancels only low-yield exploratory work after quality and requirements are satisfied", async () => {
    const ctx = await fixture(true);
    ctx.state.cycleGains = [plateauGain(1), plateauGain(2)];
    await ctx.stack.ledger.upsert(task("T_exploratory_extra"));

    const stopped = await applyAdaptiveStopIfSafe(ctx, 2, await captureResearchGainSnapshot(ctx));

    expect(stopped).toBe(true);
    expect((await ctx.stack.ledger.getById("T_exploratory_extra"))?.status).toBe("cancelled");
    expect(ctx.state.adaptiveStop).toMatchObject({ stopped: true, cycle: 2, cancelledTaskIds: ["T_exploratory_extra"] });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({ eventType: "adaptive_budget_stopped" }));
  });

  it("defers plateau stopping while evidence quality, must coverage, or node state still blocks", async () => {
    const ctx = await fixture(false);
    ctx.state.cycleGains = [plateauGain(1), plateauGain(2)];
    await ctx.stack.ledger.upsert(task("T_missing_evidence"));

    const stopped = await applyAdaptiveStopIfSafe(ctx, 2, await captureResearchGainSnapshot(ctx));

    expect(stopped).toBe(false);
    expect((await ctx.stack.ledger.getById("T_missing_evidence"))?.status).toBe("queued");
    expect(ctx.state.adaptiveStop).toBeUndefined();
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({
      eventType: "adaptive_budget_plateau_deferred",
      payload: expect.objectContaining({ reason: "quality_or_repair_gate_still_requires_work" }),
    }));
  });

  it("never cancels explicit repair tasks even when the evidence audit is already clean", async () => {
    const ctx = await fixture(true);
    ctx.state.cycleGains = [plateauGain(1), plateauGain(2)];
    await ctx.stack.ledger.upsert(task("T_publish_repair_report_integrity"));

    expect(await applyAdaptiveStopIfSafe(ctx, 2)).toBe(false);
    expect((await ctx.stack.ledger.getById("T_publish_repair_report_integrity"))?.status).toBe("queued");
  });

  it("stops a third repair attempt after two attempts confirm an external data blocker", async () => {
    const ctx = await fixture(false);
    if (!ctx.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    ctx.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.ledger.upsert({ ...task("T_repair_first"), status: "completed" });
    await ctx.stack.ledger.upsert(task("T_completion_gap_dataset"));
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_repair_first",
      gapType: "data_access",
      impact: "high",
      status: "open",
      description: "The microdata is not publicly accessible without registration and login.",
      suggestedQuery: "Find a public dataset mirror.",
    });

    const cancelled = await cancelRepeatedExternallyBlockedRepairs(ctx, 3);

    expect(cancelled).toEqual(["T_completion_gap_dataset"]);
    expect((await ctx.stack.ledger.getById("T_completion_gap_dataset"))?.status).toBe("cancelled");
    expect(ctx.state.adaptiveStop).toMatchObject({ stopped: true, cycle: 3 });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({ eventType: "repeated_external_blocker_repairs_cancelled" }));
  });

  it("keeps a first repair attempt or a repair without a confirmed external blocker", async () => {
    const ctx = await fixture(false);
    if (!ctx.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    ctx.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.ledger.upsert(task("T_completion_gap_evidence"));
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_original",
      gapType: "missing_evidence",
      impact: "high",
      status: "open",
      description: "A stronger authoritative source should be searched.",
      suggestedQuery: "Find an authoritative source.",
    });

    expect(await cancelRepeatedExternallyBlockedRepairs(ctx, 3)).toEqual([]);
    expect((await ctx.stack.ledger.getById("T_completion_gap_evidence"))?.status).toBe("queued");
  });

  it("keeps a global counted-row harvest despite another source blocker on the same leaf", async () => {
    const ctx = await fixture(false);
    if (!ctx.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    ctx.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.ledger.upsert({ ...task("T_completion_gap_pdf"), status: "completed" });
    await ctx.stack.ledger.upsert({
      ...task("T_reflect_global_rows"),
      acceptanceCriteria: [
        "Aim to contribute about 5 distinct eligible primary studies from any geography; this is a global repair allocation.",
        "Only the collective minimum of 15 studies is mandatory.",
      ],
    });
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_completion_gap_pdf",
      gapType: "incomplete_extraction",
      impact: "medium",
      status: "open",
      description: "One PDF could not be fetched from its publisher.",
      suggestedQuery: "Find different eligible studies from any geography.",
    });

    expect(await cancelRepeatedExternallyBlockedRepairs(ctx, 4)).toEqual([]);
    expect((await ctx.stack.ledger.getById("T_reflect_global_rows"))?.status).toBe("queued");
  });

  it("stops repair work queued for a fourth global cycle after two attempts and no outcome gain", async () => {
    const ctx = await fixture(false);
    if (!ctx.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    ctx.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    ctx.state.cycleGains = [{
      ...plateauGain(3),
      knowledgeNodeGain: 1,
      evidenceLinkGain: 4,
      completedTaskGain: 3,
    }];
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.ledger.upsert({ ...task("T_reflect_first"), status: "completed" });
    await ctx.stack.ledger.upsert(task("T_completion_gap_third"));
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_reflect_first",
      gapType: "missing_evidence",
      impact: "medium",
      status: "open",
      description: "The leaf still lacks an independently corroborated method.",
      suggestedQuery: "Find another primary source.",
    });

    const cancelled = await cancelRepeatedLowYieldRepairs(ctx, 4);

    expect(cancelled).toEqual(["T_completion_gap_third"]);
    expect((await ctx.stack.ledger.getById("T_completion_gap_third"))?.status).toBe("cancelled");
    expect(ctx.state.adaptiveStop).toMatchObject({ stopped: true, cycle: 4, cancelledTaskIds: ["T_completion_gap_third"] });
    const gaps = await ctx.stack.kg.listOpenGaps?.("R_leaf");
    expect(gaps).toEqual([expect.objectContaining({ status: "open", description: expect.stringContaining("independently corroborated") })]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({ eventType: "repeated_low_yield_repairs_cancelled" }));
  });

  it("keeps low-yield repair work when only the initial attempt finished or quality just improved", async () => {
    const firstRepair = await fixture(false);
    if (!firstRepair.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    firstRepair.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    firstRepair.state.cycleGains = [plateauGain(3)];
    await firstRepair.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await firstRepair.stack.ledger.upsert(task("T_completion_gap_first"));
    await firstRepair.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_original",
      gapType: "missing_evidence",
      impact: "medium",
      status: "open",
      description: "One targeted repair may still resolve the gap.",
      suggestedQuery: "Find a targeted source.",
    });
    expect(await cancelRepeatedLowYieldRepairs(firstRepair, 4)).toEqual([]);
    expect((await firstRepair.stack.ledger.getById("T_completion_gap_first"))?.status).toBe("queued");

    const improving = await fixture(false);
    if (!improving.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    improving.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    improving.state.cycleGains = [{ ...plateauGain(3), evidenceQualityScoreGain: 1 }];
    await improving.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await improving.stack.ledger.upsert({ ...task("T_reflect_first"), status: "completed" });
    await improving.stack.ledger.upsert({ ...task("T_completion_gap_second"), status: "completed" });
    await improving.stack.ledger.upsert(task("T_completion_gap_fourth"));
    await improving.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_completion_gap_second",
      gapType: "missing_evidence",
      impact: "medium",
      status: "open",
      description: "Quality improved and another repair may still be worthwhile.",
      suggestedQuery: "Continue targeted research.",
    });
    expect(await cancelRepeatedLowYieldRepairs(improving, 4)).toEqual([]);
    expect((await improving.stack.ledger.getById("T_completion_gap_fourth"))?.status).toBe("queued");
  });

  it("keeps a global counted-row harvest through the late-cycle low-yield preflight", async () => {
    const ctx = await fixture(false);
    if (!ctx.state.runtimeProfile.phases.dispatchEvidence) throw new Error("dispatch config required");
    ctx.state.runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    ctx.state.cycleGains = [plateauGain(3)];
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.ledger.upsert({ ...task("T_reflect_first"), status: "completed" });
    await ctx.stack.ledger.upsert({
      ...task("T_reflect_global_rows"),
      acceptanceCriteria: [
        "Aim to contribute about 5 distinct eligible primary studies from any geography; this is a global repair allocation.",
        "Only the collective minimum of 15 studies is mandatory.",
      ],
    });
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_reflect_first",
      gapType: "counted_rows_remaining",
      impact: "medium",
      status: "open",
      description: "The table still needs 11 complete study rows.",
      suggestedQuery: "Find distinct eligible primary studies.",
    });

    expect(await cancelRepeatedLowYieldRepairs(ctx, 4)).toEqual([]);
    expect((await ctx.stack.ledger.getById("T_reflect_global_rows"))?.status).toBe("queued");
  });

  it("does not regenerate completion repairs after a low-yield adaptive stop", async () => {
    const ctx = await fixture(false);
    ctx.state.adaptiveStop = {
      stopped: true,
      reason: "Repeated automatic repairs stopped improving evidence quality or requirement coverage; preserved unresolved gaps for human review.",
      cycle: 4,
      cancelledTaskIds: ["T_completion_gap_cancelled"],
    };
    await ctx.stack.ledger.upsert({ ...task("T_original"), status: "completed" });
    await ctx.stack.kg.addOpenGap?.({
      reportNodeId: "R_leaf",
      taskId: "T_original",
      gapType: "missing_evidence",
      impact: "medium",
      status: "open",
      description: "The stopped leaf still has an unresolved evidence gap.",
      suggestedQuery: "Find another primary source.",
    });

    const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: true });

    expect(decision).toMatchObject({ decision: "need_more_work", newTasks: [] });
    expect((await ctx.stack.ledger.listByStatus("queued")).filter((item) => item.taskId !== "T_root")).toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({ eventType: "completion_repair_suppressed_by_adaptive_stop" }));
  });
});

async function fixture(grounded: boolean) {
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.adaptiveBudget = {
    enabled: true,
    minDispatchCycles: 2,
    plateauWindow: 2,
    minKnowledgeNodeGain: 1,
    minEvidenceLinkGain: 1,
    minQualityScoreGain: 0.5,
  };
  const ctx = createPhaseContext({ sessionId: "S_adaptive", userInput: "Evaluate the must requirement." }, {
    runtimeProfile,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = grounded ? "EP_adaptive_safe" : "EP_adaptive_blocked";
  const requirement: ResearchRequirement = {
    requirementId: "RQ_MUST",
    description: "Evaluate the must requirement.",
    kind: "question",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: ["Independent authoritative evidence"],
    successCriteria: ["The claim is evaluated"],
  };
  ctx.state.globalRubric = {
    rubricId: "RB_adaptive",
    episodeId: ctx.state.episodeId,
    rubricText: "Evaluate the must requirement.",
    outputHints: { language: "en", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = node("R_root", "root", null, "planned");
  const aspect = node("R_aspect", "aspect", root.nodeId, "planned");
  const leaf = node("R_leaf", "hypothesis", aspect.nodeId, grounded ? "supported" : "needs_repair");
  ctx.state.rootNode = root;
  for (const item of [root, aspect, leaf]) await ctx.stack.kg.upsertReportNode(item);
  if (grounded) {
    const sources = [
      source("K_official", "https://agency.gov.example/data", "official"),
      source("K_primary", "https://research.example/study", "primary"),
    ];
    for (const item of sources) await ctx.stack.kg.upsertKnowledgeNode(item);
    await ctx.stack.kg.upsertEvidenceLink(link("E_official", sources[0]!.nodeId, "supports"));
    await ctx.stack.kg.upsertEvidenceLink(link("E_primary", sources[1]!.nodeId, "qualifies"));
  }
  return ctx;
}

function node(nodeId: string, nodeKind: ReportNode["nodeKind"], parentNodeId: string | null, status: ReportNode["status"]): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    label: nodeId,
    scopeNote: nodeId,
    status,
    requirementIds: ["RQ_MUST"],
    hypothesis: nodeKind === "hypothesis" ? { statement: nodeId, researchBrief: nodeId, evidenceGuidance: nodeId } : undefined,
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function source(nodeId: string, url: string, sourceTier: KnowledgeNode["sourceTier"]): KnowledgeNode {
  return {
    nodeId,
    nodeType: "WebPage",
    title: nodeId,
    url,
    summary: "Direct substantive evidence for the must requirement.",
    contentHash: `hash_${nodeId}`,
    sourceTier,
    qualityScore: 0.9,
    retrievedByTaskId: "T_evidence",
    retrievedAt: "2026-07-14T00:00:00.000Z",
    metadata: { contentPreview: "Fetched full source content." },
  };
}

function link(linkId: string, knowledgeNodeId: string, relation: EvidenceLink["relation"]): EvidenceLink {
  return {
    linkId,
    reportNodeId: "R_leaf",
    knowledgeNodeId,
    relation,
    claimText: "Direct evidence addresses the requirement.",
    confidence: 0.9,
    createdByTaskId: "T_evidence",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function task(taskId: string): TaskItem {
  return {
    taskId,
    parentTaskId: "T_root",
    reportNodeId: "R_leaf",
    title: taskId,
    objective: taskId,
    status: "queued",
    priority: 10,
    branchId: `B_${taskId}`,
    acceptanceCriteria: ["Produce an evidence-linked result."],
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function plateauGain(cycle: number) {
  return {
    cycle,
    knowledgeNodeGain: 0,
    evidenceLinkGain: 0,
    completedTaskGain: 0,
    evidenceQualityScoreGain: 0,
    coveredMustRequirementGain: 0,
    activeQualityErrorReduction: 0,
    recordedAt: "2026-07-14T00:00:00.000Z",
  };
}
