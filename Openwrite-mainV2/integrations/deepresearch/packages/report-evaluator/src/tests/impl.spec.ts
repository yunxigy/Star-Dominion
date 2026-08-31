import type { ReportBundle, ReportNode } from "@deepresearch/contracts";
import { describe, expect, it } from "vitest";
import { BaseReporterService, createInMemoryReporter, createSqliteReporter } from "../index.js";

const now = "2026-07-01T00:00:00.000Z";

function node(overrides: Partial<ReportNode>): ReportNode {
  return {
    nodeId: "R_root",
    nodeKind: "root",
    label: "Root",
    parentNodeId: null,
    scopeNote: "Root scope",
    status: "supported",
    coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 0 },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function bundle(): ReportBundle {
  const root = node({});
  const aspect = node({
    nodeId: "R_aspect",
    nodeKind: "aspect",
    label: "Market",
    parentNodeId: "R_root",
    scopeNote: "Market evidence",
  });
  return {
    episodeId: "E_1",
    root,
    tree: [
      { node: root, children: ["R_aspect"], evidence: [], reportlets: [], openGaps: [] },
      {
        node: aspect,
        children: [],
        reportlets: [],
        evidence: [
          {
            link: {
              linkId: "EL_1",
              reportNodeId: "R_aspect",
              knowledgeNodeId: "K_1",
              relation: "supports",
              claimText: "Market demand is increasing.",
              confidence: 0.8,
              createdByTaskId: "T_1",
              createdAt: now,
            },
            knowledge: {
              nodeId: "K_1",
              nodeType: "WebPage",
              title: "Demand report",
              url: "https://example.test/demand",
              contentHash: "hash",
              summary: "Demand summary",
              sourceTier: "primary",
              qualityScore: 0.9,
              retrievedByTaskId: "T_1",
              retrievedAt: now,
              metadata: {},
            },
          },
        ],
        openGaps: [],
      },
    ],
    globalEvidenceIndex: [
      {
        citationId: "C1",
        knowledgeNodeId: "K_1",
        title: "Demand report",
        url: "https://example.test/demand",
        sourceTier: "primary",
        retrievedAt: now,
      },
    ],
    constraints: {
      language: "en",
      citationRequired: true,
      rubricId: "RB_1",
      rubricText: "Be grounded.",
    },
  };
}

describe("v5 reporter", () => {
  it("generates a ReportArtifact from ReportBundle", async () => {
    const svc = createInMemoryReporter({ now: () => now });
    const artifact = await svc.generate(bundle());
    expect(artifact.episodeId).toBe("E_1");
    expect(artifact.reportMd).toContain("# Root");
    expect(artifact.reportMd).toContain("Market demand is increasing. [C1]");
    expect(artifact.citationMap.C1).toBe("K_1");
    expect(artifact.evidenceIndex).toHaveLength(1);
    expect(artifact.generatedAt).toBe(now);
  });

  it("returns cached artifacts for the same bundle key", async () => {
    const svc = new BaseReporterService({ now: () => now });
    const first = await svc.generate(bundle());
    const second = await svc.generate(bundle());
    expect(second).toBe(first);
  });

  it("serializes and restores cache", async () => {
    const svc = new BaseReporterService({ now: () => now });
    const first = await svc.generate(bundle());
    const json = svc.serialize();
    const restored = new BaseReporterService({ now: () => "later" });
    restored.restoreFromString(json);
    const second = await restored.generate(bundle());
    expect(second.generatedAt).toBe(first.generatedAt);
  });

  it("in-memory and sqlite factories expose ReporterService", async () => {
    await expect(createInMemoryReporter({ now: () => now }).generate(bundle())).resolves.toMatchObject({ episodeId: "E_1" });
    await expect(createSqliteReporter({ dbPath: ":memory:", now: () => now }).generate(bundle())).resolves.toMatchObject({ episodeId: "E_1" });
  });

  it("emits diagnostics for citation-required bundles without evidence", async () => {
    const empty = bundle();
    empty.globalEvidenceIndex = [];
    empty.tree[1]!.evidence = [];
    const artifact = await createInMemoryReporter({ now: () => now }).generate(empty);
    expect(artifact.diagnostics.some((diag) => diag.code === "no_evidence")).toBe(true);
  });
});
