import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import type { EpisodeResult, LlmChat, SearchProvider } from "@deepresearch/contracts";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createInMemoryResearchRunStore, createResearchHttpHandler } from "../index.js";
import { buildResearchHttpInput } from "../node-http.js";

describe("research Node HTTP handler", () => {
  const dirs: string[] = [];
  const servers: Server[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("serves health checks", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("protects research metadata and execution with a configured API token while keeping health public", async () => {
    const { url } = await startServer({ apiToken: "secret-token" });

    expect((await fetch(`${url}/healthz`)).status).toBe(200);
    const anonymous = await fetch(`${url}/research`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "unauthorized" });
    const authorized = await fetch(`${url}/research`, { headers: { authorization: "Bearer secret-token" } });
    expect(authorized.status).toBe(200);
  });

  it("accepts x-api-key authentication", async () => {
    const { url } = await startServer({ apiToken: "secret-token" });
    const response = await fetch(`${url}/research`, { headers: { "x-api-key": "secret-token" } });
    expect(response.status).toBe(200);
  });

  it("rate limits expensive research starts per client", async () => {
    const { url } = await startServer({ maxResearchStartsPerMinute: 1 });
    const first = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "first bounded run" }),
    });
    expect(first.status).toBe(200);
    await first.text();

    const second = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "second bounded run" }),
    });
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBeTruthy();
    expect(await second.json()).toMatchObject({ error: "research_start_rate_limited" });
  });

  it("rejects a new run when the concurrent run limit is reached", async () => {
    const store = createInMemoryResearchRunStore();
    store.create({ runId: "RUN_already_active", prompt: "active", controller: new AbortController() });
    const { url } = await startServer({ runStore: store, maxConcurrentRuns: 1 });
    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "must wait" }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "concurrent research run limit reached (1)" });
    expect(store.list()).toHaveLength(1);
  });

  it("caps client-supplied execution budgets", async () => {
    const { url } = await startServer({ requestCaps: { maxCycles: 2, maxEpisodeCostUsd: 1 } });
    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "bounded request", maxCycles: 99, maxCostUsd: 999 }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('"maxCycles":2');
  });

  it("ignores client artifact directories and rejects resume checkpoints outside the server artifact root", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-boundary-"));
    dirs.push(artifactDir);
    const mapped = buildResearchHttpInput(
      { prompt: "path boundary", artifactDir: "/tmp/client-selected" },
      {} as never,
      { defaults: { artifactDir } },
      new AbortController().signal,
    );
    expect(mapped.artifactDir).toBe(artifactDir);

    const { url } = await startServer({ artifactDir });
    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "unsafe resume", resumeCheckpointPath: "/tmp/outside/latest.json" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "resume checkpoint must be inside the configured artifact directory" });
  });

  it("validates research request bodies before opening SSE", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "prompt is required" });
  });

  it("rejects duplicate run ids without mutating the existing run", async () => {
    const store = createInMemoryResearchRunStore();
    store.create({ runId: "RUN_existing", prompt: "original", controller: new AbortController() });
    const { url } = await startServer({ runStore: store });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "RUN_existing", prompt: "replacement" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "runId already exists: RUN_existing" });
    expect(store.get("RUN_existing")).toMatchObject({ status: "running", prompt: "original" });
  });

  it("rejects run ids that could escape artifact or storage namespaces", async () => {
    const { url } = await startServer();
    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId: "../outside", prompt: "invalid run id" }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "runId must be 1-128 characters using letters, numbers, dot, underscore, or hyphen",
    });
  });

  it("lists stored research runs newest first without replay payloads", async () => {
    const store = createInMemoryResearchRunStore();
    store.create({ runId: "RUN_old", prompt: "older run", controller: new AbortController() });
    await new Promise((resolve) => setTimeout(resolve, 2));
    store.create({ runId: "RUN_new", prompt: "newer run", controller: new AbortController() });
    const { url } = await startServer({ runStore: store });

    const response = await fetch(`${url}/research`);

    expect(response.status).toBe(200);
    const body = await response.json() as { runs: Array<{ runId: string; frames?: unknown[]; events?: unknown[] }> };
    expect(body.runs.map((run) => run.runId)).toEqual(["RUN_new", "RUN_old"]);
    expect(body.runs[0]?.frames).toBeUndefined();
    expect(body.runs[0]?.events).toBeUndefined();
  });

  it("treats needs_human_review as a terminal run status", () => {
    const store = createInMemoryResearchRunStore();
    store.create({ runId: "RUN_review", prompt: "review needed", controller: new AbortController() });
    const result: EpisodeResult = {
      episodeId: "EP_review",
      status: "needs_human_review",
      reportArtifactPath: "/tmp/incomplete-report.md",
      closedAt: "2026-07-07T00:00:00.000Z",
      metrics: {
        reportNodeCount: 1,
        knowledgeNodeCount: 0,
        evidenceLinkCount: 0,
        completedTaskCount: 0,
        openGapCount: 1,
        citationCount: 0,
        rubricIssueCount: 0,
        publishGatePassed: false,
      },
    };

    store.finish("RUN_review", result, {
      status: "needs_human_review",
      episodeId: "EP_review",
      report: "/tmp/incomplete-report.md",
      filesExist: { report: false, evidenceIndex: false, trace: false, fullTrace: false, checkpoint: false },
      metrics: result.metrics,
    });

    expect(store.get("RUN_review")?.status).toBe("needs_human_review");
  });

  it("loads incomplete report artifacts as needs_human_review, not running or interrupted", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-review-artifact-"));
    dirs.push(artifactDir);
    const episodeDir = join(artifactDir, "EP_review_artifact");
    await mkdir(episodeDir, { recursive: true });
    await writeFile(join(episodeDir, "incomplete-report.md"), "# Incomplete\n\nNeeds more work.", "utf8");
    const { url } = await startServer({ artifactDir });

    const response = await fetch(`${url}/research/EP_review_artifact`);

    expect(response.status).toBe(200);
    const body = await response.json() as { status: string; result?: { status?: string } };
    expect(body.status).toBe("needs_human_review");
    expect(body.result?.status).toBe("needs_human_review");
  });

  it("maps report budget overrides from HTTP request bodies", () => {
    const input = buildResearchHttpInput(
      {
        prompt: "budget mapping",
        maxCycles: 30,
        reportMaxTokens: 24576,
        reportMaxCalls: 96,
        reportContextTokenLimit: 96000,
        evidenceTargetSteps: 80,
        evidenceTargetFetchCalls: 40,
        maxCostUsd: 9.5,
        maxLlmRequests: 50,
        maxTotalTokens: 250000,
        adaptiveBudget: false,
        humanReview: true,
        evidenceQualityMode: "strict",
      },
      {} as never,
      {},
      new AbortController().signal,
    );

    expect(input.maxCycles).toBe(30);
    expect(input.reportMaxTokens).toBe(24576);
    expect(input.reportMaxCalls).toBe(96);
    expect(input.reportContextTokenLimit).toBe(96000);
    expect(input.evidenceTargetSteps).toBe(80);
    expect(input.evidenceTargetFetchCalls).toBe(40);
    expect(input.maxEpisodeCostUsd).toBe(9.5);
    expect(input.maxLlmRequests).toBe(50);
    expect(input.maxEpisodeTokens).toBe(250000);
    expect(input.adaptiveBudget).toBe(false);
    expect(input.humanReview).toBe(true);
    expect(input.evidenceQualityMode).toBe("strict");
  });

  it("maps human review responses only when a resume checkpoint is supplied", () => {
    const signal = new AbortController().signal;
    const response = {
      submittedBy: "reviewer",
      decisions: [{ questionId: "quality_1", action: "accept_risk", rationale: "Accepted for this scope." }],
    };
    const input = buildResearchHttpInput(
      { resume: "/tmp/checkpoints/latest.json", reviewResponse: response },
      {} as never,
      {},
      signal,
    );

    expect(input.resumeCheckpointPath).toBe("/tmp/checkpoints/latest.json");
    expect(input.humanReviewResponse).toEqual(response);
    expect(() => buildResearchHttpInput(
      { prompt: "new run", humanReviewResponse: response },
      {} as never,
      {},
      signal,
    )).toThrow("humanReviewResponse requires resumeCheckpointPath");
  });

  it("streams research over SSE with injected backend defaults", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-"));
    dirs.push(artifactDir);
    const { url } = await startServer({ artifactDir });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Node HTTP handler backend smoke research task",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const text = await response.text();
    expect(text).toContain("event: frame\n");
    expect(text).toContain("event: result\n");
    expect(text).toContain("\"status\":\"succeeded\"");
  });

  it("replays completed run events and visual frames", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-replay-"));
    dirs.push(artifactDir);
    const { url } = await startServer({ artifactDir });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Replayable backend smoke research task",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    const runId = text.match(/"runId":"([^"]+)"/)?.[1];
    expect(runId).toBeTruthy();

    const statusResponse = await fetch(`${url}/research/${runId}`);
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json() as { status: string; counts: { frames: number; visualEvents: number } };
    expect(status.status).toBe("succeeded");
    expect(status.counts.frames).toBeGreaterThan(0);
    expect(status.counts.visualEvents).toBeGreaterThan(0);

    const replayResponse = await fetch(`${url}/research/${runId}/events`);
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as { frames: unknown[]; visualEvents: unknown[] };
    expect(replay.frames.length).toBeGreaterThan(0);
    expect(replay.visualEvents.length).toBeGreaterThan(0);
  });

  it("hydrates history and replay payloads from artifact files after memory is lost", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-hydrate-"));
    dirs.push(artifactDir);
    const { url } = await startServer({ artifactDir });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Artifact-backed replay should survive process memory loss",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    const episodeId = text.match(/"episodeId":"([^"]+)"/)?.[1];
    expect(episodeId).toBeTruthy();
    await writeFile(join(artifactDir, episodeId!, "checkpoints", "latest.json"), "{interrupted", "utf8");

    const coldStore = createInMemoryResearchRunStore();
    const { url: coldUrl } = await startServer({ artifactDir, runStore: coldStore });

    const historyResponse = await fetch(`${coldUrl}/research`);
    expect(historyResponse.status).toBe(200);
    const history = await historyResponse.json() as { runs: Array<{ runId: string; artifactBacked?: boolean; checkpointPath?: string; checkpointCursor?: { nextCycle?: number } }> };
    const hydrated = history.runs.find((run) => run.runId === episodeId);
    expect(hydrated?.artifactBacked).toBe(true);
    expect(hydrated?.checkpointPath).toMatch(/\/\d{13}_.+\.json$/);
    expect(hydrated?.checkpointCursor?.nextCycle).toBeGreaterThan(0);

    const replayResponse = await fetch(`${coldUrl}/research/${episodeId}/events`);
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as { frames: Array<{ event?: { eventType?: string } }>; resumeCheckpointPath?: string; checkpointCursor?: { nextCycle?: number } };
    expect(replay.frames.length).toBeGreaterThan(0);
    expect(replay.frames.some((frame) => frame.event?.eventType === "full.kg.upsertKnowledgeNode")).toBe(true);
    expect(replay.resumeCheckpointPath).toBe(hydrated?.checkpointPath);
    expect(replay.checkpointCursor?.nextCycle).toBeGreaterThan(0);

    const reportResponse = await fetch(`${coldUrl}/research/${episodeId}/report`);
    expect(reportResponse.status).toBe(200);
    expect(await reportResponse.text()).toContain("Deep Research Report");
  });

  it("replays checkpoint graph state after trace events so graphs show final evidence ownership", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-graph-replay-"));
    dirs.push(artifactDir);
    const episodeDir = join(artifactDir, "EP_graph_replay_test");
    await mkdir(join(episodeDir, "checkpoints"), { recursive: true });
    await writeFile(join(episodeDir, "report.md"), "# Final\n", "utf8");
    await writeFile(join(episodeDir, "trace-full.jsonl"), `${JSON.stringify({
      eventId: "ME_old_link",
      episodeId: "EP_graph_replay_test",
      timestamp: "2026-07-07T00:00:01.000Z",
      eventType: "full.kg.upsertEvidenceLink",
      reportNodeId: "R_a",
      payload: {
        link: {
          linkId: "E_shared",
          reportNodeId: "R_a",
          knowledgeNodeId: "K_shared",
          relation: "supports",
          claimText: "old owner",
          confidence: 0.5,
          createdByTaskId: "T_a",
          createdAt: "2026-07-07T00:00:01.000Z",
        },
      },
    })}\n`, "utf8");
    await writeFile(join(episodeDir, "checkpoints", "latest.json"), JSON.stringify({
      version: 1,
      savedAt: "2026-07-07T00:00:02.000Z",
      state: {
        startedAt: "2026-07-07T00:00:00.000Z",
        closedAt: "2026-07-07T00:00:02.000Z",
        submission: { userInput: "graph replay" },
        runtimeProfile: { artifactDir },
        episodeId: "EP_graph_replay_test",
        agentResults: [],
        fetchCache: [],
      },
      cursor: { stage: "after_root", nextCycle: 1, pass: 1 },
      stack: {
        events: [],
        tasks: [],
        openGaps: [],
        reportNodes: [
          { nodeId: "R_a", parentNodeId: "R_root", nodeKind: "hypothesis", label: "Old", status: "planned", coverage: {} },
          { nodeId: "R_b", parentNodeId: "R_root", nodeKind: "hypothesis", label: "Final", status: "supported", coverage: {} },
        ],
        knowledgeNodes: [
          { nodeId: "K_shared", nodeType: "WebPage", title: "Shared source", url: "https://example.test/shared", summary: "", sourceTier: "secondary", qualityScore: 0.8, retrievedAt: "2026-07-07T00:00:01.000Z", metadata: {} },
        ],
        evidenceLinks: [
          { linkId: "E_shared", reportNodeId: "R_b", knowledgeNodeId: "K_shared", relation: "supports", claimText: "final owner", confidence: 0.9, createdByTaskId: "T_a", createdAt: "2026-07-07T00:00:01.000Z" },
        ],
      },
    }), "utf8");
    const { url } = await startServer({ artifactDir, runStore: createInMemoryResearchRunStore() });

    const replayResponse = await fetch(`${url}/research/EP_graph_replay_test/events`);

    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as { frames: Array<{ event?: { eventType?: string; payload?: { link?: { linkId?: string; reportNodeId?: string } } } }> };
    const links = new Map<string, string>();
    for (const frame of replay.frames) {
      const link = frame.event?.payload?.link;
      if (link?.linkId && frame.event?.eventType?.includes("kg.")) links.set(link.linkId, link.reportNodeId ?? "");
    }
    expect(links.get("E_shared")).toBe("R_b");
  });

  it("replays compact checkpoint event sidecars when trace artifacts do not exist", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-compact-replay-"));
    dirs.push(artifactDir);
    const episodeId = "EP_compact_replay_test";
    const episodeDir = join(artifactDir, episodeId);
    const checkpointDir = join(episodeDir, "checkpoints");
    await mkdir(checkpointDir, { recursive: true });
    await writeFile(join(episodeDir, "report-draft.md"), "# Draft\n", "utf8");
    const event = {
      eventId: "ME_compact_replay",
      episodeId,
      timestamp: "2026-07-10T00:00:01.000Z",
      eventType: "episode_started",
      payload: { objective: "compact replay" },
    };
    await writeFile(join(checkpointDir, "events.jsonl.gz"), gzipSync(JSON.stringify(event)));
    await writeFile(join(checkpointDir, "latest.json"), JSON.stringify({
      version: 2,
      savedAt: "2026-07-10T00:00:02.000Z",
      state: {
        startedAt: "2026-07-10T00:00:00.000Z",
        submission: { userInput: "compact replay" },
        runtimeProfile: { artifactDir },
        episodeId,
        agentResults: [],
        fetchCache: [],
      },
      cursor: { stage: "after_root", nextCycle: 1, pass: 1 },
      stack: { tasks: [], openGaps: [], reportlets: [], reportNodes: [], knowledgeNodes: [], evidenceLinks: [] },
      eventStore: { path: "events.jsonl.gz", encoding: "gzip-jsonl", count: 1 },
    }), "utf8");
    const { url } = await startServer({ artifactDir, runStore: createInMemoryResearchRunStore() });

    const replayResponse = await fetch(`${url}/research/${episodeId}/events`);
    expect(replayResponse.status).toBe(200);
    const replay = await replayResponse.json() as { frames: Array<{ event?: { eventType?: string }; line?: string }> };
    expect(replay.frames.some((frame) => frame.event?.eventType === "episode_started")).toBe(true);
  });

  it("marks incomplete artifact-backed runs with checkpoints as needs_human_review and resumable", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-incomplete-"));
    dirs.push(artifactDir);
    const episodeDir = join(artifactDir, "EP_incomplete_test");
    await mkdir(join(episodeDir, "checkpoints"), { recursive: true });
    await writeFile(join(episodeDir, "incomplete-report.md"), "# Incomplete\n", "utf8");
    await writeFile(join(episodeDir, "checkpoints", "latest.json"), JSON.stringify({
      version: 1,
      savedAt: "2026-07-07T00:00:00.000Z",
      state: {
        startedAt: "2026-07-07T00:00:00.000Z",
        submission: { userInput: "recover me" },
        runtimeProfile: { artifactDir },
        episodeId: "EP_incomplete_test",
        agentResults: [],
        fetchCache: [],
      },
      cursor: { stage: "after_root", nextCycle: 1, pass: 1 },
      stack: {
        reportNodes: [],
        knowledgeNodes: [],
        evidenceLinks: [],
        openGaps: [],
        tasks: [],
        events: [],
      },
    }), "utf8");
    await writeFile(join(episodeDir, "checkpoints", "last-error.json"), JSON.stringify({
      episodeId: "EP_incomplete_test",
      failedAt: "2026-07-07T00:01:00.000Z",
      error: { message: "DeepSeek API 402: Insufficient Balance" },
    }), "utf8");
    const { url } = await startServer({ artifactDir, runStore: createInMemoryResearchRunStore() });

    const response = await fetch(`${url}/research`);

    expect(response.status).toBe(200);
    const body = await response.json() as { runs: Array<{ runId: string; status: string; checkpointPath?: string; error?: string }> };
    const run = body.runs.find((item) => item.runId === "EP_incomplete_test");
    expect(run?.status).toBe("needs_human_review");
    expect(run?.checkpointPath).toContain("latest.json");
    expect(run?.error).toContain("Insufficient Balance");
  });

  it("starts a resumed research run from an artifact checkpoint over HTTP", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-resume-"));
    dirs.push(artifactDir);
    const { url } = await startServer({ artifactDir });

    const initialResponse = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "HTTP resume checkpoint source task",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });
    expect(initialResponse.status).toBe(200);
    const initialText = await initialResponse.text();
    const checkpoint = initialText.match(/"checkpoint":"([^"]+)"/)?.[1];
    expect(checkpoint).toContain("checkpoints/latest.json");

    const coldStore = createInMemoryResearchRunStore();
    const { url: coldUrl } = await startServer({ artifactDir, runStore: coldStore });
    const checkpointJson = await readFile(checkpoint!, "utf8");
    const nextCycle = (JSON.parse(checkpointJson) as { cursor: { nextCycle: number } }).cursor.nextCycle;
    await writeFile(checkpoint!, "{interrupted", "utf8");
    const resumeResponse = await fetch(`${coldUrl}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Continue the previous checkpoint",
        resumeCheckpointPath: checkpoint,
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });

    expect(resumeResponse.status).toBe(200);
    const resumeText = await resumeResponse.text();
    expect(resumeText).toContain("event: frame\n");
    expect(resumeText).toContain("event: result\n");
    expect(resumeText).toContain("\"status\":\"succeeded\"");
    expect(resumeText).toContain('"maxCycles":1');
  });

  it("keeps backend research running when the SSE client disconnects", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-disconnect-"));
    dirs.push(artifactDir);
    const runStore = createInMemoryResearchRunStore();
    const { url } = await startServer({
      artifactDir,
      runStore,
      llm: delayedLlm(new EchoJsonLlm(), 5),
    });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "RUN_disconnect_test",
        prompt: "Disconnect should not cancel backend research",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });

    expect(response.status).toBe(200);
    await response.body?.cancel();

    const record = await waitForRun(runStore, "RUN_disconnect_test");
    expect(record.status).toBe("succeeded");
    expect(record.error).toBeUndefined();
    expect(record.counts.frames).toBeGreaterThan(0);
  });

  it("serves completed report and evidence artifacts by run id", async () => {
    const artifactDir = await mkdtemp(join(tmpdir(), "dr-node-http-artifacts-"));
    dirs.push(artifactDir);
    const { url } = await startServer({ artifactDir });

    const response = await fetch(`${url}/research`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Artifact serving backend smoke research task",
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    const runId = text.match(/"runId":"([^"]+)"/)?.[1];
    expect(runId).toBeTruthy();

    const reportResponse = await fetch(`${url}/research/${runId}/report`);
    expect(reportResponse.status).toBe(200);
    expect(reportResponse.headers.get("content-type")).toContain("text/markdown");
    expect(await reportResponse.text()).toContain("Deep Research Report");

    const evidenceResponse = await fetch(`${url}/research/${runId}/evidence-index`);
    expect(evidenceResponse.status).toBe(200);
    expect(evidenceResponse.headers.get("content-type")).toContain("application/json");
    const evidence = await evidenceResponse.json() as unknown[];
    expect(evidence.length).toBeGreaterThan(0);

    const qualityResponse = await fetch(`${url}/research/${runId}/evidence-quality`);
    expect(qualityResponse.status).toBe(200);
    expect(qualityResponse.headers.get("content-type")).toContain("application/json");
    const quality = await qualityResponse.json() as { version: number; mode: string; score: number; summary: { auditedLeafCount: number } };
    expect(quality).toMatchObject({ version: 1, mode: "balanced" });
    expect(quality.score).toBeGreaterThanOrEqual(0);
    expect(quality.summary.auditedLeafCount).toBeGreaterThan(0);

    const budgetResponse = await fetch(`${url}/research/${runId}/budget`);
    expect(budgetResponse.status).toBe(200);
    expect(budgetResponse.headers.get("content-type")).toContain("application/json");
    const budget = await budgetResponse.json() as { version: number; totals: { requests: number; totalTokens: number }; breaches: unknown[] };
    expect(budget.version).toBe(1);
    expect(budget.totals.requests).toBeGreaterThan(0);
    expect(budget.totals.totalTokens).toBeGreaterThan(0);
    expect(budget.breaches).toEqual([]);
  });

  it("cancels stored runs through the HTTP API", async () => {
    const store = createInMemoryResearchRunStore();
    const controller = new AbortController();
    store.create({ runId: "RUN_cancel_test", prompt: "cancel me", controller });
    const { url } = await startServer({ runStore: store });

    const response = await fetch(`${url}/research/RUN_cancel_test/cancel`, { method: "POST" });
    expect(response.status).toBe(202);
    const body = await response.json() as { status: string; error: string };
    expect(body.status).toBe("cancelled");
    expect(body.error).toBe("cancelled by API request");
    expect(controller.signal.aborted).toBe(true);
  });

  async function startServer(opts: {
    artifactDir?: string;
    runStore?: ReturnType<typeof createInMemoryResearchRunStore>;
    llm?: LlmChat;
    apiToken?: string;
    maxResearchStartsPerMinute?: number;
    maxConcurrentRuns?: number;
    requestCaps?: { maxCycles?: number; maxEpisodeCostUsd?: number };
  } = {}): Promise<{ url: string }> {
    const server = createServer(createResearchHttpHandler({
      env: {},
      runStore: opts.runStore,
      apiToken: opts.apiToken,
      maxResearchStartsPerMinute: opts.maxResearchStartsPerMinute,
      maxConcurrentRuns: opts.maxConcurrentRuns,
      requestCaps: opts.requestCaps,
      defaults: {
        artifactDir: opts.artifactDir,
        language: "en",
        maxCycles: 1,
        streamMode: "steps",
        llm: opts.llm ?? new EchoJsonLlm(),
        search: mockSearch(),
      },
    }));
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP test server address");
    return { url: `http://127.0.0.1:${address.port}` };
  }
});

async function waitForRun(
  store: ReturnType<typeof createInMemoryResearchRunStore>,
  runId: string,
): Promise<{ status: string; error?: string; counts: { frames: number } }> {
  for (let i = 0; i < 200; i++) {
    const record = store.get(runId);
    if (record && record.status !== "running") {
      return {
        status: record.status,
        error: record.error,
        counts: { frames: record.frames.length },
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${runId}`);
}

function delayedLlm(inner: LlmChat, delayMs: number): LlmChat {
  return {
    name: `testing-echo-delayed-${inner.name}`,
    async chat(req) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return inner.chat(req);
    },
  };
}

function mockSearch(): SearchProvider {
  return {
    name: "node-http-test-search",
    async search(query, topK) {
      return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
        url: `https://example.test/node-http/${index + 1}`,
        title: `HTTP source ${index + 1}`,
        snippet: `Evidence for ${query}`,
      }));
    },
  };
}
