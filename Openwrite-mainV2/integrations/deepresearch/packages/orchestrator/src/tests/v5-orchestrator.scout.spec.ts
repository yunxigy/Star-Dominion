import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LlmChat, ResearchRequirement, SearchProvider } from "@deepresearch/contracts";
import { loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { stageFetchedCandidatesForRepair } from "../phases/dispatch-evidence.js";
import { architectTreePhase, compactHypothesisLabel } from "../phases/architect-tree.js";
import { initRootPhase } from "../phases/init-root.js";
import { parsePhase } from "../phases/parse.js";
import { focusedPassagesForClaim, looksTruncated, normalizeBalancedPublishRevision } from "../phases/publish-gate.js";
import { resolveScoutSourceSelection, SCOUT_SOURCE_SELECTION_SYSTEM_PROMPT, scoutCandidateNeedsFallback, scoutPhase } from "../phases/scout.js";
import { fixedNow, submission, node, task, requirement } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("compacts long hypothesis labels at a complete clause boundary", () => {
    const statement = "锂材料回收目标在 Regulation (EU) 2023/1542 Annex XII Part C 中有明确的年份和数值规定，且不包含 Part B 的整电池回收效率要求";

    const label = compactHypothesisLabel(statement, 80);

    expect(label.length).toBeLessThanOrEqual(80);
    expect(label).toContain("年份和数值规定");
    expect(label).not.toMatch(/整电$/u);
    expect(statement).toContain("整电池回收效率要求");

    const sourceRoute = "锂材料回收目标（Annex XII Part C recovery of materials）的年份和数值可从 Regulation (EU) 2023/1542 正式文本中提取并核实";
    expect(compactHypothesisLabel(sourceRoute, 80)).toBe("锂材料回收目标（Annex XII Part C recovery of materials）的年份和数值");
  });

  it("uses low-confidence scout leads only to satisfy the minimum source floor", () => {
    expect(resolveScoutSourceSelection({
      highConfidenceIndices: [4],
      fallbackIndices: [2, 3, 1],
    }, 5, 5)).toEqual([4, 2]);
    expect(resolveScoutSourceSelection({
      highConfidenceIndices: [],
      fallbackIndices: [3, 2, 1],
    }, 5, 5)).toEqual([3, 2]);
    expect(resolveScoutSourceSelection({}, 5, 5)).toEqual([0, 1]);
  });

  it("narrows bidirectionality claims and preserves covered-period semantics after publish rewrites", () => {
    const revised = normalizeBalancedPublishRevision(`## Between Fungi and Plants

HGT between fungi and plants is **bidirectional**.

### Scope and Evidence Boundaries

This report covers sources published up to 2020, except source C5 published 2022, which falls outside the temporal scope.`, true);

    expect(revised).toContain("document transfers in both directions");
    expect(revised).not.toContain("is **bidirectional**");
    expect(revised).toContain("covered research period, not to source publication dates");
    expect(revised).not.toContain("falls outside the temporal scope");

    const finance = normalizeBalancedPublishRevision(`## VIX analysis

### 研究范围与证据边界

This report covers VIX, GVZ, and OVX during the requested period.`, true);
    expect(finance).toContain("This report covers VIX, GVZ, and OVX during the requested period.");
    expect(finance).not.toContain("Cuscuta");
  });

  it("explicitly requests JSON when scout source selection enables JSON response mode", () => {
    expect(SCOUT_SOURCE_SELECTION_SYSTEM_PROMPT).toMatch(/\bJSON\b/u);
  });

  it("continues scout with successful searches when sibling queries fail", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.scout) throw new Error("scout phase config required");
    runtimeProfile.phases.scout.maxSearchCalls = 2;
    runtimeProfile.phases.scout.maxFetchCalls = 0;
    runtimeProfile.phases.scout.maxOutputItems = 2;
    const llm: LlmChat = {
      name: "partial-scout-llm",
      async chat(req) {
        if (req.user.includes("Plan scout searches")) {
          return { content: JSON.stringify({
            queries: ["successful query", "rate limited query"],
            sourceStrategy: "Exercise partial failure tolerance.",
            reasoningSummary: "One query should remain usable.",
          }) };
        }
        return { content: JSON.stringify({
          highConfidenceIndices: [0],
          fallbackIndices: [],
          reasoningSummary: "Use the successful official source.",
        }) };
      },
    };
    const search: SearchProvider = {
      name: "partial-scout-search",
      async search(query) {
        if (query === "rate limited query") throw new Error("HTTP 429 request limit");
        return [{
          url: "https://www.cboe.com/tradable_products/vix/",
          title: "Cboe VIX official documentation",
          snippet: "Official volatility index documentation.",
        }];
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, search });
    ctx.state.episodeId = "EP_partial_scout";
    ctx.state.globalRubric = {
      rubricId: "RB_partial_scout",
      episodeId: ctx.state.episodeId,
      rubricText: "Research an official volatility index source.",
      researchQuestionHints: [],
      requirements: [],
      outputHints: { titleHint: "Partial Scout", language: "zh-CN", citationRequired: true, format: "markdown" },
    };
    await initRootPhase(ctx);

    const result = await scoutPhase(ctx);

    expect(result.knowledgeNodeIds).toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events).toContainEqual(expect.objectContaining({
      eventType: "scout_searches_degraded",
      payload: expect.objectContaining({ attemptedCount: 2, succeededCount: 1, failedCount: 1, continued: true }),
    }));
    expect(events.some((event) => event.eventType === "scout_finished")).toBe(true);
  });

  it("demotes metadata-only aggregators and event notices from scout high confidence", () => {
    expect(scoutCandidateNeedsFallback({
      title: "Download Scientific Diagram",
      url: "https://www.researchgate.net/figure/example",
      snippet: "A figure copied from a paper.",
    })).toBe(true);
    expect(scoutCandidateNeedsFallback({
      title: "学术报告通知",
      url: "https://university.edu.cn/notice/1",
      snippet: "Lecture notice.",
    })).toBe(true);
    expect(scoutCandidateNeedsFallback({
      title: "Integration of Agrobacterium T-DNA into the Plant Genome",
      url: "https://pubmed.ncbi.nlm.nih.gov/28853920/",
      snippet: "A review of T-DNA integration.",
    })).toBe(false);
  });

  it("stages fetched pages without claiming evidence when an agent exhausts its budget", async () => {
    const ctx = createPhaseContext(submission(), { now: fixedNow, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_stage_budget_candidate";
    const reportNode = node({ nodeId: "R_budget_candidate", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Budget candidate" });
    const taskItem = task({ taskId: "T_budget_candidate", reportNodeId: reportNode.nodeId });

    const ids = await stageFetchedCandidatesForRepair(ctx, taskItem, reportNode, {
      taskId: taskItem.taskId,
      reportNodeId: reportNode.nodeId,
      branchId: taskItem.branchId,
      agentRunId: "A_budget_candidate",
    }, {
      agent: {
        agentRunId: "A_budget_candidate",
        agentId: "evidence-agent",
        role: "evidence",
        title: "Budget candidate evidence",
        objective: "Inspect one fetched candidate.",
        taskId: taskItem.taskId,
        reportNodeId: reportNode.nodeId,
        branchId: taskItem.branchId,
      },
      status: "budget_exceeded",
      steps: [{
        step: 1,
        decision: { action: "tool", toolName: "fetch_page", args: { url: "https://example.test/paper" }, thoughtSummary: "Inspect the candidate." },
        toolResult: {
          toolName: "fetch_page",
          ok: true,
          output: {
            url: "https://example.test/paper",
            title: "Fetched research paper",
            content: "A directly fetched candidate passage with enough source content for later inspection. ".repeat(12),
          },
        },
      }],
      error: "budget exhausted",
    });

    expect(ids).toHaveLength(1);
    expect(await ctx.stack.kg.getKnowledgeNode(ids[0]!)).toMatchObject({ title: "Fetched research paper" });
    expect(await ctx.stack.kg.listEvidenceLinks(reportNode.nodeId)).toHaveLength(0);
  });

  it("ranks long-document passages independently for each evidence claim", () => {
    const article = "--- Focused source passage 2 ---\nArticle 59(3) requires collection targets of 45% by 2023, 63% by 2027, and 73% by 2030.";
    const annex = "--- Focused source passage 14 ---\nAnnex XII Part C requires lithium recovery of materials of 50% by 2027 and 80% by 2031.";
    const noise = Array.from({ length: 8 }, (_, index) => `--- Focused source passage ${index + 3} ---\nGeneral regulation background for year ${2020 + index}.`);
    const passages = [article, ...noise, annex];

    expect(focusedPassagesForClaim(
      passages,
      "Regulation (EU) 2023/1542 Article 59(3) sets 45% in 2023, 63% in 2027, and 73% in 2030.",
      1,
    )[0]).toContain("Article 59(3)");
    expect(focusedPassagesForClaim(
      passages,
      "Annex XII Part C sets lithium recovery targets of 50% in 2027 and 80% in 2031.",
      1,
    )[0]).toContain("Annex XII Part C");
  });

  it("realigns a uniquely owned leaf to its requirement and named primary source", async () => {
    const runtimeProfile = loadDefaultRuntimeProfile();
    const llm: LlmChat = {
      name: "scripted-cross-branch-contamination",
      async chat() {
        return { content: JSON.stringify({
          aspects: [{
            label: "Battery targets",
            scopeNote: "Extract regulatory targets.",
            requirementIds: ["R1", "R_CONCEPT", "R_FORMAT"],
            hypotheses: [{
              statement: "Collection targets should be taken from Annex XII Part B and Article 59.",
              researchBrief: "Research Part B efficiency values together with collection rates.",
              evidenceGuidance: "Use any source that repeats the values.",
              requirementIds: ["R1", "R_CONCEPT", "R_FORMAT"],
            }],
            tasks: [{
              title: "Mixed battery task",
              objective: "Combine Part B efficiency and collection targets.",
              acceptanceCriteria: ["Find two independent sources for Part B and collection rates."],
            }],
          }],
        }) };
      },
    };
    const ctx = createPhaseContext({
      sessionId: "S_requirement_aligned_leaf",
      userInput: "依据 EUR-Lex 上 Regulation (EU) 2023/1542 的正式文本，提取废旧便携式电池收集目标。",
      uiOptions: { outputLanguage: "zh-CN", citationRequired: true },
    }, { now: fixedNow, runtimeProfile, llm });
    ctx.state.episodeId = "EP_requirement_aligned_leaf";
    const requirement: ResearchRequirement = {
      requirementId: "R1",
      description: "从 Regulation (EU) 2023/1542 第59条第3款提取废旧便携式电池收集目标的年份和数值。",
      kind: "question",
      priority: "must",
      evidenceRequired: true,
      evidenceNeeds: ["Article 59(3) official text"],
      successCriteria: ["列出每个收集目标。"],
      sourcePolicy: {
        mode: "named_primary_sufficient",
        sources: [{ title: "EUR-Lex Regulation (EU) 2023/1542", identifiers: ["2023/1542"] }],
      },
    };
    ctx.state.globalRubric = {
      rubricId: "RB_requirement_aligned_leaf",
      episodeId: ctx.state.episodeId,
      rubricText: requirement.description,
      outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
      requirements: [requirement, {
        requirementId: "R_CONCEPT",
        description: "区分收集率与材料回收率。",
        kind: "constraint",
        priority: "must",
        evidenceRequired: true,
        evidenceNeeds: ["Direct definitions"],
        successCriteria: ["报告区分两个概念。"],
      }, {
        requirementId: "R_FORMAT",
        description: "使用简明中文。",
        kind: "constraint",
        priority: "must",
        evidenceRequired: false,
        evidenceNeeds: [],
        successCriteria: ["报告使用简明中文。"],
      }],
    };
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_root",
      nodeKind: "root",
      parentNodeId: null,
      requirementIds: [],
      label: "Battery targets",
    }));

    const result = await architectTreePhase(ctx);
    const leaf = result.reportNodes.find((item) => item.nodeKind === "hypothesis")!;
    const task = result.tasks[0]!;

    expect(leaf.label).toContain("第59条第3款");
    expect(leaf.hypothesis?.statement).toBe(requirement.description);
    expect(leaf.scopeNote).toContain("only this owned requirement");
    expect(task.objective).toContain(requirement.description);
    expect(task.acceptanceCriteria.join(" ")).toContain("EUR-Lex Regulation (EU) 2023/1542");
    expect(JSON.stringify({ leaf, task })).not.toContain("Part B");
    expect(task.acceptanceCriteria.join(" ")).not.toContain("independent source");
  });

  it("does not mistake a complete conclusion followed by nested reference URLs for truncation", () => {
    const markdown = `# Report\n\n## Analysis\n\n${"Evidence-backed analysis sentence. ".repeat(50)}\n\n## 结论\n\n本报告形成了完整结论。\n\n#### 参考文献\n\n[C1] Source. https://example.test/report`;
    expect(looksTruncated(markdown)).toBe(false);
  });

  it("preserves a safe caller-provided episode identity and rejects path-like identities", async () => {
    const ctx = createPhaseContext(submission(), {
      episodeId: "benchmark_task-107.1",
      now: fixedNow,
      llm: new EchoJsonLlm(),
    });

    await parsePhase(ctx);
    expect(ctx.state.episodeId).toBe("benchmark_task-107.1");
    expect(() => createPhaseContext(submission(), {
      episodeId: "../escape",
      now: fixedNow,
      llm: new EchoJsonLlm(),
    })).toThrow("episodeId must be 1-128 characters");
  });
});
