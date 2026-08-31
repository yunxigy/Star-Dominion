import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import type { EpisodeResult, LlmChat, MemoryEvent } from "@deepresearch/contracts";
import { createResearchHttpHandler, ResearchRunConflictError } from "../node-http.js";
import { createSqliteResearchRunStore } from "../sqlite-run-store.js";
import type { ResearchRunSummary } from "../research-api.js";

const dirs: string[] = [];

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("SqliteResearchRunStore", () => {
  it("preserves stable run metadata, replay data, and episode mapping across instances", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-run-store-"));
    dirs.push(dir);
    const dbPath = join(dir, "runs.sqlite");
    const controller = new AbortController();
    const first = createSqliteResearchRunStore({ dbPath, ownerId: "worker-a" });
    first.create({ runId: "RUN_stable", prompt: "Persistent run", controller });
    first.appendEvent("RUN_stable", event("episode_started"));
    first.appendEvent("RUN_stable", event("checkpoint_saved", {
      path: "/artifacts/EP_stable/checkpoints/latest.json",
      stage: "after_scout",
      nextCycle: 1,
      pass: 1,
    }));
    first.appendFrame("RUN_stable", frame("Planning"));
    first.finish("RUN_stable", result(), summary());
    first.close();

    const second = createSqliteResearchRunStore({ dbPath, ownerId: "worker-b" });
    const restored = second.get("RUN_stable");
    expect(restored).toMatchObject({
      runId: "RUN_stable",
      episodeId: "EP_stable",
      status: "succeeded",
      prompt: "Persistent run",
      checkpointPath: "/artifacts/EP_stable/checkpoints/latest.json",
      checkpointCursor: { stage: "after_scout", nextCycle: 1 },
    });
    expect(restored?.events.map((item) => item.eventType)).toEqual(["episode_started", "checkpoint_saved"]);
    expect(restored?.frames).toEqual([frame("Planning")]);
    expect(restored?.result?.episodeId).toBe("EP_stable");
    expect(restored?.summary?.status).toBe("succeeded");
    expect(() => second.create({ runId: "RUN_stable", prompt: "collision", controller: new AbortController() }))
      .toThrow(ResearchRunConflictError);
    second.close();
  });

  it("shares cancellation state and marks expired heartbeats as interrupted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-run-store-state-"));
    dirs.push(dir);
    const dbPath = join(dir, "runs.sqlite");
    let now = Date.UTC(2026, 6, 14);
    const first = createSqliteResearchRunStore({ dbPath, ownerId: "worker-a", now: () => now, staleAfterMs: 1000 });
    first.create({ runId: "RUN_cancel", prompt: "Cancel remotely", controller: new AbortController() });
    const second = createSqliteResearchRunStore({ dbPath, ownerId: "worker-b", now: () => now, staleAfterMs: 1000 });

    second.cancel("RUN_cancel", "cancelled by peer");
    expect(first.get("RUN_cancel")).toMatchObject({ status: "cancelled", error: "cancelled by peer" });

    first.create({ runId: "RUN_stale", prompt: "Worker disappeared", controller: new AbortController() });
    now += 1001;
    expect(second.get("RUN_stale")).toMatchObject({
      status: "interrupted",
      error: "run heartbeat expired before completion",
    });
    first.close();
    second.close();
  });

  it("bounds durable replay rows without changing run state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-run-store-bounds-"));
    dirs.push(dir);
    const store = createSqliteResearchRunStore({ dbPath: join(dir, "runs.sqlite"), maxEvents: 2, maxFrames: 2 });
    store.create({ runId: "RUN_bounded", prompt: "Bound replay", controller: new AbortController() });
    for (let index = 1; index <= 4; index++) {
      store.appendEvent("RUN_bounded", { ...event(`step_${index}`), eventId: `ME_${index}` });
      store.appendFrame("RUN_bounded", frame(`frame ${index}`));
    }

    expect(store.get("RUN_bounded")?.events.map((item) => item.eventType)).toEqual(["step_3", "step_4"]);
    expect(store.get("RUN_bounded")?.frames.map((item) => item.line)).toEqual(["frame 3", "frame 4"]);
    expect(store.get("RUN_bounded")?.status).toBe("running");
    store.close();
  });

  it("propagates cancellation from a peer HTTP worker to the owning worker", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dr-run-store-cancel-http-"));
    dirs.push(dir);
    const dbPath = join(dir, "runs.sqlite");
    const ownerStore = createSqliteResearchRunStore({ dbPath, ownerId: "worker-owner" });
    const peerStore = createSqliteResearchRunStore({ dbPath, ownerId: "worker-peer" });
    const owner = await startServer(ownerStore, blockingLlm());
    const peer = await startServer(peerStore, blockingLlm());
    try {
      const runningResponse = await fetch(`${owner.url}/research`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ runId: "RUN_remote_cancel", prompt: "Wait until a peer cancels this run." }),
      });
      expect(runningResponse.status).toBe(200);

      const cancelResponse = await fetch(`${peer.url}/research/RUN_remote_cancel/cancel`, { method: "POST" });
      expect(cancelResponse.status).toBe(202);
      await waitUntil(() => ownerStore.get("RUN_remote_cancel")?.controller.signal.aborted === true);

      expect(ownerStore.get("RUN_remote_cancel")).toMatchObject({
        status: "cancelled",
        error: "cancelled by API request",
      });
      await expect(runningResponse.text()).resolves.toContain("event: error");
    } finally {
      await closeServer(owner.server);
      await closeServer(peer.server);
      ownerStore.close();
      peerStore.close();
    }
  });
});

async function startServer(
  runStore: ReturnType<typeof createSqliteResearchRunStore>,
  llm: LlmChat,
): Promise<{ server: Server; url: string }> {
  const server = createServer(createResearchHttpHandler({
    env: {},
    runStore,
    defaults: { llm, searchProvider: "none", streamMode: "off", maxCycles: 1 },
  }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function blockingLlm(): LlmChat {
  return {
    name: "blocking-test-llm",
    async chat(req) {
      return await new Promise((_, reject) => {
        const fail = () => reject(new Error(String(req.signal?.reason || "aborted")));
        if (req.signal?.aborted) fail();
        else req.signal?.addEventListener("abort", fail, { once: true });
      });
    },
  };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("condition was not met before timeout");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function event(eventType: string, payload: Record<string, unknown> = {}): MemoryEvent {
  return {
    eventId: `ME_${eventType}`,
    eventType,
    episodeId: "EP_stable",
    timestamp: "2026-07-14T00:00:00.000Z",
    payload,
  };
}

function frame(line: string) {
  return { kind: "summary" as const, line, event: event(`frame_${line}`) };
}

function result(): EpisodeResult {
  return {
    episodeId: "EP_stable",
    status: "succeeded",
    reportArtifactPath: "/artifacts/EP_stable/report.md",
    metrics: {
      reportNodeCount: 1,
      knowledgeNodeCount: 1,
      evidenceLinkCount: 1,
      completedTaskCount: 1,
      openGapCount: 0,
      citationCount: 1,
      rubricIssueCount: 0,
      publishGatePassed: true,
    },
    closedAt: "2026-07-14T00:01:00.000Z",
  };
}

function summary(): ResearchRunSummary {
  return {
    status: "succeeded",
    episodeId: "EP_stable",
    report: "/artifacts/EP_stable/report.md",
    checkpoint: "/artifacts/EP_stable/checkpoints/latest.json",
    filesExist: {
      report: true,
      evidenceIndex: false,
      trace: true,
      fullTrace: false,
      checkpoint: true,
    },
    metrics: result().metrics,
  };
}
