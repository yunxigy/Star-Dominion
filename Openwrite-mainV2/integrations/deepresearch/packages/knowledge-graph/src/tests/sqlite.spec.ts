import { afterEach, describe, expect, it } from "vitest";
import { MockNotFoundError, type EvidenceLink, type KnowledgeNode, type Reportlet, type ReportNode } from "@deepresearch/contracts";
import { SqliteKgService } from "../impl/sqlite.js";

const ISO = "2026-07-01T00:00:00.000Z";

function makeReport(overrides: Partial<ReportNode> = {}): ReportNode {
  return {
    nodeId: "R_root",
    nodeKind: "root",
    label: "Root",
    parentNodeId: null,
    scopeNote: "Scope",
    status: "planned",
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

function makeKnowledge(overrides: Partial<KnowledgeNode> = {}): KnowledgeNode {
  return {
    nodeId: "K_1",
    nodeType: "WebPage",
    title: "Source",
    url: "https://example.test",
    contentHash: "sha256:1",
    summary: "Summary",
    sourceTier: "official",
    qualityScore: 0.9,
    retrievedByTaskId: "T_1",
    retrievedAt: ISO,
    metadata: {},
    ...overrides,
  };
}

function makeLink(overrides: Partial<EvidenceLink> = {}): EvidenceLink {
  return {
    linkId: "E_1",
    reportNodeId: "R_root",
    knowledgeNodeId: "K_1",
    relation: "supports",
    claimText: "Claim",
    confidence: 0.8,
    createdByTaskId: "T_1",
    createdAt: ISO,
    ...overrides,
  };
}

function makeReportlet(overrides: Partial<Reportlet> = {}): Reportlet {
  return {
    reportletId: "RL_1",
    reportNodeId: "R_root",
    taskId: "T_1",
    title: "Atomic finding",
    markdown: "#### Atomic finding\n\nClaim [E:E_1]",
    citedEvidenceLinkIds: ["E_1"],
    citedKnowledgeNodeIds: ["K_1"],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

describe("SqliteKgService v5", () => {
  const services: SqliteKgService[] = [];
  function makeKg(): SqliteKgService {
    const kg = new SqliteKgService({ dbPath: ":memory:" });
    services.push(kg);
    return kg;
  }

  afterEach(() => {
    for (const service of services) service.close();
    services.length = 0;
  });

  it("upserts and reads report and knowledge nodes", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await kg.upsertKnowledgeNode(makeKnowledge());
    expect((await kg.getReportNode("R_root"))?.label).toBe("Root");
    expect((await kg.getKnowledgeNode("K_1"))?.title).toBe("Source");
  });

  it("lists children", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await kg.upsertReportNode(makeReport({ nodeId: "R_a", nodeKind: "aspect", parentNodeId: "R_root", label: "A" }));
    expect((await kg.listChildren("R_root")).map((node) => node.nodeId)).toEqual(["R_a"]);
  });

  it("upserts evidence links and recomputes coverage", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink());
    expect((await kg.listEvidenceLinks("R_root")).length).toBe(1);
    expect((await kg.getReportNode("R_root"))?.coverage.supportingCount).toBe(1);
  });

  it("upserts reportlets and exposes them in ReportBundle", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink());
    await kg.upsertReportlet(makeReportlet());

    expect((await kg.listReportlets("R_root")).map((reportlet) => reportlet.reportletId)).toEqual(["RL_1"]);
    const bundle = await kg.buildReportBundle("EP_1", "R_root", {
      language: "zh-CN",
      citationRequired: true,
      rubricId: "RB_1",
      rubricText: "Use citations.",
    });

    expect(bundle.tree.find((entry) => entry.node.nodeId === "R_root")?.reportlets[0]?.markdown).toContain("[E:E_1]");
  });

  it("aggregates descendant evidence and gaps into parent coverage", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport({ nodeId: "R_root" }));
    await kg.upsertReportNode(makeReport({ nodeId: "R_aspect", nodeKind: "aspect", parentNodeId: "R_root", label: "Aspect" }));
    await kg.upsertReportNode(makeReport({
      nodeId: "R_hyp",
      nodeKind: "hypothesis",
      parentNodeId: "R_aspect",
      label: "Hypothesis",
      hypothesis: { statement: "Hypothesis", researchBrief: "Research hypothesis.", evidenceGuidance: "Find evidence." },
    }));
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink({ reportNodeId: "R_hyp" }));
    kg.addOpenGap({ gapType: "missing", description: "Need more evidence.", suggestedQuery: "more evidence", reportNodeId: "R_hyp", status: "open" });

    expect((await kg.getReportNode("R_hyp"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
    expect((await kg.getReportNode("R_aspect"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
    expect((await kg.getReportNode("R_root"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
  });

  it("deduplicates identical gaps and closes only matched gaps", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    kg.addOpenGap({ gapType: "missing_source", description: "Need source A.", suggestedQuery: "A", reportNodeId: "R_root", impact: "medium", status: "open" });
    kg.addOpenGap({ gapType: "missing_source", description: "Need source A.", suggestedQuery: "A better", reportNodeId: "R_root", impact: "high", status: "open" });
    kg.addOpenGap({ gapType: "missing_source", description: "Need source B.", suggestedQuery: "B", reportNodeId: "R_root", impact: "medium", status: "open" });

    expect(await kg.listOpenGaps("R_root")).toEqual([
      expect.objectContaining({ description: "Need source A.", suggestedQuery: "A better", impact: "high", status: "open" }),
      expect.objectContaining({ description: "Need source B.", status: "open" }),
    ]);
    await expect(kg.closeOpenGapsMatching([{ reportNodeId: "R_root", description: "Need source A.", reason: "resolved" }])).resolves.toBe(1);
    expect(await kg.listOpenGaps("R_root")).toEqual([
      expect.objectContaining({ description: "Need source A.", status: "closed" }),
      expect.objectContaining({ description: "Need source B.", status: "open" }),
    ]);
  });

  it("clusters semantic evidence gaps conservatively in SQLite", async () => {
    const kg = makeKg();
    const countries = "印度、巴基斯坦、孟加拉国、尼泊尔、斯里兰卡";
    kg.addOpenGap({ gapType: "missing_evidence", description: `缺乏直接针对${countries}工业4.0核心技能需求的官方或权威研究报告。`, suggestedQuery: "skills source", reportNodeId: "R_hyp", impact: "medium", status: "open" });
    kg.addOpenGap({ gapType: "evidence_gap", description: `未找到直接支持${countries}工业4.0核心技能需求的权威研究或官方报告。`, suggestedQuery: "better skills query", reportNodeId: "R_hyp", impact: "high", status: "open" });
    kg.addOpenGap({ gapType: "missing_evidence", description: "缺乏尼泊尔工业4.0采纳挑战的直接证据。", suggestedQuery: "Nepal challenges", reportNodeId: "R_hyp", status: "open" });
    kg.addOpenGap({ gapType: "missing_evidence", description: "缺乏斯里兰卡工业4.0采纳挑战的直接证据。", suggestedQuery: "Sri Lanka challenges", reportNodeId: "R_hyp", status: "open" });

    const gaps = await kg.listOpenGaps("R_hyp");
    expect(gaps).toHaveLength(3);
    expect(gaps[0]).toMatchObject({ suggestedQuery: "better skills query", impact: "high" });
  });

  it("replaces a stale broad temporal data gap with its narrower remainder in SQLite", async () => {
    const kg = makeKg();
    kg.addOpenGap({ gapType: "missing_data", description: "2015年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。已获取2022年和2023年数据。", suggestedQuery: "2015-2021 城轨数据", reportNodeId: "R_hyp", status: "open" });
    kg.addOpenGap({ gapType: "missing_data", description: "2016年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。", suggestedQuery: "2016-2021 城轨数据", reportNodeId: "R_hyp", status: "open" });
    kg.addOpenGap({ gapType: "missing_data", description: "2015年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。已获取2022年和2023年数据。", suggestedQuery: "stale broad query", reportNodeId: "R_hyp", status: "open" });

    await expect(kg.listOpenGaps("R_hyp")).resolves.toEqual([
      expect.objectContaining({
        description: "2016年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。",
        suggestedQuery: "2016-2021 城轨数据",
      }),
    ]);
  });

  it("refreshes old and new ancestors when moving evidence links", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport({ nodeId: "R_root" }));
    await kg.upsertReportNode(makeReport({ nodeId: "R_a", nodeKind: "aspect", parentNodeId: "R_root", label: "A" }));
    await kg.upsertReportNode(makeReport({ nodeId: "R_b", nodeKind: "aspect", parentNodeId: "R_root", label: "B" }));
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink({ reportNodeId: "R_a" }));
    await kg.updateEvidenceLink(makeLink({ reportNodeId: "R_b" }));

    expect((await kg.getReportNode("R_a"))?.coverage.supportingCount).toBe(0);
    expect((await kg.getReportNode("R_b"))?.coverage.supportingCount).toBe(1);
    expect((await kg.getReportNode("R_root"))?.coverage.supportingCount).toBe(1);
  });

  it("throws when evidence references missing knowledge", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await expect(kg.upsertEvidenceLink(makeLink())).rejects.toBeInstanceOf(MockNotFoundError);
  });

  it("builds report bundle", async () => {
    const kg = makeKg();
    await kg.upsertReportNode(makeReport());
    await kg.upsertReportNode(makeReport({
      nodeId: "R_hyp",
      nodeKind: "hypothesis",
      parentNodeId: "R_root",
      label: "Hypothesis",
      hypothesis: {
        statement: "Claim",
        researchBrief: "Research the claim.",
        evidenceGuidance: "Use this source.",
      },
    }));
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink({ reportNodeId: "R_hyp" }));
    const bundle = await kg.buildReportBundle("EP_1", "R_root", {
      language: "zh-CN",
      citationRequired: true,
      rubricId: "RB_1",
      rubricText: "Use citations.",
    });
    expect(bundle.globalEvidenceIndex[0]?.knowledgeNodeId).toBe("K_1");
  });
});
