import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FetchProvider, SearchProvider } from "@deepresearch/contracts";
import {
  DeepResearchBenchIIAdapter,
  acceptBenchmarkAuthoritySearchResults,
  benchmarkSearchProviders,
  filterBenchmarkAuthoritySearchResults,
  loadBenchmarkEnvironment,
  runDeepResearchBenchIICli,
  type DeepResearchBenchIIOutput,
} from "../deepresearch-bench-ii.js";
import {
  aggregateDeepResearchBenchIIOfficialScores,
  parseDeepResearchBenchIIDataset,
  selectDeepResearchBenchIITasks,
  type DeepResearchBenchIITaskRecord,
} from "../deepresearch-bench-ii-harness.js";
import type { FrameworkRunResult } from "../types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("DeepResearchBenchII harness", () => {
  it("selects one random task by default and reproduces the selection with a seed", () => {
    const tasks = [task(1), task(2), task(3), task(4)];

    const first = selectDeepResearchBenchIITasks(tasks, { seed: "repeatable" });
    const second = selectDeepResearchBenchIITasks(tasks, { seed: "repeatable" });

    expect(first.mode).toBe("random");
    expect(first.tasks).toHaveLength(1);
    expect(second.tasks.map((item) => item.idx)).toEqual(first.tasks.map((item) => item.idx));
    expect(selectDeepResearchBenchIITasks(tasks, { seed: "repeatable", sampleSize: 3 }).tasks).toHaveLength(3);
    expect(selectDeepResearchBenchIITasks(tasks, { all: true }).tasks).toHaveLength(4);
    expect(selectDeepResearchBenchIITasks(tasks, { ids: [3, 1] }).tasks.map((item) => item.idx)).toEqual([3, 1]);
    expect(() => selectDeepResearchBenchIITasks(tasks, { ids: [99] })).toThrow("task IDs not found: 99");
  });

  it("rejects malformed and duplicate dataset rows", () => {
    expect(() => parseDeepResearchBenchIIDataset("not-json\n")).toThrow("line 1");
    const duplicate = `${JSON.stringify(task(1))}\n${JSON.stringify(task(1))}\n`;
    expect(() => parseDeepResearchBenchIIDataset(duplicate)).toThrow("Duplicate DeepResearch Bench II task idx: 1");
  });

  it("builds benchmark search providers in the default and configured order", () => {
    const env = {
      BOCHA_API_KEY: "bocha-key",
      BRAVE_API_KEY: "brave-key",
      JINA_API_KEY: "jina-key",
    };

    expect(benchmarkSearchProviders(env, task(1)).map((provider) => provider.name)).toEqual([
      "bocha-search",
      "brave-search",
      "jina-search",
    ]);
    expect(benchmarkSearchProviders({ ...env, BENCH_SEARCH_ORDER: "jina,bocha,brave" }, task(1)).map((provider) => provider.name)).toEqual([
      "jina-search",
      "bocha-search",
      "brave-search",
    ]);
    expect(() => benchmarkSearchProviders({ ...env, BENCH_SEARCH_ORDER: "bocha,typo" }, task(1))).toThrow("unsupported provider");
    expect(() => benchmarkSearchProviders({ ...env, BOCHA_RETRY: "NaN" }, task(1))).toThrow("BOCHA_RETRY must be an integer");

    const adapter = new DeepResearchBenchIIAdapter({
      queryPath: "unused",
      outputDir: "unused",
      env,
      fetchProvider: { name: "fetch", fetchPage: async (url) => ({ url, title: "title", content: "content" }) },
    });
    expect(adapter.buildToolProfile(task(1), taskEnv()).searchProvider.name).toBe(
      "fallback(bocha-search->brave-search->jina-search)-drb2-block-filter",
    );
  });

  it("accepts authority-first search results only when authority URL shape and subject overlap agree", () => {
    const query = "Betaflight communication protocol official documentation";
    expect(acceptBenchmarkAuthoritySearchResults({
      query,
      providerName: "portal-search",
      results: [{
        url: "https://software-download.example/betaflight",
        title: "Betaflight 官方中文版 official download",
        snippet: "Download portal",
      }],
    })).toBe(false);
    expect(acceptBenchmarkAuthoritySearchResults({
      query,
      providerName: "web-search",
      results: [{
        url: "https://betaflight.com/docs/wiki/guides/current/MSP-Extensions",
        title: "Betaflight MSP Extensions",
        snippet: "Project protocol documentation",
      }],
    })).toBe(true);
    expect(acceptBenchmarkAuthoritySearchResults({
      query,
      providerName: "web-search",
      results: [{
        url: "https://docs.example.org/unrelated",
        title: "Unrelated flight documentation",
        snippet: "No matching project",
      }],
    })).toBe(false);
    expect(filterBenchmarkAuthoritySearchResults(query, [
      { url: "https://software-download.example/betaflight", title: "Betaflight 官方中文版", snippet: "Download portal" },
      { url: "https://betaflight.com/docs/development", title: "Betaflight development", snippet: "Official project docs" },
      { url: "https://blog.example/betaflight", title: "Betaflight overview", snippet: "Blog" },
    ])).toEqual([
      { url: "https://betaflight.com/docs/development", title: "Betaflight development", snippet: "Official project docs" },
    ]);
  });

  it("accepts direct project repositories and leaves ordinary queries on first-non-empty behavior", () => {
    expect(acceptBenchmarkAuthoritySearchResults({
      query: "LibrePilot license file official repository",
      providerName: "search",
      results: [{ url: "https://github.com/librepilot/LibrePilot", title: "LibrePilot repository", snippet: "Source code" }],
    })).toBe(true);
    expect(acceptBenchmarkAuthoritySearchResults({
      query: "broad autopilot ecosystem overview",
      providerName: "search",
      results: [{ url: "https://example.com/overview", title: "Autopilot overview", snippet: "Secondary overview" }],
    })).toBe(true);
    expect(filterBenchmarkAuthoritySearchResults(
      "Zambia 2018 DHS official data report filetype:pdf",
      [
        { url: "https://dhsprogram.com/data/dataset/Zambia_Standard-DHS_2018.cfm", title: "Zambia DHS 2018", snippet: "Dataset" },
        { url: "https://example.gov.cn/water/report", title: "Unrelated regional water report", snippet: "Official data" },
      ],
    )).toEqual([
      { url: "https://dhsprogram.com/data/dataset/Zambia_Standard-DHS_2018.cfm", title: "Zambia DHS 2018", snippet: "Dataset" },
    ]);
  });

  it("loads local benchmark defaults while preserving explicit environment overrides", () => {
    const dir = temporaryDirectory();
    writeFileSync(join(dir, ".env.local"), "BOCHA_API_KEY=local-key\nBENCH_SEARCH_ORDER='bocha,jina'\n", "utf8");

    expect(loadBenchmarkEnvironment({ BOCHA_API_KEY: "shell-key" }, dir)).toMatchObject({
      BOCHA_API_KEY: "shell-key",
      BENCH_SEARCH_ORDER: "bocha,jina",
    });
  });

  it("uses clean task text, enforces blocked sources at provider boundaries, and writes official filenames", async () => {
    const dir = temporaryDirectory();
    let fetchCalls = 0;
    const search: SearchProvider = {
      name: "fixture-search",
      async search() {
        return [
          { url: "https://blocked.example/paper", title: "Forbidden Expert Paper", snippet: "blocked" },
          { url: "https://allowed.example/report", title: "Independent report", snippet: "allowed" },
        ];
      },
    };
    const fetch: FetchProvider = {
      name: "fixture-fetch",
      async fetchPage(url) {
        fetchCalls += 1;
        return { url, title: "Independent report", content: "Useful independent source content." };
      },
    };
    const input = task(7, {
      prompt: "WRAPPED PROMPT **important** repeated block",
      content: {
        task: "Write the actual benchmark report.",
        rubric: { info_recall: ["fact"], analysis: [], presentation: [] },
        blocked: { title: "Forbidden Expert Paper", urls: ["https://blocked.example/paper"] },
      },
    });
    const adapter = new DeepResearchBenchIIAdapter({
      queryPath: join(dir, "tasks.jsonl"),
      outputDir: join(dir, "reports", "model"),
      env: {},
      searchProvider: search,
      fetchProvider: fetch,
    });

    const submission = adapter.toTaskSubmission(input, taskEnv());
    expect(submission.userInput).toContain("Write the actual benchmark report.");
    expect(submission.userInput).not.toContain("WRAPPED PROMPT");
    expect(submission.userInput.match(/https:\/\/blocked\.example\/paper/g)).toHaveLength(1);

    const profile = adapter.buildToolProfile(input, taskEnv());
    await expect(profile.searchProvider.search("query", 5)).resolves.toEqual([
      { url: "https://allowed.example/report", title: "Independent report", snippet: "allowed" },
    ]);
    await expect(profile.fetchProvider?.fetchPage("https://blocked.example/paper")).rejects.toThrow("blocked reference URL");
    expect(fetchCalls).toBe(0);
    await expect(profile.fetchProvider?.fetchPage("https://allowed.example/report")).resolves.toMatchObject({ url: "https://allowed.example/report" });
    expect(fetchCalls).toBe(1);

    const output = await adapter.renderOutput({ artifact: { reportMd: "# report" } } as FrameworkRunResult, input);
    expect(output.reportPath).toBe(join(dir, "reports", "model", "idx-7.md"));
    expect(readFileSync(output.reportPath, "utf8")).toBe("# report");
    await adapter.writeOutputs([output], { modelName: "model", outputDir: join(dir, "reports", "model") });
    expect(JSON.parse(readFileSync(join(dir, "reports", "model", "manifest.json"), "utf8"))).toEqual([output]);
    const emptyOutputDir = join(dir, "failed-run-output");
    await adapter.writeOutputs([], { modelName: "model", outputDir: emptyOutputDir });
    expect(JSON.parse(readFileSync(join(emptyOutputDir, "manifest.json"), "utf8"))).toEqual([]);
  });

  it("aggregates official three-way rubric scores with leaderboard weighting", () => {
    const dir = temporaryDirectory();
    const input = task(8, {
      content: {
        task: "Benchmark task",
        rubric: {
          info_recall: ["fact one", "fact two"],
          analysis: ["analysis one"],
          presentation: ["presentation one"],
        },
      },
    });
    const resultPath = join(dir, "official.jsonl");
    writeFileSync(resultPath, `${JSON.stringify({
      model: "model-a",
      idx: 8,
      result: {
        scores: {
          info_recall: {
            "fact one": { score: 1 },
            "fact two": { score: 0 },
          },
          analysis: { "analysis one": { score: -1 } },
          presentation: { "presentation one": { score: 1 } },
        },
        usage_summary: { total_tokens: 123 },
      },
    })}\n`, "utf8");

    const score = aggregateDeepResearchBenchIIOfficialScores(resultPath, [input]);

    expect(score.tasks[0]?.dimensions.info_recall.passPercent).toBe(50);
    expect(score.aggregate.total).toMatchObject({ rubricCount: 4, passedCount: 2, blockedCount: 1, passPercent: 50, blockedRate: 0.25 });
    expect(score.leaderboardComparable).toBe(false);
  });

  it("writes a reproducible random selection manifest without requiring model providers", async () => {
    const dir = temporaryDirectory();
    const queryPath = join(dir, "tasks.jsonl");
    const traceRoot = join(dir, "trace");
    writeFileSync(queryPath, [task(1), task(2), task(3)].map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");

    await runDeepResearchBenchIICli({
      argv: [
        "node", "cli",
        "--queryPath", queryPath,
        "--traceRoot", traceRoot,
        "--seed", "manifest-seed",
        "--maxRounds", "3",
        "--maxSubAgentTurns", "15",
        "--subAgentMaxTokens", "7777",
        "--reportMaxTokens", "9999",
        "--select-only",
      ],
      env: {},
      repoRoot: dir,
      workspaceRoot: dir,
    });

    const manifest = JSON.parse(readFileSync(join(traceRoot, "benchmark-run.json"), "utf8")) as {
      status: string;
      seed: string;
      selectionMode: string;
      selectedTasks: unknown[];
      dataset: { taskCount: number; sha256: string };
      generation: { maxRounds: number; maxSubAgentTurns: number; subAgentMaxTokens: number; reportMaxTokens: number };
    };
    expect(manifest).toMatchObject({ status: "selected", seed: "manifest-seed", selectionMode: "random" });
    expect(manifest.selectedTasks).toHaveLength(1);
    expect(manifest.dataset.taskCount).toBe(3);
    expect(manifest.dataset.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.generation).toMatchObject({
      maxRounds: 3,
      maxSubAgentTurns: 15,
      subAgentMaxTokens: 7777,
      reportMaxTokens: 9999,
    });
  });

  it("routes CLI progress logs into the injected logger instead of console", async () => {
    const dir = temporaryDirectory();
    const queryPath = join(dir, "tasks.jsonl");
    const traceRoot = join(dir, "trace");
    writeFileSync(queryPath, [task(1), task(2), task(3)].map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
    const captured: string[] = [];
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      await runDeepResearchBenchIICli({
        argv: ["node", "cli", "--queryPath", queryPath, "--traceRoot", traceRoot, "--seed", "logger-seed", "--select-only"],
        env: {},
        repoRoot: dir,
        workspaceRoot: dir,
        logger: { info: (message) => captured.push(message) },
      });
      expect(captured).toEqual([
        expect.stringMatching(/^Selected 1\/3 DeepResearch Bench II task\(s\): /),
        "Selection seed: logger-seed (random)",
        expect.stringMatching(/^Dataset SHA-256: [a-f0-9]{64}$/),
        expect.stringMatching(/^Selection manifest: /),
      ]);
      expect(consoleLog).not.toHaveBeenCalled();
    } finally {
      consoleLog.mockRestore();
    }
  });

  it("restores task selection and generation settings from a benchmark checkpoint", async () => {
    const dir = temporaryDirectory();
    const queryPath = join(dir, "tasks.jsonl");
    const traceRoot = join(dir, "trace");
    const episodeId = "deepresearch-bench-ii_7_resume";
    const checkpointDir = join(traceRoot, episodeId, "checkpoints");
    const checkpointPath = join(checkpointDir, "latest.json");
    const reportRoot = join(traceRoot, "official-input");
    const outputDir = join(reportRoot, "saved-model");
    const historyPath = join(dir, "history.jsonl");
    mkdirSync(checkpointDir, { recursive: true });
    writeFileSync(queryPath, `${JSON.stringify(task(7))}\n`, "utf8");
    writeFileSync(checkpointPath, JSON.stringify({
      version: 1,
      savedAt: "2026-07-15T00:00:00.000Z",
      cursor: { stage: "after_dispatch", nextCycle: 2, pass: 1 },
      state: {
        submission: { sessionId: "S_DRB2_7", userInput: "Research task 7" },
        runtimeProfile: {},
        episodeId,
        startedAt: "2026-07-15T00:00:00.000Z",
        agentResults: [],
        fetchCache: [],
      },
      stack: {
        reportNodes: [],
        knowledgeNodes: [],
        evidenceLinks: [],
        openGaps: [],
        reportlets: [],
        tasks: [],
        events: [],
      },
    }), "utf8");
    const originalManifest = {
      version: 2,
      benchmark: "DeepResearch Bench II",
      status: "failed",
      modelName: "saved-model",
      seed: "saved-seed",
      selectedTasks: [{ idx: 7 }],
      dataset: { path: queryPath },
      traceRoot,
      reportRoot,
      outputDir,
      historyPath,
      generation: {
        llmProvider: "deepseek",
        maxUsd: 6,
        maxRounds: 4,
        maxParallelBranches: 3,
        maxDepth: 3,
        maxSubbranchesPerParent: 2,
        maxSubAgentTurns: 15,
        subAgentMode: "react",
        subAgentMaxTokens: 7_777,
        subAgentContextMaxChars: 48_000,
        synthesizeReport: true,
        reportMaxTokens: 9_999,
        reporterReAct: true,
        reporterMaxTurns: 5,
        concurrency: 1,
        rateLimitCooldownMs: 5_000,
      },
    };
    writeFileSync(join(traceRoot, "benchmark-run.json"), JSON.stringify(originalManifest), "utf8");

    await runDeepResearchBenchIICli({
      argv: ["node", "cli", "--resume", checkpointPath, "--select-only"],
      env: {},
      repoRoot: dir,
      workspaceRoot: dir,
    });

    const resumeManifests = readdirSync(traceRoot).filter((name) => /^benchmark-resume-.+\.json$/u.test(name));
    expect(resumeManifests).toHaveLength(1);
    const resumeManifest = JSON.parse(readFileSync(join(traceRoot, resumeManifests[0]!), "utf8")) as Record<string, any>;
    expect(resumeManifest).toMatchObject({
      status: "selected",
      modelName: "saved-model",
      seed: "saved-seed",
      selectionMode: "explicit",
      traceRoot,
      reportRoot,
      outputDir,
      generation: {
        maxRounds: 4,
        maxSubAgentTurns: 15,
        subAgentMaxTokens: 7_777,
        reportMaxTokens: 9_999,
      },
      resumedFrom: {
        episodeId,
        checkpointPath,
        sourceManifestPath: join(traceRoot, "benchmark-run.json"),
      },
    });
    expect(resumeManifest.selectedTasks).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(traceRoot, "benchmark-run.json"), "utf8"))).toEqual(originalManifest);

    writeFileSync(join(traceRoot, "benchmark-run.json"), JSON.stringify({
      ...originalManifest,
      dataset: { path: queryPath, sha256: "0".repeat(64) },
    }), "utf8");
    await expect(runDeepResearchBenchIICli({
      argv: ["node", "cli", "--resume", checkpointPath, "--select-only"],
      env: {},
      repoRoot: dir,
      workspaceRoot: dir,
    })).rejects.toThrow("different Bench II dataset revision");
  });
});

function temporaryDirectory(): string {
  const dir = mkdtempSync(join(tmpdir(), "drb2-harness-"));
  dirs.push(dir);
  return dir;
}

function task(idx: number, override: Partial<DeepResearchBenchIITaskRecord> = {}): DeepResearchBenchIITaskRecord {
  return {
    id: `task-${idx}`,
    idx,
    language: "en",
    theme: "Test",
    description: `Task ${idx}`,
    prompt: `Research task ${idx}`,
    content: {
      task: `Research task ${idx}`,
      rubric: { info_recall: [], analysis: [], presentation: [] },
      blocked: { urls: [] },
    },
    license: "CC BY 4.0",
    ...override,
  };
}

function taskEnv() {
  return {
    episodeId: "EP_test",
    maxUsd: 1,
    maxRounds: 1,
    maxParallelBranches: 1,
    maxDepth: 1,
    maxSubbranchesPerParent: 1,
  };
}
