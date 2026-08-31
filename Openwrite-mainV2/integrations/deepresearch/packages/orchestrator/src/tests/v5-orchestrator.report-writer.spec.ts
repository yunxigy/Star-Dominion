import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { FetchProvider, KnowledgeNode, LlmChat, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { restoreResearchCheckpoint, saveResearchCheckpoint } from "../checkpoint.js";
import { createPhaseContext } from "../phase-runner.js";
import { reportPhase } from "../phases/report.js";
import { runWriterDraftAgent } from "../phases/report-writer.js";
import { fixedNow, submission, node, task, scriptedEvidenceReact, bundle } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("repairs a malformed writer finish envelope instead of rendering protocol JSON", async () => {
    const dir = await artifactDir();
    let calls = 0;
    const llm: LlmChat = {
      name: "scripted-malformed-writer-envelope",
      async chat() {
        calls += 1;
        if (calls === 1) {
          return { content: '{"thoughtSummary":"Drafted.","action":"finish","finish":{"markdown":"### 结构方法\\n\\n本节不把"三幕式"写成已证实结论。"}}' };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Repaired malformed JSON.",
          action: "finish",
          finish: { markdown: "### 结构方法\n\n本节不把‘三幕式’写成已证实结论。" },
        }) };
      },
    };
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_malformed_writer_envelope";

    const markdown = await runWriterDraftAgent(ctx, {
      phase: "report.leaf",
      reportNodeId: "R_hyp_structure",
      title: "LeafWriterAgent 结构方法",
      objective: "Write a bounded structure section.",
      language: "zh-CN",
      prompt: "Draft one focused subsection and return Markdown only.",
    });

    expect(calls).toBe(2);
    expect(markdown).toBe("### 结构方法\n\n本节不把‘三幕式’写成已证实结论。");
    expect(markdown).not.toContain("thoughtSummary");
    expect(markdown).not.toContain('"action"');
  });

  it("drafts final reports by aspect sections before synthesis", async () => {
    const dir = await artifactDir();
    let leafCalls = 0;
    let sectionCalls = 0;
    let synthCalls = 0;
    const llm: LlmChat = {
      name: "scripted-section-report",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Write a sectioned report.",
            outputHints: { titleHint: "Sectioned", language: "en", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["a", "b"],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["section source"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [
              {
                label: "Aspect A",
                scopeNote: "Aspect A scope",
                hypotheses: [{ statement: "Claim A.", researchBrief: "Research A.", evidenceGuidance: "Search A." }],
                tasks: [{ title: "Task A", objective: "Find A.", acceptanceCriteria: ["Save A."] }],
              },
              {
                label: "Aspect B",
                scopeNote: "Aspect B scope",
                hypotheses: [{ statement: "Claim B.", researchBrief: "Research B.", evidenceGuidance: "Search B." }],
                tasks: [{ title: "Task B", objective: "Find B.", acceptanceCriteria: ["Save B."] }],
              },
            ],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && !user.includes("ReflectionSchedulerAgent") && !user.includes("StructureReviewAgent") && !user.includes("\"role\": \"reporter\"")) {
          return scriptedEvidenceReact(user, {
            query: "section evidence",
            title: "Section evidence source",
            url: "https://example.test/section-evidence",
            content: "This source contains detailed section evidence and is long enough to pass source quality validation.",
            claimText: "Claim is supported.",
            reasoningSummary: "Saved explicit evidence for the section claim.",
          });
        }
        if (user.includes("Create a search plan")) {
          return { content: JSON.stringify({ queries: ["section evidence"], searchRationale: "Search." }) };
        }
        if (user.includes("Assess the search observations")) {
          return { content: JSON.stringify({
            relation: "supports",
            claimText: "Claim is supported.",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Supported.",
            openGaps: [],
            structurePatchSuggestions: [],
          }) };
        }
        if (user.includes("Reflect on this dispatch cycle")) {
          return { content: JSON.stringify({ continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] }) };
        }
        if (user.includes("Review this report tree")) {
          return { content: JSON.stringify({ suggestions: [] }) };
        }
        if (user.includes("Draft one focused subsection")) {
          leafCalls += 1;
          return { content: `### Drafted Leaf ${leafCalls}\n\nDetailed grounded leaf ${leafCalls} [C1].` };
        }
        if (user.includes("Draft one top-level section overview")) {
          sectionCalls += 1;
          const title = user.includes("Aspect A") ? "Aspect A" : "Aspect B";
          return { content: `## ${title}\n\nDetailed grounded section ${sectionCalls} [C1].` };
        }
        if (user.includes("Write only the opening executive summary")) {
          synthCalls += 1;
          return { content: "## Executive Summary\n\nSectioned summary [C1].\n\n## Conclusion\n\nSectioned conclusion complete." };
        }
        return { content: "{}" };
      },
    };
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.maxLlmCalls = 8;
    const search: SearchProvider = {
      name: "fixture-search",
      async search(query) {
        return [{ url: `https://example.test/${encodeURIComponent(query)}`, title: `Source ${query}`, snippet: "Evidence supports the claim." }];
      },
    };
    const result = await createInMemoryOrchestrator({ now: fixedNow, artifactDir: dir, runtimeProfile, llm, search }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    expect(leafCalls).toBe(2);
    expect(sectionCalls).toBe(0);
    expect(synthCalls).toBe(1);
    const report = await readFile(result.reportArtifactPath, "utf8");
    expect(report).toContain("## Aspect A");
    expect(report).toContain("## Aspect B");
    expect(report).toContain("Detailed grounded leaf 1 [C1]");
    expect(report).toContain("Detailed grounded leaf 2 [C1]");
    expect(report).toContain("## Executive Summary");
    expect(report).toContain("## Conclusion");
    expect(report).not.toContain("## 执行摘要");
  });

  it("drafts every leaf report node before synthesizing top-level aspect sections", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.maxLlmCalls = 6;
    const leafNodeIds: string[] = [];
    let sectionCalls = 0;
    let synthCalls = 0;
    const llm: LlmChat = {
      name: "scripted-leaf-first-report",
      async chat(req) {
        const user = req.user;
        if (user.includes("Draft one focused subsection")) {
          if (user.includes("\"nodeId\": \"R_hyp_leaf\"")) leafNodeIds.push("R_hyp_leaf");
          if (user.includes("\"nodeId\": \"R_aspect_nested\"")) leafNodeIds.push("R_aspect_nested");
          return { content: `### Leaf ${leafNodeIds.length}\n\nLeaf draft ${leafNodeIds.at(-1)}.` };
        }
        if (user.includes("Draft one top-level section overview")) {
          sectionCalls += 1;
          expect(user).toContain("Leaf draft R_hyp_leaf");
          expect(user).toContain("Leaf draft R_aspect_nested");
          return { content: "## Top Aspect\n\nSection overview only; the model intentionally does not repeat leaf bodies." };
        }
        if (user.includes("Write only the opening executive summary")) {
          synthCalls += 1;
          return { content: "# Leaf First\n\n## Top Aspect\n\nSection from all leaf nodes.\n\n## 结论\n\n结论完整。" };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_leaf_first_report";
    ctx.state.globalRubric = {
      rubricId: "RB_leaf_first",
      episodeId: ctx.state.episodeId,
      rubricText: "Write leaf-first report.",
      outputHints: { titleHint: "Leaf First", language: "zh-CN", citationRequired: false, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_top", nodeKind: "aspect", parentNodeId: "R_root", label: "Top Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_leaf", nodeKind: "hypothesis", parentNodeId: "R_aspect_top", label: "Hypothesis leaf" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_nested", nodeKind: "aspect", parentNodeId: "R_aspect_top", label: "Nested aspect leaf" }));

    const { artifact } = await reportPhase(ctx);

    expect(leafNodeIds.sort()).toEqual(["R_aspect_nested", "R_hyp_leaf"]);
    expect(sectionCalls).toBe(1);
    expect(synthCalls).toBe(1);
    expect(artifact.reportMd).toContain("Section overview only");
    expect(artifact.reportMd).toContain("Leaf draft R_hyp_leaf");
    expect(artifact.reportMd).toContain("Leaf draft R_aspect_nested");
  });

  it("drafts independent leaves and aspects with bounded concurrency while preserving tree order", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.maxLlmCalls = 12;
    runtimeProfile.phases.report.maxConcurrentAgents = 2;
    let activeLeaves = 0;
    let activeSections = 0;
    let maxActiveLeaves = 0;
    let maxActiveSections = 0;
    const llm: LlmChat = {
      name: "scripted-concurrent-bottom-up-writer",
      async chat(req) {
        if (req.user.includes("Draft one focused subsection")) {
          activeLeaves += 1;
          maxActiveLeaves = Math.max(maxActiveLeaves, activeLeaves);
          const label = ["Leaf A1", "Leaf A2", "Leaf B1", "Leaf B2"].find((item) => req.user.includes(item)) ?? "Unknown leaf";
          await new Promise((resolve) => setTimeout(resolve, 30));
          activeLeaves -= 1;
          return { content: `### ${label}\n\nConcurrent content for ${label}.` };
        }
        if (req.user.includes("Draft one top-level section overview")) {
          activeSections += 1;
          maxActiveSections = Math.max(maxActiveSections, activeSections);
          const label = req.user.includes("Aspect A") ? "Aspect A" : "Aspect B";
          await new Promise((resolve) => setTimeout(resolve, 30));
          activeSections -= 1;
          return { content: `## ${label}\n\nConcurrent synthesis for ${label}.` };
        }
        if (req.user.includes("Write only the opening executive summary")) {
          return { content: "## Executive Summary\n\nConcurrent lower-level drafts completed.\n\n## Conclusion\n\nOrdered assembly completed." };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_concurrent_bottom_up_writer";
    ctx.state.globalRubric = {
      rubricId: "RB_concurrent_bottom_up_writer",
      episodeId: ctx.state.episodeId,
      rubricText: "Draft independent report branches concurrently.",
      outputHints: { titleHint: "Concurrent Bottom Up", language: "en", citationRequired: false, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    for (const aspect of ["A", "B"]) {
      const aspectId = `R_aspect_${aspect.toLowerCase()}`;
      await ctx.stack.kg.upsertReportNode(node({ nodeId: aspectId, nodeKind: "aspect", parentNodeId: "R_root", label: `Aspect ${aspect}` }));
      for (const leaf of ["1", "2"]) {
        await ctx.stack.kg.upsertReportNode(node({
          nodeId: `R_leaf_${aspect.toLowerCase()}${leaf}`,
          nodeKind: "hypothesis",
          parentNodeId: aspectId,
          label: `Leaf ${aspect}${leaf}`,
        }));
      }
    }

    const { artifact } = await reportPhase(ctx);

    expect(maxActiveLeaves).toBe(2);
    expect(maxActiveSections).toBe(2);
    expect(activeLeaves).toBe(0);
    expect(activeSections).toBe(0);
    const positions = ["Leaf A1", "Leaf A2", "Leaf B1", "Leaf B2"].map((label) => artifact.reportMd.indexOf(`Concurrent content for ${label}`));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("reuses completed leaf and section drafts after a synthesis failure and checkpoint resume", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "writer-resume-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.maxLlmCalls = 6;
    let firstLeafCalls = 0;
    let firstSectionCalls = 0;
    let firstSynthesisCalls = 0;
    const failingLlm: LlmChat = {
      name: "scripted-writer-resume-failure",
      async chat(req) {
        if (req.user.includes("Draft one focused subsection")) {
          firstLeafCalls += 1;
          const label = req.user.includes("Leaf A") ? "Leaf A" : "Leaf B";
          return { content: `### ${label}\n\nCached draft for ${label}.` };
        }
        if (req.user.includes("Draft one top-level section overview")) {
          firstSectionCalls += 1;
          return { content: "## Aspect\n\nCached aspect synthesis from both leaf drafts." };
        }
        if (req.user.includes("Write only the opening executive summary")) {
          firstSynthesisCalls += 1;
          throw new Error("synthetic root synthesis outage");
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: failingLlm });
    ctx.state.episodeId = "EP_writer_resume_cache";
    ctx.state.globalRubric = {
      rubricId: "RB_writer_resume_cache",
      episodeId: ctx.state.episodeId,
      rubricText: "Resume bottom-up report writing.",
      outputHints: { titleHint: "Writer Resume", language: "en", citationRequired: false, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf_a", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Leaf A" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf_b", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Leaf B" }));
    const checkpointPath = await saveResearchCheckpoint(ctx, { stage: "after_structure_review", nextCycle: 1, pass: 1 }, { checkpointDir });

    await expect(reportPhase(ctx)).rejects.toThrow("synthetic root synthesis outage");
    expect(firstLeafCalls).toBe(2);
    expect(firstSectionCalls).toBe(1);
    expect(firstSynthesisCalls).toBe(1);

    let resumedLeafCalls = 0;
    let resumedSectionCalls = 0;
    let resumedSynthesisCalls = 0;
    let allowInvalidatedRewrite = false;
    const recoveryLlm: LlmChat = {
      name: "scripted-writer-resume-success",
      async chat(req) {
        if (req.user.includes("Draft one focused subsection")) {
          resumedLeafCalls += 1;
          return { content: allowInvalidatedRewrite
            ? "### Leaf A revised\n\nRegenerated after the leaf input changed."
            : "### Unexpected leaf rewrite\n\nThis should not run." };
        }
        if (req.user.includes("Draft one top-level section overview")) {
          resumedSectionCalls += 1;
          return { content: allowInvalidatedRewrite
            ? "## Aspect\n\nRegenerated aspect after one child changed."
            : "## Unexpected section rewrite\n\nThis should not run." };
        }
        if (req.user.includes("Write only the opening executive summary")) {
          resumedSynthesisCalls += 1;
          return { content: "## Executive Summary\n\nRecovered from cached lower-level drafts.\n\n## Conclusion\n\nRecovery completed." };
        }
        return { content: "{}" };
      },
    };
    const restored = await restoreResearchCheckpoint(checkpointPath!, { now: fixedNow, llm: recoveryLlm });
    const { artifact } = await reportPhase(restored.ctx);

    expect(resumedLeafCalls).toBe(0);
    expect(resumedSectionCalls).toBe(0);
    expect(resumedSynthesisCalls).toBe(1);
    expect(artifact.reportMd).toContain("Cached draft for Leaf A");
    expect(artifact.reportMd).toContain("Cached draft for Leaf B");
    expect(artifact.reportMd).toContain("Cached aspect synthesis");
    expect(artifact.reportMd).toContain("Recovered from cached lower-level drafts");
    const events = await restored.ctx.stack.memory.listEvents({ episodeId: restored.ctx.state.episodeId });
    expect(events.filter((event) => event.eventType === "writer_draft_cache_hit")).toHaveLength(3);

    allowInvalidatedRewrite = true;
    const changedLeaf = await restored.ctx.stack.kg.getReportNode("R_leaf_a");
    if (!changedLeaf) throw new Error("changed leaf required");
    await restored.ctx.stack.kg.updateReportNode({
      ...changedLeaf,
      label: "Leaf A revised",
      updatedAt: new Date(fixedNow() + 1_000).toISOString(),
    });
    const regenerated = await reportPhase(restored.ctx);
    expect(resumedLeafCalls).toBe(1);
    expect(resumedSectionCalls).toBe(1);
    expect(resumedSynthesisCalls).toBe(2);
    expect(regenerated.artifact.reportMd).toContain("Regenerated after the leaf input changed");
    expect(regenerated.artifact.reportMd).toContain("Cached draft for Leaf B");
    expect(regenerated.artifact.reportMd).toContain("Regenerated aspect after one child changed");
  });

  it("falls back to a complete bundle report when report call budget cannot cover every aspect section", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.maxLlmCalls = 3;
    let writeCalls = 0;
    let sectionCalls = 0;
    let synthCalls = 0;
    let writePrompt = "";
    const llm: LlmChat = {
      name: "scripted-low-budget-report",
      async chat(req) {
        if (req.user.includes("Write the final report")) {
          writeCalls += 1;
          writePrompt = req.user;
          return { content: "# Low Budget\n\n## Aspect A\n\nA.\n\n## Aspect B\n\nB.\n\n## Aspect C\n\nC.\n\n## 结论\n\n结论完整。" };
        }
        if (req.user.includes("Draft one top-level section overview")) sectionCalls += 1;
        if (req.user.includes("Synthesize the final report")) synthCalls += 1;
        return { content: "## Unexpected\n\nUnexpected." };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_low_budget_report";
    ctx.state.globalRubric = {
      rubricId: "RB_low_budget",
      episodeId: ctx.state.episodeId,
      rubricText: "Write all aspects.",
      outputHints: { titleHint: "Low Budget", language: "zh-CN", citationRequired: false, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    for (const [index, label] of ["Aspect A", "Aspect B", "Aspect C"].entries()) {
      const aspectId = `R_aspect_${index + 1}`;
      const hypId = `R_hyp_${index + 1}`;
      await ctx.stack.kg.upsertReportNode(node({ nodeId: aspectId, nodeKind: "aspect", parentNodeId: "R_root", label }));
      await ctx.stack.kg.upsertReportNode(node({ nodeId: hypId, nodeKind: "hypothesis", parentNodeId: aspectId, label: `${label} hypothesis` }));
    }

    const { artifact } = await reportPhase(ctx);

    expect(writeCalls).toBe(1);
    expect(sectionCalls).toBe(0);
    expect(synthCalls).toBe(0);
    expect(writePrompt).toContain("Aspect C");
    expect(artifact.reportMd).toContain("## Aspect C");
  });

  it("lets the writer inspect full cited source content before drafting a leaf", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.agents.writer) throw new Error("writer agent config required");
    runtimeProfile.agents.writer.maxFetchCalls = 1;
    runtimeProfile.agents.writer.maxReactSteps = 2;
    let leafPrompt = "";
    const fetchedUrls: string[] = [];
    const llm: LlmChat = {
      name: "scripted-writer-source-inspection",
      async chat(req) {
        const user = req.user;
        if (user.includes("Choose which cited source URLs should be opened")) {
          expect(user).toContain("Thin summary only");
          return { content: JSON.stringify({ citationIds: ["C1"], reasoningSummary: "Need the source body for detailed chronology." }) };
        }
        if (user.includes("Draft one focused subsection")) {
          leafPrompt = user;
          return { content: "### Leaf claim\n\nThe full source body gives the detailed sequence, not just the thin summary [C1]." };
        }
        if (user.includes("Draft one top-level section overview")) {
          return { content: "## Aspect\n\nOverview from the inspected leaf [C1]." };
        }
        if (user.includes("Write only the opening executive summary")) {
          return { content: "## 执行摘要\n\nSummary grounded in inspected source content [C1].\n\n## 结论\n\nConclusion complete。" };
        }
        return { content: "{}" };
      },
    };
    const fetch: FetchProvider = {
      name: "writer-fixture-fetch",
      async fetchPage(url) {
        fetchedUrls.push(url);
        return {
          url,
          title: "Full Source",
          content: "FULL SOURCE CONTENT: first the policy was introduced, then implementation expanded, and finally later evaluation recorded concrete effects.",
          description: "Full source description.",
        };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, fetch });
    ctx.state.episodeId = "EP_writer_inspects_sources";
    ctx.state.globalRubric = {
      rubricId: "RB_writer_inspects_sources",
      episodeId: ctx.state.episodeId,
      rubricText: "Write with source inspection.",
      outputHints: { titleHint: "Writer Source Inspection", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Leaf claim" }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_full_source",
      nodeType: "WebPage",
      title: "Thin Source",
      url: "https://example.test/full-source",
      contentHash: "sha256:full-source",
      summary: "Thin summary only.",
      sourceTier: "official",
      qualityScore: 0.9,
      retrievedByTaskId: "T_leaf",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_full_source",
      reportNodeId: "R_leaf",
      knowledgeNodeId: "K_full_source",
      relation: "supports",
      claimText: "The source supports the leaf claim.",
      confidence: 0.9,
      createdByTaskId: "T_leaf",
      createdAt: new Date(fixedNow()).toISOString(),
    });

    const { artifact } = await reportPhase(ctx);

    expect(fetchedUrls).toEqual(["https://example.test/full-source"]);
    expect(leafPrompt).toContain("Fetched source excerpts selected for this leaf");
    expect(leafPrompt).toContain("FULL SOURCE CONTENT");
    expect(artifact.reportMd).toContain("The full source body gives the detailed sequence");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.writer.sourceInspectionPlan")).toBe(true);
    expect(events.some((event) => event.eventType === "full.fetch.response" && event.payload?.phase === "report.leaf.inspect")).toBe(true);
  });

  it("caps oversized writer contexts before leaf drafting", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.report) throw new Error("report phase config required");
    runtimeProfile.phases.report.contextTokenLimit = 60000;
    if (!runtimeProfile.agents.writer) throw new Error("writer agent config required");
    runtimeProfile.agents.writer.maxFetchCalls = 1;
    runtimeProfile.agents.writer.maxReactSteps = 1;

    const writerPromptLengths: number[] = [];
    const inspectorPromptLengths: number[] = [];
    const llm: LlmChat = {
      name: "scripted-capped-writer-context",
      async chat(req) {
        if (req.user.includes("\"agentId\": \"leaf_writer_source_inspector\"")) {
          inspectorPromptLengths.push(req.user.length);
          return { content: JSON.stringify({ thoughtSummary: "Catalog is compact enough.", action: "finish", finish: { reasoningSummary: "No fetch needed." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.leaf\"")) {
          writerPromptLengths.push(req.user.length);
          expect(req.user).not.toContain("CONTENT_PREVIEW_SHOULD_NOT_REACH_WRITER");
          return { content: JSON.stringify({ thoughtSummary: "Draft compact leaf.", action: "finish", finish: { markdown: "### Oversized leaf\n\nCompact evidence context still supports the claim [C1]." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.section\"")) {
          writerPromptLengths.push(req.user.length);
          return { content: JSON.stringify({ thoughtSummary: "Draft compact section.", action: "finish", finish: { markdown: "## Aspect\n\nSection overview stays compact [C1]." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.synthesize\"")) {
          writerPromptLengths.push(req.user.length);
          return { content: JSON.stringify({ thoughtSummary: "Draft compact synthesis.", action: "finish", finish: { markdown: "## 执行摘要\n\nSummary [C1].\n\n## 结论\n\nConclusion complete。" } }) };
        }
        return { content: "{}" };
      },
    };
    const fetch: FetchProvider = {
      name: "unused-writer-fetch",
      async fetchPage(url) {
        return { url, title: "Fetched", content: "Fetched source body." };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, fetch });
    ctx.state.episodeId = "EP_writer_context_cap";
    ctx.state.globalRubric = {
      rubricId: "RB_writer_context_cap",
      episodeId: ctx.state.episodeId,
      rubricText: "Write with compact context.",
      outputHints: { titleHint: "Writer Context Cap", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_leaf",
      nodeKind: "hypothesis",
      parentNodeId: "R_aspect",
      label: "Oversized leaf",
      status: "supported",
      coverage: { supportingCount: 900, contradictingCount: 0, openGapCount: 0 },
    }));
    const now = new Date(fixedNow()).toISOString();
    const longSummary = "Long summary. ".repeat(900);
    const longClaim = "Long claim text. ".repeat(500);
    const longPreview = `CONTENT_PREVIEW_SHOULD_NOT_REACH_WRITER ${"x".repeat(12000)}`;
    for (let i = 0; i < 900; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_context_cap_${i}`,
        nodeType: "WebPage",
        title: `Context cap source ${i}`,
        url: `https://example.test/context-cap/${i}`,
        contentHash: `sha256:context-cap-${i}`,
        summary: longSummary,
        sourceTier: "secondary",
        qualityScore: 0.7,
        retrievedByTaskId: `T_context_cap_${i}`,
        retrievedAt: now,
        metadata: {
          canonicalUrl: `https://example.test/context-cap/${i}`,
          searchSnippet: longSummary,
          contentPreview: longPreview,
        },
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_context_cap_${i}`,
        reportNodeId: "R_leaf",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: longClaim,
        confidence: 0.7,
        createdByTaskId: `T_context_cap_${i}`,
        createdAt: now,
      });
    }

    const { artifact } = await reportPhase(ctx);

    expect(artifact.reportMd).toContain("Compact evidence context");
    expect(inspectorPromptLengths.length).toBeGreaterThan(1);
    expect(writerPromptLengths.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...inspectorPromptLengths)).toBeLessThan(70000);
    expect(Math.max(...writerPromptLengths)).toBeLessThan(140000);
  });

  it("feeds oversized leaf evidence to the writer in batches until all citations are considered", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.agents.writer) throw new Error("writer agent config required");
    runtimeProfile.agents.writer.maxFetchCalls = 0;

    const leafPrompts: string[] = [];
    const llm: LlmChat = {
      name: "scripted-batched-leaf-evidence",
      async chat(req) {
        if (req.user.includes("\"agentId\": \"leaf_writer_source_inspector\"")) {
          return { content: JSON.stringify({ thoughtSummary: "No fetch needed.", action: "finish", finish: { reasoningSummary: "Summaries are enough." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.leaf\"")) {
          leafPrompts.push(req.user);
          const isRevision = req.user.includes("Revise the existing focused subsection");
          return {
            content: JSON.stringify({
              thoughtSummary: isRevision ? "Revised with next batch." : "Drafted first batch.",
              action: "finish",
              finish: {
                markdown: isRevision
                  ? "### Batched leaf\n\nThe revised subsection includes first-batch evidence [C1] and later evidence [C29]."
                  : "### Batched leaf\n\nThe initial subsection includes first-batch evidence [C1].",
              },
            }),
          };
        }
        if (req.user.includes("\"agentId\": \"report.section\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Section.", action: "finish", finish: { markdown: "## Aspect\n\nOverview." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.synthesize\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Synthesis.", action: "finish", finish: { markdown: "## 执行摘要\n\nSummary.\n\n## 结论\n\nConclusion complete." } }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_batched_leaf_evidence";
    ctx.state.globalRubric = {
      rubricId: "RB_batched_leaf_evidence",
      episodeId: ctx.state.episodeId,
      rubricText: "Write batched evidence report.",
      outputHints: { titleHint: "Batched Evidence", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Batched leaf", status: "supported" }));
    const now = new Date(fixedNow()).toISOString();
    for (let i = 1; i <= 29; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_batch_${i}`,
        nodeType: "WebPage",
        title: `Batch source ${String(i).padStart(2, "0")}`,
        url: `https://example.test/batch/${i}`,
        contentHash: `sha256:batch-${i}`,
        summary: `Summary for batch source ${i}.`,
        sourceTier: "secondary",
        qualityScore: 0.7,
        retrievedByTaskId: `T_batch_${i}`,
        retrievedAt: now,
        metadata: { canonicalUrl: `https://example.test/batch/${i}` },
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_batch_${i}`,
        reportNodeId: "R_leaf",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: `Claim supported by batch source ${i}.`,
        confidence: 0.7,
        createdByTaskId: `T_batch_${i}`,
        createdAt: now,
      });
    }

    const { artifact } = await reportPhase(ctx);

    expect(leafPrompts).toHaveLength(2);
    expect(leafPrompts[0]).toContain("[C1]");
    expect(leafPrompts[0]).not.toContain("[C29]");
    expect(leafPrompts[1]).toContain("[C29]");
    expect(leafPrompts[1]).toContain("Existing subsection draft");
    expect(artifact.reportMd).toContain("[C29]");
  });

  it("prefers pre-written reportlets over raw oversized leaf evidence during report drafting", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.agents.writer) throw new Error("writer agent config required");
    runtimeProfile.agents.writer.maxFetchCalls = 0;

    const leafPrompts: string[] = [];
    const llm: LlmChat = {
      name: "scripted-reportlet-first-leaf",
      async chat(req) {
        if (req.user.includes("\"agentId\": \"report.leaf\"")) {
          leafPrompts.push(req.user);
          expect(req.user).toContain("Pre-written atomic reportlets for this leaf");
          expect(req.user).toContain("Reportlet says later evidence matters [C29]");
          expect(req.user).not.toContain("Revise the existing focused subsection");
          return { content: JSON.stringify({
            thoughtSummary: "Drafted from reportlet.",
            action: "finish",
            finish: { markdown: "### Reportlet leaf\n\nReportlet-first drafting preserves the later source [C29]." },
          }) };
        }
        if (req.user.includes("\"agentId\": \"report.section\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Section.", action: "finish", finish: { markdown: "## Aspect\n\nOverview from reportlet leaf [C29]." } }) };
        }
        if (req.user.includes("\"agentId\": \"report.synthesize\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Synthesis.", action: "finish", finish: { markdown: "## 执行摘要\n\nSummary [C29].\n\n## 结论\n\nConclusion complete." } }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reportlet_first_leaf";
    ctx.state.globalRubric = {
      rubricId: "RB_reportlet_first_leaf",
      episodeId: ctx.state.episodeId,
      rubricText: "Write from reportlets first.",
      outputHints: { titleHint: "Reportlet First", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Reportlet leaf", status: "supported" }));
    const now = new Date(fixedNow()).toISOString();
    for (let i = 1; i <= 29; i++) {
      const knowledge: KnowledgeNode = {
        nodeId: `K_reportlet_${i}`,
        nodeType: "WebPage",
        title: `Reportlet source ${String(i).padStart(2, "0")}`,
        url: `https://example.test/reportlet/${i}`,
        contentHash: `sha256:reportlet-${i}`,
        summary: `Summary for reportlet source ${i}.`,
        sourceTier: "secondary",
        qualityScore: 0.7,
        retrievedByTaskId: `T_reportlet_${i}`,
        retrievedAt: now,
        metadata: { canonicalUrl: `https://example.test/reportlet/${i}` },
      };
      await ctx.stack.kg.upsertKnowledgeNode(knowledge);
      await ctx.stack.kg.upsertEvidenceLink({
        linkId: `E_reportlet_${i}`,
        reportNodeId: "R_leaf",
        knowledgeNodeId: knowledge.nodeId,
        relation: "supports",
        claimText: `Claim supported by reportlet source ${i}.`,
        confidence: 0.7,
        createdByTaskId: `T_reportlet_${i}`,
        createdAt: now,
      });
    }
    await ctx.stack.kg.upsertReportlet?.({
      reportletId: "RL_reportlet_first",
      reportNodeId: "R_leaf",
      taskId: "T_reportlet_first",
      title: "Reportlet leaf",
      markdown: "#### Reportlet leaf\n\nReportlet says later evidence matters [E:E_reportlet_29].",
      citedEvidenceLinkIds: ["E_reportlet_29"],
      citedKnowledgeNodeIds: ["K_reportlet_29"],
      createdAt: now,
      updatedAt: now,
    });

    const { artifact } = await reportPhase(ctx);

    expect(leafPrompts).toHaveLength(1);
    expect(artifact.reportMd).toContain("Reportlet-first drafting");
  });

  it("creates writer repair tasks for citation-required leaf nodes without evidence", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-writer-gap-repair",
      async chat(req) {
        const user = req.user;
        if (user.includes("Draft one focused subsection")) {
          return { content: "### Unsupported leaf\n\nThis leaf has no attached evidence, so it is reported as unsupported." };
        }
        if (user.includes("Draft one top-level section overview")) {
          return { content: "## Aspect\n\nThe unsupported leaf requires repair before publication." };
        }
        if (user.includes("Write only the opening executive summary")) {
          return { content: "## 执行摘要\n\nThis report contains a writer repair gap.\n\n## 结论\n\nConclusion complete." };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_writer_gap_repair";
    ctx.state.globalRubric = {
      rubricId: "RB_writer_gap_repair",
      episodeId: ctx.state.episodeId,
      rubricText: "Write with repair gaps.",
      outputHints: { titleHint: "Writer Gap Repair", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_leaf", nodeKind: "hypothesis", parentNodeId: "R_aspect", label: "Unsupported leaf" }));

    await reportPhase(ctx);

    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((task) => task.taskId.startsWith("T_writer_repair_") && task.reportNodeId === "R_leaf")).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "writer_gap_repair" && event.reportNodeId === "R_leaf")).toBe(true);
  });
});
