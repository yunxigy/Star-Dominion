import type { AgentRunResult } from "@deepresearch/contracts";
import { describe, expect, it } from "vitest";
import {
  analyzeCalibration,
  computeActualGain,
  writeReport,
  collectFromOrchestrator,
  makeRecord,
  type CalibrationRecord,
} from "../index.js";

function result(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    agentRunId: "AR_1",
    taskId: "T_1",
    reportNodeId: "R_1",
    branchId: "B_1",
    branchOutcome: "done_here",
    knowledgeNodeIds: ["K_1"],
    evidenceLinkIds: ["EL_1"],
    nodeUpdates: [
      {
        reportNodeId: "R_1",
        oldStatus: "researching",
        newStatus: "supported",
        reason: "Evidence supports the claim.",
        confidence: 0.8,
      },
    ],
    openGaps: [],
    structurePatchSuggestions: [],
    turnSummary: {
      actionSummary: "searched",
      searchSummary: "one source",
      reasoningSummary: "linked evidence",
      citedKnowledgeNodeIds: ["K_1"],
      citedEvidenceLinkIds: ["EL_1"],
    },
    ...overrides,
  };
}

describe("computeActualGain", () => {
  it("returns 0 when no v5 artifacts are present", () => {
    expect(computeActualGain({ source: "agent_run" })).toBe(0);
  });

  it("scores rich evidence output close to 1", () => {
    const gain = computeActualGain({
      source: "agent_run",
      agentResults: [
        result({
          knowledgeNodeIds: ["K_1", "K_2", "K_3", "K_4", "K_5"],
          evidenceLinkIds: ["EL_1", "EL_2", "EL_3", "EL_4", "EL_5"],
          nodeUpdates: [
            { reportNodeId: "R_1", oldStatus: "researching", newStatus: "supported", reason: "a", confidence: 0.8 },
            { reportNodeId: "R_2", oldStatus: "researching", newStatus: "supported", reason: "b", confidence: 0.8 },
            { reportNodeId: "R_3", oldStatus: "researching", newStatus: "supported", reason: "c", confidence: 0.8 },
          ],
          turnSummary: {
            actionSummary: "searched",
            searchSummary: "five sources",
            reasoningSummary: "linked evidence",
            citedKnowledgeNodeIds: ["K_1", "K_2", "K_3", "K_4", "K_5"],
            citedEvidenceLinkIds: ["EL_1", "EL_2", "EL_3", "EL_4", "EL_5"],
          },
        }),
      ],
    });
    expect(gain).toBeGreaterThan(0.9);
    expect(gain).toBeLessThanOrEqual(1);
  });

  it("scores sparse evidence output as medium-low", () => {
    const gain = computeActualGain({ source: "agent_run", agentResults: [result()] });
    expect(gain).toBeGreaterThan(0.15);
    expect(gain).toBeLessThan(0.5);
  });

  it("penalizes open gaps", () => {
    const clean = computeActualGain({ source: "agent_run", agentResults: [result()] });
    const withGaps = computeActualGain({
      source: "agent_run",
      agentResults: [
        result({
          openGaps: [
            { gapType: "coverage", description: "missing x", suggestedQuery: "x" },
            { gapType: "coverage", description: "missing y", suggestedQuery: "y" },
          ],
        }),
      ],
    });
    expect(withGaps).toBeLessThan(clean);
  });

  it("clamps to [0, 1]", () => {
    const gain = computeActualGain({
      source: "agent_run",
      agentResults: [
        result({
          knowledgeNodeIds: Array.from({ length: 100 }, (_, i) => `K_${i}`),
          evidenceLinkIds: Array.from({ length: 100 }, (_, i) => `EL_${i}`),
          turnSummary: {
            actionSummary: "",
            searchSummary: "",
            reasoningSummary: "",
            citedKnowledgeNodeIds: [],
            citedEvidenceLinkIds: Array.from({ length: 100 }, (_, i) => `EL_${i}`),
          },
        }),
      ],
    });
    expect(gain).toBeLessThanOrEqual(1);
  });
});

describe("analyzeCalibration", () => {
  const records: CalibrationRecord[] = [
    { recordId: "r1", episodeId: "E1", source: "agent_run", decisionId: "p1", expectedGain: 0.9, decision: "complete", actualGain: 0.8, decidedAt: "t", realizedAt: "t" },
    { recordId: "r2", episodeId: "E1", source: "agent_run", decisionId: "p2", expectedGain: 0.2, decision: "complete", actualGain: 0.3, decidedAt: "t", realizedAt: "t" },
    { recordId: "r3", episodeId: "E1", source: "agent_run", decisionId: "p3", expectedGain: 0.7, decision: "complete", actualGain: 0.2, decidedAt: "t", realizedAt: "t" },
    { recordId: "r4", episodeId: "E1", source: "agent_run", decisionId: "p4", expectedGain: 0.3, decision: "complete", actualGain: 0.6, decidedAt: "t", realizedAt: "t" },
    { recordId: "r5", episodeId: "E1", source: "completion_gate", decisionId: "p5", expectedGain: 0.6, decision: "complete", actualGain: 0.6, decidedAt: "t", realizedAt: "t" },
    { recordId: "r6", episodeId: "E1", source: "publish_gate", decisionId: "p6", expectedGain: 0.8, decision: "repair", decidedAt: "t" },
  ];

  it("counts total records and records with actual gain", () => {
    const a = analyzeCalibration(records);
    expect(a.totalRecords).toBe(6);
    expect(a.recordsWithActual).toBe(5);
  });

  it("computes MAE and RMSE", () => {
    const a = analyzeCalibration(records);
    expect(a.mae).toBeCloseTo(0.2, 5);
    expect(a.rmse).toBeCloseTo(0.2683, 3);
  });

  it("computes direction accuracy", () => {
    const a = analyzeCalibration(records);
    expect(a.directionAccuracy).toBeCloseTo(0.6, 5);
  });

  it("computes Brier score", () => {
    const a = analyzeCalibration(records);
    expect(a.brierScore).toBeCloseTo(0.238, 3);
  });

  it("keeps ECE in range", () => {
    const a = analyzeCalibration(records);
    expect(a.ece).toBeGreaterThanOrEqual(0);
    expect(a.ece).toBeLessThanOrEqual(1);
  });

  it("counts decisions", () => {
    const a = analyzeCalibration(records);
    expect(a.decisionDistribution.complete).toBe(5);
    expect(a.decisionDistribution.repair).toBe(1);
  });

  it("groups by source", () => {
    const a = analyzeCalibration(records);
    expect(a.bySource.agent_run?.count).toBe(4);
    expect(a.bySource.completion_gate?.count).toBe(1);
    expect(a.bySource.publish_gate?.count).toBe(1);
  });

  it("handles empty records", () => {
    const a = analyzeCalibration([]);
    expect(a.totalRecords).toBe(0);
    expect(a.mae).toBe(0);
    expect(a.recordsWithActual).toBe(0);
  });
});

describe("writeReport", () => {
  it("writes parseable json", () => {
    const a = analyzeCalibration([
      { recordId: "r", episodeId: "E", source: "agent_run", decisionId: "p", expectedGain: 0.5, decision: "complete", actualGain: 0.6, decidedAt: "t" },
    ]);
    const s = writeReport(a, "json");
    expect(() => JSON.parse(s)).not.toThrow();
    expect(JSON.parse(s).totalRecords).toBe(1);
  });

  it("writes markdown with key metrics", () => {
    const a = analyzeCalibration([
      { recordId: "r", episodeId: "E", source: "agent_run", decisionId: "p", expectedGain: 0.5, decision: "complete", actualGain: 0.6, decidedAt: "t" },
    ]);
    const md = writeReport(a, "md");
    expect(md).toMatch(/# Calibration Analysis Report/);
    expect(md).toMatch(/MAE/);
    expect(md).toMatch(/Direction accuracy/);
    expect(md).toMatch(/By source/);
  });
});

describe("collectFromOrchestrator", () => {
  it("collects one record per v5 agent result", () => {
    const fakeOrch = {
      state: {
        agentResults: [
          result({ agentRunId: "AR_1" }),
          result({
            agentRunId: "AR_2",
            branchOutcome: "failed",
            knowledgeNodeIds: [],
            evidenceLinkIds: [],
            nodeUpdates: [],
            turnSummary: {
              actionSummary: "",
              searchSummary: "",
              reasoningSummary: "",
              citedKnowledgeNodeIds: [],
              citedEvidenceLinkIds: [],
            },
          }),
        ],
        episodeId: "E_test",
      },
    };
    const records = collectFromOrchestrator(fakeOrch, {
      expectedGainByAgentRunId: { AR_1: 0.8 },
    });
    expect(records.length).toBe(2);
    expect(records[0]?.expectedGain).toBe(0.8);
    expect(records[0]?.actualGain).toBeGreaterThan(0);
    expect(records[1]?.decision).toBe("failed");
    expect(records[1]?.actualGain).toBe(0);
  });

  it("uses default expected gain when no map entry exists", () => {
    const fakeOrch = {
      _state: {
        agentResults: [result({ agentRunId: "AR_3" })],
      },
    };
    const records = collectFromOrchestrator(fakeOrch, { defaultExpectedGain: 0.7 });
    expect(records[0]?.expectedGain).toBe(0.7);
  });
});

describe("makeRecord", () => {
  it("fills decidedAt and recordId", () => {
    const r = makeRecord({ episodeId: "E", source: "agent_run", decisionId: "p1", expectedGain: 0.5, decision: "complete" });
    expect(r.recordId).toBe("calib_p1");
    expect(r.decidedAt).toBeTruthy();
  });
});
