import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  NotFoundError,
  ValidationError,
  type AgentRunResult,
  type ContextPacket,
  type EvidenceLink,
  type GlobalRubric,
  type KnowledgeNode,
  type ReportBundle,
  type ReportNode,
  type ResearchContext,
  type RuntimeProfile,
  type StructurePatch,
  type TaskItem,
  isTerminalStatus,
  reportNodeConfidence,
} from "../index.js";

const ISO = "2026-07-01T00:00:00.000Z";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

describe("v5 contracts", () => {
  it("uses the reduced ResearchContext shape", () => {
    const ctx: ResearchContext = {
      episodeId: "EP_20260701_001",
      sessionId: "S_1",
      userInput: "Research the transition from land finance to property tax.",
      expectedArtifacts: ["report", "evidence_index"],
    };

    expect(ctx.userInput).toContain("property tax");
    expect("scope" in ctx).toBe(false);
    expect("constraints" in ctx).toBe(false);
  });

  it("represents rubric as natural-language constraints plus light output hints", () => {
    const rubric: GlobalRubric = {
      rubricId: "RB_001",
      episodeId: "EP_20260701_001",
      rubricText: "Write in Chinese. Use official sources first. Avoid unsupported strong claims.",
      outputHints: {
        titleHint: "Property tax transition",
        language: "zh-CN",
        citationRequired: true,
        format: "markdown",
      },
      researchQuestionHints: ["Fiscal replacement capacity", "Pilot evidence"],
    };

    expect(rubric.rubricText).toContain("official sources");
    expect(rubric.researchQuestionHints).toHaveLength(2);
  });

  it("keeps ReportNode coverage to support, contradict, and gap counts", () => {
    const node: ReportNode = {
      nodeId: "R_hyp_1",
      nodeKind: "hypothesis",
      label: "Replacement capacity",
      parentNodeId: "R_aspect_1",
      scopeNote: "Assess whether recurring property tax can replace land sale revenue.",
      status: "supported",
      hypothesis: {
        statement: "Property tax can only partially replace land sale revenue in the medium term.",
        researchBrief: "Compare land sale revenue with property tax estimates and uncertainty.",
        evidenceGuidance: "Prefer official fiscal data and peer-reviewed or institutional estimates.",
      },
      coverage: {
        supportingCount: 2,
        contradictingCount: 1,
        openGapCount: 1,
      },
      createdAt: ISO,
      updatedAt: ISO,
    };

    expect(reportNodeConfidence(node)).toBe(0.5);
    expect(`${"neutral"}Count` in node.coverage).toBe(false);
    expect(isTerminalStatus(node.status)).toBe(true);
  });

  it("uses EvidenceLink as the only report-to-knowledge binding", () => {
    const knowledge: KnowledgeNode = {
      nodeId: "K_web_001",
      nodeType: "WebPage",
      title: "Fiscal data",
      url: "https://example.test/fiscal",
      contentHash: "sha256:abc",
      summary: "Official fiscal summary.",
      sourceTier: "official",
      qualityScore: 0.95,
      retrievedByTaskId: "T_1",
      retrievedAt: ISO,
      metadata: { publisher: "Example Ministry", language: "en-US" },
    };
    const link: EvidenceLink = {
      linkId: "E_1",
      reportNodeId: "R_hyp_1",
      knowledgeNodeId: knowledge.nodeId,
      relation: "supports",
      claimText: "Official data supports the fiscal trend claim.",
      evidenceQuote: "Fiscal revenue declined year over year.",
      confidence: 0.86,
      createdByTaskId: "T_1",
      createdAt: ISO,
    };

    expect(`${"retrieved"}ByBranchId` in knowledge).toBe(false);
    expect(`${"retrieval"}Query` in knowledge.metadata).toBe(false);
    expect(`${"created"}ByBranchId` in link).toBe(false);
    expect(link.knowledgeNodeId).toBe(knowledge.nodeId);
  });

  it("requires non-empty task acceptance criteria by convention", () => {
    const task: TaskItem = {
      taskId: "T_1",
      parentTaskId: null,
      reportNodeId: "R_hyp_1",
      title: "Verify replacement capacity",
      objective: "Find evidence for replacement capacity estimates.",
      status: "queued",
      priority: 90,
      branchId: "B_1",
      acceptanceCriteria: ["At least one source with tax base assumptions."],
      createdAt: ISO,
      updatedAt: ISO,
    };

    expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
  });

  it("builds explicit ContextPacket for evidence agents", () => {
    const packet: ContextPacket = {
      globalRubric: {
        rubricText: "Use citations.",
        outputHints: { language: "zh-CN", citationRequired: true },
      },
      currentTask: {
        taskId: "T_1",
        branchId: "B_1",
        reportNodeId: "R_hyp_1",
        objective: "Verify a hypothesis.",
        acceptanceCriteria: ["Find support or contradiction."],
      },
      currentReportNode: {
        nodeId: "R_hyp_1",
        nodeKind: "hypothesis",
        label: "Capacity",
        scopeNote: "Scope",
      },
      siblingTasks: [{ taskId: "T_2", title: "Risk", status: "completed" }],
      relevantEvidence: [{
        knowledgeNodeId: "K_1",
        title: "Known source",
        sourceTier: "official",
        summary: "Existing summary",
        relation: "background",
      }],
      budget: {
        maxReactSteps: 8,
        maxToolCalls: 16,
        maxSearchCalls: 4,
        maxFetchCalls: 4,
      },
      availableTools: [{ toolName: "web_search", description: "Search the web" }],
      bindingContext: {
        currentReportNodeId: "R_hyp_1",
        currentTaskId: "T_1",
        currentBranchId: "B_1",
      },
    };

    expect(packet.bindingContext.currentTaskId).toBe(packet.currentTask.taskId);
    expect(packet.availableTools[0]?.toolName).toBe("web_search");
  });

  it("unifies scout and evidence outputs as AgentRunResult", () => {
    const result: AgentRunResult = {
      agentRunId: "A_1",
      taskId: "T_1",
      reportNodeId: "R_hyp_1",
      branchId: "B_1",
      branchOutcome: "done_here",
      knowledgeNodeIds: ["K_1"],
      evidenceLinkIds: ["E_1"],
      nodeUpdates: [{
        reportNodeId: "R_hyp_1",
        oldStatus: "researching",
        newStatus: "supported",
        reason: "Found evidence.",
        confidence: 0.8,
      }],
      openGaps: [],
      structurePatchSuggestions: [],
      turnSummary: {
        actionSummary: "Searched and saved evidence.",
        searchSummary: "Official source first.",
        reasoningSummary: "Evidence supports the claim.",
        citedKnowledgeNodeIds: ["K_1"],
        citedEvidenceLinkIds: ["E_1"],
      },
    };

    expect(result.branchOutcome).toBe("done_here");
  });

  it("defines ReportBundle as the only reporter input", () => {
    const root: ReportNode = {
      nodeId: "R_root",
      nodeKind: "root",
      label: "Report title",
      parentNodeId: null,
      scopeNote: "Must follow rubric.",
      status: "planned",
      coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
      createdAt: ISO,
      updatedAt: ISO,
    };
    const bundle: ReportBundle = {
      episodeId: "EP_20260701_001",
      root,
      tree: [{ node: root, children: [], evidence: [], reportlets: [], openGaps: [] }],
      globalEvidenceIndex: [],
      constraints: {
        language: "zh-CN",
        citationRequired: true,
        rubricId: "RB_001",
        rubricText: "Use citations.",
      },
    };

    expect(bundle.root.nodeId).toBe("R_root");
  });

  it("uses v5 patch operation names", () => {
    const patch: StructurePatch = {
      op: "add_hypothesis_node",
      parentNodeId: "R_aspect_1",
      statement: "Risk requires separate analysis.",
      researchBrief: "Investigate fiscal and market risks.",
      evidenceGuidance: "Find official and institutional sources.",
    };

    expect(patch.op).toBe("add_hypothesis_node");
  });

  it("ships a default RuntimeProfile config", () => {
    const raw = readFileSync(resolve(repoRoot, "configs/runtime/default.json"), "utf8");
    const profile = JSON.parse(raw) as RuntimeProfile;

    expect(profile.hilMode).toBe("auto_accept");
    expect(profile.llm.rubric?.temperature).toBe(0.2);
    expect(profile.phases.dispatchEvidence?.maxParallelAgents).toBeGreaterThan(0);
    expect(profile.agents.evidence?.outputRepairAttempts).toBe(2);
  });
});

describe("errors", () => {
  it("keeps typed framework errors", () => {
    expect(new NotFoundError("KnowledgeNode", "K_1").message).toContain("K_1");
    expect(new ValidationError("bad", "field").field).toBe("field");
  });
});
