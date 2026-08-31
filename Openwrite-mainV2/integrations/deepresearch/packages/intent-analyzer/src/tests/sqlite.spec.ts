import { afterEach, describe, expect, it } from "vitest";
import { SqliteIntentParser } from "../index.js";

describe("SqliteIntentParser v5", () => {
  const parsers: SqliteIntentParser[] = [];
  afterEach(() => {
    for (const parser of parsers) parser.close();
    parsers.length = 0;
  });

  it("persists parsed context", async () => {
    const parser = new SqliteIntentParser({ dbPath: ":memory:", now: () => Date.UTC(2026, 6, 1) });
    parsers.push(parser);
    const ctx = await parser.parse({ sessionId: "S_1", userInput: "Research y" });
    expect(parser.getByEpisodeId(ctx.episodeId)?.userInput).toBe("Research y");
  });
});
