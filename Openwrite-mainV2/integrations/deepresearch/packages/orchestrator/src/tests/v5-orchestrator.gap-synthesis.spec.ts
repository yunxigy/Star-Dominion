import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import type { KnowledgeNode, LlmChat, OpenGap, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";
import { cycleReflectionPhase } from "../phases/cycle-reflection.js";
import { structureReviewPhase } from "../phases/structure-review.js";
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
  it("synthesizes gap tasks when reflection leaves blocking gaps while budget remains", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-stop",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: false,
          taskUpdates: [],
          newTasks: [],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_stop_no_gap_tasks";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_stop",
      nodeKind: "hypothesis",
      label: "Reflection stop hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_stop", "Open gap that still blocks completion.")]);

    expect(reflection.continueDispatch).toBe(true);
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_gap_"))).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "cycle_reflection" && Array.isArray(event.payload?.createdTaskIds) && event.payload.createdTaskIds.length === 1)).toBe(true);
  });

  it("defers synthesized gap tasks until planned parent agent task finishes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-defer-planned-parts",
      async chat() {
        return { content: JSON.stringify({ continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_defer_planned_parts";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_planned", nodeKind: "hypothesis", label: "Planned part hypothesis", parentNodeId: "R_root", status: "partially_supported" }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_broad_pending",
      reportNodeId: "R_hyp_planned",
      status: "queued",
      plannedReportlets: [{
        partId: "P_1",
        parentAgentTaskId: "T_broad_pending",
        parentReportNodeId: "R_hyp_planned",
        researchQuestion: "Planned direction still pending.",
        searchGoal: "Find pending planned direction evidence.",
        writingGoal: "Write pending planned direction.",
        expectedHeading: "Pending planned direction",
        evidenceNeeds: ["direct evidence"],
      }],
    }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_broad_pending", "R_hyp_planned", "Open gap while planned parent is still queued.")]);

    expect(reflection.continueDispatch).toBe(true);
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.map((item) => item.taskId)).toContain("T_broad_pending");
    expect(queued.some((item) => item.taskId.startsWith("T_gap_"))).toBe(false);
  });

  it("allows synthesized gap tasks after planned parent agent task finishes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-after-planned-parts",
      async chat() {
        return { content: JSON.stringify({ continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_after_planned_parts";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_planned_done", nodeKind: "hypothesis", label: "Completed planned part hypothesis", parentNodeId: "R_root", status: "partially_supported" }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_broad_done",
      reportNodeId: "R_hyp_planned_done",
      status: "completed",
      plannedReportlets: [{
        partId: "P_1",
        parentAgentTaskId: "T_broad_done",
        parentReportNodeId: "R_hyp_planned_done",
        researchQuestion: "Completed planned direction.",
        searchGoal: "Find completed planned direction evidence.",
        writingGoal: "Write completed planned direction.",
        expectedHeading: "Completed planned direction",
        evidenceNeeds: ["direct evidence"],
      }],
    }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_broad_done", "R_hyp_planned_done", "Open gap after planned directions finished.")]);

    expect(reflection.continueDispatch).toBe(true);
    expect((await ctx.stack.ledger.listByStatus("queued")).some((item) => item.taskId.startsWith("T_gap_"))).toBe(true);
  });

  it("synthesizes repair tasks for stored blocking gaps even when the latest batch has no new gaps", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-stored-gap-stop",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: false,
          taskUpdates: [],
          newTasks: [],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_stored_gap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_stored_gap",
      nodeKind: "hypothesis",
      label: "Stored gap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 2, contradictingCount: 0, openGapCount: 1 },
    }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_primary_source",
      description: "Stored gap still blocks completion.",
      suggestedQuery: "stored gap primary source",
      reportNodeId: "R_hyp_stored_gap",
      taskId: "T_previous",
      impact: "medium",
      status: "open",
    });

    const reflection = await cycleReflectionPhase(ctx, [{
      ...agentResultWithGap("T_done", "R_hyp_stored_gap"),
      openGaps: [],
      turnSummary: {
        actionSummary: "No new gap in this batch.",
        searchSummary: "Batch completed.",
        reasoningSummary: "Stored gap remains in KG.",
        citedKnowledgeNodeIds: [],
        citedEvidenceLinkIds: [],
      },
    }]);

    expect(reflection.continueDispatch).toBe(true);
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((task) => task.taskId.startsWith("T_gap_") && task.objective.includes("Stored gap still blocks completion."))).toBe(true);
  });

  it("falls back deterministically when reflection returns invalid JSON", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-invalid-reflection",
      async chat() {
        return { content: "I need another pass, but this is not JSON." };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_invalid_reflection";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_invalid",
      nodeKind: "hypothesis",
      label: "Invalid reflection hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_invalid")]);

    expect(reflection.continueDispatch).toBe(true);
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_gap_"))).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "cycle_reflection_parse_repair")).toBe(true);
  });

  it("falls back when structure review returns invalid JSON", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-invalid-structure-review",
      async chat() {
        return { content: "No structural changes are needed." };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_invalid_structure_review";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", label: "Hypothesis", parentNodeId: "R_root", status: "supported" }));

    await expect(structureReviewPhase(ctx)).resolves.toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "structure_review_parse_repair")).toBe(true);
    expect(events.some((event) => event.eventType === "structure_review")).toBe(true);
  });

  it("runs StructureReviewAgent through AgentRuntime tools before applying a safe patch", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-structure-agent-runtime",
      async chat(req) {
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("Previous steps:\n[]")) {
          return {
            content: JSON.stringify({
              thoughtSummary: "Inspect the current report tree before proposing a rename.",
              action: "tool",
              toolName: "list_report_tree",
              args: {},
            }),
          };
        }
        return {
          content: JSON.stringify({
            thoughtSummary: "The hypothesis label is too vague and can be safely renamed.",
            action: "finish",
            finish: {
              suggestions: [{
                patch: { op: "rename_report_node", reportNodeId: "R_hyp_structure_agent", label: "Renamed by StructureReviewAgent" },
                rationale: "Clarify the hypothesis label after inspecting the tree.",
                confidence: 0.9,
              }],
            },
          }),
        };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_structure_agent_runtime";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_structure_agent",
      nodeKind: "hypothesis",
      label: "Vague hypothesis",
      parentNodeId: "R_root",
      status: "supported",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ decision: "apply" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_structure_agent")).resolves.toMatchObject({ label: "Renamed by StructureReviewAgent" });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    const visualEvents = events.filter((event) => event.eventType === "agent_runtime_visual");
    expect(visualEvents.some((event) => event.payload?.visual && (event.payload.visual as { actor?: { title?: string } }).actor?.title === "StructureReviewAgent")).toBe(true);
    expect(visualEvents.some((event) => event.payload?.visual && (event.payload.visual as { kind?: string; ui?: { title?: string } }).kind === "tool_started" && (event.payload.visual as { ui?: { title?: string } }).ui?.title === "list_report_tree")).toBe(true);
  });

  it("lets StructureReviewAgent inspect relevant evidence with nodeIds arrays", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-structure-array-inspection",
      async chat(req) {
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("Previous steps:\n[]")) {
          return {
            content: JSON.stringify({
              thoughtSummary: "Inspect evidence for both overlapping nodes.",
              action: "tool",
              toolName: "list_relevant_evidence",
              args: { nodeIds: ["R_hyp_a", "R_hyp_b"] },
            }),
          };
        }
        return { content: JSON.stringify({ thoughtSummary: "No patch needed.", action: "finish", finish: { suggestions: [] } }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_structure_array_inspection";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_a", nodeKind: "hypothesis", label: "A", parentNodeId: "R_root", status: "supported" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_b", nodeKind: "hypothesis", label: "B", parentNodeId: "R_root", status: "supported" }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_structure_array",
      nodeType: "WebPage",
      url: "https://example.test/structure",
      title: "Structure evidence",
      contentHash: "hash_structure_array",
      summary: "Evidence summary.",
      sourceTier: "secondary",
      qualityScore: 0.8,
      retrievedByTaskId: "T_test",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_structure_array",
      reportNodeId: "R_hyp_b",
      knowledgeNodeId: "K_structure_array",
      relation: "supports",
      claimText: "B is supported.",
      confidence: 0.8,
      createdByTaskId: "T_test",
      createdAt: new Date(fixedNow()).toISOString(),
    });

    await expect(structureReviewPhase(ctx)).resolves.toEqual([]);
    const visualEvents = (await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId })).filter((event) => event.eventType === "agent_runtime_visual");
    expect(visualEvents.some((event) => event.payload?.visual && (event.payload.visual as { kind?: string; ui?: { title?: string } }).kind === "tool_finished" && (event.payload.visual as { ui?: { title?: string } }).ui?.title === "list_relevant_evidence")).toBe(true);
  });

  it("filters task-creating structure patches when no dispatch budget remains", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-late-structure-review",
      async chat() {
        return { content: JSON.stringify({
          suggestions: [
            {
              patch: { op: "add_aspect_node", parentNodeId: "R_root", label: "Late aspect", scopeNote: "Would require more research." },
              rationale: "Add a late aspect.",
              confidence: 0.8,
            },
            {
              patch: {
                op: "add_hypothesis_node",
                parentNodeId: "R_root",
                statement: "Late hypothesis needs new evidence.",
                researchBrief: "Research late hypothesis.",
                evidenceGuidance: "Find late evidence.",
              },
              rationale: "Add a late hypothesis.",
              confidence: 0.8,
            },
          ],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_late_structure_budget";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));

    const decisions = await structureReviewPhase(ctx, { allowNewResearchTasks: false });

    expect(decisions).toHaveLength(0);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    expect(await ctx.stack.kg.listReportNodes()).toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "structure_review_suggestions_filtered" && event.payload?.source === "dispatch-budget" && event.payload?.dropped === 2)).toBe(true);
    expect(events.some((event) => event.eventType === "structure_review" && event.payload?.applied === 0)).toBe(true);
  });

  it("acknowledges a medium gap from a structured safe qualification without keyword matching", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const gapText = "One secondary field could not be verified.";
    const llm: LlmChat = {
      name: "structured-gap-disposition",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: false,
          taskUpdates: [],
          newTasks: [],
          skipReasons: [{
            gap: gapText,
            reason: "The supported core finding remains accurate when this field is excluded.",
            disposition: "qualify",
            claimSafeWithoutMissingEvidence: true,
            affectedRequirementIds: ["RQ_CORE"],
          }],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_structured_gap_disposition";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_safe_qualify",
      nodeKind: "hypothesis",
      label: "Safe qualification",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    const source: KnowledgeNode = {
      nodeId: "K_safe_qualify",
      nodeType: "WebPage",
      title: "Core evidence",
      url: "https://example.test/core-evidence",
      contentHash: "sha256:core-evidence",
      summary: "Direct support for the core finding.",
      sourceTier: "primary",
      qualityScore: 0.9,
      retrievedByTaskId: "T_done",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: { fetched: true },
    };
    await ctx.stack.kg.upsertKnowledgeNode(source);
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_safe_qualify",
      reportNodeId: "R_hyp_safe_qualify",
      knowledgeNodeId: source.nodeId,
      relation: "supports",
      claimText: "The core finding is supported.",
      confidence: 0.9,
      createdByTaskId: "T_done",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_safe_qualify", status: "completed" }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_secondary_field",
      description: gapText,
      suggestedQuery: "secondary field",
      reportNodeId: "R_hyp_safe_qualify",
      taskId: "T_done",
      impact: "medium",
      status: "open",
    });

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_safe_qualify", gapText)], { currentCycle: 2, maxCycles: 3 });

    expect(reflection.continueDispatch).toBe(false);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_safe_qualify")).resolves.toEqual([
      expect.objectContaining({ status: "acknowledged" }),
    ]);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
  });

  it("does not enqueue more reflection work at the dispatch cycle limit and leaves blocking gaps open", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "explicit";
    const llm: LlmChat = {
      name: "scripted-limit-reflection",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: [{ taskId: "T_done", newStatus: "queued", reason: "Try one more time." }],
          newTasks: [{
            parentTaskId: "T_done",
            reportNodeId: "R_hyp_limit",
            title: "Should not enqueue",
            objective: "This exceeds the cycle budget.",
            priority: 99,
            acceptanceCriteria: ["Should be removed."],
          }],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_limit_reflection";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_limit",
      nodeKind: "hypothesis",
      label: "Limit reflection hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_limit", status: "completed" }));
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "budget_limit",
      description: "Remaining gap at final cycle.",
      suggestedQuery: "final cycle gap",
      reportNodeId: "R_hyp_limit",
      taskId: "T_done",
      impact: "medium",
      status: "open",
    });

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_limit", "Remaining gap at final cycle.")], { currentCycle: 3, maxCycles: 3 });

    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_limit")).resolves.toEqual([
      expect.objectContaining({ status: "open" }),
    ]);
    await expect(completionGatePhase(ctx)).resolves.toMatchObject({ decision: "ready_for_report" });
  });

  it("does not synthesize gap tasks after the dispatch cycle limit", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-limit-gap-synthesis",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: [],
          newTasks: [],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_limit_gap_synthesis";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_limit_gap",
      nodeKind: "hypothesis",
      label: "Limit gap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));

    const reflection = await cycleReflectionPhase(
      ctx,
      [agentResultWithGap("T_done", "R_hyp_limit_gap", "Unmatched final-cycle gap.")],
      { currentCycle: 2, maxCycles: 2 },
    );

    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
  });

  it("caps synthesized gap repair tasks per report node", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-gap-cap",
      async chat() {
        return { content: JSON.stringify({ continueDispatch: true, taskUpdates: [], newTasks: [], skipReasons: [] }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_gap_cap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_cap",
      nodeKind: "hypothesis",
      label: "Cap hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_gap_R_hyp_cap_first", reportNodeId: "R_hyp_cap", status: "completed" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_gap_R_hyp_cap_second", reportNodeId: "R_hyp_cap", status: "completed" }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_gap_R_hyp_cap_second", "R_hyp_cap", "Still unresolved after two gap repairs.")]);

    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipNewTask" && event.payload?.reason === "repair_task_cap_reached_for_node")).toBe(true);
  });

  it("reports reflection-requested tasks skipped by repair capacity", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-reflection-cap-request",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: [],
          newTasks: [{
            parentTaskId: "T_done",
            reportNodeId: "R_hyp_cap_request",
            title: "Another capped repair",
            objective: "This should be skipped because the node already used repair capacity.",
            priority: 90,
            acceptanceCriteria: ["Should be skipped."],
          }],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_cap_requested";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_cap_request",
      nodeKind: "hypothesis",
      label: "Cap request hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_reflect_cap_request_first", reportNodeId: "R_hyp_cap_request", status: "completed" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_gap_cap_request_second", reportNodeId: "R_hyp_cap_request", status: "completed" }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_gap_cap_request_second", "R_hyp_cap_request", "Still unresolved after capacity used.")]);

    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "cycle_reflection" && Array.isArray(event.payload?.skippedNewTasks) && event.payload.skippedNewTasks.length === 1)).toBe(true);
    expect(events.some((event) => event.eventType === "reflection_scheduler_finished" && Array.isArray(event.payload?.skippedNewTasks) && event.payload.skippedNewTasks[0]?.reason === "repair_task_cap_reached_for_evidenced_node")).toBe(true);
  });

  it("keeps synthesized gap task ids from nesting parent repair task ids", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-gap-id",
      async chat() {
        return { content: JSON.stringify({ continueDispatch: true, taskUpdates: [], newTasks: [], skipReasons: [] }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_gap_id";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_id",
      nodeKind: "hypothesis",
      label: "ID hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 1 },
    }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_gap_R_hyp_id_old_parent_task", "R_hyp_id", "Need one more targeted search.")]);
    const queued = await ctx.stack.ledger.listByStatus("queued");

    expect(reflection.continueDispatch).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.taskId).toMatch(/^T_gap_R_hyp_id_missing_primary_source_/);
    expect(queued[0]?.taskId).not.toContain("old_parent_task");
  });

  it("redispatches structure-review repair tasks before completion", async () => {
    const dir = await artifactDir();
    const ledger = createInMemoryTaskLedger();
    const memory = createInMemoryMemoryGraph();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 3;
    let structureReviewCalls = 0;
    const llm: LlmChat = {
      name: "scripted-structure-redispatch",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Verify structure redispatch.",
            outputHints: { titleHint: "Redispatch", language: "en", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["redispatch"],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["redispatch source"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Aspect",
              scopeNote: "Aspect scope",
              hypotheses: [{ statement: "Claim needs evidence.", researchBrief: "Research claim.", evidenceGuidance: "Search claim." }],
              tasks: [{ title: "Original evidence task", objective: "Find evidence.", acceptanceCriteria: ["Save evidence."] }],
            }],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("ReflectionSchedulerAgent")) {
          return { content: JSON.stringify({
            thoughtSummary: "No more evidence tasks are needed before structure review.",
            action: "finish",
            finish: { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("StructureReviewAgent")) {
          structureReviewCalls += 1;
          return { content: JSON.stringify({
            thoughtSummary: "Review structure after dispatch.",
            action: "finish",
            finish: {
              suggestions: structureReviewCalls === 1
                ? [{
                    patch: { op: "move_report_node", reportNodeId: "R_hyp_1", fromParentId: "R_aspect_1", toParentId: "R_root" },
                    rationale: "Moving an evidenced node requires redispatch validation.",
                    confidence: 0.9,
                  }]
                : [],
            },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime")) {
          return scriptedEvidenceReact(user, {
            query: "claim evidence",
            title: "Redispatch source",
            url: "https://example.test/redispatch",
            content: "Redispatch source content is long enough to be saved and make the structure move patch risky.",
            claimText: "Claim is supported.",
            reasoningSummary: "Evidence supports the claim.",
          });
        }
        if (user.includes("Create a search plan")) {
          return { content: JSON.stringify({ queries: ["claim evidence"], searchRationale: "Search for evidence." }) };
        }
        if (user.includes("Assess the search observations")) {
          return { content: JSON.stringify({
            relation: "supports",
            claimText: "Claim is supported.",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Evidence supports the claim.",
            openGaps: [],
            structurePatchSuggestions: [],
          }) };
        }
        if (user.includes("Write the final report")) {
          return { content: "# Redispatch\n\n## Aspect\n\nClaim is supported [C1].\n" };
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "fixture-search",
      async search() {
        return [{ url: "https://example.test/redispatch", title: "Redispatch source", snippet: "Evidence supports the claim." }];
      },
    };
    const orchestrator = createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm,
      search,
      stack: { ledger, memory },
    });

    const result = await orchestrator.runEpisode(submission());

    expect(result.status).toBe("succeeded");
    expect(result.episodeId).toMatch(/^EP_20260701_000000_\d{3}_[0-9a-f]{8}$/);
    expect(structureReviewCalls).toBeGreaterThanOrEqual(2);
    expect((await ledger.listAll()).filter((item) => item.status === "completed")).toHaveLength(2);
    expect((await ledger.listAll()).some((item) => item.title.startsWith("Review structure patch"))).toBe(true);
    const events = await memory.listEvents({ episodeId: result.episodeId });
    expect(events.some((event) => event.eventType === "dispatch_cycle_started")).toBe(true);
    expect(events.some((event) => event.eventType === "dispatch_cycle_finished")).toBe(true);
    expect(events.some((event) => event.eventType === "structure_critic_decision" && (event.payload?.critique as { risk?: string } | undefined)?.risk === "risky")).toBe(true);
    expect(events.some((event) => event.eventType === "patch_guard_decision" && (event.payload?.decision as { decision?: string } | undefined)?.decision === "redispatch")).toBe(true);
  });
});
