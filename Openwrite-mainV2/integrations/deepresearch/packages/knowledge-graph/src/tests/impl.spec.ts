import { describe, expect, it } from "vitest";
import { MockNotFoundError, ValidationError, type EvidenceLink, type KnowledgeNode, type Reportlet, type ReportNode } from "@deepresearch/contracts";
import { InMemoryKgService, createFixtureKgService, createInMemoryKgService } from "../index.js";

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

describe("InMemoryKgService v5", () => {
  it("starts empty and exposes report/knowledge/evidence lists", async () => {
    const kg = createInMemoryKgService();
    expect(await kg.listReportNodes()).toEqual([]);
    expect(await kg.listKnowledgeNodes()).toEqual([]);
    expect(await kg.listEvidenceLinks()).toEqual([]);
  });

  it("upserts report nodes and lists children", async () => {
    const kg = createInMemoryKgService();
    await kg.upsertReportNode(makeReport({ nodeId: "R_root" }));
    await kg.upsertReportNode(makeReport({ nodeId: "R_a", nodeKind: "aspect", parentNodeId: "R_root", label: "A" }));
    const children = await kg.listChildren("R_root");
    expect(children.map((node) => node.nodeId)).toEqual(["R_a"]);
  });

  it("upserts knowledge nodes without branch fields", async () => {
    const kg = createInMemoryKgService();
    await kg.upsertKnowledgeNode(makeKnowledge());
    const got = await kg.getKnowledgeNode("K_1");
    expect(got?.title).toBe("Source");
    expect(`${"retrieved"}ByBranchId` in (got ?? {})).toBe(false);
  });

  it("links evidence and recomputes coverage", async () => {
    const kg = createInMemoryKgService();
    await kg.upsertReportNode(makeReport());
    await kg.upsertKnowledgeNode(makeKnowledge());
    const r1 = await kg.upsertEvidenceLink(makeLink());
    const r2 = await kg.upsertEvidenceLink(makeLink({ claimText: "Claim v2" }));
    expect(r1.created).toBe(true);
    expect(r2.created).toBe(false);
    const node = await kg.getReportNode("R_root");
    expect(node?.coverage.supportingCount).toBe(1);
  });

  it("aggregates descendant evidence and gaps into parent coverage", async () => {
    const kg = createInMemoryKgService();
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
    await kg.upsertEvidenceLink(makeLink({ reportNodeId: "R_hyp", relation: "supports" }));
    await kg.addOpenGap?.({ gapType: "missing", description: "Need more evidence.", suggestedQuery: "more evidence", reportNodeId: "R_hyp", status: "open" });

    expect((await kg.getReportNode("R_hyp"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
    expect((await kg.getReportNode("R_aspect"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
    expect((await kg.getReportNode("R_root"))?.coverage).toMatchObject({ supportingCount: 1, contradictingCount: 0, openGapCount: 1 });
  });

  it("deduplicates identical gaps and closes only matched gaps", async () => {
    const kg = createInMemoryKgService();
    await kg.upsertReportNode(makeReport());
    await kg.addOpenGap?.({ gapType: "missing_source", description: "Need source A.", suggestedQuery: "A", reportNodeId: "R_root", impact: "medium", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_source", description: "Need source A.", suggestedQuery: "A better", reportNodeId: "R_root", impact: "high", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_source", description: "Need source B.", suggestedQuery: "B", reportNodeId: "R_root", impact: "medium", status: "open" });

    expect(await kg.listOpenGaps?.("R_root")).toEqual([
      expect.objectContaining({ description: "Need source A.", suggestedQuery: "A better", impact: "high", status: "open" }),
      expect.objectContaining({ description: "Need source B.", status: "open" }),
    ]);
    await expect(kg.closeOpenGapsMatching?.([{ reportNodeId: "R_root", description: "Need source A.", reason: "resolved" }])).resolves.toBe(1);
    expect(await kg.listOpenGaps?.("R_root")).toEqual([
      expect.objectContaining({ description: "Need source A.", status: "closed" }),
      expect.objectContaining({ description: "Need source B.", status: "open" }),
    ]);
  });

  it("clusters paraphrased evidence gaps without crossing country or facet boundaries", async () => {
    const kg = createInMemoryKgService();
    const countries = "南亚五国（印度、巴基斯坦、孟加拉国、尼泊尔、斯里兰卡）";
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: `缺乏直接针对${countries}工业4.0核心技能需求的官方或权威研究报告。`, suggestedQuery: "skills source", reportNodeId: "R_hyp", impact: "medium", status: "open" });
    await kg.addOpenGap?.({ gapType: "evidence_gap", description: `未找到直接支持${countries}工业4.0核心技能需求的权威研究或官方报告。`, suggestedQuery: "better skills query", reportNodeId: "R_hyp", impact: "high", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: `缺乏直接列出${countries}工业4.0五类核心技能及其详细解释的权威来源。`, suggestedQuery: "five explained skills", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: "缺乏尼泊尔工业4.0采纳挑战的直接证据。", suggestedQuery: "Nepal challenges", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: "缺乏斯里兰卡工业4.0采纳挑战的直接证据。", suggestedQuery: "Sri Lanka challenges", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: "缺乏尼泊尔工业4.0基础设施挑战的直接证据。", suggestedQuery: "Nepal infrastructure", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_evidence", description: "缺乏印度工业4.0监管挑战的直接证据。", suggestedQuery: "India regulation old", reportNodeId: "R_hyp", status: "closed" });
    await kg.addOpenGap?.({ gapType: "evidence_gap", description: "未找到印度工业4.0监管挑战的直接证据。", suggestedQuery: "India regulation new", reportNodeId: "R_hyp", status: "open" });

    const gaps = await kg.listOpenGaps?.("R_hyp") ?? [];
    expect(gaps).toHaveLength(7);
    expect(gaps[0]).toMatchObject({
      gapType: "missing_evidence",
      description: `缺乏直接针对${countries}工业4.0核心技能需求的官方或权威研究报告。`,
      suggestedQuery: "better skills query",
      impact: "high",
    });
  });

  it("keeps only the narrower remaining-year data gap without merging distinct entities or metrics", async () => {
    const kg = createInMemoryKgService();
    await kg.addOpenGap?.({ gapType: "missing_data", description: "2015年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。已获取2022年和2023年数据。", suggestedQuery: "2015-2021 城轨数据", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "2016年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。", suggestedQuery: "2016-2021 城轨数据", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "2015年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。已获取2022年和2023年数据。", suggestedQuery: "stale broad query", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "北京2016年至2021年每年运营里程数据缺失。", suggestedQuery: "北京里程", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "上海2016年至2021年每年运营里程数据缺失。", suggestedQuery: "上海里程", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "2016年至2021年全国城轨日均客运强度数据缺失。", suggestedQuery: "客运强度", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "缺少2015-2018年及2020年全国城轨日均客运强度数据。", suggestedQuery: "旧客运强度", reportNodeId: "R_hyp", status: "open" });
    await kg.addOpenGap?.({ gapType: "missing_data", description: "缺少2015年、2016年及2020年全国城轨日均客运强度数据。2017年和2018年数据虽已获取报告但未提取具体数值。", suggestedQuery: "剩余客运强度", reportNodeId: "R_hyp", status: "open" });

    const gaps = await kg.listOpenGaps?.("R_hyp") ?? [];
    expect(gaps).toHaveLength(5);
    expect(gaps[0]).toMatchObject({
      description: "2016年至2021年每年年底开通城轨的城市数量和总运营里程数据缺失。",
      suggestedQuery: "2016-2021 城轨数据",
    });
    expect(gaps.map((gap) => gap.description)).toEqual(expect.arrayContaining([
      "北京2016年至2021年每年运营里程数据缺失。",
      "上海2016年至2021年每年运营里程数据缺失。",
      "2016年至2021年全国城轨日均客运强度数据缺失。",
      "缺少2015年、2016年及2020年全国城轨日均客运强度数据。2017年和2018年数据虽已获取报告但未提取具体数值。",
    ]));
  });

  it("refreshes old and new ancestors when moving evidence links", async () => {
    const kg = createInMemoryKgService();
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

  it("rejects evidence links pointing at missing entities", async () => {
    const kg = createInMemoryKgService();
    await expect(kg.upsertEvidenceLink(makeLink())).rejects.toBeInstanceOf(MockNotFoundError);
  });

  it("serializes and restores v5 snapshot", async () => {
    const src = new InMemoryKgService();
    await src.upsertReportNode(makeReport());
    await src.upsertKnowledgeNode(makeKnowledge());
    await src.upsertEvidenceLink(makeLink());
    await src.upsertReportlet(makeReportlet());
    const json = src.serialize();
    const dst = new InMemoryKgService();
    dst.restoreFromString(json);
    expect((await dst.listEvidenceLinks()).length).toBe(1);
    expect((await dst.listReportlets()).map((reportlet) => reportlet.reportletId)).toEqual(["RL_1"]);
  });

  it("stores reportlets and exposes them in ReportBundle", async () => {
    const kg = new InMemoryKgService();
    await kg.upsertReportNode(makeReport());
    await kg.upsertKnowledgeNode(makeKnowledge());
    await kg.upsertEvidenceLink(makeLink());
    await kg.upsertReportlet(makeReportlet());

    expect((await kg.getReportlet("RL_1"))?.markdown).toContain("[E:E_1]");
    const bundle = await kg.buildReportBundle("EP_1", "R_root", {
      language: "zh-CN",
      citationRequired: true,
      rubricId: "RB_1",
      rubricText: "Use citations.",
    });

    expect(bundle.tree.find((entry) => entry.node.nodeId === "R_root")?.reportlets[0]?.reportletId).toBe("RL_1");
  });

  it("validates bad nodes before restore", () => {
    const kg = new InMemoryKgService();
    expect(() => kg.restore({
      version: 5,
      reportNodes: [makeReport({ nodeId: "" })],
      knowledgeNodes: [],
      evidenceLinks: [],
      openGaps: [],
      reportlets: [],
    })).toThrow(ValidationError);
  });

  it("builds ReportBundle for reporter", async () => {
    const kg = new InMemoryKgService();
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
    expect(bundle.globalEvidenceIndex[0]?.citationId).toBe("C1");
    expect(bundle.tree.find((entry) => entry.node.nodeId === "R_hyp")?.evidence[0]?.knowledge.nodeId).toBe("K_1");
  });

  it("excludes root and unlinked sources from ReportBundle citations", async () => {
    const kg = new InMemoryKgService();
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
    await kg.upsertKnowledgeNode(makeKnowledge({ nodeId: "K_leaf", url: "https://example.test/leaf" }));
    await kg.upsertKnowledgeNode(makeKnowledge({ nodeId: "K_root", url: "https://example.test/root" }));
    await kg.upsertKnowledgeNode(makeKnowledge({ nodeId: "K_unlinked", url: "https://example.test/unlinked" }));
    await kg.upsertEvidenceLink(makeLink({ linkId: "E_leaf", reportNodeId: "R_hyp", knowledgeNodeId: "K_leaf" }));
    await kg.upsertEvidenceLink(makeLink({ linkId: "E_root", reportNodeId: "R_root", knowledgeNodeId: "K_root", createdByTaskId: "T_root" }));

    const bundle = await kg.buildReportBundle("EP_1", "R_root", {
      language: "zh-CN",
      citationRequired: true,
      rubricId: "RB_1",
      rubricText: "Use citations.",
    });

    expect(bundle.globalEvidenceIndex.map((entry) => entry.knowledgeNodeId)).toEqual(["K_leaf"]);
    expect(bundle.tree.find((entry) => entry.node.nodeId === "R_root")?.evidence).toEqual([]);
  });

  it("fixture service has a minimal v5 tree", async () => {
    const kg = createFixtureKgService();
    expect((await kg.listReportNodes()).length).toBeGreaterThan(0);
    expect((await kg.listKnowledgeNodes()).length).toBeGreaterThan(0);
  });
});
