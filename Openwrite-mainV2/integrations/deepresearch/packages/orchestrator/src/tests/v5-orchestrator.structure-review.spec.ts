import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentRunResult, LlmChat, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { createHumanReviewRequest } from "../phases/human-review.js";
import { structureReviewPhase } from "../phases/structure-review.js";
import { saveSourceEvidence } from "../source-store.js";
import { fixedNow, submission, node, task, requirement, agentResultWithPatch, scriptedEvidenceReact } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("accepts injected LLM JSON for rubric and architect phases", async () => {
    const dir = await artifactDir();
    const llm: LlmChat = {
      name: "scripted",
      async chat(req) {
        const user = req.user;
        if (req.system?.includes("final report writer")) {
          return { content: "# Scripted Title\n\n## Scripted Aspect\n\nScripted report body." };
        }
        if (user.includes("DeepResearch AgentRuntime")) {
          return scriptedEvidenceReact(user, {
            query: "Scripted query",
            title: "Scripted source",
            url: "https://example.test/scripted",
            content: "Scripted source content is long enough to be saved as evidence for the injected LLM JSON test.",
            claimText: "Scripted evidence supports the hypothesis.",
            reasoningSummary: "Scripted ReAct evidence completed.",
          });
        }
        if (user.includes("GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Scripted rubric text.",
            outputHints: { titleHint: "Scripted Title", language: "en-US", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["Scripted question"],
          }) };
        }
        return { content: JSON.stringify({
          aspects: [{
            label: "Scripted Aspect",
            scopeNote: "Scripted scope",
            hypotheses: [{ statement: "Scripted hypothesis", researchBrief: "Scripted brief", evidenceGuidance: "Scripted query" }],
            tasks: [{ title: "Scripted task", objective: "Scripted objective", acceptanceCriteria: ["Scripted criterion"] }],
          }],
        }) };
      },
    };
    const search: SearchProvider = {
      name: "scripted-search",
      async search() {
        return [{ url: "https://example.test/scripted", title: "Scripted source", snippet: "Scripted evidence supports the hypothesis." }];
      },
    };
    const orchestrator = createInMemoryOrchestrator({ now: fixedNow, artifactDir: dir, llm, search });
    const result = await orchestrator.runEpisode(submission());
    const report = await readFile(result.reportArtifactPath, "utf8");
    expect(report).toContain("Scripted Title");
    expect(report).toContain("Scripted Aspect");
  });

  it("applies v5 structure patch suggestions and creates repair tasks for new hypotheses", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_patch";
    ctx.state.globalRubric = {
      rubricId: "RB_patch",
      episodeId: "EP_patch",
      rubricText: "Patch test rubric",
      outputHints: { titleHint: "Patch", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_1", nodeKind: "aspect", label: "Old", parentNodeId: "R_root" }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "add_hypothesis_node",
      parentNodeId: "R_aspect_1",
      newNodeId: "R_hyp_added",
      statement: "Added hypothesis",
      researchBrief: "Research added hypothesis.",
      evidenceGuidance: "Search added hypothesis.",
    }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "rename_report_node",
      reportNodeId: "R_aspect_1",
      label: "Renamed Aspect",
    }));

    const decisions = await structureReviewPhase(ctx);
    expect(decisions.map((decision) => decision.decision)).toEqual(["apply", "apply"]);
    await expect(ctx.stack.kg.getReportNode("R_hyp_added")).resolves.toMatchObject({ nodeKind: "hypothesis" });
    await expect(ctx.stack.kg.getReportNode("R_aspect_1")).resolves.toMatchObject({ label: "Renamed Aspect" });
    expect((await ctx.stack.ledger.listByReportNode("R_hyp_added"))[0]?.acceptanceCriteria).toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "structure_review_started")).toBe(true);
    expect(events.some((event) => event.eventType === "structure_review_agent_suggested" && event.payload?.workerSuggestions === 2)).toBe(true);
    expect(events.some((event) => event.eventType === "structure_critic_decision" && (event.payload?.critique as { risk?: string } | undefined)?.risk === "safe")).toBe(true);
    expect(events.some((event) => event.eventType === "patch_guard_decision" && (event.payload?.decision as { decision?: string } | undefined)?.decision === "apply")).toBe(true);
  });

  it("keeps debug tree limits active during structure review", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.debug = { singleBranch: true, maxAspects: 2, maxBranchesPerAspect: 2, maxInitialAgentNodes: 4, maxAgentNodeParts: 2 };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_debug_structure_limits";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    for (let aspectIndex = 1; aspectIndex <= 2; aspectIndex++) {
      const aspectId = `R_aspect_${aspectIndex}`;
      await ctx.stack.kg.upsertReportNode(node({ nodeId: aspectId, nodeKind: "aspect", label: `Aspect ${aspectIndex}`, parentNodeId: "R_root" }));
      for (let branchIndex = 1; branchIndex <= 2; branchIndex++) {
        await ctx.stack.kg.upsertReportNode(node({
          nodeId: `R_hyp_${aspectIndex}_${branchIndex}`,
          nodeKind: "hypothesis",
          label: `Branch ${aspectIndex}.${branchIndex}`,
          parentNodeId: aspectId,
        }));
      }
    }
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "add_aspect_node",
      parentNodeId: "R_root",
      label: "Overflow aspect",
      scopeNote: "Must be rejected in debug mode.",
    }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "add_hypothesis_node",
      parentNodeId: "R_aspect_1",
      statement: "Overflow branch",
      researchBrief: "Must be rejected in debug mode.",
      evidenceGuidance: "No new branch should be created.",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toHaveLength(2);
    expect(decisions.every((decision) => decision.decision === "reject")).toBe(true);
    expect(decisions.every((decision) => decision.rationale.includes("debug tree limit"))).toBe(true);
    const nodes = await ctx.stack.kg.listReportNodes();
    expect(nodes.filter((item) => item.nodeKind === "aspect")).toHaveLength(2);
    expect(nodes.filter((item) => item.nodeKind === "hypothesis")).toHaveLength(4);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
  });

  it("keeps distinct evidence-bearing must requirements on separate focused leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_focused_merge_guard";
    ctx.state.globalRubric = {
      rubricId: "RB_focused_merge_guard",
      episodeId: ctx.state.episodeId,
      rubricText: "Keep explicit deliverables independently traceable.",
      outputHints: { titleHint: "Focused", language: "en", citationRequired: true, format: "markdown" },
      requirements: [
        requirement("R1", "Identify the providers.", "question"),
        requirement("R2", "Provide the country market-share table.", "deliverable"),
      ],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", label: "Market", parentNodeId: "R_root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_providers", nodeKind: "hypothesis", label: "Providers", parentNodeId: "R_aspect", requirementIds: ["R1"] }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_table", nodeKind: "hypothesis", label: "Market-share table", parentNodeId: "R_aspect", requirementIds: ["R2"] }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "merge_report_nodes",
      sourceNodeId: "R_hyp_providers",
      targetNodeId: "R_hyp_table",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toEqual([expect.objectContaining({
      decision: "reject",
      rationale: expect.stringContaining("distinct evidence-bearing must requirements"),
    })]);
    await expect(ctx.stack.kg.getReportNode("R_hyp_providers")).resolves.toMatchObject({ status: "planned" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_table")).resolves.toMatchObject({ requirementIds: ["R2"] });
  });

  it("rejects merging a hypothesis leaf into its parent aspect so evidence stays leaf-grounded", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_leaf_into_aspect_merge_guard";
    ctx.state.globalRubric = {
      rubricId: "RB_leaf_into_aspect_merge_guard",
      episodeId: ctx.state.episodeId,
      rubricText: "Keep direct evidence on the research leaf.",
      outputHints: { titleHint: "Leaf grounding", language: "en", citationRequired: true, format: "markdown" },
      requirements: [requirement("R1", "Provide the attack technology table.", "deliverable")],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_aspect_attacks",
      nodeKind: "aspect",
      label: "Attack Technology Overview",
      parentNodeId: "R_root",
      requirementIds: ["R1"],
    }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_attacks",
      nodeKind: "hypothesis",
      label: "Attack methods include active and passive techniques",
      parentNodeId: "R_aspect_attacks",
      requirementIds: ["R1"],
    }));
    const source = await saveSourceEvidence(ctx, {
      taskId: "T_attacks",
      reportNodeId: "R_hyp_attacks",
      branchId: "B_attacks",
      index: 1,
      title: "Attack source",
      url: "https://publisher.test/attacks",
      snippet: "Primary evidence describing active and passive Wi-Fi sensing attack techniques.",
      sourceTier: "primary",
      qualityScore: 0.9,
      relation: "supports",
      claimText: "Active and passive attack techniques exist.",
      confidence: 0.85,
    });
    if (!source) throw new Error("expected source evidence");
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "merge_report_nodes",
      sourceNodeId: "R_hyp_attacks",
      targetNodeId: "R_aspect_attacks",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toEqual([expect.objectContaining({
      decision: "reject",
      rationale: expect.stringContaining("break leaf-level grounding"),
    })]);
    await expect(ctx.stack.kg.getReportNode("R_hyp_attacks")).resolves.toMatchObject({ status: "planned" });
    await expect(ctx.stack.kg.listEvidenceLinks("R_hyp_attacks")).resolves.toEqual([
      expect.objectContaining({ linkId: source.evidenceLinkId, reportNodeId: "R_hyp_attacks" }),
    ]);
    await expect(ctx.stack.kg.listEvidenceLinks("R_aspect_attacks")).resolves.toHaveLength(0);
  });

  it("rejects duplicate aspect labels under the same parent", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_duplicate_aspect_guard";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_aspect_regulatory",
      nodeKind: "aspect",
      label: "Regulatory and Policy Responses",
      parentNodeId: "R_root",
    }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "add_aspect_node",
      parentNodeId: "R_root",
      label: "regulatory & policy responses",
      scopeNote: "Duplicate heading should not be added.",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toEqual([expect.objectContaining({ decision: "reject", rationale: expect.stringContaining("standalone aspect") })]);
    expect((await ctx.stack.kg.listReportNodes()).filter((item) => item.nodeKind === "aspect")).toHaveLength(1);
  });

  it("does not merge distinct sibling subjects that share one broad requirement", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_distinct_subject_merge_guard";
    ctx.state.globalRubric = {
      rubricId: "RB_distinct_subjects",
      episodeId: ctx.state.episodeId,
      rubricText: "Cover every product separately.",
      outputHints: { titleHint: "Products", language: "en", citationRequired: true, format: "markdown" },
      requirements: [requirement("R1", "Compare all listed products.", "question")],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", label: "Products", parentNodeId: "R_root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_betaflight", nodeKind: "hypothesis", label: "Betaflight uses ChibiOS as its RTOS, is written in C, and supports MSP", parentNodeId: "R_aspect", requirementIds: ["R1"] }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_inav", nodeKind: "hypothesis", label: "iNAV uses ChibiOS as its RTOS, is written in C, and supports MSP", parentNodeId: "R_aspect", requirementIds: ["R1"] }));
    ctx.state.agentResults.push(agentResultWithPatch({ op: "merge_report_nodes", sourceNodeId: "R_inav", targetNodeId: "R_betaflight" }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toEqual([expect.objectContaining({ decision: "reject", rationale: expect.stringContaining("distinct sibling subjects") })]);
    await expect(ctx.stack.kg.getReportNode("R_inav")).resolves.toMatchObject({ status: "planned" });
  });

  it("maps generated human-review questions to concerns by report node before list position", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "reordered-human-review",
      async chat() {
        return { content: JSON.stringify({
          summary: "Choose how to handle gaps.",
          questions: [{
            id: "q1",
            title: "Second concern first",
            question: "Should the second claim be omitted?",
            whyNeeded: "It lacks evidence.",
            answerFormat: "yes/no",
            options: ["Keep", "Omit"],
            recommendedAnswer: "Omit",
            reportNodeId: "R_second",
          }],
          responseInstructions: "Answer q1.",
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_human_review_node_mapping";

    const review = await createHumanReviewRequest(ctx, "completion_gate", "Evidence gaps remain.", [
      { id: "gap_first", title: "First", description: "First gap", reportNodeId: "R_first", requirementIds: ["R1"] },
      { id: "gap_second", title: "Second", description: "Second gap", reportNodeId: "R_second", requirementIds: ["R2"] },
    ]);

    expect(review.questions).toEqual([expect.objectContaining({ reportNodeId: "R_second", requirementIds: ["R2"] })]);
  });

  it("drops human-review questions that propose weakening a blocked-source rule", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "unsafe-blocked-source-human-review",
      async chat() {
        return { content: JSON.stringify({
          summary: "Choose how to continue.",
          questions: [{
            id: "unsafe",
            title: "Use blocked reference?",
            question: "May we mine the blocked reference for citations and then retrieve those papers?",
            whyNeeded: "It could provide leads.",
            answerFormat: "yes/no",
            options: ["Yes", "No"],
            reportNodeId: "R_first",
          }, {
            id: "safe",
            title: "Qualify the conclusion?",
            question: "Should the weak conclusion be retained with an explicit limitation?",
            whyNeeded: "Direct evidence remains sparse.",
            answerFormat: "yes/no",
            options: ["Retain with limitation", "Omit"],
            reportNodeId: "R_second",
          }],
          responseInstructions: "Answer safe.",
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_human_review_blocked_source_guard";

    const review = await createHumanReviewRequest(ctx, "completion_gate", "Evidence gaps remain.", [
      { id: "gap_first", title: "First", description: "First gap", reportNodeId: "R_first", requirementIds: ["R1"] },
      { id: "gap_second", title: "Second", description: "Second gap", reportNodeId: "R_second", requirementIds: ["R2"] },
    ]);

    expect(review.questions).toEqual([expect.objectContaining({ id: "safe", reportNodeId: "R_second" })]);
  });

  it("drops human-review questions that propose hypothetical or uncited evidence", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "unsafe-fabricated-evidence-human-review",
      async chat() {
        return { content: JSON.stringify({
          summary: "Choose how to continue.",
          questions: [{
            id: "hypothetical",
            title: "Use hypothetical examples?",
            question: "May we use hypothetical examples instead of real studies?",
            whyNeeded: "No source was found.",
            options: ["Use hypothetical examples", "Search for real studies"],
            reportNodeId: "R_first",
          }, {
            id: "uncited",
            title: "Use generic descriptions?",
            question: "Should we use generic descriptions without citations?",
            whyNeeded: "Evidence remains sparse.",
            options: ["Proceed without citations", "Omit"],
            reportNodeId: "R_second",
          }, {
            id: "downscope",
            title: "Reduce the minimum?",
            question: "Should we reduce the minimum from 15 studies to 4 and accept the report with gaps?",
            whyNeeded: "The required rows are missing.",
            options: ["Reduce the minimum", "Continue research"],
            reportNodeId: "R_fourth",
          }, {
            id: "approximate",
            title: "Use approximate sample sizes?",
            question: "Should we use approximate values for the missing sample sizes?",
            whyNeeded: "Exact values were not found.",
            options: ["Use approximate values", "Omit incomplete rows"],
            reportNodeId: "R_fifth",
          }, {
            id: "proxy",
            title: "Use a proxy methodology?",
            question: "Should we use a quasi-experimental study as a proxy for the missing RCT category?",
            whyNeeded: "No RCT was found.",
            options: ["Use it as a proxy", "Continue research"],
            reportNodeId: "R_sixth",
          }, {
            id: "safe",
            title: "Continue research?",
            question: "Should research continue for real primary studies, or should the unsupported claim be omitted?",
            whyNeeded: "Direct evidence remains missing.",
            options: ["Continue research", "Omit the claim"],
            reportNodeId: "R_third",
          }],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_human_review_fabricated_evidence_guard";

    const review = await createHumanReviewRequest(ctx, "completion_gate", "Evidence gaps remain.", [
      { id: "gap_first", title: "First", description: "First gap", reportNodeId: "R_first" },
      { id: "gap_second", title: "Second", description: "Second gap", reportNodeId: "R_second" },
      { id: "gap_third", title: "Third", description: "Third gap", reportNodeId: "R_third" },
      { id: "gap_fourth", title: "Fourth", description: "Fourth gap", reportNodeId: "R_fourth" },
      { id: "gap_fifth", title: "Fifth", description: "Fifth gap", reportNodeId: "R_fifth" },
      { id: "gap_sixth", title: "Sixth", description: "Sixth gap", reportNodeId: "R_sixth" },
    ]);

    expect(review.questions).toEqual([expect.objectContaining({ id: "safe", reportNodeId: "R_third" })]);
  });

  it("rejects dangerous structure patches with PatchGuard", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_dangerous_patch_guard";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_parent", nodeKind: "aspect", label: "Parent", parentNodeId: "R_root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_child", nodeKind: "aspect", label: "Child", parentNodeId: "R_aspect_parent" }));
    ctx.state.agentResults.push(agentResultWithPatch({
      op: "move_report_node",
      reportNodeId: "R_aspect_parent",
      fromParentId: "R_root",
      toParentId: "R_aspect_child",
    }));

    const decisions = await structureReviewPhase(ctx);

    expect(decisions).toEqual([
      expect.objectContaining({ decision: "reject", rationale: expect.stringContaining("dangerous") }),
    ]);
    await expect(ctx.stack.kg.getReportNode("R_aspect_parent")).resolves.toMatchObject({ parentNodeId: "R_root" });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "structure_critic_decision" && (event.payload?.critique as { risk?: string } | undefined)?.risk === "dangerous")).toBe(true);
    expect(events.some((event) => event.eventType === "patch_guard_decision" && (event.payload?.decision as { decision?: string } | undefined)?.decision === "reject")).toBe(true);
  });

  it("filters invalid worker structure patch suggestions before review decisions", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_filter_invalid_patch";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    ctx.state.agentResults.push({
      ...agentResultWithPatch({
        op: "rename_report_node",
        reportNodeId: "R_root",
        label: "Valid rename",
      }),
      structurePatchSuggestions: [
        {
          patch: { operation: "rename", nodeId: "R_root", label: "Invalid legacy patch" },
          rationale: "Legacy non-v5 patch shape.",
          confidence: 0.9,
        },
      ],
    } as unknown as AgentRunResult);

    await expect(structureReviewPhase(ctx)).resolves.toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "structure_review_suggestions_filtered" && event.payload?.dropped === 1)).toBe(true);
    expect(events.filter((event) => event.eventType === "full.structure.decision")).toHaveLength(0);
  });
});
