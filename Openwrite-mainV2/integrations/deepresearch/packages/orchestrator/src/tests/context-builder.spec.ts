import { describe, expect, it } from "vitest";
import type { EvidenceLink, KnowledgeNode, ReportNode, TaskItem } from "@deepresearch/contracts";
import { buildContextPacket } from "../context-builder.js";
import { loadDefaultRuntimeProfile } from "../infra/config.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { evidenceTools } from "../tools.js";

const now = "2026-07-15T00:00:00.000Z";

describe("evidence-agent context reuse", () => {
  it("surfaces a small set of semantically relevant sources saved in another branch", async () => {
    const ctx = createPhaseContext({ sessionId: "S_context", userInput: "研究城市轨道交通" }, {
      llm: new EchoJsonLlm(),
      runtimeProfile: loadDefaultRuntimeProfile(),
    });
    const root = reportNode("R_root", "root", null, "城市轨道交通发展");
    const scaleAspect = reportNode("R_scale", "aspect", root.nodeId, "整体规模");
    const scaleLeaf = reportNode("R_scale_leaf", "hypothesis", scaleAspect.nodeId, "年度运营里程");
    const efficiencyAspect = reportNode("R_efficiency", "aspect", root.nodeId, "服务效率");
    const efficiencyLeaf = reportNode("R_efficiency_leaf", "hypothesis", efficiencyAspect.nodeId, "年度客运强度");
    for (const node of [root, scaleAspect, scaleLeaf, efficiencyAspect, efficiencyLeaf]) {
      await ctx.stack.kg.upsertReportNode(node);
    }
    const annualReport = knowledge(
      "K_annual",
      "2022年城市轨道交通年度统计报告：客运量与客运强度",
      "报告列出城市轨道交通运营里程、日均客运量和客运强度。",
      "official",
    );
    const unrelated = knowledge(
      "K_unrelated",
      "海洋生物多样性调查",
      "珊瑚礁生态系统物种调查结果。",
      "official",
    );
    await ctx.stack.kg.upsertKnowledgeNode(annualReport);
    await ctx.stack.kg.upsertKnowledgeNode(unrelated);
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_annual", scaleLeaf.nodeId, annualReport.nodeId));
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_annual_second", scaleAspect.nodeId, annualReport.nodeId));
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_unrelated", scaleLeaf.nodeId, unrelated.nodeId));
    const task = taskItem(efficiencyLeaf.nodeId);

    const packet = await buildContextPacket({
      task,
      globalRubric: {
        rubricId: "RB_context",
        episodeId: "EP_context",
        rubricText: "整理城市轨道交通服务效率",
        outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
        requirements: [{
          requirementId: "R1",
          description: "列出2019年至2022年的城市轨道交通日均客运量和客运强度。",
          kind: "question",
          priority: "must",
          evidenceNeeds: ["每年客运强度"],
          successCriteria: ["每年数据均有来源"],
        }],
      },
      runtimeProfile: loadDefaultRuntimeProfile(),
      kg: ctx.stack.kg,
      ledger: ctx.stack.ledger,
      availableTools: evidenceTools,
    });

    expect(packet.relevantEvidence).toContainEqual(expect.objectContaining({
      knowledgeNodeId: annualReport.nodeId,
      sourceTier: "official",
    }));
    expect(packet.relevantEvidence.map((source) => source.knowledgeNodeId)).not.toContain(unrelated.nodeId);
    expect(packet.relevantEvidence.filter((source) => source.knowledgeNodeId === annualReport.nodeId)).toHaveLength(1);
    expect(packet.availableTools.map((tool) => tool.toolName)).toContain("inspect_knowledge_node");
  });

  it("keeps directly linked evidence even when its title has little lexical overlap", async () => {
    const ctx = createPhaseContext({ sessionId: "S_local", userInput: "研究政策" }, {
      llm: new EchoJsonLlm(),
      runtimeProfile: loadDefaultRuntimeProfile(),
    });
    const root = reportNode("R_root", "root", null, "政策研究");
    const leaf = reportNode("R_leaf", "hypothesis", root.nodeId, "实施效果");
    await ctx.stack.kg.upsertReportNode(root);
    await ctx.stack.kg.upsertReportNode(leaf);
    const source = knowledge("K_local", "附件甲", "直接支持当前叶子的原始材料。", "primary");
    await ctx.stack.kg.upsertKnowledgeNode(source);
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_local", leaf.nodeId, source.nodeId));
    const task = taskItem(leaf.nodeId);

    const packet = await buildContextPacket({
      task,
      globalRubric: {
        rubricId: "RB_local",
        episodeId: "EP_local",
        rubricText: "研究政策效果",
        outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
      },
      runtimeProfile: loadDefaultRuntimeProfile(),
      kg: ctx.stack.kg,
      ledger: ctx.stack.ledger,
      availableTools: evidenceTools,
    });

    expect(packet.relevantEvidence).toContainEqual(expect.objectContaining({ knowledgeNodeId: source.nodeId }));
  });

  it("reuses older documents from the same annual-report series without admitting a topical sibling", async () => {
    const ctx = createPhaseContext({ sessionId: "S_series", userInput: "整理历年运营里程" }, {
      llm: new EchoJsonLlm(),
      runtimeProfile: loadDefaultRuntimeProfile(),
    });
    const root = reportNode("R_root", "root", null, "城市轨道交通");
    const aspect = reportNode("R_aspect", "aspect", root.nodeId, "发展规模");
    const current = reportNode("R_current", "hypothesis", aspect.nodeId, "2015至2023年运营里程");
    const sibling = reportNode("R_sibling", "hypothesis", aspect.nodeId, "人才发展");
    for (const node of [root, aspect, current, sibling]) await ctx.stack.kg.upsertReportNode(node);
    const currentAnnual = knowledge("K_2023", "城市轨道交通2023年度统计和分析报告", "2023年运营里程。", "official");
    const olderAnnual = knowledge("K_2018", "中国城市轨道交通协会2018年度统计和分析报告", "2018年运营里程。", "primary");
    const historicalRange = knowledge("K_2010_2018", "2010-2018年城市轨道交通运营里程汇编", "历年运营里程。", "secondary");
    const futureAnnual = knowledge("K_2024", "城市轨道交通2024年度统计和分析报告", "2024年运营里程。", "official");
    const talentPlan = knowledge("K_talent", "城市轨道交通人才培养规划（2016-2020年）", "人才培养目标。", "primary");
    for (const source of [currentAnnual, olderAnnual, historicalRange, futureAnnual, talentPlan]) await ctx.stack.kg.upsertKnowledgeNode(source);
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_2023", current.nodeId, currentAnnual.nodeId));
    await ctx.stack.kg.upsertEvidenceLink(evidenceLink("E_talent", sibling.nodeId, talentPlan.nodeId));
    const task = {
      ...taskItem(current.nodeId),
      title: "整理2015至2023年运营里程",
      objective: "逐年列出2015至2023年运营里程。",
      acceptanceCriteria: ["每个年份都有运营里程"],
    };

    const packet = await buildContextPacket({
      task,
      globalRubric: {
        rubricId: "RB_series",
        episodeId: "EP_series",
        rubricText: task.objective,
        outputHints: { language: "zh-CN", citationRequired: true, format: "markdown" },
      },
      runtimeProfile: loadDefaultRuntimeProfile(),
      kg: ctx.stack.kg,
      ledger: ctx.stack.ledger,
      availableTools: evidenceTools,
    });

    const sourceIds = packet.relevantEvidence.map((source) => source.knowledgeNodeId);
    expect(sourceIds).toContain(olderAnnual.nodeId);
    expect(sourceIds).toContain(historicalRange.nodeId);
    expect(sourceIds).not.toContain(futureAnnual.nodeId);
    expect(sourceIds).not.toContain(talentPlan.nodeId);
  });
});

function reportNode(
  nodeId: string,
  nodeKind: ReportNode["nodeKind"],
  parentNodeId: string | null,
  label: string,
): ReportNode {
  return {
    nodeId,
    nodeKind,
    parentNodeId,
    label,
    scopeNote: label,
    hypothesis: nodeKind === "hypothesis" ? {
      statement: label,
      researchBrief: label,
      evidenceGuidance: "优先使用年度权威统计报告。",
    } : undefined,
    requirementIds: nodeKind === "hypothesis" ? ["R1"] : [],
    status: "planned",
    coverage: { supportingCount: 0, contradictingCount: 0, openGapCount: 0 },
    createdAt: now,
    updatedAt: now,
  };
}

function knowledge(
  nodeId: string,
  title: string,
  summary: string,
  sourceTier: KnowledgeNode["sourceTier"],
): KnowledgeNode {
  return {
    nodeId,
    nodeType: "Report",
    title,
    url: `https://example.com/${nodeId}`,
    contentHash: `hash:${nodeId}`,
    summary,
    sourceTier,
    qualityScore: 0.9,
    retrievedByTaskId: "T_source",
    retrievedAt: now,
    metadata: { fetched: true, contentPreview: summary.repeat(20) },
  };
}

function evidenceLink(linkId: string, reportNodeId: string, knowledgeNodeId: string): EvidenceLink {
  return {
    linkId,
    reportNodeId,
    knowledgeNodeId,
    relation: "supports",
    claimText: "支持先前叶子的统计结论。",
    confidence: 0.9,
    createdByTaskId: "T_source",
    createdAt: now,
  };
}

function taskItem(reportNodeId: string): TaskItem {
  return {
    taskId: `T_${reportNodeId}`,
    parentTaskId: "T_root",
    reportNodeId,
    title: "整理城市轨道交通客运强度",
    objective: "提取2019年至2022年城市轨道交通日均客运量和客运强度。",
    status: "queued",
    priority: 100,
    branchId: "B_test",
    acceptanceCriteria: ["列出每年客运量和客运强度"],
    createdAt: now,
    updatedAt: now,
  };
}
