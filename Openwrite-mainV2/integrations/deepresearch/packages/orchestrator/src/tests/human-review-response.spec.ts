import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { HumanReviewRequest, ReportNode, ResearchRequirement } from "@deepresearch/contracts";
import { createPhaseContext } from "../phase-runner.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { applyHumanReviewResponse, validateResponse } from "../human-review-response.js";
import { restoreResearchCheckpoint, saveResearchCheckpoint } from "../checkpoint.js";
import { createInMemoryOrchestrator } from "../orchestrator.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("human review response", () => {
  it("validates question ids, actions, rationales, and target bindings", () => {
    const review = reviewRequest("R_leaf");
    expect(() => validateResponse({ decisions: [{ questionId: "missing", action: "omit", rationale: "Not material." }] }, review)).toThrow("Unknown human review questionId");
    expect(() => validateResponse({ decisions: [{ questionId: "quality_1", action: "omit", rationale: "" }] }, review)).toThrow("requires a rationale");
    expect(() => validateResponse({ decisions: [{ questionId: "quality_1", action: "omit", rationale: "Not material.", reportNodeId: "R_other" }] }, review)).toThrow("does not match");
  });

  it("queues a user-authorized repair with supplied sources", async () => {
    const { ctx, episodeDir } = await contextFixture();
    await writeFile(join(episodeDir, "human-review.json"), JSON.stringify(reviewRequest("R_leaf")), "utf8");

    const applied = await applyHumanReviewResponse(ctx, {
      submittedBy: "test-user",
      decisions: [{
        questionId: "quality_1",
        action: "continue_research",
        rationale: "Use the regulator's new release.",
        sourceUrls: ["https://regulator.gov.example/latest", "javascript:invalid"],
      }],
    });

    expect(applied.continueResearch).toBe(true);
    expect(applied.taskIds).toHaveLength(1);
    const task = await ctx.stack.ledger.getById(applied.taskIds[0]!);
    expect(task).toMatchObject({ reportNodeId: "R_leaf", status: "queued", priority: 100 });
    expect(task?.objective).toContain("https://regulator.gov.example/latest");
    expect(task?.objective).not.toContain("javascript:");
    expect((await ctx.stack.kg.getReportNode("R_leaf"))?.status).toBe("needs_repair");
    await expect(readFile(applied.responsePath, "utf8")).resolves.toContain("continue_research");
  });

  it("keeps source-quality risk waivers narrower than requirement-level waivers", async () => {
    const sourceRisk = await contextFixture();
    await writeFile(join(sourceRisk.episodeDir, "human-review.json"), JSON.stringify(reviewRequest("R_leaf")), "utf8");
    await applyHumanReviewResponse(sourceRisk.ctx, {
      decisions: [{ questionId: "quality_1", action: "accept_risk", rationale: "The remaining source mix is acceptable for this use." }],
    });
    expect(sourceRisk.ctx.state.issueWaivers).toEqual([
      expect.objectContaining({ issueCode: "missing_authoritative_source", requirementIds: [] }),
    ]);

    const requirementRisk = await contextFixture();
    await writeFile(
      join(requirementRisk.episodeDir, "human-review.json"),
      JSON.stringify(reviewRequest("R_leaf", "ungrounded_research_requirement")),
      "utf8",
    );
    await applyHumanReviewResponse(requirementRisk.ctx, {
      decisions: [{ questionId: "quality_1", action: "accept_risk", rationale: "The requirement may remain explicitly ungrounded." }],
    });
    expect(requirementRisk.ctx.state.issueWaivers).toEqual([
      expect.objectContaining({ issueCode: "ungrounded_research_requirement", requirementIds: ["RQ_CORE"] }),
    ]);
  });

  it("does not waive a requirement when another active leaf still owns it", async () => {
    const { ctx, episodeDir } = await contextFixture();
    await ctx.stack.kg.upsertReportNode(reportNode("R_leaf_alternative", "hypothesis", "R_aspect", ["RQ_CORE"]));
    await writeFile(join(episodeDir, "human-review.json"), JSON.stringify(reviewRequest("R_leaf")), "utf8");

    await applyHumanReviewResponse(ctx, {
      decisions: [{ questionId: "quality_1", action: "omit", rationale: "Use the alternative branch instead." }],
    });

    expect(ctx.state.issueWaivers[0]).toMatchObject({ issueCode: "missing_authoritative_source", requirementIds: [] });
    expect((await ctx.stack.kg.getReportNode("R_leaf"))?.status).toBe("pruned");
    expect((await ctx.stack.kg.getReportNode("R_leaf_alternative"))?.status).not.toBe("pruned");
  });

  it("runs one user-authorized repair cycle after the automatic cycle budget is exhausted", async () => {
    const { ctx, episodeDir, runtimeProfile } = await contextFixture();
    runtimeProfile.phases.dispatchEvidence!.maxCycles = 1;
    await writeFile(join(episodeDir, "human-review.json"), JSON.stringify(reviewRequest("R_leaf")), "utf8");
    const checkpointPath = await saveResearchCheckpoint(ctx, { stage: "after_structure_review", nextCycle: 2, pass: 1 });
    if (!checkpointPath) throw new Error("checkpoint expected");

    await createInMemoryOrchestrator({
      resumeCheckpointPath: checkpointPath,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      humanReviewResponse: {
        decisions: [{ questionId: "quality_1", action: "continue_research", rationale: "Spend one more cycle on the approved repair." }],
      },
    }).runEpisode({ sessionId: "ignored", userInput: "__resume__" });

    const restored = await restoreResearchCheckpoint(join(episodeDir, "checkpoints"), { runtimeProfile, llm: new EchoJsonLlm() });
    const events = await restored.ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({
      eventType: "dispatch_cycle_started",
      payload: expect.objectContaining({ cycle: 2, maxCycles: 2 }),
    }));
    expect((await restored.ctx.stack.ledger.listAll()).find((task) => task.taskId.startsWith("T_human_review_"))?.status).not.toBe("queued");
  });

  it("applies an omit decision, persists a waiver, and resumes to a new final report", async () => {
    const { ctx, episodeDir, runtimeProfile } = await contextFixture();
    const review = reviewRequest("R_leaf");
    await writeFile(join(episodeDir, "human-review.json"), JSON.stringify(review), "utf8");
    const checkpointPath = await saveResearchCheckpoint(ctx, { stage: "after_structure_review", nextCycle: 2, pass: 1 });
    if (!checkpointPath) throw new Error("checkpoint expected");

    const result = await createInMemoryOrchestrator({
      resumeCheckpointPath: checkpointPath,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      humanReviewResponse: {
        submittedBy: "test-user",
        decisions: [{ questionId: "quality_1", action: "omit", rationale: "This claim is outside the desired scope." }],
      },
    }).runEpisode({ sessionId: "ignored", userInput: "__resume__" });

    expect(result.status).toBe("succeeded");
    expect(result.humanReviewResponsePath).toContain("human-review-response.json");
    const audit = JSON.parse(await readFile(result.evidenceQualityAuditPath!, "utf8")) as {
      requirementCoverage: { entries: Array<{ requirementId: string; status: string; waiverId?: string }> };
      issues: unknown[];
    };
    expect(audit.requirementCoverage.entries).toContainEqual(expect.objectContaining({
      requirementId: "RQ_CORE",
      status: "waived",
      waiverId: expect.stringMatching(/^W_/),
    }));
    expect(audit.issues).toEqual([]);
  });
});

async function contextFixture() {
  const dir = await mkdtemp(join(tmpdir(), "dr-human-review-response-"));
  dirs.push(dir);
  const runtimeProfile = loadDefaultRuntimeProfile();
  runtimeProfile.artifactDir = dir;
  runtimeProfile.hilMode = "explicit";
  const ctx = createPhaseContext({ sessionId: "S_review", userInput: "Evaluate the core claim." }, {
    runtimeProfile,
    artifactDir: dir,
    llm: new EchoJsonLlm(),
    now: () => Date.UTC(2026, 6, 14),
  });
  ctx.state.episodeId = "EP_review_response";
  const requirement: ResearchRequirement = {
    requirementId: "RQ_CORE",
    description: "Evaluate the core claim.",
    kind: "question",
    priority: "must",
    evidenceRequired: true,
    evidenceNeeds: ["Independent authoritative evidence"],
    successCriteria: ["The report evaluates the claim"],
  };
  ctx.state.globalRubric = {
    rubricId: "RB_review",
    episodeId: ctx.state.episodeId,
    rubricText: "Evaluate the core claim.",
    outputHints: { titleHint: "Review response", language: "en", citationRequired: true, format: "markdown" },
    requirements: [requirement],
  };
  const root = reportNode("R_root", "root", null, [requirement.requirementId]);
  const aspect = reportNode("R_aspect", "aspect", root.nodeId, [requirement.requirementId]);
  const leaf = reportNode("R_leaf", "hypothesis", aspect.nodeId, [requirement.requirementId]);
  ctx.state.rootNode = root;
  await ctx.stack.kg.upsertReportNode(root);
  await ctx.stack.kg.upsertReportNode(aspect);
  await ctx.stack.kg.upsertReportNode(leaf);
  const episodeDir = join(dir, ctx.state.episodeId);
  await mkdir(episodeDir, { recursive: true });
  return { ctx, episodeDir, runtimeProfile };
}

function reviewRequest(reportNodeId: string, issueCode = "missing_authoritative_source"): HumanReviewRequest {
  return {
    stage: "completion_gate",
    summary: "Evidence quality remains unresolved.",
    generatedAt: "2026-07-14T00:00:00.000Z",
    responseInstructions: "Submit one decision per question ID.",
    questions: [{
      id: "quality_1",
      title: issueCode,
      issueCode,
      question: "Should the claim be researched further, downplayed, omitted, or accepted with risk?",
      whyNeeded: "The claim lacks an authoritative source.",
      answerFormat: "continue_research | downplay | omit | accept_risk",
      options: ["continue_research", "downplay", "omit", "accept_risk"],
      reportNodeId,
      requirementIds: ["RQ_CORE"],
    }],
  };
}

function reportNode(nodeId: string, nodeKind: ReportNode["nodeKind"], parentNodeId: string | null, requirementIds: string[]): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    requirementIds,
    label: nodeId,
    scopeNote: nodeId,
    status: nodeKind === "hypothesis" ? "needs_repair" : "planned",
    hypothesis: nodeKind === "hypothesis" ? { statement: nodeId, researchBrief: nodeId, evidenceGuidance: nodeId } : undefined,
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}
