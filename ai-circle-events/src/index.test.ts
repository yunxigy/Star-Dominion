import { describe, expect, it, vi } from "vitest";
import { createWorker } from "./index";
import type { KVStore } from "./kv";

const secret = "manual-secret-value";

function environment(overrides: Record<string, unknown> = {}) {
  return {
    MANUAL_TRIGGER_TOKEN: secret,
    AI_EVENTS_KV: {} as KVStore,
    ...overrides,
  };
}

describe("Cloudflare Worker entry", () => {
  it("returns a public health response without exposing secrets", async () => {
    const worker = createWorker({ run: vi.fn() });

    const response = await worker.fetch(
      new Request("https://worker.example/health"),
      environment({ GEMINI_API_KEY: "gemini-private" }),
    );

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ status: "ok", version: "0.1.0" });
    expect(body).not.toContain("gemini-private");
  });

  it.each([undefined, "Bearer wrong-secret-value"])(
    "does not start a manual run for an invalid bearer token (%s)",
    async (authorization) => {
      const run = vi.fn(async () => ({ status: "delivered", runId: "test-run" }));
      const worker = createWorker({ run });
      const headers = new Headers();
      if (authorization) headers.set("authorization", authorization);

      const response = await worker.fetch(
        new Request("https://worker.example/trigger", { method: "POST", headers }),
        environment(),
      );

      expect(response.status).toBe(401);
      expect(run).not.toHaveBeenCalled();
      expect(await response.text()).not.toContain(secret);
    },
  );

  it("starts a manual run only for the valid bearer token", async () => {
    const run = vi.fn(async () => ({ status: "delivered", runId: "test-run" }));
    const worker = createWorker({ run });

    const response = await worker.fetch(
      new Request("https://worker.example/trigger", {
        method: "POST",
        headers: { authorization: "Bearer " + secret },
      }),
      environment(),
    );

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({ status: "delivered", runId: "test-run" });
  });

  it("returns a generic configuration error when manual auth is not configured", async () => {
    const run = vi.fn();
    const worker = createWorker({ run });

    const response = await worker.fetch(
      new Request("https://worker.example/trigger", {
        method: "POST",
        headers: { authorization: "Bearer " + secret },
      }),
      environment({ MANUAL_TRIGGER_TOKEN: undefined }),
    );

    expect(response.status).toBe(503);
    expect(run).not.toHaveBeenCalled();
    expect(await response.text()).not.toContain(secret);
  });

  it("fails safely when execution secrets are missing", async () => {
    const worker = createWorker();
    const response = await worker.fetch(
      new Request("https://worker.example/trigger", {
        method: "POST",
        headers: { authorization: "Bearer " + secret },
      }),
      environment(),
    );

    expect(response.status).toBe(502);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ error: "pipeline_failed" });
    expect(body).not.toContain(secret);
  });

  it("returns 404 for an unknown route", async () => {
    const worker = createWorker({ run: vi.fn() });
    const response = await worker.fetch(
      new Request("https://worker.example/missing"),
      environment(),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });

  it("uses the same runner for a scheduled cron execution", async () => {
    const run = vi.fn(async () => ({ status: "delivered", runId: "cron-run" }));
    const worker = createWorker({ run });
    let scheduledPromise: Promise<unknown> | undefined;

    worker.scheduled(
      { cron: "*/15 * * * *", scheduledTime: Date.now() },
      environment(),
      { waitUntil(promise) { scheduledPromise = promise; }, passThroughOnException() {} },
    );
    await scheduledPromise;

    expect(run).toHaveBeenCalledTimes(1);
  });
});
