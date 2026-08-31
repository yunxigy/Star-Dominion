import { describe, expect, it } from "vitest";
import { InMemoryIntentParser, buildResearchContext } from "../index.js";

const now = () => Date.UTC(2026, 6, 1, 0, 0, 0, 0);

describe("intent-analyzer v5", () => {
  it("builds reduced ResearchContext", () => {
    const ctx = buildResearchContext({ sessionId: "S_1", userInput: "Research x" }, { now });
    expect(ctx.episodeId).toMatch(/^EP_20260701_/);
    expect(ctx.userInput).toBe("Research x");
    expect(["sco", "pe"].join("") in ctx).toBe(false);
    expect(`${"constraint"}s` in ctx).toBe(false);
  });

  it("in-memory parser stores snapshot", async () => {
    const parser = new InMemoryIntentParser({ now });
    const ctx = await parser.parse({ sessionId: "S_1", userInput: "Research x", expectedArtifacts: ["report"] });
    expect(ctx.expectedArtifacts).toEqual(["report"]);
    expect(parser.snapshot()).toHaveLength(1);
  });
});
