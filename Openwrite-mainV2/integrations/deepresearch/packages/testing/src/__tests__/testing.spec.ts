import { describe, expect, it } from "vitest";
import { Rng } from "../random.js";
import {
  makeRootReportNode,
  makeSampleEvidenceLinks,
  makeSampleKnowledgeNodes,
  makeSampleReportNodes,
  makeSampleTaskItem,
} from "../fixtures.js";
import { newInMemoryStack, newMockStack } from "../test-stack.js";

describe("Rng", () => {
  it("produces the same sequence for the same seed", () => {
    const a = new Rng(123);
    const b = new Rng(123);
    for (let i = 0; i < 50; i++) {
      expect(a.next()).toBe(b.next());
    }
  });

  it("keeps int values in range", () => {
    const r = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const v = r.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
  });
});

describe("v5 fixtures", () => {
  it("builds a complete root report node", () => {
    const node = makeRootReportNode(new Rng(1));
    expect(node.parentNodeId).toBeNull();
    expect(node.nodeKind).toBe("root");
    expect(node.coverage.supportingCount).toBe(0);
  });

  it("builds report, knowledge, evidence, and task fixtures", () => {
    const rng = new Rng(1);
    const reports = makeSampleReportNodes(rng, 2);
    const knowledge = makeSampleKnowledgeNodes(rng, 2);
    const links = makeSampleEvidenceLinks(reports[0]!.nodeId, knowledge);
    const task = makeSampleTaskItem(rng, "B_1", reports[0]!.nodeId, "Research fixtures");
    expect(reports).toHaveLength(2);
    expect(knowledge[0]?.contentHash).toBeTruthy();
    expect(links[0]?.reportNodeId).toBe(reports[0]!.nodeId);
    expect(task.status).toBe("queued");
    expect(task.acceptanceCriteria.length).toBeGreaterThan(0);
  });
});

describe("test stacks", () => {
  it("creates a mock stack with v5 services", async () => {
    const stack = newMockStack({ seed: 42 });
    expect(stack.parser).toBeDefined();
    expect(stack.ledger).toBeDefined();
    expect(stack.kg).toBeDefined();
    expect(stack.memory).toBeDefined();
    expect(stack.reporter).toBeDefined();
    expect(stack.llm.name).toBe("testing-echo-llm");
    await expect(stack.kg.getReportNode("R_root")).resolves.toBeTruthy();
  });

  it("creates an empty in-memory stack", async () => {
    const stack = newInMemoryStack({ seed: 7 });
    await expect(stack.kg.getReportNode("R_root")).resolves.toBeNull();
    const a = await stack.parser.parse({ userInput: "x", sessionId: "S_1" });
    const b = await stack.parser.parse({ userInput: "y", sessionId: "S_2" });
    expect(a.episodeId).not.toBe(b.episodeId);
  });
});
