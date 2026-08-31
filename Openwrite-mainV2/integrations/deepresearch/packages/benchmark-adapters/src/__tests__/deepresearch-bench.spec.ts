import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeepResearchBenchAdapter, type DeepResearchBenchOutput } from "../deepresearch-bench.js";

describe("DeepResearchBenchAdapter", () => {
  it("loads tasks, maps TaskSubmission, and writes raw JSONL outputs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drb-adapter-"));
    try {
      const queryPath = join(dir, "query.jsonl");
      const outputPath = join(dir, "raw.jsonl");
      writeFileSync(queryPath, JSON.stringify({
        id: 100,
        topic: "Social Life",
        language: "en",
        prompt: "Write a paper about AI interaction and interpersonal relations.",
      }) + "\n", "utf-8");
      const adapter = new DeepResearchBenchAdapter({ queryPath, outputPath, env: {} });
      const tasks = await adapter.loadTasks();
      expect(tasks).toHaveLength(1);
      const submission = adapter.toTaskSubmission(tasks[0]!, {
        episodeId: "E_TEST",
        maxUsd: 1,
        maxRounds: 2,
        maxParallelBranches: 3,
        maxDepth: 2,
        maxSubbranchesPerParent: 2,
      });
      expect(submission.sessionId).toBe("S_DRB_100");
      expect(submission.uiOptions?.citationRequired).toBe(true);
      expect(submission.userInput).toContain("The final report must be written in English.");

      const outputs: DeepResearchBenchOutput[] = [{ id: 100, prompt: tasks[0]!.prompt, article: "# report" }];
      await adapter.writeOutputs(outputs, { modelName: "test", outputPath });
      const raw = readFileSync(outputPath, "utf-8").trim();
      expect(JSON.parse(raw)).toEqual(outputs[0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
