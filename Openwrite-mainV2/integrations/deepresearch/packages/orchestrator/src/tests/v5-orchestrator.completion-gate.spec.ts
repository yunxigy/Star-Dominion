import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { KnowledgeNode, LlmChat, OpenGap, SearchProvider } from "@deepresearch/contracts";
import { loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";
import { cycleReflectionPhase } from "../phases/cycle-reflection.js";
import { dispatchEvidencePhase } from "../phases/dispatch-evidence.js";
import { fixedNow, submission, node, task, agentResultWithGap, scriptedEvidenceReact } from "./helpers/v5-orchestrator-fixtures.js";

describe("v5 Orchestrator", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function artifactDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dr-v5-orch-"));
    dirs.push(dir);
    return dir;
  }
  it("blocks completion while active open gaps remain", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "explicit";
    runtimeProfile.evidenceQuality.mode = "strict";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_gap";
    ctx.state.globalRubric = {
      rubricId: "RB_completion",
      episodeId: "EP_completion_gap",
      rubricText: "Rubric",
      outputHints: { titleHint: "Completion", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_gap",
      nodeKind: "hypothesis",
      label: "Gap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_primary_source",
      description: "Needs direct primary-source confirmation.",
      suggestedQuery: "primary source",
      reportNodeId: "R_hyp_gap",
      taskId: "T_done",
      impact: "high",
      status: "open",
    });

    const decision = await completionGatePhase(ctx);

    expect(decision.decision).toBe("need_more_work");
    if (decision.decision === "need_more_work") {
      if (!decision.result) throw new Error("expected final completion gate result");
      expect(decision.result.status).toBe("needs_human_review");
      expect(decision.reason).toContain("open evidence gaps");
    }
  });

  it("auto-skips unresolved completion issues when human review is disabled", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "auto_accept";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_auto_skip";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_auto_skip",
      nodeKind: "hypothesis",
      label: "Unsupported optional branch",
      parentNodeId: "R_root",
      status: "insufficient_evidence",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_direct_evidence",
      description: "No direct evidence was found after the repair budget.",
      suggestedQuery: "direct evidence",
      reportNodeId: "R_hyp_auto_skip",
      taskId: "T_done",
      impact: "high",
      status: "open",
    });

    const decision = await completionGatePhase(ctx);

    expect(decision).toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_auto_skip")).resolves.toMatchObject({ status: "downplayed" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_auto_skip")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "completion_gate_auto_skipped")).toBe(true);
  });

  it("creates gap-specific completion repair tasks for stored blocking gaps", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_gap_specific_repair";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_gap_specific",
      nodeKind: "hypothesis",
      label: "Gap-specific hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 2, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_primary_source",
      description: "Need a direct primary source for the central claim.",
      suggestedQuery: "central claim primary source",
      reportNodeId: "R_hyp_gap_specific",
      taskId: "T_done",
      impact: "medium",
      status: "open",
    });

    const decision = await completionGatePhase(ctx, { final: false });

    expect(decision.decision).toBe("need_more_work");
    const queued = await ctx.stack.ledger.listByStatus("queued");
    const repair = queued.find((task) => task.taskId.startsWith("T_completion_gap_") && task.reportNodeId === "R_hyp_gap_specific");
    expect(repair).toBeTruthy();
    expect(repair?.objective).toContain("Need a direct primary source for the central claim.");
    expect(repair?.objective).toContain("Suggested query: central claim primary source");
  });

  it("does not create completion repair tasks when dispatch budget is exhausted", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_no_budget_repair";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_no_budget",
      nodeKind: "hypothesis",
      label: "No-budget hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_primary_source",
      description: "Need a direct primary source but no dispatch cycles remain.",
      suggestedQuery: "direct primary source",
      reportNodeId: "R_hyp_no_budget",
      taskId: "T_done",
      impact: "medium",
      status: "open",
    });

    const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });

    expect(decision.decision).toBe("need_more_work");
    expect(decision.newTasks).toEqual([]);
    expect(await ctx.stack.ledger.listByStatus("queued")).toEqual([]);
  });

  it("acknowledges residual medium gaps for supported reportlet branches in single-branch debug mode", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.debug = { ...(runtimeProfile.debug ?? {}), singleBranch: true };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_single_branch_medium_gaps";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_debug",
      nodeKind: "hypothesis",
      label: "Debug hypothesis",
      parentNodeId: "R_root",
      status: "supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 2 },
    }));
    const knowledge: KnowledgeNode = {
      nodeId: "K_debug_medium_gap",
      nodeType: "WebPage",
      title: "Debug medium gap source",
      url: "https://example.test/debug-medium-gap",
      contentHash: "sha256:debug-medium-gap",
      summary: "Supports the explored debug branch.",
      sourceTier: "secondary",
      qualityScore: 0.8,
      retrievedByTaskId: "T_debug",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_debug_medium_gap",
      reportNodeId: "R_hyp_debug",
      knowledgeNodeId: knowledge.nodeId,
      relation: "supports",
      claimText: "The explored branch is supported.",
      confidence: 0.8,
      createdByTaskId: "T_debug",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await ctx.stack.kg.upsertReportlet?.({
      reportletId: "RL_debug_medium_gap",
      reportNodeId: "R_hyp_debug",
      taskId: "T_debug",
      title: "Debug reportlet",
      markdown: "#### Debug reportlet\n\nThe explored branch has a usable cited fragment [E:E_debug_medium_gap].",
      citedEvidenceLinkIds: ["E_debug_medium_gap"],
      citedKnowledgeNodeIds: [knowledge.nodeId],
      createdAt: new Date(fixedNow()).toISOString(),
      updatedAt: new Date(fixedNow()).toISOString(),
    });
    for (const [gapType, description] of [
      ["data_mismatch", "报告原断言与已找到证据口径不完全一致，但当前单分支已有可写修正建议。"],
      ["data_quality", "1998年数据权威性不足，但当前单分支已有可写边界说明。"],
      ["missing_direct_evidence", "未找到直接政策建议文献，但当前单分支已有间接证据和可写边界说明。"],
    ] as const) {
      await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
        gapType,
        description,
        suggestedQuery: "debug residual evidence",
        reportNodeId: "R_hyp_debug",
        taskId: "T_debug",
        impact: "medium",
        status: "open",
      });
    }

    const decision = await completionGatePhase(ctx, { final: false, allowRepairTasks: false });

    expect(decision).toMatchObject({ decision: "ready_for_report" });
    const gaps = await ctx.stack.kg.listOpenGaps?.("R_hyp_debug") ?? [];
    expect(gaps.map((gap) => gap.status)).toEqual(["acknowledged", "acknowledged", "acknowledged"]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.acknowledgeSingleBranchDebugGaps" && event.payload?.acknowledged === 3)).toBe(true);
  });

  it("routes root completion gaps to the matching report branch", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_root_gap_route";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null, status: "supported" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_theory",
      nodeKind: "hypothesis",
      label: "理论传播分支",
      parentNodeId: "R_root",
      status: "supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_practice",
      nodeKind: "hypothesis",
      label: "实践影响分支",
      scopeNote: "收集实践案例、政策事实和统计数据。",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    for (const nodeId of ["R_hyp_theory", "R_hyp_practice"]) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_${nodeId}`,
        nodeType: "WebPage",
        title: `${nodeId} source`,
        url: `https://example.test/${nodeId}`,
        contentHash: `sha256:${nodeId}`,
        summary: "Existing support.",
        sourceTier: "secondary",
        qualityScore: 0.7,
        retrievedByTaskId: `T_${nodeId}`,
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_${nodeId}`,
        reportNodeId: nodeId,
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: "Existing support.",
        confidence: 0.7,
        createdByTaskId: `T_${nodeId}`,
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    await ctx.stack.ledger.upsert(task({ taskId: "T_practice_original", reportNodeId: "R_hyp_practice", status: "completed", updatedAt: new Date(fixedNow() + 1000).toISOString() }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_evidence",
      description: "实践影响分支缺少具体实践案例和统计数据。",
      suggestedQuery: "实践影响 案例 统计数据",
      reportNodeId: "R_root",
      taskId: "T_practice_original",
      impact: "high",
      status: "open",
    });

    const decision = await completionGatePhase(ctx, { final: false });

    expect(decision.decision).toBe("need_more_work");
    const queued = await ctx.stack.ledger.listByStatus("queued");
    const repair = queued.find((item) => item.taskId.startsWith("T_completion_gap_"));
    expect(repair?.reportNodeId).toBe("R_hyp_practice");
    expect(repair?.parentTaskId).toBe("T_practice_original");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.routeCompletionGapRepair" && event.payload?.toReportNodeId === "R_hyp_practice")).toBe(true);
  });

  it("continues from a completion-created gap repair to a report-ready state", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-completion-gap-repair",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "replacement authoritative source",
          title: "Replacement authoritative source",
          url: "https://example.test/replacement-authority",
          content: "Replacement authoritative evidence directly supports the narrowed claim and is sufficient for the report.",
          claimText: "Replacement authoritative evidence supports the narrowed claim.",
          reasoningSummary: "The completion gap repair found an authoritative replacement source.",
        });
      },
    };
    const search: SearchProvider = {
      name: "completion-gap-search",
      async search() {
        return [{ url: "https://example.test/replacement-authority", title: "Replacement authoritative source", snippet: "Replacement evidence." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_completion_gap_repair_to_ready";
    ctx.state.globalRubric = {
      rubricId: "RB_completion_gap_repair",
      episodeId: ctx.state.episodeId,
      rubricText: "Repair a completion gap.",
      outputHints: { titleHint: "Repair", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_gap_repair",
      nodeKind: "hypothesis",
      label: "Gap repair hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_source",
      description: "原始页面无法访问，但可由其他权威来源替代；补到替代证据后不影响整体结论。",
      suggestedQuery: "replacement authoritative source",
      reportNodeId: "R_hyp_gap_repair",
      taskId: "T_previous",
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "need_more_work" });
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_completion_gap_"))).toBe(true);

    const [result] = await dispatchEvidencePhase(ctx, "C_completion_gap_repair");
    expect(result?.branchOutcome).toBe("done_here");

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    const gaps = await ctx.stack.kg.listOpenGaps?.("R_hyp_gap_repair") ?? [];
    expect(gaps).toHaveLength(1);
    expect(gaps[0]?.status).toBe("closed");
  });

  it("carries the original planned reportlet into a completion gap repair", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_planned_reportlet_repair";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_plan_repair",
      nodeKind: "hypothesis",
      label: "Three application areas",
      parentNodeId: "R_root",
      status: "partially_supported",
    }));
    const original = task({ taskId: "T_original_plan", reportNodeId: "R_hyp_plan_repair", status: "completed" });
    original.plannedReportlets = [{
      partId: "P_2",
      parentAgentTaskId: original.taskId,
      parentReportNodeId: original.reportNodeId,
      researchQuestion: "Cover DI-QKD and delegated computation",
      searchGoal: "Find direct sources for both application areas",
      writingGoal: "Write the two cited application analyses",
      expectedHeading: "DI-QKD and delegated computation",
      evidenceNeeds: ["DI-QKD source", "delegated computation source"],
    }];
    await ctx.stack.ledger.upsert(original);
    await ctx.stack.kg.addOpenGap?.({
      gapType: "planned_reportlet_not_completed",
      description: "报告任务 P_2 未完成：DI-QKD and delegated computation",
      suggestedQuery: "DI-QKD delegated computation self-testing",
      reportNodeId: original.reportNodeId,
      taskId: original.taskId,
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "need_more_work" });
    const repair = (await ctx.stack.ledger.listByStatus("queued")).find((item) => item.taskId.startsWith("T_completion_gap_"));
    expect(repair?.plannedReportlet).toMatchObject({ partId: "P_2", researchQuestion: "Cover DI-QKD and delegated computation" });
  });

  it("repairs an untried gap before retrying the same node's earlier gap", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_gap_diversity";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_gap_diversity",
      nodeKind: "hypothesis",
      label: "Multi-gap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
    }));
    const firstDescription = "Missing evidence for country A.";
    const secondDescription = "Missing the official comparison table.";
    const previous = task({ taskId: "T_completion_gap_previous", reportNodeId: "R_hyp_gap_diversity", status: "completed" });
    previous.objective = `Gap type: missing_country_coverage\nGap: ${firstDescription}`;
    await ctx.stack.ledger.upsert(previous);
    for (const [gapType, description] of [["missing_country_coverage", firstDescription], ["missing_table", secondDescription]] as const) {
      await ctx.stack.kg.addOpenGap?.({
        gapType,
        description,
        suggestedQuery: description,
        reportNodeId: "R_hyp_gap_diversity",
        taskId: "T_original",
        impact: "medium",
        status: "open",
      });
    }

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "need_more_work" });
    const repair = (await ctx.stack.ledger.listByStatus("queued")).find((item) => item.taskId.startsWith("T_completion_gap_"));
    expect(repair?.objective).toContain(secondDescription);
    expect(repair?.objective).not.toContain(firstDescription);
  });

  it("blocks insufficient evidence nodes even when gaps are acknowledged", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.evidenceQuality.mode = "strict";
    runtimeProfile.hilMode = "explicit";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_acknowledged_insufficient";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_insufficient_reportable",
      nodeKind: "hypothesis",
      label: "Reportable insufficient hypothesis",
      parentNodeId: "R_root",
      status: "insufficient_evidence",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));
    const knowledge: KnowledgeNode = {
      nodeId: "K_reportable_1",
      nodeType: "WebPage",
      title: "Background source",
      url: "https://example.test/background",
      contentHash: "sha256:background",
      summary: "Background evidence for a limited conclusion.",
      sourceTier: "secondary",
      qualityScore: 0.5,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_reportable_1",
      reportNodeId: "R_hyp_insufficient_reportable",
      knowledgeNodeId: knowledge.nodeId,
      relation: "background",
      claimText: "Only background support is available.",
      confidence: 0.4,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "limited_evidence",
      description: "Only background evidence is available.",
      suggestedQuery: "better source",
      reportNodeId: "R_hyp_insufficient_reportable",
      taskId: "T_done",
      impact: "high",
      status: "acknowledged",
    });

    await expect(completionGatePhase(ctx)).resolves.toMatchObject({ decision: "need_more_work" });
  });

  it("blocks completion while failed repair tasks remain", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_failed_repair";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_failed_repair",
      nodeKind: "hypothesis",
      label: "Failed repair hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    }));
    const knowledge: KnowledgeNode = {
      nodeId: "K_failed_repair_1",
      nodeType: "WebPage",
      title: "Supporting source",
      url: "https://example.test/support",
      contentHash: "sha256:support",
      summary: "Supports the limited claim.",
      sourceTier: "secondary",
      qualityScore: 0.7,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_failed_repair_1",
      reportNodeId: "R_hyp_failed_repair",
      knowledgeNodeId: knowledge.nodeId,
      relation: "supports",
      claimText: "The claim has limited support.",
      confidence: 0.7,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await ctx.stack.ledger.upsert(task({ taskId: "T_publish_repair_hidden_gap_1", reportNodeId: "R_hyp_failed_repair", status: "failed" }));

    const decision = await completionGatePhase(ctx, { final: false });

    expect(decision.decision).toBe("need_more_work");
    expect(decision.reason).toContain("failed research tasks");
    expect((await ctx.stack.ledger.listByStatus("queued")).some((item) => item.taskId.startsWith("T_completion_") && item.reportNodeId === "R_hyp_failed_repair")).toBe(true);
  });

  it("does not enqueue unbounded completion repairs for the same node", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_repair_cap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_completion_cap",
      nodeKind: "hypothesis",
      label: "Completion cap hypothesis",
      parentNodeId: "R_root",
      status: "insufficient_evidence",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    }));
    for (let i = 1; i <= 6; i++) {
      await ctx.stack.ledger.upsert(task({
        taskId: `T_completion_cap_${i}`,
        reportNodeId: "R_hyp_completion_cap",
        status: "completed",
      }));
    }

    const decision = await completionGatePhase(ctx, { final: false });

    expect(decision.decision).toBe("need_more_work");
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipCompletionRepair" && event.reportNodeId === "R_hyp_completion_cap")).toBe(true);
  });

  it("auto-acknowledges residual medium gaps on well-supported nodes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_residual_gaps";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_residual",
      nodeKind: "hypothesis",
      label: "Well-supported hypothesis",
      parentNodeId: "R_root",
      status: "supported",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    }));
    for (let i = 0; i < 5; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_residual_${i}`,
        nodeType: "WebPage",
        title: `Supporting source ${i}`,
        url: `https://example.test/residual/${i}`,
        contentHash: `sha256:residual-${i}`,
        summary: "Directly supports the claim.",
        sourceTier: "secondary",
        qualityScore: 0.75,
        retrievedByTaskId: "T_done",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_residual_${i}`,
        reportNodeId: "R_hyp_residual",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: "The claim is supported.",
        confidence: 0.75,
        createdByTaskId: "T_done",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    await ctx.stack.ledger.upsert(task({ taskId: "T_reflect_residual_1", reportNodeId: "R_hyp_residual", status: "completed" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_gap_residual_2", reportNodeId: "R_hyp_residual", status: "completed" }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_quantitative_data",
      description: "缺乏更细的量化数据，但现有证据已足够支持假设。",
      suggestedQuery: "more quantitative detail",
      reportNodeId: "R_hyp_residual",
      taskId: "T_gap_residual_2",
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_residual")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.autoAcknowledgeResolvedGaps")).toBe(true);
  });

  it("promotes stale insufficient-evidence nodes after completion repairs add support and reportlets", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_promote_stale_status";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_stale",
      nodeKind: "hypothesis",
      label: "Stale insufficient node",
      parentNodeId: "R_root",
      status: "insufficient_evidence",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 3 },
    }));
    for (let i = 0; i < 8; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_stale_${i}`,
        nodeType: "WebPage",
        title: `Stale repair source ${i}`,
        url: `https://example.test/stale/${i}`,
        contentHash: `sha256:stale-${i}`,
        summary: "Supports the previously insufficient node.",
        sourceTier: "secondary",
        qualityScore: 0.8,
        retrievedByTaskId: "T_completion_stale",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_stale_${i}`,
        reportNodeId: "R_hyp_stale",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: "The repaired node is now supported.",
        confidence: 0.8,
        createdByTaskId: "T_completion_stale",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    await ctx.stack.ledger.upsert(task({ taskId: "T_completion_stale", reportNodeId: "R_hyp_stale", status: "completed" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_gap_stale_1", reportNodeId: "R_hyp_stale", status: "completed" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_reflect_stale_2", reportNodeId: "R_hyp_stale", status: "completed" }));
    await ctx.stack.kg.upsertReportlet?.({
      reportletId: "RL_stale",
      reportNodeId: "R_hyp_stale",
      taskId: "T_completion_stale",
      title: "Stale node repair reportlet",
      markdown: "#### Stale node\n\nThe stale node has usable repaired evidence [E:E_stale_0].",
      citedEvidenceLinkIds: ["E_stale_0"],
      citedKnowledgeNodeIds: ["K_stale_0"],
      createdAt: new Date(fixedNow()).toISOString(),
      updatedAt: new Date(fixedNow()).toISOString(),
    });
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_evidence",
      description: "Residual direct-policy gap remains after repairs.",
      suggestedQuery: "direct policy source",
      reportNodeId: "R_hyp_stale",
      taskId: "T_completion_stale",
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false, allowRepairTasks: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_stale")).resolves.toMatchObject({ status: "partially_supported" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_stale")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.promoteEvidenceBackedBlockingNode" && event.reportNodeId === "R_hyp_stale")).toBe(true);
  });

  it("does not block final reporting on residual medium gaps after repeated repairs and strong support", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_trace_residual_gaps";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_trace",
      nodeKind: "hypothesis",
      label: "Trace-like well-supported hypothesis",
      parentNodeId: "R_root",
      status: "supported",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    }));
    for (let i = 0; i < 12; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_trace_${i}`,
        nodeType: "WebPage",
        title: `Trace source ${i}`,
        url: `https://example.test/trace/${i}`,
        contentHash: `sha256:trace-${i}`,
        summary: "Strong supporting evidence for the trace-like claim.",
        sourceTier: "secondary",
        qualityScore: 0.8,
        retrievedByTaskId: "T_done",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_trace_${i}`,
        reportNodeId: "R_hyp_trace",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: "The claim is strongly supported.",
        confidence: 0.8,
        createdByTaskId: "T_done",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    for (let i = 0; i < 3; i++) {
      await ctx.stack.ledger.upsert(task({ taskId: `T_gap_trace_${i}`, reportNodeId: "R_hyp_trace", status: "completed" }));
    }
    await ctx.stack.kg.upsertReportlet?.({
      reportletId: "RL_trace_residual",
      reportNodeId: "R_hyp_trace",
      taskId: "T_gap_trace_2",
      title: "Trace residual reportlet",
      markdown: "#### Trace residual\n\nThe well-supported node has a cited reportlet [E:E_trace_0].",
      citedEvidenceLinkIds: ["E_trace_0"],
      citedKnowledgeNodeIds: ["K_trace_0"],
      createdAt: new Date(fixedNow()).toISOString(),
      updatedAt: new Date(fixedNow()).toISOString(),
    });
    for (const [index, gapType] of [
      "missing_direct_citation",
      "comparative_study",
      "outdated_data",
      "specific_quote",
      "evidence_gap",
      "quantitative_data",
      "planned_reportlet_not_completed",
    ].entries()) {
      await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
        gapType,
        description: `Residual trace gap ${index + 1}.`,
        suggestedQuery: `trace residual ${index + 1}`,
        reportNodeId: "R_hyp_trace",
        taskId: "T_gap_trace_2",
        impact: "medium",
        status: "open",
      });
    }

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_trace")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
    ]);
  });

  it("auto-acknowledges repeated missing direct-source gaps when authoritative alternatives already support the node", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_alternative_source_gap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_alt_source",
      nodeKind: "hypothesis",
      label: "Alternative source hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    }));
    for (let i = 0; i < 7; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_alt_source_${i}`,
        nodeType: "WebPage",
        title: `Authoritative alternative source ${i}`,
        url: `https://example.test/alt-source/${i}`,
        contentHash: `sha256:alt-source-${i}`,
        summary: "Authoritative related source supports the claim.",
        sourceTier: i === 0 ? "official" : "secondary",
        qualityScore: 0.8,
        retrievedByTaskId: "T_done",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_alt_source_${i}`,
        reportNodeId: "R_hyp_alt_source",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: "The claim is supported by related authoritative evidence.",
        confidence: 0.8,
        createdByTaskId: "T_done",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    for (let i = 0; i < 6; i++) {
      await ctx.stack.ledger.upsert(task({ taskId: `T_completion_alt_source_${i}`, reportNodeId: "R_hyp_alt_source", status: i < 3 ? "completed" : "blocked" }));
    }
    for (const [index, description] of [
      "未能直接获取《马克思主义研究》期刊文章，但获取了同属中国社会科学院系统的《世界社会主义研究》期刊文章，内容高度相关。",
      "未直接获取《马克思主义研究》期刊文章，而是获取了《世界社会主义研究》文章，但两者同属马克思主义研究领域，且来源权威。",
      "未直接获取到《马克思主义研究》期刊的原文，但已获取《世界社会主义研究》期刊的强相关文章，且该文来自马克思主义研究网，权威性高。",
    ].entries()) {
      await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
        gapType: "missing_direct_source",
        description,
        suggestedQuery: "马克思主义研究 2024 2025 前沿 挑战",
        reportNodeId: "R_hyp_alt_source",
        taskId: `T_completion_alt_source_${index}`,
        impact: "medium",
        status: "open",
      });
    }

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_alt_source")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
      expect.objectContaining({ status: "acknowledged" }),
    ]);
  });

  it("auto-acknowledges repeated residual detail gaps after provider outages on strongly supported nodes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_provider_outage_residuals";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_practice",
      nodeKind: "hypothesis",
      label: "Strongly supported practice hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
    }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_contemporary",
      nodeKind: "hypothesis",
      label: "Strongly supported contemporary hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
    }));
    for (const [nodeId, count] of [["R_hyp_practice", 26], ["R_hyp_contemporary", 13]] as const) {
      for (let i = 0; i < count; i++) {
        const knowledge: KnowledgeNode = {
          nodeId: `K_${nodeId}_${i}`,
          nodeType: "WebPage",
          title: `Source ${nodeId} ${i}`,
          url: `https://example.test/${nodeId}/${i}`,
          contentHash: `sha256:${nodeId}-${i}`,
          summary: "Strong supporting evidence.",
          sourceTier: "secondary",
          qualityScore: 0.8,
          retrievedByTaskId: "T_done",
          retrievedAt: new Date(fixedNow()).toISOString(),
          metadata: {},
        };
        await ctx.stack.kg.upsertKnowledgeNode(knowledge);
        await ctx.stack.kg.upsertEvidenceLink({
          linkId: `E_${nodeId}_${i}`,
          reportNodeId: nodeId,
          knowledgeNodeId: knowledge.nodeId,
          relation: "supports",
          claimText: "The claim is strongly supported.",
          confidence: 0.8,
          createdByTaskId: "T_done",
          createdAt: new Date(fixedNow()).toISOString(),
        });
      }
      for (let i = 0; i < 6; i++) {
        await ctx.stack.ledger.upsert(task({ taskId: `T_completion_${nodeId}_${i}`, reportNodeId: nodeId, status: i < 3 ? "completed" : "blocked" }));
      }
    }
    for (const [nodeId, gapType, description] of [
      ["R_hyp_practice", "specific_data", "缺少具体的量化数据（如文化自信指数、民生改善的具体数字）来进一步支撑成就描述。"],
      ["R_hyp_practice", "case_study", "缺少具体的案例研究（如某个地区和谐社会建设的典型案例）来增强说服力。"],
      ["R_hyp_practice", "missing_source", "指定URL K_url_49f4c30f368c10b6 和 K_url_db6431898436d5d2 未能直接获取内容，但通过搜索已找到等效权威来源。"],
      ["R_hyp_contemporary", "specific_policy", "缺少具体政策文件（如“十四五”规划、二十大报告原文）的直接引用，以增强实践指导的细节。"],
      ["R_hyp_contemporary", "international_comparison", "缺少国际视角下马克思主义中国化与其他社会主义国家理论创新的比较分析。"],
    ] as const) {
      await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
        gapType,
        description,
        suggestedQuery: "follow-up query",
        reportNodeId: nodeId,
        taskId: `T_completion_${nodeId}_0`,
        impact: "medium",
        status: "open",
      });
    }

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    const gaps = await ctx.stack.kg.listOpenGaps?.() ?? [];
    expect(gaps.every((gap) => gap.status === "acknowledged")).toBe(true);
  });

  it("restores pruned aspect parents when supported children should still be reported", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_restore_pruned_aspect";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_aspect_pruned",
      nodeKind: "aspect",
      label: "Pruned but supported aspect",
      parentNodeId: "R_root",
      status: "pruned",
    }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_child_supported",
      nodeKind: "hypothesis",
      label: "Supported child",
      parentNodeId: "R_aspect_pruned",
      status: "supported",
    }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_child_supported",
      nodeType: "WebPage",
      title: "Child evidence",
      url: "https://example.test/child",
      contentHash: "sha256:child",
      summary: "Supports the child hypothesis.",
      sourceTier: "secondary",
      qualityScore: 0.8,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_child_supported",
      reportNodeId: "R_hyp_child_supported",
      knowledgeNodeId: "K_child_supported",
      relation: "supports",
      claimText: "The child hypothesis is supported.",
      confidence: 0.8,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.getReportNode("R_aspect_pruned")).resolves.toMatchObject({ status: "supported" });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.restorePrunedSupportedNode")).toBe(true);
  });

  it("restores pruned hypothesis nodes that still have strong supporting evidence", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_restore_pruned_hypothesis";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_practice", nodeKind: "aspect", label: "Practice", parentNodeId: "R_root", status: "supported" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_pruned_supported",
      nodeKind: "hypothesis",
      label: "Pruned supported hypothesis",
      parentNodeId: "R_aspect_practice",
      status: "pruned",
    }));
    for (let i = 0; i < 3; i++) {
      await ctx.stack.kg.upsertKnowledgeNode({
        nodeId: `K_pruned_supported_${i}`,
        nodeType: "WebPage",
        title: `Pruned supporting source ${i}`,
        url: `https://example.test/pruned/${i}`,
        contentHash: `sha256:pruned-${i}`,
        summary: "Strong evidence that should not be hidden from the writer.",
        sourceTier: "secondary",
        qualityScore: 0.8,
        retrievedByTaskId: "T_done",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      });
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_pruned_supported_${i}`,
        reportNodeId: "R_hyp_pruned_supported",
        knowledgeNodeId: `K_pruned_supported_${i}`,
        relation: "supports",
        claimText: "The pruned hypothesis is supported.",
        confidence: 0.8,
        createdByTaskId: "T_done",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_pruned_supported")).resolves.toMatchObject({ status: "supported" });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.restorePrunedSupportedNode" && event.reportNodeId === "R_hyp_pruned_supported")).toBe(true);
  });

  it("auto-acknowledges root-level residual limitation gaps after repeated repairs and broad subtree support", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_root_residual_limit";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null, status: "partially_supported" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_root_child", nodeKind: "hypothesis", label: "Root child", parentNodeId: "R_root", status: "supported" }));
    for (let i = 0; i < 20; i++) {
      await ctx.stack.kg.upsertKnowledgeNode({
        nodeId: `K_root_residual_${i}`,
        nodeType: "WebPage",
        title: `Root residual support ${i}`,
        url: `https://example.test/root-residual/${i}`,
        contentHash: `sha256:root-residual-${i}`,
        summary: "Subtree evidence supports the overall report.",
        sourceTier: "secondary",
        qualityScore: 0.75,
        retrievedByTaskId: "T_done",
        retrievedAt: new Date(fixedNow()).toISOString(),
        metadata: {},
      });
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_root_residual_${i}`,
        reportNodeId: "R_hyp_root_child",
        knowledgeNodeId: `K_root_residual_${i}`,
        relation: "supports",
        claimText: "The overall report is broadly supported through child evidence.",
        confidence: 0.75,
        createdByTaskId: "T_done",
        createdAt: new Date(fixedNow()).toISOString(),
      });
    }
    for (let i = 0; i < 3; i++) {
      await ctx.stack.ledger.upsert(task({ taskId: `T_reflect_R_root_limit_${i}`, reportNodeId: "R_root", status: "completed" }));
    }
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_source",
      description: "缺乏直接讨论马克思主义在中国传播研究中数据稀缺、证据可信度或研究局限性的学术或权威来源。",
      suggestedQuery: "马克思主义在中国传播 研究反思 方法论 局限",
      reportNodeId: "R_root",
      taskId: "T_reflect_R_root_limit_1",
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
    await expect(ctx.stack.kg.listOpenGaps?.("R_root")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
  });

  it("blocks downplayed nodes while acknowledged high-impact gaps remain", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.evidenceQuality.mode = "strict";
    runtimeProfile.hilMode = "explicit";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_acknowledged_downplayed";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_downplayed_reportable",
      nodeKind: "hypothesis",
      label: "Reportable downplayed hypothesis",
      parentNodeId: "R_root",
      status: "downplayed",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));
    const knowledge: KnowledgeNode = {
      nodeId: "K_downplayed_1",
      nodeType: "WebPage",
      title: "Background source",
      url: "https://example.test/background",
      contentHash: "sha256:background",
      summary: "Background evidence for a limited conclusion.",
      sourceTier: "secondary",
      qualityScore: 0.5,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_downplayed_1",
      reportNodeId: "R_hyp_downplayed_reportable",
      knowledgeNodeId: knowledge.nodeId,
      relation: "background",
      claimText: "Only background support is available.",
      confidence: 0.4,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "limited_evidence",
      description: "Only background evidence is available.",
      suggestedQuery: "better source",
      reportNodeId: "R_hyp_downplayed_reportable",
      taskId: "T_done",
      impact: "high",
      status: "acknowledged",
    });

    await expect(completionGatePhase(ctx)).resolves.toMatchObject({ decision: "need_more_work" });
  });

  it("does not block completion on medium open gaps attached only to downplayed nodes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_completion_downplayed_medium_gap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_downplayed_medium",
      nodeKind: "hypothesis",
      label: "Downplayed hypothesis",
      parentNodeId: "R_root",
      status: "downplayed",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_policy",
      description: "Medium residual gap on a claim already downplayed from the report.",
      suggestedQuery: "missing policy",
      reportNodeId: "R_hyp_downplayed_medium",
      taskId: "T_done",
      impact: "medium",
      status: "open",
    });

    await expect(completionGatePhase(ctx, { final: false })).resolves.toMatchObject({ decision: "ready_for_report" });
  });

  it("acknowledges skipped gaps so non-critical limitations can be reported", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-gap-skip",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: false,
          taskUpdates: [],
          newTasks: [],
          skipReasons: [{ gap: "Minor methodological limitation.", reason: "Useful caveat but not required for the central conclusion." }],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_gap_skip";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_skip",
      nodeKind: "hypothesis",
      label: "Skippable gap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    const knowledge: KnowledgeNode = {
      nodeId: "K_skip_1",
      nodeType: "WebPage",
      title: "Limited source",
      url: "https://example.test/limited",
      contentHash: "sha256:limited",
      summary: "Limited evidence for the claim.",
      sourceTier: "secondary",
      qualityScore: 0.6,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    };
    await ctx.stack.kg.upsertKnowledgeNode(knowledge);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_skip_1",
      reportNodeId: "R_hyp_skip",
      knowledgeNodeId: knowledge.nodeId,
      relation: "supports",
      claimText: "Limited evidence supports a cautious conclusion.",
      confidence: 0.6,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "method_limit",
      description: "Minor methodological limitation.",
      suggestedQuery: "method limitation",
      reportNodeId: "R_hyp_skip",
      taskId: "T_done",
      impact: "low",
      status: "open",
    });

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_skip", "Minor methodological limitation.")]);

    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_skip")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
    await expect(completionGatePhase(ctx)).resolves.toMatchObject({ decision: "ready_for_report" });
  });
});
