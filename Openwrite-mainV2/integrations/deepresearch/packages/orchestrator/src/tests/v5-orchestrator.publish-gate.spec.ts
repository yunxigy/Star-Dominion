import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import type { LlmChat, OpenGap, ReportBundle, ResearchRequirement, SearchProvider } from "@deepresearch/contracts";
import { createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { publishGatePhase } from "../phases/publish-gate.js";
import { detectMissingRenderedDeliverables } from "../phases/report.js";
import { fixedNow, submission, node, task, requirement, scriptedEvidenceReact, bundle } from "./helpers/v5-orchestrator-fixtures.js";

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
  it("publish gate skips non-dispatchable root repair tasks when citation checks fail", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_repair";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, "This report cites a missing source [C999].", "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: "This report cites a missing source [C999].",
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);
    expect(result.status).toBe("needs_human_review");
    expect(result.metrics.publishGatePassed).toBe(false);
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_publish_repair_missing_citation"))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask" && event.payload?.reason === "root_publish_issue_requires_structure_or_report_rewrite_not_evidence_search")).toBe(true);
  });

  it("publish gate blocks an incomplete counted-study table without dispatching research for the render defect", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.hilMode = "auto_accept";
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_counted_table";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const columns = ["Authors", "Country", "Sample Size", "Research Design", "Outcome Variable", "Finding on Effectiveness"];
    const rows = Array.from({ length: 14 }, (_, index) => `| Author ${index + 1} [C1] | Country ${index + 1} | ${101 + index} | Survey | Learning outcome | Effective |`);
    const draft = [
      "# Online learning review",
      "",
      "## Summary Table of Reviewed Studies",
      "",
      `| ${columns.join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      ...rows,
      "",
      "## Conclusion",
      "",
      "The rendered review remains one study short of its explicit minimum [C1].",
    ].join("\n");
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Online learning review", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    const citation = {
      citationId: "C1",
      knowledgeNodeId: "K_counted_table",
      title: "Primary online learning study",
      url: "https://journal.example/online-learning-study",
      sourceTier: "primary" as const,
      qualityScore: 0.9,
      summary: "A primary study of online learning effectiveness.",
      retrievedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: { C1: citation.knowledgeNodeId },
      evidenceIndex: [citation],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = {
      ...bundle(root),
      episodeId: ctx.state.episodeId,
      globalEvidenceIndex: [citation],
      constraints: {
        language: "en",
        citationRequired: true,
        rubricId: "RB_publish_counted_table",
        rubricText: "Create the requested counted study table.",
        requirements: [{
          requirementId: "R_study_table",
          description: "Create a summary table of at least 15 empirical studies with the requested columns.",
          kind: "deliverable",
          priority: "must",
          evidenceRequired: false,
          evidenceNeeds: [],
          successCriteria: ["Render at least 15 distinct cited rows."],
          metricScope: columns,
        }],
      },
    };

    const result = await publishGatePhase(ctx, draftPath, { forcePublish: true });

    expect(result.status).toBe("needs_human_review");
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => (
      task.taskId.startsWith("T_publish_repair_rendered_deliverable_incomplete_table")
    ))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "publish_gate_diagnostics"
      && JSON.stringify(event.payload).includes("rendered_deliverable_incomplete_table"))).toBe(true);
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask"
      && JSON.stringify(event.payload).includes("rendered_deliverable_incomplete_table"))).toBe(true);
  });

  it("accepts a structurally valid partial counted table under an audited downplay disposition", () => {
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Online learning review", parentNodeId: null });
    const columns = ["Authors", "Country", "Sample Size", "Research Design", "Outcome Variable", "Finding on Effectiveness"];
    const requirement: ResearchRequirement = {
      requirementId: "R_study_table",
      description: "Create a summary table of at least 15 empirical studies with the requested columns.",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["Render at least 15 distinct cited rows."],
      metricScope: columns,
      failurePolicy: "degrade",
    };
    const rows = Array.from({ length: 6 }, (_, index) => `| Author ${index + 1} [C1] | Country ${index + 1} | ${101 + index} | Survey | Learning outcome | Effective |`);
    const markdown = [
      "# Online learning review",
      "## Summary Table of Reviewed Studies",
      `| ${columns.join(" | ")} |`,
      `| ${columns.map(() => "---").join(" | ")} |`,
      ...rows,
      "",
      "Six of the requested fifteen studies could be verified from cited evidence [C1].",
    ].join("\n");
    const base = {
      ...bundle(root),
      constraints: {
        language: "en",
        citationRequired: true,
        rubricId: "RB_partial_table",
        rubricText: requirement.description,
        requirements: [requirement],
      },
    };
    expect(detectMissingRenderedDeliverables(base, markdown)).toContainEqual(expect.objectContaining({
      requirementId: requirement.requirementId,
      reason: "incomplete_table",
    }));
    const degraded: ReportBundle = {
      ...base,
      constraints: {
        ...base.constraints,
        waivers: [{
          waiverId: "W_auto_partial",
          questionId: "auto_partial",
          issueCode: "incomplete_entity_coverage",
          action: "downplay",
          rationale: "Only six cited rows were verifiable after bounded repair.",
          requirementIds: [requirement.requirementId],
          decidedBy: "framework",
          decidedAt: new Date(fixedNow()).toISOString(),
        }],
      },
    };
    expect(detectMissingRenderedDeliverables(degraded, markdown)).toEqual([]);
  });

  it("does not turn a citation-marker or reference-list alternative into a required content section", () => {
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Cited report", parentNodeId: null });
    const requirement: ResearchRequirement = {
      requirementId: "OUT_CITATIONS",
      description: "报告需包含引用。",
      kind: "deliverable",
      priority: "must",
      evidenceRequired: false,
      evidenceNeeds: [],
      successCriteria: ["报告包含引用标记或参考文献列表"],
    };
    const reportBundle: ReportBundle = {
      ...bundle(root),
      constraints: {
        language: "zh-CN",
        citationRequired: true,
        rubricId: "RB_citations",
        rubricText: requirement.description,
        requirements: [requirement],
      },
    };

    expect(detectMissingRenderedDeliverables(reportBundle, "# 报告\n\n## 分析\n\n核心结论已有本地引用[C1]。"))
      .toEqual([]);
  });

  it("publish gate blocks extra peer sections after final organization", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.hilMode = "auto_accept";
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_exact_sections";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const body = "Evidence-backed analysis remains within the requested scope. ".repeat(4);
    const draft = [
      "# Exact section report",
      "",
      "## Requested Part 1", body,
      "## Requested Part 2", body,
      "## Requested Part 3", body,
      "## Requested Part 4", body,
      "## Summary Comparison Table", "| Item | Result |\n| --- | --- |\n| A | B |",
    ].join("\n\n");
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Exact section report", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = {
      ...bundle(root),
      episodeId: ctx.state.episodeId,
      constraints: {
        language: "en",
        citationRequired: false,
        rubricId: "RB_publish_exact_sections",
        rubricText: "Please divide the answer into exactly four sections.",
        requirements: [],
      },
    };

    const result = await publishGatePhase(ctx, draftPath, { forcePublish: true });

    expect(result.status).toBe("needs_human_review");
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => (
      task.taskId.startsWith("T_publish_repair_rendered_top_level_section_count")
    ))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "publish_gate_diagnostics"
      && JSON.stringify(event.payload).includes("rendered_top_level_section_count"))).toBe(true);
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask"
      && JSON.stringify(event.payload).includes("rendered_top_level_section_count"))).toBe(true);
  });

  it("never force-publishes a citation-integrity failure", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "auto_accept";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_auto_skip";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, "# Draft\n\nUnsupported citation [C999].", "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: "# Draft\n\nUnsupported citation [C999].",
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath, { finalize: true, forcePublish: true });

    expect(result.status).toBe("needs_human_review");
    expect(result.humanReview?.stage).toBe("publish_gate");
    expect(await readFile(result.reportArtifactPath, "utf8")).toContain("报告发布需要你的决定");
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "publish_gate_auto_skipped")).toBe(false);
  });

  it("publish gate skips non-dispatchable root repair tasks for citations missing from evidence index", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_orphan";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    await writeFile(draftPath, "This report cites an orphan source [C1].", "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: "This report cites an orphan source [C1].",
      citationMap: { C1: "K_missing" },
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_publish_repair_orphan_citation"))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask" && event.payload?.reason === "root_publish_issue_requires_structure_or_report_rewrite_not_evidence_search")).toBe(true);
  });

  it("publish gate blocks truncated reports and repeated open-problem blocks", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_truncated";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const incomplete = `${"# Truncated\n\n"}${"正文内容。".repeat(220)}\n\n**存在的开放性问题**：一个限制。\n\n**存在的开放性问题**：另一个限制\n`;
    await writeFile(draftPath, incomplete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: incomplete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_report_truncated"))).toBe(false);
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_repeated_open_problem_blocks"))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask" && event.payload?.reason === "root_publish_issue_requires_structure_or_report_rewrite_not_evidence_search")).toBe(true);
  });

  it("publish gate blocks final reports that expose internal evidence defects", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_evidence_defects";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成足够长度，并引用已有材料完成主要论证。".repeat(90)}

## 结论

总体结论已经形成，但现有证据缺乏对关键传播渠道的量化比较，未来研究仍需进一步补充数据。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_report_mentions_unresolved"))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask" && JSON.stringify(event.payload).includes("report_mentions_unresolved_evidence_defects"))).toBe(true);
  });

  it("publish gate allows cited source-dispute wording that is not an internal evidence defect", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_source_dispute";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成足够长度，并围绕核心问题给出审慎论证。".repeat(90)}

部分资料记载该书1898年出版，但权威研究指出，1898年版本缺乏原始实物证据，实际出版时间可能较晚[C1]。

## 结论

本报告完成了主要路线梳理。未来研究可进一步深化对传播机制的讨论。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    const reportBundle = bundle(root);
    reportBundle.globalEvidenceIndex = [{
      citationId: "C1",
      knowledgeNodeId: "K_source_dispute",
      title: "Source dispute",
      url: "https://example.test/source-dispute",
      canonicalUrl: "https://example.test/source-dispute",
      sourceTier: "secondary",
      summary: "Discusses the publication-date dispute.",
      retrievedAt: new Date(fixedNow()).toISOString(),
    }];
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: { C1: "K_source_dispute" },
      evidenceIndex: reportBundle.globalEvidenceIndex,
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = reportBundle;

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
  });

  it("publish gate allows analytical wording about avoiding decisions without performance data", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_analytical_missing_data";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成足够长度，并围绕核心问题给出审慎论证。".repeat(90)}

能力基准使评估不会因缺乏性能数据而无法判断模型的实际可用性。

## 结论

风险治理与能力测量提供互补的分析视角。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    await expect(publishGatePhase(ctx, draftPath)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("publish gate allows one reader-facing research boundary section", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_reader_boundary";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成足够长度，并围绕核心问题给出审慎论证。".repeat(90)}

## 研究范围与证据边界

本报告主要依据公开发表的官方文献、学术论文和机构材料展开分析。对于资料覆盖较少或证据有限的细分议题，正文只作趋势性判断，不把局部样本推广为总体结论。

## 结论

综合来看，报告结论限定在已覆盖资料能够支撑的范围内，核心判断保持审慎且完整。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
  });

  it("publish gate allows a reader-facing inline coverage note that explicitly narrows the claim", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_inline_boundary";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成足够长度，并围绕核心问题给出审慎论证。".repeat(90)}

**覆盖说明**：本节仅比较两个指定来源；因证据有限，仅呈现其互补性分析，不外推到其他框架。

## 结论

综合来看，报告结论限定在两个指定来源能够支撑的范围内。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    await expect(publishGatePhase(ctx, draftPath)).resolves.toMatchObject({ status: "succeeded" });
  });

  it("automatically revises writer-fixable semantic publish issues once before final review", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "auto_accept";
    let semanticCalls = 0;
    let rewriteCalls = 0;
    const revised = `# Report

## Analysis

${"The two named sources provide complementary governance and capability perspectives within the requested comparison. ".repeat(20)}

## Scope and Evidence Boundaries

This report compares only the two named sources and does not generalize beyond them.

## Conclusion

Together they provide two complementary perspectives for the requested comparison.`;
    const llm: LlmChat = {
      name: "scripted-publish-revision",
      async chat(req) {
        if (req.system?.includes("conservative final-report revision editor")) {
          rewriteCalls += 1;
          return { content: revised };
        }
        if (req.user.includes("Semantic publish review")) {
          semanticCalls += 1;
          return { content: JSON.stringify(semanticCalls === 1 ? {
            decision: "needs_repair",
            reasoningSummary: "Narrow one overclaim.",
            issues: [{ code: "overclaim", severity: "error", message: "The draft generalizes beyond its two sources.", reportNodeId: "R_root" }],
          } : { decision: "pass", reasoningSummary: "The narrowed draft is publishable.", issues: [] }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_publish_auto_revision";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const original = `# Report

## Analysis

${"The two sources prove a universally complete evaluation framework. ".repeat(25)}

## Conclusion

The framework is complete for every AI system.`;
    await writeFile(draftPath, original, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: original,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    await expect(publishGatePhase(ctx, draftPath, { finalize: true })).resolves.toMatchObject({ status: "succeeded" });
    expect(rewriteCalls).toBe(1);
    expect(semanticCalls).toBe(2);
    expect(await readFile(join(episodeDir, "report.md"), "utf8")).toContain("Scope and Evidence Boundaries");
  });

  it("publish gate ignores medium unresolved gaps on pruned or downplayed report nodes", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.publishGate) throw new Error("publishGate phase config required");
    runtimeProfile.phases.publishGate.enabled = false;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_pruned_gap";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const draft = `# Report

## Analysis

${"正文已经形成完整论证，并且只发布仍在报告树中有效的研究内容。".repeat(90)}

## 结论

本报告完成了当前可发布范围内的分析。`;
    await writeFile(draftPath, draft, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    const pruned = node({ nodeId: "R_hyp_pruned_gap", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Pruned gap", status: "pruned" });
    const downplayed = node({ nodeId: "R_hyp_downplayed_gap", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Downplayed gap", status: "downplayed" });
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(pruned);
    await ctx.stack.kg.upsertReportNode(downplayed);
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "missing_quantitative_data",
      description: "Medium residual gap on a pruned branch should not block publish.",
      suggestedQuery: "pruned branch residual data",
      reportNodeId: pruned.nodeId,
      impact: "medium",
      status: "open",
    });
    await (ctx.stack.kg as { addOpenGap?: (gap: OpenGap) => void | Promise<void> }).addOpenGap?.({
      gapType: "evidence_gap",
      description: "Medium residual gap on a downplayed branch should not block publish.",
      suggestedQuery: "downplayed branch residual evidence",
      reportNodeId: downplayed.nodeId,
      impact: "medium",
      status: "open",
    });
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: draft,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = {
      ...bundle(root),
      episodeId: ctx.state.episodeId,
      tree: [
        { node: root, children: [pruned.nodeId, downplayed.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: pruned, children: [], evidence: [], reportlets: [], openGaps: [] },
        { node: downplayed, children: [], evidence: [], reportlets: [], openGaps: [] },
      ],
    };

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
  });

  it("publish gate blocks reports masked by an automatic template conclusion", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_template_completion";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const masked = `# Report

## Analysis

${"Evidence-backed body sentence. ".repeat(90)}

## 五、结论

This report reaches a complete conclusion.

马克思主义在中国的发展路线表明

## 结论

本报告已基于当前证据完成综合分析；若需要更长篇幅，应提高 report.maxTokens 或增加 report.maxLlmCalls。`;
    await writeFile(draftPath, masked, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: masked,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_report_template_completion"))).toBe(false);
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_duplicate_conclusion"))).toBe(false);
    expect(queued.some((task) => task.taskId.startsWith("T_publish_repair_report_truncated"))).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.skipPublishRepairTask" && JSON.stringify(event.payload).includes("report_template_completion"))).toBe(true);
  });

  it("publish gate accepts complete reports whose level-2 conclusion heading includes extra words", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_conclusion_heading";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = `# Report\n\n## Analysis\n\n${"Evidence-backed paragraph. ".repeat(80)}\n\n## 5. 综合分析与结论\n\nThis report reaches a complete conclusion.\n\n*本报告基于现有公开史料撰写。*\n\n---\n\n## 参考文献\n\nExample. https://example.test/source`;
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
  });

  it("publish gate recognizes a complete English Conclusion section", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_publish_english_conclusion";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = [
      "# Report",
      "",
      "## Analysis",
      "",
      "Evidence-backed paragraph. ".repeat(80),
      "",
      "#### References",
      "",
      "Example source. https://example.test/source",
      "",
      "## Conclusion",
      "",
      "This report reaches a complete conclusion.",
    ].join("\n");
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
  });

  it("publish semantic review rewrites an overclaim before dispatching an evidence repair", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.evidenceQuality.mode = "advisory";
    let primarySemanticReviewCalled = false;
    let rewriteCalled = false;
    const llm: LlmChat = {
      name: "primary-writer-model",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) primarySemanticReviewCalled = true;
        if (req.user.includes("Publish issues to resolve")) {
          rewriteCalled = true;
          return { content: `# Report

## Analysis

${"The report presents a qualified conclusion with adequate prose depth. ".repeat(25)}

## 结论

This report reaches a complete, qualified conclusion.` };
        }
        return { content: "{}" };
      },
    };
    let semanticReviewCalls = 0;
    const reviewLlm: LlmChat = {
      name: "independent-publish-reviewer",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) {
          semanticReviewCalls += 1;
          if (semanticReviewCalls > 1) {
            return { content: JSON.stringify({ decision: "pass", reasoningSummary: "The revised draft is appropriately qualified.", issues: [] }) };
          }
          return { content: JSON.stringify({
            decision: "needs_repair",
            reasoningSummary: "The draft overstates one weakly grounded claim.",
            issues: [{
              code: "overclaim",
              severity: "error",
              message: "The final report claims a decisive conclusion, but the evidence summary only supports a qualified conclusion.",
              reportNodeId: "R_hyp_overclaim",
              suggestedRepair: "Collect targeted evidence for the decisive claim or downscope the conclusion.",
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm, reviewLlm });
    ctx.state.episodeId = "EP_publish_semantic";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = `# Report

## Analysis

${"The report presents a sourced but possibly overstated claim with adequate prose depth. ".repeat(25)}

## 结论

This report reaches a complete conclusion.`;
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    const hyp = node({ nodeId: "R_hyp_overclaim", nodeKind: "hypothesis", parentNodeId: "R_root", label: "Overclaim hypothesis", status: "supported" });
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(hyp);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = {
      ...bundle(root),
      episodeId: ctx.state.episodeId,
      tree: [
        { node: root, children: [hyp.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: hyp, children: [], evidence: [], reportlets: [], openGaps: [] },
      ],
    };

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
    expect(primarySemanticReviewCalled).toBe(false);
    expect(rewriteCalled).toBe(true);
    const queued = await ctx.stack.ledger.listByStatus("queued");
    const repair = queued.find((task) => task.taskId.startsWith("T_publish_repair_overclaim"));
    expect(repair).toBeUndefined();
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "publish_gate_review_started"
      && event.payload?.reviewerProvider === "independent-publish-reviewer"
      && event.payload?.independentReviewer === true)).toBe(true);
    expect(events.some((event) => event.eventType === "publish_gate_review_finished" && event.payload?.decision === "needs_repair")).toBe(true);
    expect(events.some((event) => event.eventType === "publish_gate_draft_revised")).toBe(true);
    expect(events.some((event) => event.eventType === "full.llm.request" && event.payload?.provider === "independent-publish-reviewer")).toBe(true);
    expect(events.some((event) => event.eventType === "full.ledger.upsert" && event.payload?.source === "publish_gate_repair")).toBe(false);
  });

  it("publish semantic review does not queue non-dispatchable root coverage repairs", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-root-publish-review",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) {
          return { content: JSON.stringify({
            decision: "needs_repair",
            reasoningSummary: "The draft is a partial debug report and misses required rubric sections.",
            issues: [
              {
                code: "rubric_coverage",
                severity: "error",
                message: "A major requested section is missing from the report.",
                suggestedRepair: "Add the missing section through structure planning, not a root evidence task.",
              },
              {
                code: "hidden_gap",
                severity: "error",
                message: "The report should disclose that this is a partial debug run.",
                suggestedRepair: "Rewrite the report boundary note.",
              },
            ],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_publish_root_coverage";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = `# Report

## Analysis

${"This partial debug report covers one researched branch with enough prose for semantic review. ".repeat(60)}

## 结论

This debug draft has a complete local conclusion.`;
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    expect(await ctx.stack.ledger.listByStatus("queued")).toEqual([]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    const repairEvent = events.find((event) => event.eventType === "publish_gate_repair");
    expect(repairEvent?.payload?.repairTaskIds).toEqual([]);
    expect(events.filter((event) => event.eventType === "full.ledger.skipPublishRepairTask" && event.payload?.reason === "root_publish_issue_requires_structure_or_report_rewrite_not_evidence_search")).toHaveLength(2);
  });

  it("publish gate skips semantic review in single-branch debug mode", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    runtimeProfile.debug = { ...(runtimeProfile.debug ?? {}), singleBranch: true };
    let semanticReviewCalled = false;
    const llm: LlmChat = {
      name: "scripted-single-branch-publish-review",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) {
          semanticReviewCalled = true;
          return { content: JSON.stringify({
            decision: "needs_repair",
            reasoningSummary: "The draft is intentionally partial because only one debug branch ran.",
            issues: [{
              code: "rubric_coverage",
              severity: "error",
              message: "Most requested sections are missing from this partial debug report.",
              suggestedRepair: "Run the full report tree when leaving single-branch debug mode.",
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_publish_single_branch_debug";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = `# Debug Partial Report

## 已探索分支

${"本调试草稿只覆盖一个已探索分支，用于验证子代理、报告片段和分级写作链路是否连通。".repeat(40)}

在已探索分支中，部分机制未找到直接文献，后续有待进一步研究；测试版应把这类表述作为单分支调试边界，而不是要求完整任务发布修复。

## 结论

本次单分支调试草稿在已探索范围内形成完整结论。`;
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    await ctx.stack.kg.upsertReportNode(root);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = bundle(root);

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("succeeded");
    expect(result.metrics.publishGatePassed).toBe(true);
    expect(await ctx.stack.ledger.listByStatus("queued")).toEqual([]);
    expect(semanticReviewCalled).toBe(false);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "publish_gate_debug_partial" && event.payload?.skippedSemanticReview === true)).toBe(true);
    expect(events.some((event) => event.eventType === "publish_gate_debug_partial" && event.payload?.downgraded === 1)).toBe(true);
    expect(events.some((event) => {
      if (event.eventType !== "publish_gate_diagnostics") return false;
      const counts = event.payload?.counts as { finalErrors?: number; finalWarnings?: number } | undefined;
      return counts?.finalErrors === 0 && counts.finalWarnings === 1;
    })).toBe(true);
  });

  it("publish rubric coverage repair restores pruned aspect children and targets leaf hypotheses", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-publish-coverage",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) {
          return { content: JSON.stringify({
            decision: "needs_repair",
            reasoningSummary: "A required rubric aspect was pruned.",
            issues: [{
              code: "rubric_coverage",
              severity: "error",
              message: "Required aspect is missing because its subtree was pruned.",
              reportNodeId: "R_aspect_missing",
              suggestedRepair: "Restore the aspect and write its leaf hypotheses.",
            }],
          }) };
        }
        return { content: "{}" };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_publish_coverage_restore";
    const episodeDir = join(dir, ctx.state.episodeId);
    await mkdir(episodeDir, { recursive: true });
    const draftPath = join(episodeDir, "report-draft.md");
    const complete = `# Report

## Analysis

${"Evidence-backed paragraph. ".repeat(90)}

## 结论

本报告正文完整，但缺少一个应覆盖的方面。`;
    await writeFile(draftPath, complete, "utf8");
    const root = node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null });
    const aspect = node({ nodeId: "R_aspect_missing", nodeKind: "aspect", parentNodeId: "R_root", label: "Missing aspect", status: "pruned" });
    const hyp1 = node({ nodeId: "R_hyp_missing_1", nodeKind: "hypothesis", parentNodeId: "R_aspect_missing", label: "Missing leaf 1", status: "pruned" });
    const hyp2 = node({ nodeId: "R_hyp_missing_2", nodeKind: "hypothesis", parentNodeId: "R_aspect_missing", label: "Missing leaf 2", status: "pruned" });
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(aspect);
    await ctx.stack.kg.upsertReportNode(hyp1);
    await ctx.stack.kg.upsertReportNode(hyp2);
    ctx.state.reportArtifact = {
      episodeId: ctx.state.episodeId,
      reportMd: complete,
      citationMap: {},
      evidenceIndex: [],
      diagnostics: [],
      generatedAt: new Date(fixedNow()).toISOString(),
    };
    ctx.state.reportBundle = {
      ...bundle(root),
      episodeId: ctx.state.episodeId,
      tree: [
        { node: root, children: [aspect.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: aspect, children: [hyp1.nodeId, hyp2.nodeId], evidence: [], reportlets: [], openGaps: [] },
        { node: hyp1, children: [], evidence: [], reportlets: [], openGaps: [] },
        { node: hyp2, children: [], evidence: [], reportlets: [], openGaps: [] },
      ],
    };

    const result = await publishGatePhase(ctx, draftPath);

    expect(result.status).toBe("needs_human_review");
    await expect(ctx.stack.kg.getReportNode("R_aspect_missing")).resolves.toMatchObject({ status: "needs_repair" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_missing_1")).resolves.toMatchObject({ status: "needs_repair" });
    await expect(ctx.stack.kg.getReportNode("R_hyp_missing_2")).resolves.toMatchObject({ status: "needs_repair" });
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.filter((task) => task.taskId.startsWith("T_publish_repair_rubric_coverage")).map((task) => task.reportNodeId).sort())
      .toEqual(["R_hyp_missing_1", "R_hyp_missing_2"]);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.restorePublishRepairNode" && event.reportNodeId === "R_aspect_missing")).toBe(true);
  });

  it("runs publish-gate repair cycles after normal evidence cycles are exhausted", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.phases.publishGate) throw new Error("required runtime phases missing");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    runtimeProfile.phases.publishGate.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 2;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    let semanticReviewCalls = 0;
    let reflectionCalls = 0;
    const echo = new EchoJsonLlm();
    const llm: LlmChat = {
      name: "scripted-publish-auto-repair",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) {
          semanticReviewCalls += 1;
          return { content: JSON.stringify(semanticReviewCalls === 1
            ? {
                decision: "needs_repair",
                reasoningSummary: "A hidden limitation must be repaired before publication.",
                issues: [{
                  code: "hidden_gap",
                  severity: "error",
                  message: "The report needs one more targeted qualification on the main hypothesis.",
                  reportNodeId: "R_hyp_1",
                  suggestedRepair: "Collect targeted evidence or downscope this report node.",
                }],
              }
            : { decision: "pass", reasoningSummary: "The repaired draft is publishable.", issues: [] }) };
        }
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("ReflectionSchedulerAgent")) {
          reflectionCalls += 1;
          return { content: JSON.stringify({
            thoughtSummary: reflectionCalls === 2 ? "Publish repair needs one follow-up task." : "No more repair work needed.",
            action: "finish",
            finish: reflectionCalls === 2
              ? {
                  continueDispatch: true,
                  taskUpdates: [],
                  newTasks: [{
                    parentTaskId: "T_publish_repair_hidden_gap_1",
                    reportNodeId: "R_hyp_1",
                    title: "Publish repair follow-up",
                    objective: "Add one more qualification after the publish repair task.",
                    priority: 79,
                    acceptanceCriteria: ["Save follow-up evidence or downscope the node."],
                  }],
                  skipReasons: [],
                }
              : { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
          }) };
        }
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("\"role\": \"subagent\"")) {
          return scriptedEvidenceReact(req.user, {
            query: "publish repair evidence",
            title: "Publish repair evidence source",
            url: "https://example.test/publish-repair/evidence",
            content: "This source contains enough detail to support and qualify the report claim during publish repair.",
            claimText: "The repaired report claim is supported with an explicit qualification.",
            reasoningSummary: "Saved explicit evidence for the publish repair.",
          });
        }
        if (req.user.includes("\"agentId\": \"leaf_writer_source_inspector\"")) {
          return { content: JSON.stringify({ thoughtSummary: "No source fetch needed.", action: "finish", finish: { citationIds: [] } }) };
        }
        if (req.user.includes("\"agentId\": \"report.leaf\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft leaf.", action: "finish", finish: { markdown: `### 核心证据\n\n${"该小节基于已保存证据展开，说明核心论点已经获得来源支撑，并在表述上保留必要边界[C1]。".repeat(18)}` } }) };
        }
        if (req.user.includes("\"agentId\": \"report.section\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft section.", action: "finish", finish: { markdown: `## Core Evidence\n\n${"本节综合下属最小节点的证据，说明研究问题的主要方面、证据链条和结论边界，避免把局部证据扩大为无限定判断[C1]。".repeat(12)}` } }) };
        }
        if (req.user.includes("\"agentId\": \"report.synthesize\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft synthesis.", action: "finish", finish: { markdown: `## 执行摘要\n\n${"本报告围绕研究任务形成证据化论证，先由子代理收集资料，再由写作阶段按报告树组织结论。".repeat(12)}[C1]\n\n## 研究范围与证据边界\n\n${"涉及认同度、影响范围或趋势判断时，本文仅在已有公开资料能够支撑的范围内表述，不把局部材料解释为全国性结论。".repeat(6)}\n\n## 结论\n\n${"经过发布前修复，报告已覆盖核心论点，并把结论限定在证据能够支持的范围内。".repeat(10)}。` } }) };
        }
        return echo.chat(req);
      },
    };
    const search: SearchProvider = {
      name: "publish-auto-repair-search",
      async search(query, topK) {
        return Array.from({ length: Math.min(topK, 2) }, (_, index) => ({
          url: `https://example.test/publish-repair/${index + 1}`,
          title: `Publish repair source ${index + 1}`,
          snippet: `Evidence for ${query}`,
        }));
      },
    };

    const result = await createInMemoryOrchestrator({ now: fixedNow, artifactDir: dir, runtimeProfile, llm, search }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    expect(semanticReviewCalls).toBe(2);
    expect(reflectionCalls).toBe(3);
    const trace = await readFile(result.tracePath!, "utf8");
    expect(trace).toContain("publish_gate_repair");
    expect(trace).toContain("C_003");
  });

  it("runs completion-gate repair cycles after normal evidence cycles are exhausted", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    if (!runtimeProfile.phases.dispatchEvidence || !runtimeProfile.phases.publishGate || !runtimeProfile.phases.completionGate) throw new Error("required runtime phases missing");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    runtimeProfile.phases.publishGate.maxCycles = 2;
    runtimeProfile.phases.completionGate.maxCycles = 2;
    runtimeProfile.phases.dispatchEvidence.maxParallelAgents = 1;
    runtimeProfile.phases.dispatchEvidence.maxConcurrentAgents = 1;
    runtimeProfile.traceLevel = "full";
    const ledger = createInMemoryTaskLedger();
    const memory = createInMemoryMemoryGraph();
    const echo = new EchoJsonLlm();
    const llm: LlmChat = {
      name: "scripted-completion-auto-repair",
      async chat(req) {
        const user = req.user;
        if (user.includes("Build GlobalRubric")) {
          return { content: JSON.stringify({
            rubricText: "Verify completion repair after first evidence cycle.",
            outputHints: { titleHint: "Completion Repair", language: "en", citationRequired: true, format: "markdown" },
            researchQuestionHints: ["completion repair"],
            requirements: [{
              requirementId: "REQ_completion",
              description: "Verify the claim with direct evidence before completing the report.",
              kind: "question",
              priority: "must",
              evidenceRequired: true,
              evidenceNeeds: ["Direct evidence for the claim"],
              successCriteria: ["The claim has a direct evidence link."],
              temporalScope: { mode: "timeless" },
              geographicScope: [],
            }],
          }) };
        }
        if (user.includes("Plan scout searches")) {
          return { content: JSON.stringify({ queries: ["completion repair source"], sourceStrategy: "fixture", reasoningSummary: "fixture" }) };
        }
        if (user.includes("Output schema:") && user.includes("\"aspects\"")) {
          return { content: JSON.stringify({
            aspects: [{
              label: "Aspect",
              scopeNote: "Aspect scope",
              hypotheses: [{ statement: "Claim needs evidence.", researchBrief: "Research the claim.", evidenceGuidance: "Find direct evidence." }],
              tasks: [{ title: "Original weak task", objective: "Try to find evidence but leave the branch unsupported.", acceptanceCriteria: ["Attempt evidence search."] }],
            }],
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("ReflectionSchedulerAgent")) {
          return { content: JSON.stringify({
            thoughtSummary: "Do not create reflection repairs; completion gate should detect the unsupported branch.",
            action: "finish",
            finish: { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("StructureReviewAgent")) {
          return { content: JSON.stringify({
            thoughtSummary: "No structure changes.",
            action: "finish",
            finish: { suggestions: [] },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime") && user.includes("T_Original_weak_task")) {
          return { content: JSON.stringify({
            thoughtSummary: "The first cycle found no usable source.",
            action: "finish",
            finish: {
              relation: "insufficient",
              claimText: "No usable source was saved in the first cycle.",
              confidence: 0.2,
              nodeStatus: "insufficient_evidence",
              reasoningSummary: "The branch still has no evidence links.",
              openGaps: [{
                gapType: "missing_direct_evidence",
                description: "The claim still needs a direct source.",
                suggestedQuery: "completion repair source",
              }],
              structurePatchSuggestions: [],
            },
          }) };
        }
        if (user.includes("DeepResearch AgentRuntime")) {
          return scriptedEvidenceReact(user, {
            query: "completion repair source",
            title: "Completion repair source",
            url: "https://example.test/completion-repair",
            content: "Completion repair source content is long enough to be saved and support the previously unsupported branch with a direct evidence link.",
            claimText: "Claim is supported after completion repair.",
            reasoningSummary: "Completion repair evidence supports the claim.",
          });
        }
        if (user.includes("\"agentId\": \"leaf_writer_source_inspector\"")) {
          return { content: JSON.stringify({ thoughtSummary: "No extra source fetch needed.", action: "finish", finish: { citationIds: [] } }) };
        }
        if (user.includes("\"agentId\": \"report.leaf\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft leaf.", action: "finish", finish: { markdown: `### Evidence\n\n${"The completion repair added direct support for the branch, so the report can cite the repaired evidence [C1].".repeat(18)}` } }) };
        }
        if (user.includes("\"agentId\": \"report.section\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft section.", action: "finish", finish: { markdown: `## Aspect\n\n${"The section summarizes the repaired evidence and keeps the claim scoped to the saved citation [C1].".repeat(14)}` } }) };
        }
        if (user.includes("\"agentId\": \"report.synthesize\"")) {
          return { content: JSON.stringify({ thoughtSummary: "Draft synthesis.", action: "finish", finish: { markdown: `## Executive Summary\n\n${"The report is now grounded after completion repair [C1].".repeat(16)}\n\n## Conclusion\n\n${"The previously unsupported branch was repaired before publication.".repeat(12)}` } }) };
        }
        if (user.includes("Semantic publish review")) {
          return { content: JSON.stringify({ decision: "pass", reasoningSummary: "Completion repair made the report publishable.", issues: [] }) };
        }
        return echo.chat(req);
      },
    };
    const search: SearchProvider = {
      name: "completion-auto-repair-search",
      async search(query, topK) {
        return Array.from({ length: Math.min(topK, 1) }, () => ({
          url: "https://example.test/completion-repair",
          title: "Completion repair source",
          snippet: `Evidence for ${query}`,
        }));
      },
    };

    const result = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm,
      search,
      stack: { ledger, memory },
    }).runEpisode(submission());

    expect(result.status).toBe("succeeded");
    const tasks = await ledger.listAll();
    expect(tasks.map((task) => ({ taskId: task.taskId, status: task.status, title: task.title }))).toContainEqual(
      expect.objectContaining({ taskId: expect.stringMatching(/^T_(?:completion|gap|quality)_/), status: "completed" }),
    );
    const events = await memory.listEvents({ episodeId: result.episodeId });
    expect(events.some((event) => event.eventType === "dispatch_cycle_started" && event.payload?.cycleId === "C_002")).toBe(true);
    expect(events.some((event) => event.eventType === "dispatch_cycle_finished" && event.payload?.cycleId === "C_002")).toBe(true);
  });
});
