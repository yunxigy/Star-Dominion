import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import type { FetchProvider, KnowledgeNode, LlmChat, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { completionGatePhase } from "../phases/completion-gate.js";
import { cycleReflectionPhase } from "../phases/cycle-reflection.js";
import { dispatchEvidencePhase } from "../phases/dispatch-evidence.js";
import { knowledgeNodeIdForUrl } from "../source-identity.js";
import { saveKnowledgeSource, saveSourceEvidence } from "../source-store.js";
import { tracedFetchPage } from "../trace.js";
import { fixedNow, submission, node, task, scriptedEvidenceReact } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("reuses KnowledgeNodes and cached fetches for repeated canonical URLs", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    let fetchCalls = 0;
    const llm: LlmChat = {
      name: "echo-scripted-reuse",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Verify URL reuse.",
            outputHints: { titleHint: "Reuse", language: "zh-CN", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["same url"],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["same url"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Aspect",
              scopeNote: "Aspect scope",
              hypotheses: [{ statement: "Claim uses same URL.", researchBrief: "Research same URL.", evidenceGuidance: "same url" }],
              tasks: [{ title: "Evidence task", objective: "Find same URL.", acceptanceCriteria: ["Save same URL."] }],
            }],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && !user.includes("ReflectionSchedulerAgent") && !user.includes("StructureReviewAgent")) {
          const taskId = user.match(/"taskId"\s*:\s*"([^"]+)"/)?.[1];
          return user.includes("Previous steps:\n[]")
            ? { content: JSON.stringify({ thoughtSummary: "Search same URL.", action: "tool", toolName: "web_search", args: { query: "same url" } }) }
            : { content: JSON.stringify({
                thoughtSummary: "Same URL evidence is enough.",
                action: "finish",
                finish: {
                  relation: "supports",
                  claimText: "Same canonical URL supports the claim.",
                  confidence: 0.8,
                  nodeStatus: "supported",
                  reasoningSummary: "Supported.",
                  reportletMarkdown: taskId ? `#### Same URL evidence\n\nSame canonical URL supports the claim. [E:E_${taskId}_1]` : undefined,
                  openGaps: [],
                  structurePatchSuggestions: [],
                },
              }) };
        }
        if (user.includes("Create a search plan")) {
          return { content: JSON.stringify({ queries: ["same url"], searchRationale: "same URL" }) };
        }
        if (user.includes("Assess the search observations")) {
          return { content: JSON.stringify({
            relation: "supports",
            claimText: "Same canonical URL supports the claim.",
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
        if (user.includes("Write the final report")) {
          return { content: "# Reuse\n\n## Aspect\n\nSame canonical URL supports the claim [C1].\n\n## 结论\n\n结论完整。" };
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "duplicate-search",
      async search() {
        return [
          { url: "https://example.test/source?utm_source=a", title: "Duplicated source", snippet: "Duplicate snippet." },
          { url: "https://example.test/source?utm_source=b", title: "Duplicated source", snippet: "Duplicate snippet again." },
        ];
      },
    };
    const fetchProvider: FetchProvider = {
      name: "cache-fetch",
      async fetchPage(url) {
        fetchCalls += 1;
        return {
          url,
          title: "Fetched duplicate source",
          description: "Fetched duplicate description.",
          content: "Fetched duplicate source content that is long enough to pass quality checks and describe what the source says.",
        };
      },
    };

    const kg = createInMemoryKgService();
    const memory = createInMemoryMemoryGraph();
    const result = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm,
      search,
      fetch: fetchProvider,
      stack: { kg, memory },
    }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    expect(fetchCalls).toBe(1);
    const nodes = await kg.listKnowledgeNodes();
    expect(nodes.filter((item) => item.url === "https://example.test/source").length).toBe(1);
    expect(nodes.filter((item) => item.nodeId.startsWith("K_url_")).length).toBe(1);
    const linksForNode = (await kg.listEvidenceLinks()).filter((link) => link.knowledgeNodeId === nodes[0]?.nodeId);
    expect(linksForNode.length).toBeGreaterThanOrEqual(1);
    expect(linksForNode.some((link) => link.createdByTaskId === "T_root")).toBe(false);
    const events = await memory.listEvents({ episodeId: result.episodeId });
    expect(events.some((event) => event.eventType === "full.fetch.cache_hit" || event.eventType === "full.fetch.kg_cache_hit")).toBe(true);
    expect(events.some((event) => event.eventType === "full.kg.reuseKnowledgeNode")).toBe(true);
    if (!result.evidenceIndexPath) throw new Error("expected evidence index path");
    const evidenceIndex = JSON.parse(await readFile(result.evidenceIndexPath, "utf8")) as Array<{ url: string; summary?: string }>;
    expect(evidenceIndex).toHaveLength(1);
    expect(evidenceIndex[0]?.summary).toContain("Fetched duplicate source content");
  });

  it("serves fetch_page from saved KnowledgeNode summaries before calling the provider", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.traceLevel = "full";
    let fetchCalls = 0;
    const fetchProvider: FetchProvider = {
      name: "network-fetch",
      async fetchPage() {
        fetchCalls += 1;
        throw new Error("network should not be called");
      },
    };
    const kg = createInMemoryKgService();
    const memory = createInMemoryMemoryGraph();
    const ctx = createPhaseContext(submission(), {
      now: fixedNow,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      fetch: fetchProvider,
      stack: { kg, memory },
    });
    ctx.state.episodeId = "EP_kg_fetch_cache";
    await kg.upsertKnowledgeNode({
      nodeId: "K_url_cached",
      nodeType: "WebPage",
      title: "Cached source",
      url: "https://example.test/source",
      contentHash: "sha256:cached",
      summary: "AI-written source summary that should be reusable.",
      sourceTier: "official",
      qualityScore: 0.9,
      retrievedByTaskId: "T_previous",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {
        canonicalUrl: "https://example.test/source",
        contentPreview: "Previously fetched full-content preview.",
      },
    });

    const page = await tracedFetchPage(ctx, "dispatch-evidence", "https://example.test/source?utm_source=x", { maxChars: 200 }, { taskId: "T_next", reportNodeId: "R_hyp" });

    expect(fetchCalls).toBe(0);
    expect(page?.content).toContain("Previously fetched full-content preview");
    expect(page?.content).toContain("AI-written source summary");
    const events = await memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.fetch.kg_cache_hit" && event.payload?.knowledgeNodeId === "K_url_cached")).toBe(true);
  });

  it("retains distinct focused passages when one canonical source is refreshed for multiple claims", async () => {
    const url = "https://official.example/regulation";
    const article = "--- Focused source passage 1 (characters 100-300) ---\nArticle 59 sets collection targets.";
    const annex = "--- Focused source passage 1 (characters 900-1100) ---\nAnnex XII Part C sets lithium material recovery targets.";
    const ctx = createPhaseContext(submission(), {
      now: fixedNow,
      llm: new EchoJsonLlm(),
      fetch: { name: "fixture-fetch", async fetchPage() { throw new Error("not called"); } },
    });
    ctx.state.fetchCache.set(`${url}::60000::article`, { url, title: "Regulation", content: article });
    ctx.state.fetchCache.set(`${url}::60000::annex`, { url, title: "Regulation", content: annex });

    await saveKnowledgeSource(ctx, {
      taskId: "T_article",
      reportNodeId: "R_article",
      index: 1,
      title: "Regulation - 2023/1542 - Batteries Regulation - EUR-Lex",
      url,
      content: article,
      sourceTier: "official",
      qualityScore: 0.9,
    });
    await saveKnowledgeSource(ctx, {
      taskId: "T_annex",
      reportNodeId: "R_annex",
      index: 1,
      title: "Regulation (EU) 2023/1542 Annex XII Part C - Lithium recovery targets",
      url,
      content: annex,
      sourceTier: "official",
      qualityScore: 0.9,
    });

    const [knowledge] = await ctx.stack.kg.listKnowledgeNodes();
    expect(knowledge?.metadata.focusedPassages).toEqual(expect.arrayContaining([
      expect.stringContaining("Article 59"),
      expect.stringContaining("Annex XII Part C"),
    ]));
    expect(knowledge?.title).toBe("Regulation - 2023/1542 - Batteries Regulation - EUR-Lex");
  });

  it("runs queued evidence agents concurrently up to the dispatch parallelism limit", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 2;
    runtimeProfile.phases.dispatchEvidence.maxOutputItems = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxSearchCalls = 1;

    let searchStarts = 0;
    let releaseBothSearches!: () => void;
    const bothSearchesStarted = new Promise<void>((resolve) => {
      releaseBothSearches = resolve;
    });
    const search: SearchProvider = {
      name: "blocking-parallel-search",
      async search(query) {
        searchStarts += 1;
        if (searchStarts === 2) releaseBothSearches();
        await bothSearchesStarted;
        return [{
          url: `https://example.test/${encodeURIComponent(query)}`,
          title: `Parallel source ${query}`,
          snippet: "This source provides enough fixture evidence for the parallel dispatch test.",
        }];
      },
    };
    const llm: LlmChat = {
      name: "scripted-parallel-dispatch",
      async chat(req) {
        if (req.user.includes("Create a search plan")) {
          return { content: JSON.stringify({ queries: ["parallel evidence"], searchRationale: "Exercise concurrent search." }) };
        }
        if (req.user.includes("Assess the search observations")) {
          return { content: JSON.stringify({
            relation: "supports",
            claimText: "Parallel dispatch collected evidence.",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Evidence supports the node.",
            openGaps: [],
            structurePatchSuggestions: [],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_parallel_dispatch";
    ctx.state.globalRubric = {
      rubricId: "RB_parallel",
      episodeId: ctx.state.episodeId,
      rubricText: "Dispatch two agents concurrently.",
      outputHints: { titleHint: "Parallel", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_1", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", parentNodeId: "R_aspect_1", label: "Hypothesis 1" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_2", nodeKind: "hypothesis", parentNodeId: "R_aspect_1", label: "Hypothesis 2" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_parallel_1", reportNodeId: "R_hyp_1", branchId: "B_parallel_1", title: "Parallel task 1", objective: "Find parallel evidence 1." }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_parallel_2", reportNodeId: "R_hyp_2", branchId: "B_parallel_2", title: "Parallel task 2", objective: "Find parallel evidence 2." }));

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const results = await Promise.race([
      dispatchEvidencePhase(ctx, "C_parallel"),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("dispatchEvidencePhase did not run agents concurrently")), 1000);
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });

    expect(results).toHaveLength(2);
    expect(searchStarts).toBe(2);
    expect((await ctx.stack.ledger.listByStatus("completed")).map((item) => item.taskId).sort()).toEqual(["T_parallel_1", "T_parallel_2"]);
  });

  it("runs an evidence agent through the ReAct runtime tool loop", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-react-evidence",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "react evidence",
          title: "ReAct source",
          url: "https://example.test/react-evidence",
          content: "ReAct source content is long enough to pass quality checks and prove that save_knowledge_node ran.",
          claimText: "ReAct evidence supports the claim.",
          reasoningSummary: "The ReAct loop searched, saved evidence, and finished.",
        });
      },
    };
    const search: SearchProvider = {
      name: "react-search",
      async search() {
        return [{ url: "https://example.test/react-evidence", title: "ReAct source", snippet: "ReAct evidence snippet." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_react_evidence";
    ctx.state.globalRubric = {
      rubricId: "RB_react",
      episodeId: ctx.state.episodeId,
      rubricText: "Run ReAct evidence.",
      outputHints: { titleHint: "ReAct", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_react", nodeKind: "hypothesis", parentNodeId: "R_root", label: "ReAct hypothesis" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_react", reportNodeId: "R_hyp_react", branchId: "B_react", title: "ReAct task", objective: "Run ReAct evidence." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_react");

    expect(result?.branchOutcome).toBe("done_here");
    expect(result?.knowledgeNodeIds).toHaveLength(1);
    expect(result?.evidenceLinkIds).toHaveLength(1);
    expect(result?.reportletIds).toHaveLength(1);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_react");
    expect(reportlets?.[0]?.citedEvidenceLinkIds).toEqual(result?.evidenceLinkIds);
    expect((await ctx.stack.ledger.getById("T_react"))?.status).toBe("completed");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.filter((event) => event.eventType === "full.llm.request" && event.payload?.phase === "dispatch-evidence.react" && event.taskId === "T_react").length).toBeGreaterThanOrEqual(3);
    expect(events.some((event) => event.eventType === "full.search.request" && event.taskId === "T_react")).toBe(true);
    expect(events.some((event) => event.eventType === "full.kg.upsertKnowledgeNode" && event.taskId === "T_react")).toBe(true);
  });

  it("keeps broad agent-node parts inside the parent agent and emits reportlets", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 4;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 2;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-agent-node-parts",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "agent node part evidence",
          title: "Agent node part source",
          url: "https://example.test/agent-node-part",
          content: "Agent node part source content is long enough to pass quality checks and support an atomic reportlet.",
          claimText: "Atomic part evidence supports the sub-claim.",
          reasoningSummary: "This atomic part now has a cited reportlet.",
          completedReportlets: [
            {
              partId: "P_1",
              title: "政府最大化土地出让金的动机如何导致保障性住房供应短缺",
              markdown: "#### 政府最大化土地出让金的动机如何导致保障性住房供应短缺\n\n这是模型明确完成的第一个内部报告任务。[E:E_T_broad_agent_node_1]",
              reasoningSummary: "P1 explicitly completed.",
            },
            {
              partId: "P_2",
              title: "房地产升值如何自动将财富分配给有产者并造成社会阶层固化",
              markdown: "#### 房地产升值如何自动将财富分配给有产者并造成社会阶层固化\n\n这是模型明确完成的第二个内部报告任务。[E:E_T_broad_agent_node_1]",
              reasoningSummary: "P2 explicitly completed.",
            },
            {
              partId: "P_3",
              title: "房地产高回报如何产生对实体经济的挤出效应",
              markdown: "#### 房地产高回报如何产生对实体经济的挤出效应\n\n这是模型明确完成的第三个内部报告任务。[E:E_T_broad_agent_node_1]",
              reasoningSummary: "P3 explicitly completed.",
            },
          ],
        });
      },
    };
    const search: SearchProvider = {
      name: "agent-node-part-search",
      async search() {
        return [{ url: "https://example.test/agent-node-part", title: "Agent node part source", snippet: "Part evidence snippet." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_agent_node_parts";
    ctx.state.globalRubric = {
      rubricId: "RB_agent_node_parts",
      episodeId: ctx.state.episodeId,
      rubricText: "Split broad agent node into atomic parts.",
      outputHints: { titleHint: "Agent Parts", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_broad",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "土地财政导致保障性住房供应不足、社会阶层固化和经济泡沫",
      scopeNote: "分析土地财政对住房保障、社会流动性和实体经济的影响。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_broad_agent_node",
      reportNodeId: "R_hyp_broad",
      branchId: "B_broad_agent_node",
      title: "土地财政负面后果",
      objective: "分析土地财政的负面后果，至少涵盖三个方面：保障性住房供应不足、社会阶层固化以及造成经济泡沫。",
      acceptanceCriteria: [
        "解释政府最大化土地出让金的动机如何导致保障性住房供应短缺。",
        "解释房地产升值如何自动将财富分配给有产者并造成社会阶层固化。",
        "分析房地产高回报如何产生对实体经济的挤出效应。",
      ],
    }));

    const results = await dispatchEvidencePhase(ctx, "C_agent_parts");

    expect(results).toHaveLength(1);
    expect(results[0]?.taskId).toBe("T_broad_agent_node");
    const plannedTask = await ctx.stack.ledger.getById("T_broad_agent_node");
    expect(plannedTask?.status).toBe("completed");
    expect(plannedTask?.plannedReportlets).toHaveLength(3);
    expect(plannedTask?.plannedReportlets?.every((item) => item.writingGoal.includes("写成一个可直接并入"))).toBe(true);
    expect(plannedTask?.plannedReportlets?.map((item) => item.expectedHeading)).toContain("政府最大化土地出让金的动机如何导致保障性住房供应短缺");
    expect((await ctx.stack.ledger.listAll()).some((item) => item.taskId.startsWith("T_part_"))).toBe(false);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_broad");
    expect(reportlets).toHaveLength(3);
    expect(reportlets?.every((reportlet) => reportlet.plannedReportlet?.parentAgentTaskId === "T_broad_agent_node")).toBe(true);
    const draftedNode = await ctx.stack.kg.getReportNode("R_hyp_broad");
    expect(draftedNode?.draftSummary).toContain("3 个报告任务片段");
    expect(draftedNode?.draftMarkdown).toContain("政府最大化土地出让金的动机如何导致保障性住房供应短缺");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "agent_node_parts_planned" && event.payload?.partCount === 3)).toBe(true);
    expect(events.some((event) => event.eventType === "report_node_draft_updated" && event.payload?.reportNodeId === "R_hyp_broad")).toBe(true);
  });

  it("emits only explicitly completed internal reportlets and gaps missing planned parts", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-completed-reportlets",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "agent node completed reportlets evidence",
          title: "Completed reportlet source",
          url: "https://example.test/completed-reportlets",
          content: "Completed reportlet source content is long enough to pass quality checks and support selected reportlets.",
          claimText: "Selected internal report tasks are supported.",
          reasoningSummary: "Two internal report tasks were completed; one remains open.",
          completedReportlets: [
            {
              partId: "P_1",
              title: "保障性住房供应短缺",
              markdown: "#### 保障性住房供应短缺\n\nP1 独立小报告。[E:E_T_completed_reportlets_1]",
              reasoningSummary: "P1 completed.",
            },
            {
              partId: "P_2",
              title: "社会阶层固化",
              markdown: "#### 社会阶层固化\n\nP2 独立小报告。[E:E_T_completed_reportlets_1]",
              reasoningSummary: "P2 completed.",
            },
          ],
        });
      },
    };
    const search: SearchProvider = {
      name: "completed-reportlets-search",
      async search() {
        return [{ url: "https://example.test/completed-reportlets", title: "Completed reportlet source", snippet: "Completed reportlet snippet." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_completed_reportlets";
    ctx.state.globalRubric = {
      rubricId: "RB_completed_reportlets",
      episodeId: ctx.state.episodeId,
      rubricText: "Emit only completed internal reportlets.",
      outputHints: { titleHint: "Completed Reportlets", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_completed",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "土地财政负面后果",
      scopeNote: "分析三个负面后果。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_completed_reportlets",
      reportNodeId: "R_hyp_completed",
      branchId: "B_completed_reportlets",
      title: "土地财政负面后果",
      objective: "分析土地财政的负面后果，至少涵盖三个方面：保障性住房供应不足、社会阶层固化以及造成经济泡沫。",
      acceptanceCriteria: [
        "解释保障性住房供应不足。",
        "解释社会阶层固化。",
        "分析经济泡沫和实体经济挤出效应。",
      ],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_completed_reportlets");

    expect(result?.taskId).toBe("T_completed_reportlets");
    expect(result?.reportletIds).toHaveLength(2);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_completed");
    expect(reportlets).toHaveLength(2);
    expect(reportlets?.map((reportlet) => reportlet.plannedReportlet?.partId).sort()).toEqual(["P_1", "P_2"]);
    expect(reportlets?.map((reportlet) => reportlet.markdown).sort()).toEqual([
      "#### 保障性住房供应短缺\n\nP1 独立小报告。[E:E_T_completed_reportlets_1]",
      "#### 社会阶层固化\n\nP2 独立小报告。[E:E_T_completed_reportlets_1]",
    ].sort());
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_completed")).resolves.toEqual([
      expect.objectContaining({
        gapType: "planned_reportlet_not_completed",
        taskId: "T_completed_reportlets",
        reportNodeId: "R_hyp_completed",
        status: "open",
      }),
    ]);
    const draftedNode = await ctx.stack.kg.getReportNode("R_hyp_completed");
    expect(draftedNode?.draftSummary).toContain("2 个报告任务片段");
    expect(draftedNode?.draftMarkdown).toContain("P1 独立小报告");
    expect(draftedNode?.draftMarkdown).toContain("P2 独立小报告");
    expect(draftedNode?.draftMarkdown).not.toContain("经济泡沫和实体经济挤出效应");
  });

  it("does not split reportletMarkdown into planned reportlets by heading text", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-reportlet-markdown-no-heading-split",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "reportlet markdown heading split",
          title: "Heading split source",
          url: "https://example.test/heading-split",
          content: "Heading split source content is long enough to pass quality checks.",
          claimText: "A broad reportletMarkdown was provided without completedReportlets.",
          reasoningSummary: "No structured completedReportlets were provided.",
          reportletMarkdown: "#### 保障性住房供应短缺\n\nThis heading matches P1 but is not a structured completed reportlet.\n\n#### 社会阶层固化\n\nThis heading matches P2 but is not a structured completed reportlet.",
        });
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_no_heading_split";
    ctx.state.globalRubric = {
      rubricId: "RB_no_heading_split",
      episodeId: ctx.state.episodeId,
      rubricText: "Do not split reportletMarkdown by heading.",
      outputHints: { titleHint: "No Heading Split", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_no_heading_split",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "土地财政负面后果",
      scopeNote: "分析两个负面后果。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_no_heading_split",
      reportNodeId: "R_hyp_no_heading_split",
      branchId: "B_no_heading_split",
      title: "土地财政负面后果",
      objective: "分析土地财政的负面后果。",
      acceptanceCriteria: [
        "解释保障性住房供应不足。",
        "解释社会阶层固化。",
      ],
      plannedReportlets: [
        {
          partId: "P_1",
          parentAgentTaskId: "T_no_heading_split",
          parentReportNodeId: "R_hyp_no_heading_split",
          expectedHeading: "保障性住房供应短缺",
          researchQuestion: "解释保障性住房供应不足。",
          searchGoal: "查找保障性住房供应不足的证据。",
          writingGoal: "写成保障性住房供应不足的小报告片段。",
          evidenceNeeds: ["直接证据"],
        },
        {
          partId: "P_2",
          parentAgentTaskId: "T_no_heading_split",
          parentReportNodeId: "R_hyp_no_heading_split",
          expectedHeading: "社会阶层固化",
          researchQuestion: "解释社会阶层固化。",
          searchGoal: "查找社会阶层固化的证据。",
          writingGoal: "写成社会阶层固化的小报告片段。",
          evidenceNeeds: ["直接证据"],
        },
      ],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_no_heading_split");

    expect(result?.reportletIds).toEqual([]);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_no_heading_split");
    expect(reportlets).toEqual([]);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_no_heading_split")).resolves.toEqual([
      expect.objectContaining({ gapType: "planned_reportlet_not_completed" }),
      expect.objectContaining({ gapType: "planned_reportlet_not_completed" }),
    ]);
  });

  it("keeps internal reportlet citations scoped to the evidence each part uses", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 6;
    runtimeProfile.agents.evidence.maxToolCalls = 4;
    const taskId = "T_scoped_reportlets";
    const saveCalls = [
      {
        title: "Second-home property tax rules",
        url: "https://example.test/second-home-property-tax",
        content: "Second-home ordinary commodity housing and improvement housing property tax rules are directly relevant.",
        relation: "supports",
        claimText: "第二套普通商品房及改善型住房征收房产税。",
        confidence: 0.86,
      },
      {
        title: "Rental housing tax relief",
        url: "https://example.test/rental-tax-relief",
        content: "Rental housing tax relief and deductions encourage leasing supply and reduce tax burden.",
        relation: "supports",
        claimText: "租赁性房产可获得房产税减免。",
        confidence: 0.84,
      },
      {
        title: "Second home deed tax background",
        url: "https://example.test/deed-tax-background",
        content: "A generic deed tax background page mentions house purchases but does not discuss property tax design.",
        relation: "background",
        claimText: "契税背景资料。",
        confidence: 0.3,
      },
    ];
    const savedKnowledgeNodeIds = saveCalls.map((item) => knowledgeNodeIdForUrl(item.url, `${item.title}\n${item.content}`));
    const systemPrompts: string[] = [];
    const llm: LlmChat = {
      name: "scripted-scoped-reportlet-citations",
      async chat(req) {
        if (req.system) systemPrompts.push(req.system);
        const savedCount = saveCalls.filter((item) => req.user.includes(item.url)).length;
        const next = saveCalls[savedCount];
        if (next) {
          return { content: JSON.stringify({
            thoughtSummary: `Save source ${savedCount + 1}.`,
            action: "tool",
            toolName: "save_knowledge_node",
            args: {
              ...next,
              index: savedCount + 1,
              qualityScore: next.confidence,
            },
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Finish with scoped reportlets.",
          action: "finish",
          finish: {
            relation: "supports",
            claimText: "存量房产税机制获得部分支持。",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Two internal report tasks were completed with separate evidence.",
            completedReportlets: [
              {
                partId: "P_1",
                title: "第二套普通商品房及改善型住房房产税",
                markdown: `#### 第二套普通商品房及改善型住房房产税\n\n第二套普通商品房及改善型住房应进入存量房产税税基。[E:E_${taskId}_1]`,
                citedKnowledgeNodeIds: savedKnowledgeNodeIds,
                reasoningSummary: "P1 uses only the second-home property tax source.",
              },
              {
                partId: "P_2",
                title: "租赁性房产税收减免",
                markdown: `#### 租赁性房产税收减免\n\n租赁性房产减免安排用于鼓励租赁供给。[E:E_${taskId}_2]`,
                citedEvidenceLinkIds: [`E_${taskId}_2`],
                citedKnowledgeNodeIds: savedKnowledgeNodeIds,
                reasoningSummary: "P2 uses only the rental tax relief source.",
              },
            ],
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_scoped_reportlet_citations";
    ctx.state.globalRubric = {
      rubricId: "RB_scoped_reportlets",
      episodeId: ctx.state.episodeId,
      rubricText: "Scope reportlet citations.",
      outputHints: { titleHint: "Scoped Reportlets", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_scoped",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "存量房产税模式",
      scopeNote: "解释存量房产税征收与租赁减免。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId,
      reportNodeId: "R_hyp_scoped",
      branchId: "B_scoped_reportlets",
      title: "存量房产税模式",
      objective: "解释新的存量模式，包含第二套普通商品房、改善型住房和租赁性房产减免。",
      acceptanceCriteria: [
        "说明第二套普通商品房及改善型住房征收房产税。",
        "说明租赁性房产税收减免。",
      ],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_scoped_reportlets");

    expect(result?.evidenceLinkIds).toEqual([`E_${taskId}_1`, `E_${taskId}_2`, `E_${taskId}_3`]);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_scoped");
    expect(reportlets).toHaveLength(2);
    const first = reportlets?.find((reportlet) => reportlet.plannedReportlet?.partId === "P_1");
    const second = reportlets?.find((reportlet) => reportlet.plannedReportlet?.partId === "P_2");
    expect(first?.citedEvidenceLinkIds).toEqual([`E_${taskId}_1`]);
    expect(second?.citedEvidenceLinkIds).toEqual([`E_${taskId}_2`]);
    expect(first?.citedKnowledgeNodeIds).toEqual([savedKnowledgeNodeIds[0]]);
    expect(second?.citedKnowledgeNodeIds).toEqual([savedKnowledgeNodeIds[1]]);
    expect(first?.citedEvidenceLinkIds).not.toContain(`E_${taskId}_3`);
    expect(second?.citedEvidenceLinkIds).not.toContain(`E_${taskId}_3`);
    expect(systemPrompts.some((prompt) => prompt.includes("cite only sources whose content is used in that reportlet"))).toBe(true);
    expect(systemPrompts.some((prompt) => prompt.includes("not the whole agent evidence set"))).toBe(true);
  });

  it("does not infer the whole agent evidence set for internal reportlets without explicit citations", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 5;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const taskId = "T_no_implicit_reportlet_cites";
    const saveCalls = [
      {
        title: "Land transfer income data",
        url: "https://example.test/land-transfer-income",
        content: "Land transfer income reached a specific amount in 2021 and supports fiscal data analysis.",
        relation: "supports",
        claimText: "2021年土地出让收入数据。",
        confidence: 0.82,
      },
      {
        title: "Housing tax pilot background",
        url: "https://example.test/housing-tax-pilot",
        content: "Housing tax pilot background covers Shanghai and Chongqing property tax pilots.",
        relation: "background",
        claimText: "房产税试点背景。",
        confidence: 0.35,
      },
    ];
    const llm: LlmChat = {
      name: "scripted-no-implicit-reportlet-cites",
      async chat(req) {
        const savedCount = saveCalls.filter((item) => req.user.includes(item.url)).length;
        const next = saveCalls[savedCount];
        if (next) {
          return { content: JSON.stringify({
            thoughtSummary: `Save source ${savedCount + 1}.`,
            action: "tool",
            toolName: "save_knowledge_node",
            args: {
              ...next,
              index: savedCount + 1,
              qualityScore: next.confidence,
            },
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Finish with uncited reportlets.",
          action: "finish",
          finish: {
            relation: "supports",
            claimText: "Agent saved evidence, but reportlets omitted explicit citations.",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "The model did not specify per-reportlet citations.",
            completedReportlets: [
              {
                partId: "P_1",
                title: "土地出让收入数据",
                markdown: "#### 土地出让收入数据\n\n2021年土地出让收入用于说明增量模式不可持续。",
                reasoningSummary: "No explicit citation ids were provided.",
              },
              {
                partId: "P_2",
                title: "房产税试点背景",
                markdown: "#### 房产税试点背景\n\n上海和重庆试点说明存量环节改革仍有限。",
                reasoningSummary: "No explicit citation ids were provided.",
              },
            ],
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_no_implicit_reportlet_cites";
    ctx.state.globalRubric = {
      rubricId: "RB_no_implicit_reportlet_cites",
      episodeId: ctx.state.episodeId,
      rubricText: "Do not infer reportlet citations.",
      outputHints: { titleHint: "No Implicit Reportlet Citations", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_no_implicit_cites",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "引用隔离",
      scopeNote: "验证内部报告任务不会共享整批证据。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId,
      reportNodeId: "R_hyp_no_implicit_cites",
      branchId: "B_no_implicit_cites",
      title: "引用隔离",
      objective: "验证没有显式引用时不自动挂整批证据。",
      acceptanceCriteria: [
        "说明土地出让收入数据。",
        "说明房产税试点背景。",
      ],
      plannedReportlets: [
        {
          partId: "P_1",
          parentAgentTaskId: taskId,
          parentReportNodeId: "R_hyp_no_implicit_cites",
          expectedHeading: "土地出让收入数据",
          researchQuestion: "说明土地出让收入数据。",
          searchGoal: "查找土地出让收入数据。",
          writingGoal: "写成土地出让收入数据的小报告片段。",
          evidenceNeeds: ["数据来源"],
        },
        {
          partId: "P_2",
          parentAgentTaskId: taskId,
          parentReportNodeId: "R_hyp_no_implicit_cites",
          expectedHeading: "房产税试点背景",
          researchQuestion: "说明房产税试点背景。",
          searchGoal: "查找房产税试点背景。",
          writingGoal: "写成房产税试点背景的小报告片段。",
          evidenceNeeds: ["政策背景来源"],
        },
      ],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_no_implicit_cites");

    expect(result?.evidenceLinkIds).toEqual([`E_${taskId}_1`, `E_${taskId}_2`]);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_no_implicit_cites");
    expect(reportlets).toEqual([]);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_no_implicit_cites")).resolves.toEqual([
      expect.objectContaining({ gapType: "planned_reportlet_not_completed" }),
      expect.objectContaining({ gapType: "planned_reportlet_not_completed" }),
    ]);
  });

  it("does not auto-save search hits for internal reportlet tasks that lack cited reportlets", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 3;
    runtimeProfile.agents.evidence.maxToolCalls = 2;
    const llm: LlmChat = {
      name: "scripted-no-autosave-internal-reportlets",
      async chat(req) {
        if (req.user.includes("Previous steps:\n[]")) {
          return { content: JSON.stringify({
            thoughtSummary: "Search but do not save.",
            action: "tool",
            toolName: "web_search",
            args: { query: "internal reportlet autosave should not happen", topK: 1 },
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Finish without cited reportlets.",
          action: "finish",
          finish: {
            relation: "qualifies",
            claimText: "Search found a possible source, but no cited reportlet was completed.",
            confidence: 0.4,
            nodeStatus: "partially_supported",
            reasoningSummary: "No source was explicitly saved and no completedReportlets cite evidence.",
            completedReportlets: [],
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const search: SearchProvider = {
      name: "no-autosave-internal-search",
      async search() {
        return [{ url: "https://example.test/no-autosave-internal", title: "Do not autosave internal source", snippet: "Potential source should not be auto-saved." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_no_autosave_internal_reportlets";
    ctx.state.globalRubric = {
      rubricId: "RB_no_autosave_internal",
      episodeId: ctx.state.episodeId,
      rubricText: "No autosave for internal reportlet tasks.",
      outputHints: { titleHint: "No Autosave Internal", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_no_autosave_internal",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "内部报告任务",
      scopeNote: "验证内部任务不自动保存搜索结果。",
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_no_autosave_internal",
      reportNodeId: "R_hyp_no_autosave_internal",
      branchId: "B_no_autosave_internal",
      title: "内部报告任务",
      objective: "内部报告任务必须主动保存证据并写带引用小报告。",
      plannedReportlets: [{
        partId: "P_1",
        parentAgentTaskId: "T_no_autosave_internal",
        parentReportNodeId: "R_hyp_no_autosave_internal",
        expectedHeading: "内部小报告",
        researchQuestion: "写一个带引用的小报告。",
        searchGoal: "查找并主动保存证据。",
        writingGoal: "写成带引用的小报告。",
        evidenceNeeds: ["显式保存的证据"],
      }],
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_no_autosave_internal");

    expect(result?.knowledgeNodeIds).toEqual([]);
    expect(result?.evidenceLinkIds).toEqual([]);
    expect(result?.reportletIds).toEqual([]);
    expect(await ctx.stack.kg.listKnowledgeNodes()).toEqual([]);
    expect(await ctx.stack.kg.listEvidenceLinks("R_hyp_no_autosave_internal")).toEqual([]);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_no_autosave_internal")).resolves.toEqual([
      expect.objectContaining({ gapType: "low_quality_sources" }),
      expect.objectContaining({ gapType: "planned_reportlet_not_completed" }),
    ]);
  });

  it("does not turn unsaved production search hits into supporting evidence", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxOutputItems = 24;
    runtimeProfile.agents.evidence.maxReactSteps = 3;
    runtimeProfile.agents.evidence.maxToolCalls = 2;
    runtimeProfile.agents.evidence.maxSearchCalls = 1;
    const llm: LlmChat = {
      name: "scripted-production-unsaved-results",
      async chat(req) {
        if (req.user.includes("Previous steps:\n[]")) {
          return { content: JSON.stringify({
            thoughtSummary: "Search for direct evidence.",
            action: "tool",
            toolName: "web_search",
            args: { query: "direct clinical evidence", topK: 24 },
          }) };
        }
        return { content: JSON.stringify({
          relation: "supports",
          claimText: "All search results support the clinical claim.",
          confidence: 0.8,
          nodeStatus: "supported",
          reasoningSummary: "The search returned many possible sources, but none was explicitly inspected or saved.",
          reportletMarkdown: "",
          completedReportlets: [],
          openGaps: [],
          structurePatchSuggestions: [],
        }) };
      },
    };
    const search: SearchProvider = {
      name: "unsaved-production-search",
      async search() {
        return Array.from({ length: 20 }, (_, index) => ({
          url: "https://example.test/unsaved-" + index,
          title: "Unverified result " + index,
          snippet: "A search snippet that has not been inspected or explicitly selected as evidence.",
        }));
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_unsaved_production_results";
    ctx.state.globalRubric = {
      rubricId: "RB_unsaved_production_results",
      episodeId: ctx.state.episodeId,
      rubricText: "Search results are not evidence until explicitly saved.",
      outputHints: { titleHint: "Explicit Evidence", language: "en", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_unsaved", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Clinical claim" }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_reflect_unsaved_results",
      reportNodeId: "R_hyp_unsaved",
      branchId: "B_unsaved_results",
      title: "Repair clinical evidence",
      objective: "Find direct clinical evidence.",
    }));

    const [result] = await dispatchEvidencePhase(ctx, "C_unsaved_results");

    expect(result?.knowledgeNodeIds).toEqual([]);
    expect(result?.evidenceLinkIds).toEqual([]);
    expect(result?.nodeUpdates[0]?.newStatus).toBe("insufficient_evidence");
    expect(await ctx.stack.kg.listKnowledgeNodes()).toEqual([]);
    expect(await ctx.stack.kg.listEvidenceLinks("R_hyp_unsaved")).toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => (
      event.eventType === "full.kg.skipEvidenceLink"
      && event.payload?.reason === "explicit_evidence_save_required"
      && event.payload?.searchHitCount === 20
    ))).toBe(true);
  });

  it("keeps unplanned publish repair reportlets unique and accumulates branch drafts", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 2;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 2;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-unplanned-reportlet-collision",
      async chat(req) {
        const second = req.user.includes("T_publish_repair_rubric_coverage_2");
        return scriptedEvidenceReact(req.user, {
          query: second ? "negative consequence evidence" : "land sale data evidence",
          title: second ? "Negative consequence source" : "Land sale data source",
          url: second ? "https://example.test/negative" : "https://example.test/data",
          content: `${second ? "Negative consequence" : "Land sale data"} source content is detailed enough to pass source quality checks and support the repair task.`,
          claimText: second ? "Land finance has negative consequences." : "Land sale income data supports the repair.",
          reasoningSummary: second ? "Negative consequences repaired." : "Data gap repaired.",
          reportletMarkdown: second
            ? "### 负面后果\n\n保障房、阶层固化和泡沫问题得到支持[E:E_T_publish_repair_rubric_coverage_2_1]。"
            : "### 数据补充\n\n2021年土地出让收入和相关比例得到支持[E:E_T_publish_repair_rubric_coverage_1_1]。",
        });
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_unplanned_reportlet_collision";
    ctx.state.globalRubric = {
      rubricId: "RB_unplanned_reportlet_collision",
      episodeId: ctx.state.episodeId,
      rubricText: "Repair reportlets must remain unique.",
      outputHints: { titleHint: "Repair Reportlets", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Land finance", status: "needs_repair" }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_publish_repair_rubric_coverage_1",
      reportNodeId: "R_hyp_1",
      title: "Repair data coverage",
      objective: "Repair data coverage.",
      branchId: "B_publish_1",
      priority: 90,
    }));
    await ctx.stack.ledger.upsert(task({
      taskId: "T_publish_repair_rubric_coverage_2",
      reportNodeId: "R_hyp_1",
      title: "Repair consequence coverage",
      objective: "Repair consequence coverage.",
      branchId: "B_publish_2",
      priority: 89,
    }));

    const results = await dispatchEvidencePhase(ctx, "C_publish_repairs");

    expect(results).toHaveLength(2);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_1");
    expect(reportlets).toHaveLength(2);
    expect(new Set(reportlets?.map((reportlet) => reportlet.reportletId)).size).toBe(2);
    expect(reportlets?.some((reportlet) => reportlet.taskId === "T_publish_repair_rubric_coverage_1")).toBe(true);
    expect(reportlets?.some((reportlet) => reportlet.taskId === "T_publish_repair_rubric_coverage_2")).toBe(true);
    expect(reportlets?.find((reportlet) => reportlet.taskId === "T_publish_repair_rubric_coverage_1")?.citedEvidenceLinkIds).toEqual(["E_T_publish_repair_rubric_coverage_1_1"]);
    expect(reportlets?.find((reportlet) => reportlet.taskId === "T_publish_repair_rubric_coverage_2")?.citedEvidenceLinkIds).toEqual(["E_T_publish_repair_rubric_coverage_2_1"]);
    const draftedNode = await ctx.stack.kg.getReportNode("R_hyp_1");
    expect(draftedNode?.draftSummary).toContain("2 个报告任务片段");
    expect(draftedNode?.draftMarkdown).toContain("数据补充");
    expect(draftedNode?.draftMarkdown).toContain("负面后果");
  });

  it("rejects unplanned reportlets without position-level evidence markers", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-unplanned-reportlet-without-marker",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "land finance evidence",
          title: "Land finance source",
          url: "https://example.test/no-marker",
          content: "This source is detailed enough to support the claim and pass source quality checks.",
          claimText: "Land finance evidence supports the claim.",
          reasoningSummary: "Evidence was saved, but the reportlet omitted a position-level marker.",
          reportletMarkdown: "### 无位置引用\n\n这段文字没有标明具体证据位置。",
        });
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_unplanned_reportlet_without_marker";
    ctx.state.globalRubric = {
      rubricId: "RB_unplanned_reportlet_without_marker",
      episodeId: ctx.state.episodeId,
      rubricText: "Reportlets require position-level evidence markers.",
      outputHints: { titleHint: "Explicit Citation", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_marker", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Marker hypothesis" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_marker", reportNodeId: "R_hyp_marker", branchId: "B_marker", title: "Marker task", objective: "Write an explicitly cited reportlet." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_marker");

    expect(result?.evidenceLinkIds).toEqual(["E_T_marker_1"]);
    expect(result?.reportletIds).toEqual([]);
    await expect(ctx.stack.kg.listReportlets?.("R_hyp_marker")).resolves.toEqual([]);
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_marker")).resolves.toEqual([
      expect.objectContaining({ gapType: "reportlet_missing_explicit_citation", taskId: "T_marker", status: "open" }),
    ]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "reportlet_citation_rejected" && event.payload?.reason === "missing_explicit_evidence_marker")).toBe(true);
  });

  it("normalizes reportlet markers that omit the evidence id E_ prefix", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.agents.evidence.maxReactSteps = 4;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const llm: LlmChat = {
      name: "scripted-reportlet-short-evidence-id",
      async chat(req) {
        return scriptedEvidenceReact(req.user, {
          query: "land finance evidence",
          title: "Land finance source",
          url: "https://example.test/short-evidence-id",
          content: "This source is detailed enough to support the reportlet and pass source quality checks.",
          claimText: "Land finance evidence supports the claim.",
          reasoningSummary: "The reportlet used the common shortened marker form.",
          reportletMarkdown: "### 有位置引用\n\n该结论由已保存证据支持。[E:T_marker_alias_1]",
        });
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reportlet_short_evidence_id";
    ctx.state.globalRubric = {
      rubricId: "RB_reportlet_short_evidence_id",
      episodeId: ctx.state.episodeId,
      rubricText: "Normalize an unambiguous shortened evidence id.",
      outputHints: { titleHint: "Explicit Citation", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_marker_alias", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Marker alias hypothesis" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_marker_alias", reportNodeId: "R_hyp_marker_alias", branchId: "B_marker_alias", title: "Marker alias task", objective: "Write a cited reportlet." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_marker_alias");

    expect(result?.evidenceLinkIds).toEqual(["E_T_marker_alias_1"]);
    expect(result?.reportletIds).toHaveLength(1);
    const reportlets = await ctx.stack.kg.listReportlets?.("R_hyp_marker_alias");
    expect(reportlets).toHaveLength(1);
    expect(reportlets?.[0]?.markdown).toContain("[E:E_T_marker_alias_1]");
    expect(reportlets?.[0]?.citedEvidenceLinkIds).toEqual(["E_T_marker_alias_1"]);
  });

  it("does not autosave low-confidence background search hits as evidence", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxOutputItems = 10;
    runtimeProfile.agents.evidence.maxReactSteps = 3;
    runtimeProfile.agents.evidence.maxToolCalls = 1;
    runtimeProfile.agents.evidence.maxSearchCalls = 1;
    const llm: LlmChat = {
      name: "scripted-low-background-autosave",
      async chat(req) {
        if (req.user.includes("Previous steps:\n[]")) {
          return { content: JSON.stringify({
            thoughtSummary: "Search for weak background.",
            action: "tool",
            toolName: "web_search",
            args: { query: "weak background", topK: 10 },
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "No direct support found.",
          action: "finish",
          finish: {
            relation: "background",
            claimText: "No direct source supports this mechanism.",
            confidence: 0.1,
            nodeStatus: "insufficient_evidence",
            reasoningSummary: "Only weak background search hits were available.",
            openGaps: [{ gapType: "missing_evidence", description: "Direct support is missing.", suggestedQuery: "direct support" }],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const search: SearchProvider = {
      name: "weak-background-search",
      async search() {
        return Array.from({ length: 8 }, (_, index) => ({
          url: `https://example.test/weak-${index}`,
          title: `Weak background ${index}`,
          snippet: "A weak background result that does not support the mechanism.",
        }));
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_low_background_autosave";
    ctx.state.globalRubric = {
      rubricId: "RB_low_background_autosave",
      episodeId: ctx.state.episodeId,
      rubricText: "Skip low confidence background autosave.",
      outputHints: { titleHint: "Low Background", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_low_bg", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Low background" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_low_bg", reportNodeId: "R_hyp_low_bg", branchId: "B_low_bg", title: "Low background task", objective: "Find direct support." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_low_bg");

    expect(result?.knowledgeNodeIds).toEqual([]);
    expect(result?.evidenceLinkIds).toEqual([]);
    expect(ctx.state.sourceGuards).toHaveLength(2);
    expect(ctx.state.sourceGuards.map((guard) => guard.canonicalUrl)).toEqual(["https://example.test/weak-0", "https://example.test/weak-1"]);
    expect(ctx.state.sourceGuards.every((guard) => guard.reportNodeId === "R_hyp_low_bg" && guard.reason === "low_signal_background_autosave")).toBe(true);
    await expect(ctx.stack.kg.listKnowledgeNodes()).resolves.toEqual([]);
    await expect(ctx.stack.kg.listEvidenceLinks("R_hyp_low_bg")).resolves.toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.skipEvidenceLink" && event.payload?.reason === "low_signal_background_autosave")).toBe(true);
  });

  it("guards low-signal sources only for the same report-node claim", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_source_guard_context";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_guard", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Guarded source" }));
    const base = {
      taskId: "T_guard_1",
      reportNodeId: "R_guard",
      branchId: "B_guard",
      agentRunId: "A_guard",
      index: 1,
      title: "Guarded source",
      url: "https://example.test/guarded?utm_source=x",
      snippet: "Weak background snippet.",
      sourceTier: "secondary" as const,
      qualityScore: 0.5,
      relation: "background" as const,
      claimText: "This source does not support claim A.",
      confidence: 0.1,
    };

    await expect(saveSourceEvidence(ctx, base)).resolves.toBeUndefined();
    await expect(saveSourceEvidence(ctx, { ...base, taskId: "T_guard_2", index: 2, confidence: 0.5 })).resolves.toBeUndefined();
    await expect(saveSourceEvidence(ctx, {
      ...base,
      taskId: "T_guard_3",
      index: 3,
      relation: "supports",
      claimText: "This source directly supports claim B.",
      confidence: 0.8,
      content: "The same source can directly support a different claim when the saved claim is different.",
    })).resolves.toMatchObject({ evidenceLinkId: "E_T_guard_3_3" });

    await expect(ctx.stack.kg.listKnowledgeNodes()).resolves.toHaveLength(1);
    await expect(ctx.stack.kg.listEvidenceLinks("R_guard")).resolves.toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.skipEvidenceLink" && event.payload?.reason === "guarded_low_signal_source")).toBe(true);
    expect(events.some((event) => event.eventType === "full.kg.sourceGuardNotice" && event.payload?.reason === "previous_low_signal_source")).toBe(true);
  });

  it("caps actively saved background evidence per agent", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.agents.evidence.maxReactSteps = 6;
    runtimeProfile.agents.evidence.maxToolCalls = 4;
    const sources = [1, 2, 3].map((index) => ({
      title: `Background ${index}`,
      url: `https://example.test/background-${index}`,
      content: `Background ${index} is usable but not direct support for the claim.`,
    }));
    const llm: LlmChat = {
      name: "scripted-background-save-cap",
      async chat(req) {
        const savedCount = sources.filter((item) => req.user.includes(item.url)).length;
        const next = sources[savedCount];
        if (next) {
          return { content: JSON.stringify({
            thoughtSummary: `Save background ${savedCount + 1}.`,
            action: "tool",
            toolName: "save_knowledge_node",
            args: {
              ...next,
              relation: "background",
              claimText: "Only background material is available.",
              confidence: 0.5,
              qualityScore: 0.6,
            },
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Finish with background caveat.",
          action: "finish",
          finish: {
            relation: "background",
            claimText: "Only background material is available.",
            confidence: 0.5,
            nodeStatus: "partially_supported",
            reasoningSummary: "Only background evidence was retained.",
            reportletMarkdown: "### 背景\n\n仅有背景资料可用。[E:E_T_background_cap_1]",
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_background_save_cap";
    ctx.state.globalRubric = {
      rubricId: "RB_background_save_cap",
      episodeId: ctx.state.episodeId,
      rubricText: "Cap background saves.",
      outputHints: { titleHint: "Background Cap", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_background_cap", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Background cap" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_background_cap", reportNodeId: "R_hyp_background_cap", branchId: "B_background_cap", title: "Background cap task", objective: "Save background." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_background_cap");

    expect(result?.evidenceLinkIds).toEqual(["E_T_background_cap_1", "E_T_background_cap_2"]);
    await expect(ctx.stack.kg.listEvidenceLinks("R_hyp_background_cap")).resolves.toHaveLength(2);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.skipEvidenceLink" && event.payload?.reason === "background_save_limit")).toBe(true);
  });

  it("reuses duplicate evidence links for the same task, source, and claim", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.agents.evidence) throw new Error("evidence config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.agents.evidence.maxReactSteps = 5;
    runtimeProfile.agents.evidence.maxToolCalls = 3;
    const source = {
      title: "Duplicate source",
      url: "https://example.test/duplicate-source",
      content: "Duplicate source content is usable and directly supports the same claim.",
      relation: "supports",
      claimText: "Duplicate source supports the claim.",
      confidence: 0.8,
      qualityScore: 0.8,
    };
    let saveAttempts = 0;
    const llm: LlmChat = {
      name: "scripted-duplicate-evidence-link",
      async chat() {
        if (saveAttempts < 2) {
          saveAttempts += 1;
          return { content: JSON.stringify({
            thoughtSummary: "Save the same source again.",
            action: "tool",
            toolName: "save_knowledge_node",
            args: source,
          }) };
        }
        return { content: JSON.stringify({
          thoughtSummary: "Finish after duplicate save.",
          action: "finish",
          finish: {
            relation: "supports",
            claimText: source.claimText,
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Duplicate source was saved twice but should only create one evidence link.",
            reportletMarkdown: "### 去重\n\n同一资料同一主张只应形成一条证据边。[E:E_T_duplicate_link_1]",
            openGaps: [],
            structurePatchSuggestions: [],
          },
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_duplicate_evidence_link";
    ctx.state.globalRubric = {
      rubricId: "RB_duplicate_evidence_link",
      episodeId: ctx.state.episodeId,
      rubricText: "Deduplicate evidence links.",
      outputHints: { titleHint: "Deduplicate", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_duplicate", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Duplicate" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_duplicate_link", reportNodeId: "R_hyp_duplicate", branchId: "B_duplicate", title: "Duplicate task", objective: "Deduplicate source." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_duplicate");

    expect(result?.evidenceLinkIds).toEqual(["E_T_duplicate_link_1"]);
    await expect(ctx.stack.kg.listKnowledgeNodes()).resolves.toHaveLength(1);
    await expect(ctx.stack.kg.listEvidenceLinks("R_hyp_duplicate")).resolves.toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.reuseEvidenceLink")).toBe(true);
  });

  it("does not downgrade an already supported node when a repair finds no new source", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxReactSteps = 2;
    runtimeProfile.agents.evidence.maxToolCalls = 1;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_preserve_supported_on_empty_repair";
    ctx.state.globalRubric = {
      rubricId: "RB_preserve",
      episodeId: ctx.state.episodeId,
      rubricText: "Preserve supported status.",
      outputHints: { titleHint: "Preserve", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_supported", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Supported hypothesis", status: "supported" }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_existing_support",
      nodeType: "WebPage",
      title: "Existing support",
      url: "https://example.test/existing-support",
      contentHash: "sha256:existing",
      summary: "Existing evidence already supports the claim.",
      sourceTier: "secondary",
      qualityScore: 0.75,
      retrievedByTaskId: "T_previous",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_existing_support",
      reportNodeId: "R_hyp_supported",
      knowledgeNodeId: "K_existing_support",
      relation: "supports",
      claimText: "Existing evidence supports the claim.",
      confidence: 0.75,
      createdByTaskId: "T_previous",
      createdAt: new Date(fixedNow()).toISOString(),
    });
    await ctx.stack.ledger.upsert(task({ taskId: "T_completion_empty", reportNodeId: "R_hyp_supported", branchId: "B_completion_empty", title: "Empty repair", objective: "Try one more source." }));

    const [result] = await dispatchEvidencePhase(ctx, "C_empty");

    expect(result?.knowledgeNodeIds).toHaveLength(0);
    expect((await ctx.stack.kg.getReportNode("R_hyp_supported"))?.status).toBe("supported");
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_supported")).resolves.toEqual([
      expect.objectContaining({ gapType: "low_quality_sources", status: "open" }),
    ]);
  });

  it("runs cycle reflection only after every evidence agent in the batch finishes", async () => {
    const dir = await artifactDir();
    const memory = createInMemoryMemoryGraph();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 2;
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    const llm: LlmChat = {
      name: "scripted-batch-reflection-order",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Check reflection ordering.",
            outputHints: { titleHint: "Reflection Order", language: "en", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["a", "b"],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["reflection order"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Aspect",
              scopeNote: "Aspect scope",
              hypotheses: [
                { statement: "Claim A.", researchBrief: "Research A.", evidenceGuidance: "A evidence" },
                { statement: "Claim B.", researchBrief: "Research B.", evidenceGuidance: "B evidence" },
              ],
              tasks: [
                { title: "Task A", objective: "Find A.", acceptanceCriteria: ["Save A."] },
                { title: "Task B", objective: "Find B.", acceptanceCriteria: ["Save B."] },
              ],
            }],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime")) {
          const isB = user.includes("Task B") || user.includes("R_hyp_2");
          return scriptedEvidenceReact(user, {
            query: isB ? "B evidence" : "A evidence",
            title: isB ? "Source B" : "Source A",
            url: isB ? "https://example.test/b" : "https://example.test/a",
            content: "Batch reflection ordering source content is long enough to be saved as evidence.",
            claimText: isB ? "Claim B is supported." : "Claim A is supported.",
            reasoningSummary: isB ? "B evidence saved." : "A evidence saved.",
          });
        }
        if (user.includes("Reflect on this dispatch cycle")) {
          return { content: JSON.stringify({ continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] }) };
        }
        if (user.includes("Review this report tree")) {
          return { content: JSON.stringify({ suggestions: [] }) };
        }
        if (user.includes("Draft one focused subsection")) {
          return { content: "### Leaf\n\nLeaf evidence [C1]." };
        }
        if (user.includes("Draft one top-level section overview")) {
          return { content: "## Aspect\n\nSection evidence [C1]." };
        }
        if (user.includes("Write only the opening executive summary")) {
          return { content: "## Executive Summary\n\nSummary [C1].\n\n## Conclusion\n\nComplete conclusion." };
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "batch-order-search",
      async search(query) {
        return [{ url: `https://example.test/${encodeURIComponent(query)}`, title: `Source ${query}`, snippet: "Evidence snippet." }];
      },
    };

    const result = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm,
      search,
      stack: { memory },
    }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    const events = await memory.listEvents({ episodeId: result.episodeId });
    const reflectionIndex = events.findIndex((event) => event.eventType === "cycle_reflection");
    const finishedIndexes = events
      .map((event, index) => event.eventType === "evidence_agent_finished" ? index : -1)
      .filter((index) => index >= 0 && index < reflectionIndex);
    expect(finishedIndexes).toHaveLength(2);
    expect(reflectionIndex).toBeGreaterThan(Math.max(...finishedIndexes));
    expect(events.some((event) => event.eventType === "reflection_scheduler_started")).toBe(true);
    expect(events.some((event) => event.eventType === "reflection_scheduler_finished" && event.payload?.continueDispatch === false)).toBe(true);
  });

  it("runs structure review between redispatch cycles instead of after all evidence cycles", async () => {
    const dir = await artifactDir();
    const memory = createInMemoryMemoryGraph();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    let reflectionCalls = 0;
    const llm: LlmChat = {
      name: "scripted-macro-cycle-order",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Check macro cycle order.",
            outputHints: { titleHint: "Macro Order", language: "zh-CN", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["order"],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["macro order source"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "宏观流程",
              scopeNote: "验证每轮探索后的调整和再分发顺序。",
              hypotheses: [{ statement: "每轮探索后需要先全局反思和结构调整，再进入下一轮再分发。", researchBrief: "验证宏观流程。", evidenceGuidance: "查找流程证据。" }],
              tasks: [{ title: "首轮流程证据", objective: "Find first-cycle evidence.", acceptanceCriteria: ["Save evidence."] }],
            }],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("ReflectionSchedulerAgent")) {
          reflectionCalls += 1;
          return { content: JSON.stringify({
            thoughtSummary: reflectionCalls === 1 ? "Redispatch one follow-up after global review." : "No more redispatch needed.",
            action: "finish",
            finish: reflectionCalls === 1
              ? {
                  continueDispatch: true,
                  taskUpdates: [],
                  newTasks: [{
                    parentTaskId: "T_item_1",
                    reportNodeId: "R_hyp_1",
                    title: "第二轮流程证据",
                    objective: "Find follow-up evidence after structure review.",
                    priority: 80,
                    acceptanceCriteria: ["Save follow-up evidence."],
                  }],
                  skipReasons: [],
                }
              : { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("StructureReviewAgent")) {
          return { content: JSON.stringify({
            thoughtSummary: "Structure review ran before any next redispatch cycle.",
            action: "finish",
            finish: { suggestions: [] },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("\"role\": \"reporter\"")) {
          if (user.includes("\"agentId\": \"leaf_writer_source_inspector\"")) {
            return { content: JSON.stringify({ thoughtSummary: "No source fetch needed.", action: "finish", finish: { citationIds: [] } }) };
          }
          if (user.includes("\"agentId\": \"report.leaf\"")) {
            return { content: JSON.stringify({ thoughtSummary: "Draft leaf.", action: "finish", finish: { markdown: "### 宏观流程证据\n\n两轮探索之间已经经过全局反思和结构调整，证据链支持该流程顺序[C1]。" } }) };
          }
          if (user.includes("\"agentId\": \"report.section\"")) {
            return { content: JSON.stringify({ thoughtSummary: "Draft section.", action: "finish", finish: { markdown: "## 宏观流程\n\n本节说明探索、反思、结构调整和再分发之间的顺序关系[C1]。" } }) };
          }
          return { content: JSON.stringify({ thoughtSummary: "Draft synthesis.", action: "finish", finish: { markdown: "## 执行摘要\n\n本报告验证宏观流程顺序，确认系统在再分发前进行全局反思和结构调整[C1]。\n\n## 结论\n\n宏观流程已经按文档要求执行，并形成完整闭环。" } }) };
        }
        if (user.includes("DeepResearch AgentRuntime")) {
          return scriptedEvidenceReact(user, {
            query: user.includes("follow-up") || user.includes("第二轮") ? "macro order follow-up" : "macro order source",
            title: "Macro order source",
            url: "https://example.test/macro-order",
            content: "Macro order evidence content is long enough to be saved and linked for the report node.",
            claimText: "The macro cycle order is supported.",
            reasoningSummary: "Evidence saved for macro cycle order.",
          });
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "macro-order-search",
      async search(query) {
        return [{ url: `https://example.test/${encodeURIComponent(query)}`, title: `Source ${query}`, snippet: "Evidence snippet." }];
      },
    };

    const result = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm,
      search,
      stack: { memory },
    }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    const events = await memory.listEvents({ episodeId: result.episodeId });
    const c1Finished = events.findIndex((event) => event.eventType === "dispatch_cycle_finished" && event.payload?.cycleId === "C_001");
    const structureAfterC1 = events.findIndex((event, index) => index > c1Finished && event.eventType === "structure_review_started");
    const c2Started = events.findIndex((event) => event.eventType === "dispatch_cycle_started" && event.payload?.cycleId === "C_002");
    expect(c1Finished).toBeGreaterThanOrEqual(0);
    expect(structureAfterC1).toBeGreaterThan(c1Finished);
    expect(c2Started).toBeGreaterThan(structureAfterC1);
    expect(reflectionCalls).toBe(2);
  });

  it("isolates one failed evidence agent without aborting the dispatch batch", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 2;
    runtimeProfile.phases.dispatchEvidence.maxOutputItems = 1;
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxSearchCalls = 1;
    const llm: LlmChat = {
      name: "scripted-agent-failure",
      async chat(req) {
        if (req.user.includes("Create a search plan")) {
          return { content: JSON.stringify({
            queries: [req.user.includes("R_hyp_fail") ? "fail query" : "ok query"],
            searchRationale: "Exercise per-agent failure isolation.",
          }) };
        }
        if (req.user.includes("Assess the search observations")) {
          return { content: JSON.stringify({
            relation: "supports",
            claimText: "Successful agent collected evidence.",
            confidence: 0.8,
            nodeStatus: "supported",
            reasoningSummary: "Supported.",
            openGaps: [],
            structurePatchSuggestions: [],
          }) };
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "partially-failing-search",
      async search(query) {
        if (query === "fail query") throw new Error("Injected search failure");
        return [{ url: "https://example.test/ok", title: "OK source", snippet: "Enough source text to support the successful task." }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_agent_failure_isolated";
    ctx.state.globalRubric = {
      rubricId: "RB_agent_failure",
      episodeId: ctx.state.episodeId,
      rubricText: "Dispatch should isolate one failed agent.",
      outputHints: { titleHint: "Agent Failure", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_1", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_ok", nodeKind: "hypothesis", parentNodeId: "R_aspect_1", label: "OK hypothesis" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_fail", nodeKind: "hypothesis", parentNodeId: "R_aspect_1", label: "Fail hypothesis" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_ok", reportNodeId: "R_hyp_ok", branchId: "B_ok", title: "OK task", objective: "Find ok evidence." }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_fail", reportNodeId: "R_hyp_fail", branchId: "B_fail", title: "Fail task", objective: "Find failing evidence." }));

    const results = await dispatchEvidencePhase(ctx, "C_failure");

    expect(results.map((result) => result.branchOutcome).sort()).toEqual(["done_here", "failed"]);
    expect((await ctx.stack.ledger.getById("T_ok"))?.status).toBe("completed");
    expect((await ctx.stack.ledger.getById("T_fail"))?.status).toBe("failed");
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_fail")).resolves.toEqual([
      expect.objectContaining({ gapType: "agent_runtime_error", description: expect.stringContaining("Injected search failure") }),
    ]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "evidence_agent_failed" && event.taskId === "T_fail")).toBe(true);
    expect(events.some((event) => event.eventType === "full.agent.failed" && event.taskId === "T_fail")).toBe(true);
  });

  it("downgrades external provider outages so they do not create repair blockers", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.agents.evidence) throw new Error("evidence agent config required");
    runtimeProfile.agents.evidence.maxSearchCalls = 1;
    const llm: LlmChat = {
      name: "scripted-jina-outage",
      async chat(req) {
        if (req.user.includes("Create a search plan")) {
          return { content: JSON.stringify({
            queries: ["outage query"],
            searchRationale: "Exercise infrastructure outage handling.",
          }) };
        }
        return { content: "{}" };
      },
    };
    const search: SearchProvider = {
      name: "jina-outage-search",
      async search() {
        throw new Error("Jina search request failed for https://s.jina.ai after 90000ms (attempt 4/4): TypeError: fetch failed; cause=Connect Timeout Error");
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_agent_provider_outage";
    ctx.state.globalRubric = {
      rubricId: "RB_agent_outage",
      episodeId: ctx.state.episodeId,
      rubricText: "Dispatch should not turn provider outage into content repair.",
      outputHints: { titleHint: "Provider Outage", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", parentNodeId: null, label: "Root" }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_outage", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Outage hypothesis" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_outage", reportNodeId: "R_hyp_outage", branchId: "B_outage", title: "Outage task", objective: "Find evidence despite outage." }));

    const results = await dispatchEvidencePhase(ctx, "C_outage");

    expect(results[0]?.branchOutcome).toBe("failed");
    expect((await ctx.stack.ledger.getById("T_outage"))?.status).toBe("blocked");
    expect((await ctx.stack.kg.getReportNode("R_hyp_outage"))?.status).toBe("downplayed");
    await expect(ctx.stack.kg.listOpenGaps?.("R_hyp_outage")).resolves.toEqual([
      expect.objectContaining({ gapType: "infrastructure_error", impact: "low" }),
    ]);
    const reflection = await cycleReflectionPhase(ctx, results, { currentCycle: 1, maxCycles: 40 });
    expect(reflection.continueDispatch).toBe(false);
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
    const completion = await completionGatePhase(ctx, { final: false });
    expect(completion.decision).toBe("ready_for_report");
    expect(await ctx.stack.ledger.listByStatus("queued")).toHaveLength(0);
  });
});
