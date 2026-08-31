import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import type { EvidenceLink, FetchProvider, KnowledgeNode, LlmChat, ReportBundle, ResearchRequirement, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { evidenceTaskRuntimeBudget } from "../phases/dispatch-evidence.js";
import { architectTreePhase, normalizePlan } from "../phases/architect-tree.js";
import { initRootPhase } from "../phases/init-root.js";
import { parsePhase } from "../phases/parse.js";
import { rubricPhase } from "../phases/rubric.js";
import { MarkdownReporter } from "../reporter.js";
import { fixedNow, submission, node, task, requirement, bundle } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("traces deterministic init-root writes in full trace", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.traceLevel = "full";
    const memory = createInMemoryMemoryGraph();
    const ctx = createPhaseContext(submission(), {
      now: fixedNow,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      stack: { memory },
    });

    await parsePhase(ctx);
    await rubricPhase(ctx);
    await initRootPhase(ctx);

    const events = await memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => {
      const node = event.payload?.node as { nodeId?: string } | undefined;
      return event.eventType === "full.kg.upsertReportNode" && node?.nodeId === "R_root";
    })).toBe(true);
    expect(events.some((event) => event.eventType === "full.ledger.updateStatus" && event.payload?.taskId === "T_root" && event.payload?.status === "running")).toBe(true);
    expect(events.some((event) => event.eventType === "root_created" && event.reportNodeId === "R_root")).toBe(true);
  });

  it("repairs one malformed rubric JSON response instead of failing the episode", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.rubric) throw new Error("rubric phase config required");
    runtimeProfile.phases.rubric.maxLlmCalls = 2;
    let calls = 0;
    const llm: LlmChat = {
      name: "malformed-then-valid-rubric",
      async chat() {
        calls += 1;
        if (calls === 1) return { content: '{"rubricText":"truncated"' };
        return {
          content: JSON.stringify({
            rubricText: "Research the cloud market with cited evidence.",
            outputHints: { titleHint: "Cloud market", language: "en", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["Cloud market structure"],
            requirements: [{
              requirementId: "R1",
              description: "Analyze cloud market structure.",
              kind: "question",
              priority: "must",
              evidenceRequired: true,
              evidenceNeeds: ["Competition authority evidence"],
              successCriteria: ["The report identifies major providers."],
              temporalScope: { mode: "current" },
              geographicScope: [],
            }],
          }),
        };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm });

    await parsePhase(ctx);
    const rubric = await rubricPhase(ctx);

    expect(calls).toBe(2);
    expect(rubric.requirements).toEqual([expect.objectContaining({ requirementId: "R1", priority: "must" })]);
  });

  it("falls back deterministically when every rubric repair response is malformed", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.rubric) throw new Error("rubric phase config required");
    runtimeProfile.phases.rubric.maxLlmCalls = 2;
    let calls = 0;
    const llm: LlmChat = {
      name: "always-malformed-rubric",
      async chat() {
        calls += 1;
        return { content: '{"rubricText":"still truncated"' };
      },
    };
    const memory = createInMemoryMemoryGraph();
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, llm, stack: { memory } });
    await parsePhase(ctx);

    const rubric = await rubricPhase(ctx);

    expect(calls).toBe(2);
    expect(rubric.requirements).toEqual([expect.objectContaining({ requirementId: "RQ_01", priority: "must" })]);
    const events = await memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.llm.rubricFallback" || event.eventType === "llm.rubricFallback")).toBe(true);
  });

  it("finishes with audited omissions when explicit interaction mode leaves ordinary evidence gaps", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.hilMode = "explicit";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    const orchestrator = createInMemoryOrchestrator({ now: fixedNow, artifactDir: dir, runtimeProfile, llm: new EchoJsonLlm() });
    const result = await orchestrator.runEpisode(submission());
    expect(result.status).toBe("succeeded");
    expect(result.humanReview).toBeUndefined();
    expect(result.metrics.reportNodeCount).toBeGreaterThanOrEqual(3);
    expect(result.metrics.completedTaskCount).toBeGreaterThan(1);
    expect(result.metrics.openGapCount).toBe(0);
    const report = await readFile(result.reportArtifactPath, "utf8");
    expect(report).not.toContain("需要你的决定");
    const warnings = await readFile(join(dir, result.episodeId, "publication-warnings.json"), "utf8");
    expect(warnings).toContain('"decidedBy": "framework"');
  });

  it("uses a search provider to save KnowledgeNode and EvidenceLink", async () => {
    const dir = await artifactDir();
    const kg = createInMemoryKgService();
    const ledger = createInMemoryTaskLedger();
    const memory = createInMemoryMemoryGraph();
    const search: SearchProvider = {
      name: "fixture-search",
      async search(query, topK) {
        return Array.from({ length: Math.min(topK, 2) }, (_, i) => ({
          url: `https://example.test/${i}`,
          title: `Source ${i} for ${query.slice(0, 12)}`,
          snippet: "This source provides relevant evidence for the claim.",
        }));
      },
    };
    const fetchedUrls: string[] = [];
    const fetchProvider: FetchProvider = {
      name: "fixture-fetch",
      async fetchPage(url) {
        fetchedUrls.push(url);
        return {
          url,
          title: `Fetched ${url}`,
          content: "Fetched full page content with stronger evidence than the search snippet.",
          description: "Fetched description.",
        };
      },
    };
    const orchestrator = createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      llm: new EchoJsonLlm(),
      search,
      fetch: fetchProvider,
      stack: { kg, ledger, memory, reporter: new MarkdownReporter() },
    });
    const result = await orchestrator.runEpisode(submission());
    expect(result.status).toBe("succeeded");
    const knowledgeNodes = await kg.listKnowledgeNodes();
    const fetchedKnowledge = knowledgeNodes.find((item) => item.metadata.fetched === true);
    const fetchedScoutKnowledge = knowledgeNodes.find((item) => item.nodeId.startsWith("K_url_") && item.metadata.fetched === true && item.retrievedByTaskId === "T_root");
    expect(knowledgeNodes.length).toBeGreaterThan(0);
    expect(fetchedUrls.length).toBeGreaterThan(0);
    expect(fetchedKnowledge?.summary).toContain("Fetched full page content");
    expect(fetchedKnowledge?.metadata).toMatchObject({ fetched: true, fetchProvider: "fixture-fetch" });
    expect(fetchedScoutKnowledge?.summary).toContain("Fetched full page content");
    expect((await kg.listEvidenceLinks()).some((link: EvidenceLink) => link.relation === "supports")).toBe(true);
    expect(result.metrics.citationCount).toBeGreaterThan(0);
    expect(result.metrics.usedCitationCount).toBeGreaterThan(0);
    expect(result.metrics.usedCitationCount).toBeLessThanOrEqual(result.metrics.citationCount);
    expect(result.metrics.citationUtilization).toBeGreaterThan(0);
    expect(result.metrics.citationUtilization).toBeLessThanOrEqual(1);
    const report = await readFile(result.reportArtifactPath, "utf8");
    expect(report).toContain("[C");
    const draft = await readFile(join(dir, result.episodeId, "report-draft.md"), "utf8");
    expect(draft).toContain("[C");
    if (!result.evidenceIndexPath) throw new Error("expected evidence index path");
    const evidenceIndex = JSON.parse(await readFile(result.evidenceIndexPath, "utf8")) as Array<{ summary?: string; canonicalUrl?: string }>;
    expect(evidenceIndex.some((entry) => entry.summary?.includes("Fetched full page content"))).toBe(true);
    expect(evidenceIndex.every((entry) => typeof entry.canonicalUrl === "string")).toBe(true);
    const events = await memory.listEvents({ episodeId: result.episodeId });
    expect(events.some((event) => event.eventType === "main_planner_started")).toBe(true);
    expect(events.some((event) => event.eventType === "main_planner_finished")).toBe(true);
    expect(events.some((event) => event.eventType === "rubric_created")).toBe(true);
    expect(events.some((event) => event.eventType === "architect_tree_created")).toBe(true);
  });

  it("omits downplayed and omit-only leaves from deterministic report writing", async () => {
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Disposition report", parentNodeId: null });
    const aspect = node({ nodeId: "R_aspect", nodeKind: "aspect", label: "Hidden aspect", parentNodeId: root.nodeId });
    const downplayed = node({
      nodeId: "R_downplayed",
      nodeKind: "hypothesis",
      label: "Downplayed unsupported branch",
      parentNodeId: aspect.nodeId,
      status: "downplayed",
    });
    const omitted = node({
      nodeId: "R_omitted",
      nodeKind: "hypothesis",
      label: "Requirement-omitted branch",
      parentNodeId: aspect.nodeId,
      status: "supported",
      requirementIds: ["RQ_OMIT"],
    });
    const reportBundle: ReportBundle = {
      ...bundle(root),
      tree: [
        { node: root, children: [aspect.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: aspect, children: [downplayed.nodeId, omitted.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: downplayed, children: [], evidence: [], reportlets: [], openGaps: [] },
        { node: omitted, children: [], evidence: [], reportlets: [], openGaps: [] },
      ],
      constraints: {
        ...bundle(root).constraints,
        waivers: [{
          waiverId: "W_auto_omit",
          questionId: "auto_omit",
          issueCode: "unmapped_research_requirement",
          action: "omit",
          rationale: "No verifiable evidence remained after bounded repair.",
          requirementIds: ["RQ_OMIT"],
          decidedBy: "framework",
          decidedAt: new Date(fixedNow()).toISOString(),
        }],
      },
    };

    const report = await new MarkdownReporter().generate(reportBundle);

    expect(report.reportMd).not.toContain(downplayed.label);
    expect(report.reportMd).not.toContain(omitted.label);
    expect(report.reportMd).not.toContain(aspect.label);
  });

  it("does not pad a thin report plan with unrelated generic branches", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-thin-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "马克思主义中国化",
              scopeNote: "系统梳理马克思主义在中国的发展路线。",
              hypotheses: [{
                statement: "马克思主义在中国的发展路线需要系统研究。",
                researchBrief: "研究马克思主义在中国的发展路线。",
                evidenceGuidance: "查找权威资料。",
              }],
              tasks: [{
                title: "研究发展路线",
                objective: "收集发展路线资料。",
                acceptanceCriteria: ["保存证据。"],
              }],
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_broad_architect",
      userInput: "帮我做一份研究马克思主义在中国的发展路线的研究",
      uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_broad_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_broad",
      episodeId: ctx.state.episodeId,
      rubricText: "系统研究马克思主义在中国的发展路线、阶段、理论与实践。",
      outputHints: { titleHint: "马克思主义在中国的发展路线研究", language: "zh-CN", citationRequired: true, format: "markdown" },
      researchQuestionHints: ["发展路线"],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);

    expect(result.reportNodes.filter((item) => item.nodeKind === "hypothesis")).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks.every((item) => item.reportNodeId.startsWith("R_hyp_"))).toBe(true);
    expect(result.tasks.some((item) => /关键阶段与时间线|核心概念与理论表述/.test(item.title))).toBe(false);
  });

  it("caps a narrow single-requirement task at three initial evidence leaves", async () => {
    let architectPrompt = "";
    const llm: LlmChat = {
      name: "scripted-narrow-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes('"aspects"')) return { content: "{}" };
        architectPrompt = req.user;
        return { content: JSON.stringify({
          aspects: [{
            label: "悬疑剧情设计",
            scopeNote: "整理可操作的悬疑剧情设计方法。",
            requirementIds: ["R1"],
            hypotheses: Array.from({ length: 7 }, (_, index) => ({
              statement: `剧情设计角度 ${index + 1}`,
              researchBrief: `研究剧情设计角度 ${index + 1}。`,
              evidenceGuidance: "查找可靠的写作资料。",
              requirementIds: ["R1"],
            })),
            tasks: Array.from({ length: 7 }, (_, index) => ({
              title: `研究角度 ${index + 1}`,
              objective: `核验并总结剧情设计角度 ${index + 1}。`,
              acceptanceCriteria: ["提供有来源的可操作建议。"],
            })),
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_narrow_architect",
      userInput: "帮我查查悬疑小说的写作剧情设计思路",
      uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
    }, { now: fixedNow, llm });
    ctx.state.episodeId = "EP_narrow_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_narrow_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "总结有依据、可操作的悬疑小说剧情设计方法。",
      outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
      requirements: [requirement("R1", "总结悬疑小说剧情设计的可操作方法。", "question")],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);

    expect(architectPrompt).toContain("at most 3 initial leaf sub-branches");
    expect(result.reportNodes.filter((item) => item.nodeKind === "hypothesis")).toHaveLength(3);
    expect(result.tasks).toHaveLength(3);
  });

  it("caps a short general question even when rubric generation expands it to four requirements", async () => {
    let architectPrompt = "";
    const requirementIds = ["OVERVIEW", "STRUCTURES", "TECHNIQUES", "EXPERT-ADVICE"];
    const llm: LlmChat = {
      name: "scripted-short-general-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes('"aspects"')) return { content: "{}" };
        architectPrompt = req.user;
        return { content: JSON.stringify({
          aspects: requirementIds.map((requirementId, index) => ({
            label: `角度 ${index + 1}`,
            scopeNote: `研究角度 ${index + 1}。`,
            requirementIds: [requirementId],
            hypotheses: [{
              statement: `剧情设计角度 ${index + 1}`,
              researchBrief: `研究剧情设计角度 ${index + 1}。`,
              evidenceGuidance: "查找可靠的写作资料。",
              requirementIds: [requirementId],
            }],
            tasks: [{
              title: `研究角度 ${index + 1}`,
              objective: `核验并总结剧情设计角度 ${index + 1}。`,
              acceptanceCriteria: ["提供有来源的可操作建议。"],
            }],
          })),
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_short_general_architect",
      userInput: "帮我查查悬疑小说的写作剧情设计思路",
      uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
    }, { now: fixedNow, llm });
    ctx.state.episodeId = "EP_short_general_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_short_general_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "覆盖核心要素、叙事结构、悬念技巧和专家建议。",
      outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
      requirements: requirementIds.map((id) => requirement(id, `${id} 对应的悬疑写作方法。`, "question")),
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);

    expect(architectPrompt).toContain("at most 3 initial leaf sub-branches");
    expect(result.reportNodes.filter((item) => item.nodeKind === "hypothesis")).toHaveLength(3);
    expect(result.tasks).toHaveLength(3);
    expect(new Set(result.tasks.flatMap((task) => task.requirementIds ?? []))).toEqual(new Set(requirementIds));
  });

  it("splits one requirement-dense leaf into focused research leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "scripted-dense-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Cloud competition",
              scopeNote: "Analyze cloud competition.",
              requirementIds: ["R1", "R2", "R3", "R4"],
              hypotheses: [{
                statement: "Cloud competition has several linked dimensions.",
                researchBrief: "Research market structure, shares, and switching barriers.",
                evidenceGuidance: "Use competition authority reports.",
                requirementIds: ["R1", "R2", "R3", "R4"],
              }],
              tasks: [{
                title: "Cloud competition",
                objective: "Research all cloud competition dimensions.",
                acceptanceCriteria: ["Find cloud market evidence."],
              }],
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_dense_architect",
      userInput: "Write a detailed report on cloud market structure, market shares, and switching barriers.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_dense_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_dense_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "Analyze separate cloud competition requirements.",
      outputHints: { titleHint: "Cloud competition", language: "en", citationRequired: true, format: "markdown" },
      requirements: [
        requirement("R1", "Identify hyperscale providers.", "question"),
        requirement("R2", "Create a jurisdiction market-share table.", "deliverable"),
        requirement("R3", "Analyze technical switching barriers.", "question"),
        { ...requirement("R4", "Write the report in English.", "constraint"), evidenceRequired: false },
      ],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(3);
    expect(result.tasks).toHaveLength(3);
    expect(leaves.map((leaf) => leaf.requirementIds?.filter((id) => id !== "R4"))).toEqual([["R1"], ["R2"], ["R3"]]);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R4"))).toHaveLength(1);
    expect(result.tasks.every((task) => task.acceptanceCriteria.length >= 2)).toBe(true);
    expect(leaves[2]?.scopeNote).toBe("Research and write cited material only for this focused requirement: R3: Analyze technical switching barriers.");
    expect(result.tasks[2]?.acceptanceCriteria.join(" ")).not.toContain("hyperscale");
    expect(result.tasks[2]?.acceptanceCriteria.join(" ")).not.toContain("market-share");
  });

  it("co-locates distributed comparison rows with the matching entity leaves", async () => {
    const entities = ["ArduPilot", "PX4", "Paparazzi", "LibrePilot", "Betaflight", "iNAV"];
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "scripted-entity-aligned-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [
              {
                label: "Technical profiles",
                scopeNote: `Profile every autopilot (${entities.join(", ")}).`,
                requirementIds: ["R1", "R2"],
                hypotheses: entities.map((entity) => ({
                  statement: `${entity} technical profile`,
                  researchBrief: `Research ${entity} RTOS and language.`,
                  evidenceGuidance: `Use ${entity} primary sources.`,
                  requirementIds: ["R1", "R2"],
                })),
                tasks: entities.map((entity) => ({
                  title: `Research ${entity}`,
                  objective: `Verify ${entity} technical fields.`,
                  acceptanceCriteria: [`Confirm ${entity} RTOS.`, `Confirm ${entity} core language.`],
                })),
              },
              {
                label: "Comparison table",
                scopeNote: "Create rows for each autopilot.",
                requirementIds: ["R6"],
                hypotheses: [{
                  statement: "Comparison table for all six autopilots",
                  researchBrief: "Research every autopilot ecosystem.",
                  evidenceGuidance: "Use ecosystem documentation for all six autopilots.",
                  requirementIds: ["R6"],
                }],
                tasks: [{
                  title: "All comparison rows",
                  objective: "Write all six comparison rows.",
                  acceptanceCriteria: ["Evaluate every autopilot ecosystem."],
                }],
              },
            ],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_entity_aligned_architect",
      userInput: "Write a detailed report and comparison table for six open-source autopilots.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_entity_aligned_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_entity_aligned_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "Write technical profiles and a complete comparison table.",
      outputHints: { titleHint: "Autopilot comparison", language: "en", citationRequired: true, format: "markdown" },
      requirements: [
        requirement("R1", "For each autopilot (ArduPilot, PX4, Paparazzi, LibrePilot, Betaflight, iNAV), state its RTOS.", "question"),
        requirement("R2", "For each autopilot, state its primary core language.", "question"),
        requirement("R6", "Create a comparison table with rows for each autopilot and ecosystem-support columns.", "deliverable"),
      ],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(6);
    expect(result.reportNodes.filter((item) => item.nodeKind === "aspect")).toHaveLength(1);
    expect(result.tasks).toHaveLength(6);
    expect(leaves.every((leaf) => ["R1", "R2", "R6"].every((id) => leaf.requirementIds?.includes(id)))).toBe(true);
    for (const entity of entities) {
      const task = result.tasks.find((item) => item.title === `Research ${entity}`);
      expect(task?.acceptanceCriteria.join(" ")).toContain(`For ${entity}, contribute its evidence-backed portion of R6`);
    }
  });

  it("splits r30-style Chinese table enumerations within initial dispatch capacity without meta-only leaves", async () => {
    const sensors = ["RGB摄像头", "雷达（RADAR）", "激光雷达（LiDAR）", "惯性测量单元（IMU）", "全球导航卫星系统（GNSS）", "实时动态技术（RTK）"];
    const lidarVendors = ["Velodyne", "Luminar", "AEye", "Ouster", "Ibeo Automotive Systems", "Quanergy Systems", "Innoviz Technologies", "SICK", "Cepton", "Pepperl+Fuchs"];
    const forkliftVendors = ["K-MATIC", "Seegrid", "Crown Equipment", "OTTO Motors", "Vecna Robotics", "Balyo", "Hyster Robotic CB"];
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 4;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 4;
    const llm: LlmChat = {
      name: "scripted-r30-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "自动驾驶叉车表格",
              scopeNote: "收集三张表的逐行证据。",
              requirementIds: ["REQ-001", "REQ-002", "REQ-003", "REQ-005"],
              hypotheses: ["REQ-001", "REQ-002", "REQ-003"].map((id) => ({
                statement: `${id} 表格`,
                researchBrief: `研究 ${id} 的所有实体。`,
                evidenceGuidance: `使用 ${id} 权威资料。`,
                requirementIds: [id, "REQ-005"],
              })),
              tasks: ["REQ-001", "REQ-002", "REQ-003"].map((id) => ({
                title: `${id} 原始任务`,
                objective: `完成 ${id} 全表。`,
                acceptanceCriteria: [`覆盖 ${id} 的所有实体。`],
              })),
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const requirements: ResearchRequirement[] = [
      requirement("REQ-001", "制作“自动驾驶叉车常用传感器对比表”，比较RGB摄像头、雷达（RADAR）、激光雷达（LiDAR）、惯性测量单元（IMU）、全球导航卫星系统（GNSS）和实时动态技术（RTK）这六种传感器。表格列必须包括具体技术字段。", "deliverable"),
      requirement("REQ-002", "制作“主流LiDAR制造商及其产品对比表”，包含Velodyne、Luminar、AEye、Ouster、Ibeo Automotive Systems、Quanergy Systems、Innoviz Technologies、SICK、Cepton、Pepperl+Fuchs这十家公司。表格列必须包括具体产品参数。", "deliverable"),
      requirement("REQ-003", "制作“主要自动驾驶叉车制造商及其导航传感器技术表”，覆盖K-MATIC、Seegrid、Crown Equipment、OTTO Motors、Vecna Robotics、Balyo、Hyster Robotic CB这七家公司。表格只有制造商和导航传感器类型两列。", "deliverable"),
      requirement("REQ-005", "报告必须包含引用来源，且不得搜索、打开、保存、使用或引用被禁止的参考文献及其URL。", "deliverable"),
    ];
    const ctx = createPhaseContext({
      sessionId: "S_r30_architect",
      userInput: "整理自动驾驶叉车的三张中文对比表。",
      uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_r30_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_r30_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "以三张表格覆盖所有指定实体，不将引用或禁止来源规则当作研究叶。",
      outputHints: { titleHint: "自动驾驶叉车", language: "zh-CN", citationRequired: true, format: "markdown" },
      requirements,
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(8);
    expect(result.tasks).toHaveLength(8);
    expect(result.tasks.length).toBeLessThanOrEqual(runtimeProfile.phases.dispatchEvidence.maxCycles * runtimeProfile.phases.dispatchEvidence.maxParallelAgents);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("REQ-001"))).toHaveLength(2);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("REQ-002"))).toHaveLength(4);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("REQ-003"))).toHaveLength(2);
    expect(leaves.every((leaf) => leaf.requirementIds?.some((id) => ["REQ-001", "REQ-002", "REQ-003"].includes(id)))).toBe(true);
    expect(leaves.some((leaf) => leaf.requirementIds?.length === 1 && leaf.requirementIds[0] === "REQ-005")).toBe(false);

    for (const [requirementId, entities] of [["REQ-001", sensors], ["REQ-002", lidarVendors], ["REQ-003", forkliftVendors]] as const) {
      const focusedTasks = result.tasks.filter((taskItem) => taskItem.title.startsWith(`${requirementId}:`));
      const taskTexts = focusedTasks.map((taskItem) => `${taskItem.title} ${taskItem.objective} ${taskItem.acceptanceCriteria.join(" ")}`);
      for (const entity of entities) expect(taskTexts.filter((text) => text.includes(entity)), `${requirementId} should assign ${entity} once`).toHaveLength(1);
      for (const text of taskTexts) {
        const ownedEntities = entities.filter((entity) => text.includes(entity));
        expect(ownedEntities.length).toBeGreaterThan(0);
        const acceptance = focusedTasks[taskTexts.indexOf(text)]!.acceptanceCriteria.join(" ");
        for (const sibling of entities.filter((entity) => !ownedEntities.includes(entity))) expect(acceptance).not.toContain(sibling);
      }
    }
  });

  it("splits open taxonomy groups into bounded member-discovery leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "scripted-open-taxonomy-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes('"aspects"')) return { content: "{}" };
        return { content: JSON.stringify({
          aspects: [{
            label: "Sweetener comparison",
            scopeNote: "Build the requested categorized table.",
            requirementIds: ["SWEETENER_TABLE"],
            hypotheses: [{
              statement: "Common sweeteners fall into three requested categories.",
              researchBrief: "Research all sweetener categories for one table.",
              evidenceGuidance: "Find authoritative sweetener references.",
              requirementIds: ["SWEETENER_TABLE"],
            }],
            tasks: [{
              title: "Compile sweetener table",
              objective: "Research the three requested categories.",
              acceptanceCriteria: ["Make the table comprehensive."],
            }],
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_open_taxonomy",
      userInput: "Compare common sweeteners under three categories.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_open_taxonomy";
    ctx.state.globalRubric = {
      rubricId: "RB_open_taxonomy",
      episodeId: ctx.state.episodeId,
      rubricText: "Create a comprehensive categorized sweetener table.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [{
        requirementId: "SWEETENER_TABLE",
        description: "Create a comprehensive comparison table of common sweeteners with clear categorization.",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Authoritative inventories and specifications"],
        successCriteria: ["Discover multiple concrete members in every category."],
        entityScope: ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"],
        entityScopeRole: "groups",
        metricScope: ["Sweetener Name", "Brand Name", "Primary Uses", "Relative Sweetness"],
      }],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(3);
    expect(result.tasks.map((item) => item.title)).toEqual([
      "SWEETENER_TABLE: High-Intensity Sweeteners",
      "SWEETENER_TABLE: Sugar Alcohols",
      "SWEETENER_TABLE: Natural Sweeteners",
    ]);
    expect(result.tasks.every((item) => item.acceptanceCriteria.some((criterion) => criterion.includes("grouping label, not a final row")))).toBe(true);
    expect(result.tasks.every((item) => item.acceptanceCriteria.some((criterion) => criterion.includes("do not invent a numeric member quota")))).toBe(true);
    for (const taskItem of result.tasks) {
      const ownedGroups = ["High-Intensity Sweeteners", "Sugar Alcohols", "Natural Sweeteners"]
        .filter((group) => `${taskItem.title} ${taskItem.objective}`.includes(group));
      expect(ownedGroups).toHaveLength(1);
      expect(evidenceTaskRuntimeBudget(taskItem, {
        maxReactSteps: 12,
        maxToolCalls: 16,
        maxSearchCalls: 3,
        maxFetchCalls: 3,
      })).toMatchObject({ targetSearchCalls: 1, targetFetchCalls: 2 });
    }
  });

  it("splits a coarse wide-matrix requirement from its declared entity scope", async () => {
    const countries = [
      "Albania", "Bosnia and Herzegovina", "Croatia", "Cyprus", "France", "Greece", "Italy",
      "Malta", "Monaco", "Montenegro", "Slovenia", "Spain", "Turkey",
    ];
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "scripted-declared-country-scope-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes('"aspects"')) return { content: "{}" };
        return { content: JSON.stringify({
          aspects: [{
            label: "Basic Data Table",
            scopeNote: "Compile the requested country-year matrix.",
            requirementIds: ["BASIC_DATA"],
            hypotheses: [{
              statement: "Official statistics can populate the complete matrix.",
              researchBrief: "Compile land area and annual arrivals for every requested country.",
              evidenceGuidance: "Use official statistics.",
              requirementIds: ["BASIC_DATA"],
            }],
            tasks: [{
              title: "Compile country matrix",
              objective: "Collect the complete country-year data matrix.",
              acceptanceCriteria: ["Cover every requested country and year."],
            }],
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_declared_country_scope",
      userInput: "Conduct an in-depth 13-country tourism survey from 2010 to 2020.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_declared_country_scope";
    ctx.state.globalRubric = {
      rubricId: "RB_declared_country_scope",
      episodeId: ctx.state.episodeId,
      rubricText: "Create a complete country-year tourism matrix.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [{
        requirementId: "BASIC_DATA",
        description: "Create the Basic Data Table with land area and annual arrivals for each requested country.",
        kind: "deliverable",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Official area and tourism statistics"],
        successCriteria: ["Every declared country has a complete row."],
        entityScope: countries,
        entityScopeRole: "members",
        metricScope: ["Land Area", "International Tourist Arrivals"],
      }],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    expect(result.tasks.length).toBeGreaterThan(1);
    const taskTexts = result.tasks.map((taskItem) => `${taskItem.title} ${taskItem.objective} ${taskItem.acceptanceCriteria.join(" ")}`);
    for (const country of countries) {
      expect(taskTexts.filter((text) => text.includes(country)), `${country} should be assigned once`).toHaveLength(1);
    }
  });

  it("splits an explicit dual perspective into sibling evidence leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const first = "the League maintained imperial interests through the Mandates System";
    const second = "it inadvertently provided a stage for international oversight of colonial affairs";
    const llm: LlmChat = {
      name: "scripted-dual-perspective-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes('"aspects"')) return { content: "{}" };
        return { content: JSON.stringify({
          aspects: [{
            label: "League of Nations dual role",
            scopeNote: "Analyze both dimensions of the League's role.",
            requirementIds: ["LEAGUE_DUALITY"],
            hypotheses: [{
              statement: "The League played a complex dual role.",
              researchBrief: "Research the League of Nations and decolonization.",
              evidenceGuidance: "Use primary documents and historical scholarship.",
              requirementIds: ["LEAGUE_DUALITY"],
            }],
            tasks: [{
              title: "Research League duality",
              objective: "Explain both dimensions of the League's role.",
              acceptanceCriteria: ["Avoid a one-sided conclusion."],
            }],
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_dual_perspective",
      userInput: "Analyze the dual role of the League of Nations in decolonization.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_dual_perspective";
    ctx.state.globalRubric = {
      rubricId: "RB_dual_perspective",
      episodeId: ctx.state.episodeId,
      rubricText: "Explain both sides without simplistic praise or condemnation.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [{
        requirementId: "LEAGUE_DUALITY",
        description: "Analyze the dual role of the League of Nations in decolonization.",
        kind: "question",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Primary documents and historical scholarship"],
        successCriteria: [
          `Research this explicit perspective separately: ${first}.`,
          `Research this explicit perspective separately: ${second}.`,
          "Compare and synthesize both explicit perspectives without collapsing either side.",
        ],
      }],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    expect(result.tasks).toHaveLength(2);
    expect(result.reportNodes.filter((item) => item.nodeKind === "hypothesis")).toHaveLength(2);
    const taskTexts = result.tasks.map((taskItem) => `${taskItem.title} ${taskItem.objective} ${taskItem.acceptanceCriteria.join(" ")}`);
    expect(taskTexts.filter((text) => text.includes(first))).toHaveLength(1);
    expect(taskTexts.filter((text) => text.includes(second))).toHaveLength(1);
    expect(result.reportNodes.filter((item) => item.nodeKind === "hypothesis").every((item) => (
      item.requirementIds?.includes("LEAGUE_DUALITY")
    ))).toBe(true);
  });

  it("splits explicit active and passive attack and defense deliverables into parallel category leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 4;
    const llm: LlmChat = {
      name: "scripted-paired-categories-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [
              {
                label: "Attack Technology Overview",
                scopeNote: "Build the requested attack table.",
                requirementIds: ["R1", "R5", "R8"],
                hypotheses: [{
                  statement: "Wi-Fi sensing attacks include active and passive methods.",
                  researchBrief: "Research all attack techniques for one table.",
                  evidenceGuidance: "Find primary attack papers.",
                  requirementIds: ["R1", "R5", "R8"],
                }],
                tasks: [{ title: "Compile attack table", objective: "Research active and passive attacks.", acceptanceCriteria: ["Complete both categories."] }],
              },
              {
                label: "Defense Technology Overview",
                scopeNote: "Build the requested defense table.",
                requirementIds: ["R2", "R5", "R8"],
                hypotheses: [{
                  statement: "Wi-Fi sensing defenses include active and passive methods.",
                  researchBrief: "Research all defense techniques for one table.",
                  evidenceGuidance: "Find primary defense papers.",
                  requirementIds: ["R2", "R5", "R8"],
                }],
                tasks: [{ title: "Compile defense table", objective: "Research active and passive defenses.", acceptanceCriteria: ["Complete both categories."] }],
              },
            ],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_paired_categories",
      userInput: "Create separate attack and defense tables for secure Wi-Fi sensing.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_paired_categories";
    ctx.state.globalRubric = {
      rubricId: "RB_paired_categories",
      episodeId: ctx.state.episodeId,
      rubricText: "Systematically cover active and passive attack and defense techniques.",
      outputHints: { titleHint: "Secure Wi-Fi sensing", language: "en", citationRequired: true, format: "markdown" },
      requirements: [
        requirement("R1", "Provide an Attack Technology Overview table with method, type, objective, sensing scenario, and defense-strategy columns. The table must cover both active and passive attack types.", "deliverable"),
        requirement("R2", "Provide a Defense Technology Overview table with method, type, objective, sensing scenario, and targeted-attack columns. The table must cover both active and passive defense types.", "deliverable"),
        requirement("R5", "Do not search for, open, save, use, or cite the forbidden reference and URLs.", "risk"),
        requirement("R8", "Include citations for all claims and techniques in the report. Use a standard citation format.", "deliverable"),
      ],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(4);
    expect(result.tasks).toHaveLength(4);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R1"))).toHaveLength(2);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R2"))).toHaveLength(2);
    expect(leaves.every((leaf) => leaf.requirementIds?.includes("R5"))).toBe(true);
    expect(leaves.every((leaf) => leaf.requirementIds?.includes("R8"))).toBe(true);
    expect(leaves.some((leaf) => leaf.requirementIds?.every((id) => ["R5", "R8"].includes(id)))).toBe(false);
    expect(result.tasks.map((taskItem) => taskItem.title)).toEqual([
      "R1: Active attack methods",
      "R1: Passive attack methods",
      "R2: Active defense methods",
      "R2: Passive defense methods",
    ]);
    for (const taskItem of result.tasks) {
      const text = `${taskItem.title} ${taskItem.objective} ${taskItem.acceptanceCriteria.join(" ")}`.toLowerCase();
      if (taskItem.title.includes("Active")) expect(text).not.toContain("passive");
      if (taskItem.title.includes("Passive")) expect(text).not.toContain("active");
      expect(taskItem.acceptanceCriteria.length).toBeGreaterThanOrEqual(6);
    }
  });

  it("rebuilds a counted study review by methodology instead of table columns and removes heading-only leaves", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 4;
    const llm: LlmChat = {
      name: "scripted-study-review-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes("\"aspects\"")) return { content: "{}" };
        return { content: JSON.stringify({
          aspects: [{
            label: "Summary table columns",
            scopeNote: "Build fragments of the study table.",
            requirementIds: ["R1"],
            hypotheses: ["Country and sample size", "Outcome variable", "Effectiveness label"].map((statement) => ({
              statement,
              researchBrief: `Research the ${statement} column.`,
              evidenceGuidance: "Find studies.",
              requirementIds: ["R1"],
            })),
            tasks: ["Country and sample size", "Outcome variable", "Effectiveness label"].map((title) => ({
              title,
              objective: `Fill ${title}.`,
              acceptanceCriteria: [`Complete ${title}.`],
            })),
          }, {
            label: "Effectiveness",
            scopeNote: "Synthesize effectiveness.",
            requirementIds: ["R0", "R2"],
            hypotheses: [{
              statement: "Overall effectiveness is mixed.",
              researchBrief: "Analyze effectiveness by methodology.",
              evidenceGuidance: "Find methodology evidence.",
              requirementIds: ["R0", "R2"],
            }, {
              statement: "Answer to what extent online learning is effective overall.",
              researchBrief: "Write an overall effectiveness conclusion.",
              evidenceGuidance: "Synthesize the reviewed evidence.",
              requirementIds: ["R0"],
            }],
            tasks: [
              { title: "Synthesize effectiveness", objective: "Compare methodologies.", acceptanceCriteria: ["Compare methods."] },
              { title: "Answer overall effectiveness", objective: "Conclude overall effectiveness.", acceptanceCriteria: ["Answer R0."] },
            ],
          }, {
            label: "Factors",
            scopeNote: "Analyze factors.",
            requirementIds: ["R3", "R4"],
            hypotheses: [{
              statement: "Infrastructure and interaction influence outcomes.",
              researchBrief: "Research influencing factors.",
              evidenceGuidance: "Find factor studies.",
              requirementIds: ["R3"],
            }, {
              statement: "The influencing-factors section explains mechanisms.",
              researchBrief: "Write the required influencing-factors analysis.",
              evidenceGuidance: "Find mechanism evidence and specific studies.",
              requirementIds: ["R4"],
            }, {
              statement: "Answer which factors influenced effectiveness.",
              researchBrief: "Answer the influencing-factors question without duplicating its section.",
              evidenceGuidance: "Use the same factor evidence.",
              requirementIds: ["R3"],
            }],
            tasks: [
              { title: "Influencing factors", objective: "Analyze factors.", acceptanceCriteria: ["Explain factors."] },
              { title: "Influencing factors section", objective: "Write factor mechanisms.", acceptanceCriteria: ["Cite specific studies."] },
              { title: "Answer influencing factors", objective: "Answer the factors question.", acceptanceCriteria: ["Answer R3."] },
            ],
          }, {
            label: "Headings",
            scopeNote: "Verify headings.",
            requirementIds: ["R6"],
            hypotheses: [{
              statement: "The report must have three headings.",
              researchBrief: "Research report headings.",
              evidenceGuidance: "Find evidence for headings.",
              requirementIds: ["R6"],
            }],
            tasks: [{ title: "Verify headings", objective: "Verify headings.", acceptanceCriteria: ["Three headings."] }],
          }],
        }) };
      },
    };
    const requirements: ResearchRequirement[] = [
      requirement("R0", "Answer the research question: To what extent is online learning effective overall?", "question"),
      { ...requirement("R1", "Create a summary table of at least 15 empirical studies with columns: Authors, Country, Sample Size, Research Design, Outcome Variable, Finding on Effectiveness.", "deliverable"), evidenceRequired: false },
      requirement("R2", "In the effectiveness analysis, categorize studies by research methodology (e.g., cross-sectional perceptual surveys, cross-sectional comparative studies, longitudinal studies, randomized controlled trials) and discuss how methodology influenced results.", "constraint"),
      requirement("R3", "Analyze infrastructure, instructional design, social interaction, emotions, and flexibility as influencing factors.", "question"),
      requirement("R4", "Provide an Analysis of Influencing Factors section explaining which factors influenced effectiveness and their mechanisms.", "deliverable"),
      { ...requirement("R6", "The output must have three distinct sections with headings: Summary Table of Reviewed Studies, Effectiveness Analysis, Analysis of Influencing Factors.", "deliverable"), evidenceRequired: false },
    ];
    requirements[1]!.temporalScope = { mode: "range", start: "2020-01-01", end: "2023-08-31" };
    requirements[1]!.geographicScope = ["Global"];
    const ctx = createPhaseContext({
      sessionId: "S_study_review_architect",
      userInput: "Review the effectiveness of online learning during COVID-19.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_study_review_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_study_review_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "Build a 15-study table and synthesize results by methodology.",
      outputHints: { titleHint: "Online learning review", language: "en", citationRequired: true, format: "markdown" },
      requirements,
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");
    const methodologyTasks = result.tasks.filter((item) => item.title.startsWith("R1:"));

    expect(leaves).toHaveLength(5);
    expect(methodologyTasks.map((item) => item.title)).toEqual([
      "R1: Asia-Pacific and Middle East studies",
      "R1: European and African studies",
      "R1: Americas and cross-regional studies",
    ]);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R1"))).toHaveLength(3);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R2"))).toHaveLength(3);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R0"))).toHaveLength(1);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R3"))).toHaveLength(1);
    expect(leaves.filter((leaf) => leaf.requirementIds?.includes("R4"))).toHaveLength(1);
    expect(leaves.find((leaf) => leaf.requirementIds?.includes("R3"))?.requirementIds).toEqual(expect.arrayContaining(["R3", "R4"]));
    expect(result.tasks.some((item) => /heading/i.test(`${item.title} ${item.objective}`))).toBe(false);
    for (const taskItem of methodologyTasks) {
      const criteria = taskItem.acceptanceCriteria.join(" ");
      expect(criteria).toContain("fill every requested field");
      expect(criteria).toContain("never create column-only fragments");
      expect(criteria).toContain("2020-01-01 through 2023-08-31");
      expect(criteria).toContain("without forcing a scarce category quota");
      expect(criteria).toContain("not a per-region minimum");
      expect(criteria).toContain("Only the collective minimum of 15 studies is mandatory");
    }
  });

  it("merges multiple factor-specific leaves mapped to the same influencing-factors question", async () => {
    const llm: LlmChat = {
      name: "scripted-factor-duplicate-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes("\"aspects\"")) return { content: "{}" };
        const factors = ["Infrastructure", "Instructional design", "Social interaction", "Negative emotions", "Convenience and flexibility"];
        return { content: JSON.stringify({
          aspects: [{
            label: "Influencing factors",
            scopeNote: "Analyze all factors influencing effectiveness.",
            requirementIds: ["RQ2"],
            hypotheses: factors.map((factor) => ({
              statement: `${factor} influences effectiveness.`,
              researchBrief: `Research the mechanism for ${factor}.`,
              evidenceGuidance: `Find specific studies about ${factor}.`,
              requirementIds: ["RQ2"],
            })),
            tasks: factors.map((factor) => ({
              title: `Analyze ${factor}`,
              objective: `Explain how ${factor} influences effectiveness.`,
              acceptanceCriteria: [`Explain and cite ${factor}.`],
            })),
          }],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, llm });
    ctx.state.episodeId = "EP_factor_duplicate_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_factor_duplicate_architect",
      episodeId: ctx.state.episodeId,
      rubricText: "Analyze the factors influencing effectiveness.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [requirement("RQ2", "Analyze infrastructure, instructional design, social interaction, negative emotions, and convenience/flexibility as influencing factors.", "question")],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(leaves).toHaveLength(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({ title: "Analyze influencing factors with mechanisms and citations" });
    const criteria = result.tasks[0]!.acceptanceCriteria.join(" ");
    for (const factor of ["Infrastructure", "Instructional design", "Social interaction", "Negative emotions", "Convenience and flexibility"]) {
      expect(criteria).toContain(factor);
    }
  });

  it("limits debug report tree to max aspects and max branches per aspect", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.debug = { singleBranch: true, maxAspects: 9, maxBranchesPerAspect: 9, maxInitialAgentNodes: 99, maxAgentNodeParts: 2 };
    const llm: LlmChat = {
      name: "scripted-wide-debug-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: Array.from({ length: 4 }, (_, aspectIndex) => ({
              label: `Aspect ${aspectIndex + 1}`,
              scopeNote: `Scope ${aspectIndex + 1}`,
              hypotheses: Array.from({ length: 4 }, (_, hypIndex) => ({
                statement: `Aspect ${aspectIndex + 1} branch ${hypIndex + 1}`,
                researchBrief: `Research aspect ${aspectIndex + 1} branch ${hypIndex + 1}.`,
                evidenceGuidance: `Search aspect ${aspectIndex + 1} branch ${hypIndex + 1}.`,
              })),
              tasks: Array.from({ length: 4 }, (_, taskIndex) => ({
                title: `Task ${aspectIndex + 1}.${taskIndex + 1}`,
                objective: `Research task ${aspectIndex + 1}.${taskIndex + 1}.`,
                acceptanceCriteria: [`Write reportlet ${aspectIndex + 1}.${taskIndex + 1}.`],
              })),
            })),
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_debug_architect_shape";
    ctx.state.globalRubric = {
      rubricId: "RB_debug_architect_shape",
      episodeId: ctx.state.episodeId,
      rubricText: "Debug tree shape.",
      outputHints: { titleHint: "Debug Shape", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const aspects = result.reportNodes.filter((item) => item.nodeKind === "aspect");
    const hypotheses = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(aspects).toHaveLength(2);
    expect(hypotheses).toHaveLength(4);
    expect(result.tasks).toHaveLength(4);
    expect(new Set(result.tasks.map((task) => task.reportNodeId)).size).toBe(4);
    for (const aspect of aspects) {
      expect(hypotheses.filter((hyp) => hyp.parentNodeId === aspect.nodeId).length).toBeLessThanOrEqual(2);
    }
  });

  it("reserves one leaf for every explicit top-level section when planner capacity is tight", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    const userInput = [
      "Please divide the report into four main sections: 'Classic Theoretical Frameworks', 'Review of AI/ML Applications', 'Multi-Criteria Decision Making (MCDM)', and 'Portfolio Optimization and Rebalancing'.",
      "Cover foundational theories, AI/ML applications, MCDM techniques, and portfolio optimization and rebalancing.",
    ].join("\n");
    const llm: LlmChat = {
      name: "scripted-section-starving-architect",
      async chat(req) {
        if (!req.user.includes("Output schema:") || !req.user.includes("\"aspects\"")) return { content: "{}" };
        return { content: JSON.stringify({
          aspects: [{
            label: "Classic Theoretical Frameworks",
            scopeNote: "Review foundational portfolio theories.",
            requirementIds: ["R02"],
            hypotheses: [{
              statement: "Classic portfolio theories require a chronological review.",
              researchBrief: "Research foundational theories.",
              evidenceGuidance: "Use primary academic sources.",
              requirementIds: ["R02"],
            }],
            tasks: [{ title: "Classic theories", objective: "Review classic theories.", acceptanceCriteria: ["Cover each theory."] }],
          }, {
            label: "Review of AI/ML Applications",
            scopeNote: "Review AI and machine-learning applications.",
            requirementIds: ["R03", "R04", "R05"],
            hypotheses: ["Signal Generation", "Asset Clustering", "Feature Enrichment"].map((name) => ({
              statement: `${name} supports portfolio management.`,
              researchBrief: `Research ${name}.`,
              evidenceGuidance: `Find studies about ${name}.`,
              requirementIds: ["R03"],
            })),
            tasks: ["Signal Generation", "Asset Clustering", "Feature Enrichment"].map((name) => ({
              title: name,
              objective: `Research ${name}.`,
              acceptanceCriteria: [`Explain ${name}.`],
            })),
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_explicit_section_capacity",
      userInput,
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_explicit_section_capacity";
    ctx.state.globalRubric = {
      rubricId: "RB_explicit_section_capacity",
      episodeId: ctx.state.episodeId,
      rubricText: "Cover all four portfolio-management sections.",
      outputHints: { language: "en", citationRequired: true, format: "markdown" },
      requirements: [
        requirement("R02", "In the Classic Theoretical Frameworks section, review foundational portfolio theories.", "question"),
        requirement("R03", "In the Review of AI/ML Applications section, review signal generation, clustering, and feature enrichment.", "question"),
        requirement("R04", "In the Multi-Criteria Decision Making (MCDM) section, explain specific MCDM techniques and application scenarios.", "question"),
        requirement("R05", "In the Portfolio Optimization and Rebalancing section, explain metaheuristics and dynamic rebalancing.", "question"),
        {
          requirementId: "RQ_TOP_LEVEL_SECTION_CONTRACT",
          description: "The report must contain exactly four named top-level sections in order.",
          kind: "deliverable",
          priority: "must",
          evidenceRequired: false,
          evidenceNeeds: [],
          successCriteria: ["Render one section for each named topic."],
          entityScope: [
            "Classic Theoretical Frameworks",
            "Review of AI/ML Applications",
            "Multi-Criteria Decision Making (MCDM)",
            "Portfolio Optimization and Rebalancing",
          ],
        },
      ],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);
    const aspects = result.reportNodes.filter((item) => item.nodeKind === "aspect");
    const leaves = result.reportNodes.filter((item) => item.nodeKind === "hypothesis");

    expect(aspects.map((aspect) => aspect.label)).toEqual([
      "Classic Theoretical Frameworks",
      "Review of AI/ML Applications",
      "Multi-Criteria Decision Making (MCDM)",
      "Portfolio Optimization and Rebalancing",
    ]);
    expect(leaves).toHaveLength(4);
    expect(result.tasks).toHaveLength(4);
    for (const [index, requirementId] of ["R02", "R03", "R04", "R05"].entries()) {
      const sectionLeaves = leaves.filter((leaf) => leaf.parentNodeId === aspects[index]!.nodeId);
      expect(sectionLeaves).toHaveLength(1);
      expect(sectionLeaves[0]?.requirementIds).toContain(requirementId);
      expect(leaves.filter((leaf) => leaf.requirementIds?.includes(requirementId))).toHaveLength(1);
    }
  });

  it("keeps titled scientific sections substantive and propagates cross-section constraints", () => {
    const sections = [
      "Between Parasitic Plants",
      "Between Fungi and Plants",
      "Between Bacteria and Plants",
      "Between Viruses and Plants",
    ];
    const requirements: ResearchRequirement[] = sections.map((section, index) => ({
      ...requirement(`R0${index + 1}`, `Report must include a section titled '${section}' that explains its HGT mechanism.`, "question"),
      evidenceNeeds: [`Direct biological evidence for ${section}`],
    }));
    requirements.push({
      ...requirement("R05", "Each of the four sections must include species names, gene names, and bulleted discussions.", "deliverable"),
      evidenceNeeds: ["Direct evidence addressing this requirement."],
    }, {
      ...requirement("R06", "The final report must be written in English.", "constraint"),
      evidenceRequired: false,
      evidenceNeeds: [],
    }, {
      ...requirement("R07", "Do not search, open, save, or cite the forbidden source.", "risk"),
      evidenceRequired: false,
      evidenceNeeds: [],
    }, {
      ...requirement("RQ_TOP_LEVEL_SECTION_CONTRACT", "Render exactly four top-level sections.", "deliverable"),
      evidenceRequired: false,
      evidenceNeeds: [],
      entityScope: sections,
    }, {
      ...requirement("RQ_GLOBAL_TEMPORAL_CUTOFF", "Apply the report-wide evidence cutoff through 2020-12-31.", "constraint"),
      evidenceRequired: false,
      evidenceNeeds: [],
      temporalScope: { mode: "as_of", basis: "covered_period", asOf: "2020-12-31" },
    });
    const normalized = normalizePlan({
      aspects: [{
        label: "Between Fungi and Plants",
        scopeNote: "Planner returned only one section.",
        requirementIds: ["R05"],
        hypotheses: [{
          statement: "All sections need species and gene names.",
          researchBrief: "Research the fungi section.",
          evidenceGuidance: "Use primary papers.",
          requirementIds: ["R05"],
        }],
        tasks: [{ title: "Fungi", objective: "Research fungi.", acceptanceCriteria: ["Find evidence."] }],
      }],
    }, "Investigate plant HGT in four named sections.", "Plant HGT report.", { maxSchedulableInitialNodes: 1 }, requirements);

    expect(normalized.aspects.map((aspect) => aspect.label)).toEqual(sections);
    for (const [index, aspect] of normalized.aspects.entries()) {
      expect(aspect.hypotheses).toHaveLength(1);
      expect(aspect.hypotheses[0]?.requirementIds).toContain(`R0${index + 1}`);
      expect(aspect.hypotheses[0]?.requirementIds).toEqual(expect.arrayContaining([
        "R05", "R06", "R07", "RQ_TOP_LEVEL_SECTION_CONTRACT", "RQ_GLOBAL_TEMPORAL_CUTOFF",
      ]));
    }
  });

  it("merges planner-duplicated leaves that own the same requirements with identical scope", () => {
    const requirements = [
      requirement("REQ-CONCEPTIONS", "Analyze conceptions of conception.", "task"),
      requirement("REQ-PREGNANCY", "Analyze imagery of pregnancy and childbirth.", "task"),
      requirement("REQ-COMPREHENSIVE", "Provide a comprehensive synthesis.", "task"),
      requirement("REQ-LANGUAGE-CITATION", "Write in English with citations.", "constraint"),
    ];
    const duplicated = {
      statement: "Provide 'Comprehensive Analysis': synthesize how authors transform female physiological experiences into literary tools.",
      researchBrief: "Synthesize the findings.",
      evidenceGuidance: "Use the cited leaf material.",
      requirementIds: ["REQ-COMPREHENSIVE", "REQ-LANGUAGE-CITATION"],
    };
    const task = (title: string) => ({ title, objective: title, acceptanceCriteria: ["Find evidence."] });
    const normalized = normalizePlan({
      aspects: [
        {
          label: "Conceptions of Conception",
          scopeNote: "Conception narratives.",
          requirementIds: ["REQ-CONCEPTIONS"],
          hypotheses: [
            { statement: "Analyze 'Conceptions of Conception': metaphors and divine roles.", researchBrief: "Research conception.", evidenceGuidance: "Use primary sources.", requirementIds: ["REQ-CONCEPTIONS", "REQ-LANGUAGE-CITATION"] },
            { ...duplicated },
          ],
          tasks: [task("Conceptions"), task("Synthesis A")],
        },
        {
          label: "Imagery of Pregnancy and Childbirth",
          scopeNote: "Pregnancy narratives.",
          requirementIds: ["REQ-PREGNANCY"],
          hypotheses: [
            { statement: "Analyze 'Imagery of Pregnancy and Childbirth': difficult births and nationhood.", researchBrief: "Research childbirth.", evidenceGuidance: "Use primary sources.", requirementIds: ["REQ-PREGNANCY", "REQ-LANGUAGE-CITATION"] },
            { ...duplicated },
            { ...duplicated },
          ],
          tasks: [task("Pregnancy"), task("Synthesis B"), task("Synthesis C")],
        },
      ],
    }, "Research motherhood narratives in named sections.", "Motherhood rubric.", {}, requirements);

    const comprehensiveLeaves = normalized.aspects
      .flatMap((aspect) => aspect.hypotheses)
      .filter((hypothesis) => (hypothesis.requirementIds ?? []).includes("REQ-COMPREHENSIVE"));
    expect(comprehensiveLeaves).toHaveLength(1);
    expect(normalized.aspects).toHaveLength(2);
    expect(normalized.aspects[0]?.hypotheses[0]?.requirementIds).toContain("REQ-CONCEPTIONS");
    expect(normalized.aspects[1]?.hypotheses[0]?.requirementIds).toContain("REQ-PREGNANCY");
  });

  it("keeps same-requirement leaves that research different entity shards or perspectives", () => {
    const entityRequirement = {
      ...requirement("R_TABLE", "Compare EV incentives across the US, Canada, and Turkey.", "task"),
      entityScope: ["United States", "Canada", "Turkey"],
    };
    const plain = requirement("R_DUAL", "Assess the policy on both sides.", "task");
    const task = (title: string) => ({ title, objective: title, acceptanceCriteria: ["Find evidence."] });
    const normalized = normalizePlan({
      aspects: [{
        label: "EV incentives",
        scopeNote: "Country comparison.",
        requirementIds: ["R_TABLE", "R_DUAL"],
        hypotheses: [
          { statement: "Research EV incentives in the United States.", researchBrief: "US row.", evidenceGuidance: "Official sources.", requirementIds: ["R_TABLE"] },
          { statement: "Research EV incentives in Canada.", researchBrief: "Canada row.", evidenceGuidance: "Official sources.", requirementIds: ["R_TABLE"] },
          { statement: "Analyze the benefits of the EV policy.", researchBrief: "One hand.", evidenceGuidance: "Sources.", requirementIds: ["R_DUAL"] },
          { statement: "Analyze the drawbacks of the EV policy.", researchBrief: "Other hand.", evidenceGuidance: "Sources.", requirementIds: ["R_DUAL"] },
        ],
        tasks: [task("US"), task("Canada"), task("Benefits"), task("Drawbacks")],
      }],
    }, "Compare EV incentives and assess both sides.", "EV rubric.", {}, [entityRequirement, plain]);

    const all = normalized.aspects.flatMap((aspect) => aspect.hypotheses);
    expect(all.filter((hypothesis) => (hypothesis.requirementIds ?? []).includes("R_TABLE"))).toHaveLength(2);
    expect(all.filter((hypothesis) => (hypothesis.requirementIds ?? []).includes("R_DUAL"))).toHaveLength(2);
  });

  it("normalizes malformed architect acceptanceCriteria before writing tasks", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-malformed-architect",
      async chat(req) {
        if (req.user.includes("Output schema:") && req.user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Land finance transition",
              scopeNote: "Study land finance transition.",
              hypotheses: [{
                statement: "Land finance has historical origins.",
                researchBrief: "Find historical origins.",
                evidenceGuidance: "Use credible sources.",
              }, {
                statement: "Property tax can support transition.",
                researchBrief: "Find property tax transition mechanism.",
                evidenceGuidance: "Use policy and academic sources.",
              }],
              tasks: [{
                title: "Historical origins",
                objective: "Find origins evidence.",
                acceptanceCriteria: "Find 1994 tax-sharing and 1998 housing reform evidence.",
              }, {
                title: "Property tax mechanism",
                objective: "Find property tax mechanism evidence.",
                acceptanceCriteria: [{ criterion: "Find tax base and beneficiary evidence." }],
              }],
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_malformed_architect",
      userInput: "Study land finance transition.",
      uiOptions: { outputLanguage: "en", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_malformed_architect";
    ctx.state.globalRubric = {
      rubricId: "RB_malformed",
      episodeId: ctx.state.episodeId,
      rubricText: "Check land finance transition.",
      outputHints: { titleHint: "Land finance transition", language: "en", citationRequired: true, format: "markdown" },
      researchQuestionHints: ["land finance"],
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));

    const result = await architectTreePhase(ctx);

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks[0]?.acceptanceCriteria).toEqual(["To verify: Find the applicable year tax-sharing and the applicable year housing reform evidence."]);
    expect(result.tasks[1]?.acceptanceCriteria).toEqual(["Find tax base and beneficiary evidence."]);
    expect((await ctx.stack.ledger.listAll()).every((task) => Array.isArray(task.acceptanceCriteria) && task.acceptanceCriteria.length > 0)).toBe(true);
  });
});
