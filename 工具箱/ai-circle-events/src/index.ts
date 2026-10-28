import { resolveWorkerConfig, type WorkerEnvironment } from "./config";
import { GeminiClient } from "./gemini";
import { FxTwitterProvider } from "./providers/fxtwitter";
import { runPipeline, type PipelineResult } from "./pipeline";
import { SiteClient } from "./site-client";
import type { KVStore } from "./kv";

export interface WorkerBindings extends WorkerEnvironment {
  AI_EVENTS_KV?: KVStore;
}

export interface WorkerDependencies {
  run?: (environment: WorkerBindings) => Promise<PipelineResult | unknown>;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

interface ScheduledController {
  cron: string;
  scheduledTime: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function errorType(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}

async function matchesToken(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualDigest, expectedDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const actualBytes = new Uint8Array(actualDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}

async function runConfiguredPipeline(environment: WorkerBindings): Promise<PipelineResult> {
  const config = resolveWorkerConfig(environment);
  if (!environment.AI_EVENTS_KV) {
    throw new Error("AI_EVENTS_KV is required");
  }

  const provider = new FxTwitterProvider({ baseUrl: config.fxTwitterBaseUrl });
  const gemini = new GeminiClient({ apiKey: config.geminiApiKey, model: config.geminiModel });
  const site = new SiteClient({ endpoint: config.siteApiUrl, token: config.sitePushToken });
  return runPipeline({
    kv: environment.AI_EVENTS_KV,
    provider,
    gemini,
    site,
    modelName: config.geminiModel,
  });
}

export function createWorker(dependencies: WorkerDependencies = {}) {
  const run = dependencies.run ?? runConfiguredPipeline;

  return {
    async fetch(request: Request, environment: WorkerBindings): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname === "/health" && request.method === "GET") {
        return jsonResponse({ status: "ok", version: "0.1.0" });
      }
      if (url.pathname !== "/trigger" || request.method !== "POST") {
        return jsonResponse({ error: "not_found" }, 404);
      }

      const expectedToken = environment.MANUAL_TRIGGER_TOKEN?.trim();
      if (!expectedToken) {
        return jsonResponse({ error: "manual_trigger_not_configured" }, 503);
      }
      const authorization = request.headers.get("authorization") ?? "";
      const match = /^Bearer ([^\s]+)$/i.exec(authorization);
      if (!match || !(await matchesToken(match[1], expectedToken))) {
        return jsonResponse({ error: "unauthorized" }, 401);
      }

      try {
        return jsonResponse(await run(environment));
      } catch (error) {
        console.error(JSON.stringify({ event: "manual_run_failed", errorType: errorType(error) }));
        return jsonResponse({ error: "pipeline_failed" }, 502);
      }
    },

    scheduled(
      _controller: ScheduledController,
      environment: WorkerBindings,
      context: WorkerExecutionContext,
    ): void {
      context.waitUntil(
        run(environment).catch((error: unknown) => {
          console.error(JSON.stringify({ event: "scheduled_run_failed", errorType: errorType(error) }));
        }),
      );
    },
  };
}

const worker = createWorker();
export default worker;
