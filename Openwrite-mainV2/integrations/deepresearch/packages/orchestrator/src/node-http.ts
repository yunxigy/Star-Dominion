import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { open } from "node:fs/promises";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import type { EpisodeResult, HumanReviewRequest, MemoryEvent } from "@deepresearch/contracts";
import { inspectResearchCheckpoint, readResearchCheckpointEvents, type ResearchCheckpoint } from "./checkpoint.js";
import { runResearch, type ResearchRunInput, type ResearchRunSummary } from "./research-api.js";
import { encodeResearchSse, researchSseHeaders, writeResearchSseMessage } from "./sse.js";
import { ResearchStreamRenderer, type ResearchStreamFrame } from "./stream-renderer.js";
import { abortError } from "@deepresearch/net-utils";

const MAX_STORED_RUN_EVENTS = 6000;
const MAX_STORED_RUN_FRAMES = 3000;
const MAX_REPLAY_TRACE_BYTES = 8 * 1024 * 1024;
const MAX_REPLAY_EVENTS = 2000;
const MAX_REPLAY_KG_EVENTS = 12000;
const MAX_REPLAY_TRANSCRIPT_CHARS = 12000;
const MAX_REPLAY_PAYLOAD_STRING_CHARS = 4000;
const MAX_REPLAY_PAYLOAD_ARRAY_ITEMS = 50;
const MAX_REPLAY_PAYLOAD_DEPTH = 5;

export interface ResearchHttpHandlerOptions {
  researchPath?: string;
  healthPath?: string;
  runStore?: ResearchRunStore;
  maxBodyBytes?: number;
  env?: NodeJS.ProcessEnv;
  defaults?: Omit<Partial<ResearchRunInput>, "prompt" | "signal" | "env">;
  mapBodyToInput?: (body: Record<string, unknown>, req: IncomingMessage) => Partial<ResearchRunInput>;
  /** Protects every research/list/artifact route. Health checks remain public. */
  apiToken?: string;
  /** Per-client fixed-window protection for starting expensive research runs. */
  maxResearchStartsPerMinute?: number;
  /** Per handler/store protection against unbounded simultaneous provider use. */
  maxConcurrentRuns?: number;
  /** Trust the first X-Forwarded-For value when deployed behind a trusted proxy. */
  trustProxy?: boolean;
  /** Client requests cannot move artifacts outside the configured server root by default. */
  allowClientArtifactDir?: boolean;
  /** Resume checkpoints are confined to the configured artifact root by default. */
  allowExternalResumePath?: boolean;
  requestCaps?: {
    maxEpisodeCostUsd?: number;
    maxEpisodeTokens?: number;
    maxLlmRequests?: number;
    maxCycles?: number;
  };
}

export type ResearchHttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export function createResearchHttpHandler(opts: ResearchHttpHandlerOptions = {}): ResearchHttpHandler {
  const researchPath = opts.researchPath ?? "/research";
  const healthPath = opts.healthPath ?? "/healthz";
  const maxBodyBytes = opts.maxBodyBytes ?? 1_000_000;
  const runStore = opts.runStore ?? createInMemoryResearchRunStore();
  const rateLimiter = createResearchStartRateLimiter(opts.maxResearchStartsPerMinute);

  return async (req, res) => {
    const path = requestPath(req);
    if (req.method === "GET" && path === healthPath) {
      writeJson(res, 200, { ok: true });
      return;
    }

    if (!isAuthorizedRequest(req, opts.apiToken)) {
      res.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": "Bearer",
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    if (req.method === "GET" && path === researchPath) {
      const runs = mergeRunLists(
        runStore.list().map(compactRunRecord),
        await listArtifactRunRecords(opts, runStore),
      );
      writeJson(res, 200, {
        runs,
        count: runs.length,
      });
      return;
    }

    const route = matchResearchRunRoute(path, researchPath);
    if (route && req.method === "GET" && route.action === "status") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: false });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      writeJson(res, 200, publicRunRecord(record));
      return;
    }
    if (route && req.method === "GET" && route.action === "events") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: true });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      if (acceptsSse(req)) {
        writeReplaySse(res, record);
      } else {
        writeJson(res, 200, replayPayload(record));
      }
      return;
    }
    if (route && req.method === "GET" && route.action === "report") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: false });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      await writeRunArtifact(res, record, "report");
      return;
    }
    if (route && req.method === "GET" && route.action === "evidence-index") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: false });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      await writeRunArtifact(res, record, "evidence-index");
      return;
    }
    if (route && req.method === "GET" && route.action === "evidence-quality") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: false });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      await writeRunArtifact(res, record, "evidence-quality");
      return;
    }
    if (route && req.method === "GET" && route.action === "budget") {
      const record = runStore.get(route.runId) ?? await loadArtifactRunRecord(route.runId, opts, { includeFrames: false });
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      await writeRunArtifact(res, record, "budget");
      return;
    }
    if (route && req.method === "POST" && route.action === "cancel") {
      const record = runStore.get(route.runId);
      if (!record) {
        writeJson(res, 404, { error: "run_not_found" });
        return;
      }
      runStore.cancel(route.runId, "cancelled by API request");
      writeJson(res, 202, publicRunRecord(record));
      return;
    }

    if (req.method !== "POST" || path !== researchPath) {
      writeJson(res, 404, { error: "not_found" });
      return;
    }

    const rateLimit = rateLimiter?.take(researchClientId(req, opts.trustProxy ?? false));
    if (rateLimit && !rateLimit.allowed) {
      res.writeHead(429, {
        "content-type": "application/json",
        "retry-after": String(rateLimit.retryAfterSeconds),
      });
      res.end(JSON.stringify({ error: "research_start_rate_limited", retryAfterSeconds: rateLimit.retryAfterSeconds }));
      return;
    }

    let activeRunId: string | undefined;
    try {
      const body = await readJsonBody(req, { maxBytes: maxBodyBytes });
      enforceConcurrentRunLimit(runStore, opts.maxConcurrentRuns);
      const runController = new AbortController();
      const input = buildResearchHttpInput(body, req, opts, runController.signal);
      await normalizeResumeBudget(input);
      enforceResumePathBoundary(input, opts);
      applyResearchRequestCaps(input, opts.requestCaps);
      const requestedRunId = stringValue(body.runId);
      if (requestedRunId && !isValidRunId(requestedRunId)) {
        throw new HttpError(400, "runId must be 1-128 characters using letters, numbers, dot, underscore, or hyphen");
      }
      const runId = requestedRunId ?? runStore.createRunId();
      const record = runStore.create({
        runId,
        prompt: stringValue(body.prompt) ?? "",
        controller: runController,
      });
      activeRunId = runId;
      let clientConnected = true;
      res.on("close", () => {
        if (!res.writableEnded) clientConnected = false;
      });
      const originalOnEvent = input.onEvent;
      const originalOnFrame = input.onFrame;
      input.onEvent = async (event) => {
        runStore.appendEvent(runId, event);
        await originalOnEvent?.(event);
      };
      input.onFrame = async (frame) => {
        runStore.appendFrame(runId, frame);
        await originalOnFrame?.(frame);
        if (clientConnected && !res.destroyed) safeWriteResearchSseMessage(res, "frame", { type: "frame", frame });
      };
      res.writeHead(200, researchSseHeaders);
      res.write(`: connected\n\n`);
      safeWriteResearchSseMessage(res, "run", {
        runId,
        status: record.status,
        maxCycles: input.maxCycles,
        completionRepairCycles: input.completionRepairCycles,
        maxEpisodeCostUsd: input.maxEpisodeCostUsd,
        maxEpisodeTokens: input.maxEpisodeTokens,
        maxLlmRequests: input.maxLlmRequests,
        debugSingleBranch: input.debugSingleBranch,
      });
      const stopCancellationWatcher = watchDurableCancellation(runStore, runId, runController);
      void runResearch(input).then((output) => {
        runStore.finish(runId, output.result, output.summary);
        if (clientConnected && !res.destroyed) {
          safeWriteResearchSseMessage(res, "result", { type: "result", result: output.result, summary: output.summary });
          res.end();
        }
      }).catch((err: unknown) => {
        runStore.fail(runId, err);
        if (clientConnected && !res.destroyed) {
          safeWriteResearchSseMessage(res, "error", { error: messageOf(err) });
          res.end();
        }
      }).finally(() => {
        stopCancellationWatcher();
      });
    } catch (err) {
      if (activeRunId) runStore.fail(activeRunId, err);
      if (!res.headersSent) {
        writeJson(res, errorStatus(err), { error: messageOf(err) });
        return;
      }
      res.write(encodeResearchSse("error", { error: messageOf(err) }));
      res.end();
    }
  };
}

interface ResearchStartRateLimiter {
  take(clientId: string): { allowed: boolean; retryAfterSeconds: number };
}

function createResearchStartRateLimiter(maxPerMinute: number | undefined): ResearchStartRateLimiter | undefined {
  if (maxPerMinute === undefined) return undefined;
  const limit = Math.max(1, Math.floor(maxPerMinute));
  const buckets = new Map<string, { windowStartedAt: number; count: number }>();
  return {
    take(clientId) {
      const now = Date.now();
      const current = buckets.get(clientId);
      if (!current || now - current.windowStartedAt >= 60_000) {
        buckets.set(clientId, { windowStartedAt: now, count: 1 });
        if (buckets.size > 10_000) {
          for (const [key, bucket] of buckets) {
            if (now - bucket.windowStartedAt >= 60_000) buckets.delete(key);
          }
        }
        return { allowed: true, retryAfterSeconds: 0 };
      }
      if (current.count >= limit) {
        return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((60_000 - (now - current.windowStartedAt)) / 1000)) };
      }
      current.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function enforceConcurrentRunLimit(runStore: ResearchRunStore, configured: number | undefined): void {
  if (configured === undefined) return;
  const limit = Math.max(1, Math.floor(configured));
  const running = runStore.list().filter((record) => record.status === "running").length;
  if (running >= limit) throw new HttpError(429, `concurrent research run limit reached (${limit})`);
}

function enforceResumePathBoundary(input: ResearchRunInput, opts: ResearchHttpHandlerOptions): void {
  if (!input.resumeCheckpointPath || opts.allowExternalResumePath) return;
  const root = artifactRoot(opts);
  if (!root) return;
  const target = resolve(input.resumeCheckpointPath);
  const pathFromRoot = relative(root, target);
  if (!pathFromRoot || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)) {
    throw new HttpError(400, "resume checkpoint must be inside the configured artifact directory");
  }
}

function applyResearchRequestCaps(input: ResearchRunInput, caps: ResearchHttpHandlerOptions["requestCaps"]): void {
  if (!caps) return;
  input.maxEpisodeCostUsd = cappedNumber(input.maxEpisodeCostUsd, caps.maxEpisodeCostUsd);
  input.maxEpisodeTokens = cappedNumber(input.maxEpisodeTokens, caps.maxEpisodeTokens);
  input.maxLlmRequests = cappedNumber(input.maxLlmRequests, caps.maxLlmRequests);
  input.maxCycles = cappedNumber(input.maxCycles, caps.maxCycles);
}

function cappedNumber(requested: number | undefined, cap: number | undefined): number | undefined {
  if (cap === undefined) return requested;
  const safeCap = Math.max(0, cap);
  return requested === undefined ? safeCap : Math.min(requested, safeCap);
}

function isAuthorizedRequest(req: IncomingMessage, configuredToken: string | undefined): boolean {
  if (!configuredToken) return true;
  const authorization = headerValue(req.headers.authorization);
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const apiKey = headerValue(req.headers["x-api-key"])?.trim();
  return safeTokenEqual(bearer ?? apiKey, configuredToken);
}

function safeTokenEqual(provided: string | undefined, expected: string): boolean {
  if (!provided) return false;
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function researchClientId(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = headerValue(req.headers["x-forwarded-for"])?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress ?? "unknown";
}

function watchDurableCancellation(
  runStore: ResearchRunStore,
  runId: string,
  controller: AbortController,
): () => void {
  const timer = setInterval(() => {
    if (controller.signal.aborted) return;
    const latest = runStore.getStatus(runId);
    if (latest?.status === "cancelled") controller.abort(latest.error || "cancelled by another process");
  }, 250);
  timer.unref?.();
  return () => clearInterval(timer);
}

export type ResearchRunStatus = "running" | "succeeded" | "needs_human_review" | "failed" | "cancelled" | "interrupted";

export interface ResearchRunRecord {
  runId: string;
  episodeId?: string;
  status: ResearchRunStatus;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  controller: AbortController;
  events: MemoryEvent[];
  frames: ResearchStreamFrame[];
  result?: EpisodeResult;
  summary?: ResearchRunSummary;
  error?: string;
  checkpointPath?: string;
  checkpointCursor?: Record<string, unknown>;
  artifactBacked?: boolean;
  replayTruncated?: ReplayTruncationInfo;
}

interface ReplayTruncationInfo {
  sourcePath?: string;
  maxBytes: number;
  maxEvents: number;
  loadedEvents: number;
  fileBytes?: number;
  truncatedByBytes?: boolean;
  truncatedByEvents?: boolean;
}

export interface ResearchRunStore {
  createRunId(): string;
  create(input: { runId: string; prompt: string; controller: AbortController }): ResearchRunRecord;
  list(): ResearchRunRecord[];
  get(runId: string): ResearchRunRecord | undefined;
  getStatus(runId: string): { status: ResearchRunStatus; error?: string } | undefined;
  appendEvent(runId: string, event: MemoryEvent): void;
  appendFrame(runId: string, frame: ResearchStreamFrame): void;
  finish(runId: string, result: EpisodeResult, summary: ResearchRunSummary): void;
  fail(runId: string, error: unknown): void;
  cancel(runId: string, reason: string): void;
}

export class ResearchRunConflictError extends Error {
  constructor(readonly runId: string) {
    super(`runId already exists: ${runId}`);
    this.name = "ResearchRunConflictError";
  }
}

export function createInMemoryResearchRunStore(): ResearchRunStore {
  const records = new Map<string, ResearchRunRecord>();
  const now = () => new Date().toISOString();
  return {
    createRunId() {
      return `RUN_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
    },
    create(input) {
      if (records.has(input.runId)) throw new ResearchRunConflictError(input.runId);
      const record: ResearchRunRecord = {
        runId: input.runId,
        status: "running",
        prompt: input.prompt,
        createdAt: now(),
        updatedAt: now(),
        controller: input.controller,
        events: [],
        frames: [],
      };
      records.set(input.runId, record);
      return record;
    },
    get(runId) {
      return records.get(runId);
    },
    getStatus(runId) {
      const record = records.get(runId);
      return record ? { status: record.status, error: record.error } : undefined;
    },
    list() {
      return [...records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    appendEvent(runId, event) {
      const record = records.get(runId);
      if (!record) return;
      record.events.push(event);
      record.episodeId = event.episodeId || record.episodeId;
      if (event.eventType === "checkpoint_saved") {
        record.checkpointPath = stringValue(event.payload?.path) ?? record.checkpointPath;
        record.checkpointCursor = {
          stage: event.payload?.stage,
          nextCycle: event.payload?.nextCycle,
          pass: event.payload?.pass,
          draftPath: event.payload?.draftPath,
        };
      }
      trimArrayHead(record.events, MAX_STORED_RUN_EVENTS);
      record.updatedAt = now();
    },
    appendFrame(runId, frame) {
      const record = records.get(runId);
      if (!record) return;
      record.frames.push(frame);
      trimArrayHead(record.frames, MAX_STORED_RUN_FRAMES);
      record.updatedAt = now();
    },
    finish(runId, result, summary) {
      const record = records.get(runId);
      if (!record || record.status === "cancelled") return;
      record.status = runStatusFromEpisodeResult(result);
      record.result = result;
      record.summary = summary;
      record.episodeId = result.episodeId;
      record.checkpointPath = summary.checkpoint ?? record.checkpointPath;
      record.updatedAt = now();
    },
    fail(runId, error) {
      const record = records.get(runId);
      if (!record || record.status === "cancelled") return;
      record.status = "failed";
      record.error = messageOf(error);
      record.updatedAt = now();
    },
    cancel(runId, reason) {
      const record = records.get(runId);
      if (!record) return;
      record.status = "cancelled";
      record.error = reason;
      record.updatedAt = now();
      if (!record.controller.signal.aborted) record.controller.abort(reason);
    },
  };
}

function matchResearchRunRoute(path: string, researchPath: string): { runId: string; action: "status" | "events" | "cancel" | "report" | "evidence-index" | "evidence-quality" | "budget" } | undefined {
  const prefix = researchPath.replace(/\/$/, "");
  if (!path.startsWith(`${prefix}/`)) return undefined;
  const parts = path.slice(prefix.length + 1).split("/").filter(Boolean);
  if (parts.length === 1) return { runId: decodeURIComponent(parts[0]!), action: "status" };
  if (parts.length === 2 && parts[1] === "events") return { runId: decodeURIComponent(parts[0]!), action: "events" };
  if (parts.length === 2 && parts[1] === "cancel") return { runId: decodeURIComponent(parts[0]!), action: "cancel" };
  if (parts.length === 2 && parts[1] === "report") return { runId: decodeURIComponent(parts[0]!), action: "report" };
  if (parts.length === 2 && parts[1] === "evidence-index") return { runId: decodeURIComponent(parts[0]!), action: "evidence-index" };
  if (parts.length === 2 && parts[1] === "evidence-quality") return { runId: decodeURIComponent(parts[0]!), action: "evidence-quality" };
  if (parts.length === 2 && parts[1] === "budget") return { runId: decodeURIComponent(parts[0]!), action: "budget" };
  return undefined;
}

async function writeRunArtifact(res: ServerResponse, record: ResearchRunRecord, artifact: "report" | "evidence-index" | "evidence-quality" | "budget"): Promise<void> {
  if (!record.result) {
    writeJson(res, 409, { error: "run_not_finished" });
    return;
  }
  const path = artifact === "report"
    ? record.result.reportArtifactPath
    : artifact === "evidence-index"
      ? record.result.evidenceIndexPath
      : artifact === "evidence-quality"
        ? record.result.evidenceQualityAuditPath
        : record.result.budgetAuditPath;
  if (!path) {
    writeJson(res, 404, { error: "artifact_not_found" });
    return;
  }
  try {
    const content = await readFile(path, "utf8");
    if (artifact === "report") {
      res.writeHead(200, {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "no-cache",
      });
      res.end(content);
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(content);
  } catch (err) {
    writeJson(res, 404, { error: "artifact_not_found", message: messageOf(err) });
  }
}

function acceptsSse(req: IncomingMessage): boolean {
  const accept = req.headers.accept;
  return typeof accept === "string" && accept.includes("text/event-stream");
}

function replayPayload(record: ResearchRunRecord): Record<string, unknown> {
  const frames = record.frames.map(sanitizeReplayFrame);
  return {
    ...publicRunRecord(record),
    frames,
    visualEvents: frames.flatMap((frame) => frame.visual ? [frame.visual] : []),
    replayTruncated: record.replayTruncated,
  };
}

function publicRunRecord(record: ResearchRunRecord): Record<string, unknown> {
  const counts = recordCounts(record);
  return {
    runId: record.runId,
    status: record.status,
    prompt: record.prompt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    episodeId: record.result?.episodeId ?? record.episodeId ?? record.events[0]?.episodeId,
    result: record.result,
    summary: record.summary,
    error: record.error,
    checkpointPath: record.checkpointPath,
    resumeCheckpointPath: record.checkpointPath,
    checkpointCursor: record.checkpointCursor,
    artifactBacked: record.artifactBacked,
    replayTruncated: record.replayTruncated,
    counts,
  };
}

function compactRunRecord(record: ResearchRunRecord): Record<string, unknown> {
  const lastFrame = record.frames.at(-1);
  const lastEvent = record.events.at(-1);
  const counts = recordCounts(record);
  return {
    runId: record.runId,
    status: record.status,
    prompt: record.prompt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    episodeId: record.result?.episodeId ?? record.episodeId ?? record.events[0]?.episodeId,
    error: record.error,
    checkpointPath: record.checkpointPath,
    resumeCheckpointPath: record.checkpointPath,
    checkpointCursor: record.checkpointCursor,
    artifactBacked: record.artifactBacked,
    replayTruncated: record.replayTruncated,
    counts,
    artifactPaths: record.result ? {
      report: record.result.reportArtifactPath,
      evidenceIndex: record.result.evidenceIndexPath,
      evidenceQualityAudit: record.result.evidenceQualityAuditPath,
      budgetAudit: record.result.budgetAuditPath,
      humanReviewResponse: record.result.humanReviewResponsePath,
      checkpoint: record.checkpointPath,
      trace: record.result.tracePath,
      fullTrace: record.result.fullTracePath,
    } : undefined,
    lastEvent: lastEvent ? {
      eventType: lastEvent.eventType,
      timestamp: lastEvent.timestamp,
    } : undefined,
    lastFrame: lastFrame ? {
      kind: lastFrame.visual?.kind || lastFrame.kind,
      timestamp: lastFrame.event?.timestamp || lastFrame.visual?.timestamp,
      title: lastFrame.visual?.ui?.title,
      summary: lastFrame.visual?.ui?.summary || lastFrame.line,
      lane: lastFrame.visual?.ui?.lane,
      actor: lastFrame.visual?.actor?.title,
    } : undefined,
  };
}

function recordCounts(record: ResearchRunRecord): { events: number; frames: number; visualEvents: number } {
  const events = record.events.length;
  const frames = record.frames.length || (record.artifactBacked ? events : 0);
  return {
    events,
    frames,
    visualEvents: record.frames.filter((frame) => frame.visual).length,
  };
}

async function listArtifactRunRecords(
  opts: ResearchHttpHandlerOptions,
  runStore: ResearchRunStore,
): Promise<Array<Record<string, unknown>>> {
  const root = artifactRoot(opts);
  if (!root) return [];
  const existingEpisodes = new Set(
    runStore.list()
      .map((record) => record.result?.episodeId ?? record.episodeId ?? record.events[0]?.episodeId)
      .filter((value): value is string => Boolean(value)),
  );
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: Array<Record<string, unknown>> = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (existingEpisodes.has(entry.name)) continue;
    const record = await loadArtifactRunRecord(entry.name, opts, { includeFrames: false });
    if (record) out.push(compactRunRecord(record));
  }
  return out;
}

function mergeRunLists(
  memoryRuns: Array<Record<string, unknown>>,
  artifactRuns: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const byRunId = new Map<string, Record<string, unknown>>();
  for (const run of artifactRuns) {
    const runId = typeof run.runId === "string" ? run.runId : "";
    if (runId) byRunId.set(runId, run);
  }
  for (const run of memoryRuns) {
    const runId = typeof run.runId === "string" ? run.runId : "";
    if (runId) byRunId.set(runId, run);
  }
  return [...byRunId.values()].sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
}

async function loadArtifactRunRecord(
  runId: string,
  opts: ResearchHttpHandlerOptions,
  options: { includeFrames: boolean },
): Promise<ResearchRunRecord | undefined> {
  const root = artifactRoot(opts);
  if (!root) return undefined;
  const episodeDir = resolve(join(root, runId));
  const relativePath = relative(root, episodeDir);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return undefined;
  const dirStat = await stat(episodeDir).catch(() => undefined);
  if (!dirStat?.isDirectory()) return undefined;
  const inspectedCheckpoint = await inspectResearchCheckpoint(join(episodeDir, "checkpoints")).catch(() => undefined);
  const checkpointPath = inspectedCheckpoint?.checkpointPath;
  const checkpoint = inspectedCheckpoint?.checkpoint as unknown as Record<string, unknown> | undefined;
  const lastError = await artifactLastError(episodeDir);
  const loaded = options.includeFrames
    ? await loadArtifactEvents(episodeDir, checkpoint, checkpointPath, inspectedCheckpoint?.events)
    : { events: checkpointEvents(checkpoint), truncated: undefined };
  const events = loaded.events;
  const frames = options.includeFrames ? renderReplayFrames(events) : [];
  const result = await artifactEpisodeResult(runId, episodeDir, checkpoint, events, dirStat.mtime.toISOString());
  const prompt = checkpointPrompt(checkpoint) || eventPrompt(events) || runId;
  const firstAt = checkpointString(checkpoint, ["state", "startedAt"]) || events[0]?.timestamp || dirStat.birthtime.toISOString();
  const lastAt = checkpointString(checkpoint, ["savedAt"]) || result?.closedAt || events.at(-1)?.timestamp || dirStat.mtime.toISOString();
  const status: ResearchRunStatus = result ? runStatusFromEpisodeResult(result) : checkpointPath ? "interrupted" : "failed";
  return {
    runId,
    episodeId: result?.episodeId ?? events[0]?.episodeId ?? runId,
    status,
    prompt,
    createdAt: firstAt,
    updatedAt: lastAt,
    controller: new AbortController(),
    events,
    frames,
    result,
    summary: result ? artifactSummary(result, checkpointPath) : undefined,
    error: lastError || checkpointString(checkpoint, ["error", "message"]),
    checkpointPath,
    checkpointCursor: objectValue(checkpoint?.cursor),
    artifactBacked: true,
    replayTruncated: loaded.truncated,
  };
}

async function artifactLastError(episodeDir: string): Promise<string> {
  const path = await existingPath(join(episodeDir, "checkpoints", "last-error.json"));
  if (!path) return "";
  const json = await readJsonFile<Record<string, unknown>>(path).catch(() => undefined);
  return checkpointString(json, ["error", "message"]) || checkpointString(json, ["error", "name"]);
}

async function loadArtifactEvents(
  episodeDir: string,
  checkpoint: Record<string, unknown> | undefined,
  checkpointPath: string | undefined,
  inspectedEvents?: MemoryEvent[],
): Promise<{ events: MemoryEvent[]; truncated?: ReplayTruncationInfo }> {
  const checkpointGraph = checkpointGraphEvents(checkpoint, basename(episodeDir));
  const fullTrace = await existingPath(join(episodeDir, "trace-full.jsonl"));
  const summaryTrace = await existingPath(join(episodeDir, "trace.jsonl"));
  for (const path of [fullTrace, summaryTrace]) {
    if (!path) continue;
    const replay = await readJsonlTailEvents(path, {
      maxBytes: MAX_REPLAY_TRACE_BYTES,
      maxEvents: MAX_REPLAY_EVENTS,
    }).catch(() => ({ events: [], truncated: undefined }));
    if (replay.events.length) {
      const kgEvents = await readJsonlMatchingEvents(path, isGraphReplayEvent, MAX_REPLAY_KG_EVENTS).catch(() => []);
      return {
        events: mergeReplayEvents(kgEvents, replay.events, checkpointGraph),
        truncated: replay.truncated ? { ...replay.truncated, loadedEvents: replay.events.length + kgEvents.length + checkpointGraph.length } : undefined,
      };
    }
  }
  const storedEvents = inspectedEvents ?? (checkpoint && checkpointPath
    ? await readResearchCheckpointEvents(checkpoint as unknown as ResearchCheckpoint, checkpointPath).catch(() => checkpointEvents(checkpoint))
    : checkpointEvents(checkpoint));
  return { events: mergeReplayEvents(storedEvents, checkpointGraph), truncated: undefined };
}

function checkpointGraphEvents(checkpoint: Record<string, unknown> | undefined, episodeId: string): MemoryEvent[] {
  const stack = objectValue(checkpoint?.stack);
  const timestamp = checkpointString(checkpoint, ["savedAt"]) || checkpointString(checkpoint, ["state", "closedAt"]) || new Date(0).toISOString();
  const events: MemoryEvent[] = [];
  for (const [index, node] of arrayValue(stack?.reportNodes).entries()) {
    if (!objectValue(node)) continue;
    events.push({
      eventId: `ME_replay_checkpoint_report_${index}`,
      episodeId,
      timestamp,
      eventType: "full.kg.updateReportNode",
      reportNodeId: strValue(objectValue(node)?.nodeId),
      payload: { node },
    });
  }
  for (const [index, knowledge] of arrayValue(stack?.knowledgeNodes).entries()) {
    if (!objectValue(knowledge)) continue;
    events.push({
      eventId: `ME_replay_checkpoint_knowledge_${index}`,
      episodeId,
      timestamp,
      eventType: "full.kg.upsertKnowledgeNode",
      taskId: strValue(objectValue(knowledge)?.retrievedByTaskId),
      payload: { knowledge },
    });
  }
  for (const [index, link] of arrayValue(stack?.evidenceLinks).entries()) {
    const evidenceLink = objectValue(link);
    if (!evidenceLink) continue;
    events.push({
      eventId: `ME_replay_checkpoint_evidence_${index}`,
      episodeId,
      timestamp,
      eventType: "full.kg.updateEvidenceLink",
      taskId: strValue(evidenceLink.createdByTaskId),
      reportNodeId: strValue(evidenceLink.reportNodeId),
      payload: { link },
    });
  }
  for (const [index, item] of arrayValue(stack?.reportlets).entries()) {
    const reportlet = objectValue(item);
    if (!reportlet) continue;
    events.push({
      eventId: `ME_replay_checkpoint_reportlet_${index}`,
      episodeId,
      timestamp,
      eventType: "full.kg.upsertReportlet",
      taskId: strValue(reportlet.taskId),
      reportNodeId: strValue(reportlet.reportNodeId),
      payload: { reportlet },
    });
  }
  for (const [index, gap] of arrayValue(stack?.openGaps).entries()) {
    const openGap = objectValue(gap);
    if (!openGap) continue;
    events.push({
      eventId: `ME_replay_checkpoint_gap_${index}`,
      episodeId,
      timestamp,
      eventType: "full.kg.addOpenGap",
      taskId: strValue(openGap.taskId),
      reportNodeId: strValue(openGap.reportNodeId),
      payload: { gap },
    });
  }
  return events;
}

function isGraphReplayEvent(event: MemoryEvent): boolean {
  if (event.eventType.includes(".kg.")) return true;
  return event.eventType === "main_planner_finished";
}

async function readJsonlMatchingEvents(path: string, predicate: (event: MemoryEvent) => boolean, maxEvents: number): Promise<MemoryEvent[]> {
  const events: MemoryEvent[] = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (!isMemoryEvent(parsed) || !predicate(parsed)) continue;
      events.push(parsed);
      if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    } catch {
      // Ignore malformed trace lines; replay should be best-effort.
    }
  }
  return events;
}

function mergeReplayEvents(...groups: MemoryEvent[][]): MemoryEvent[] {
  const byId = new Map<string, MemoryEvent>();
  for (const event of groups.flat()) byId.set(event.eventId, event);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function readJsonlTailEvents(path: string, opts: { maxBytes: number; maxEvents: number }): Promise<{ events: MemoryEvent[]; truncated?: ReplayTruncationInfo }> {
  const info = await stat(path);
  const bytesToRead = Math.min(info.size, opts.maxBytes);
  const start = Math.max(0, info.size - bytesToRead);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    const allEvents = parseJsonlEvents(text);
    const events = allEvents.slice(-opts.maxEvents);
    const truncatedByBytes = start > 0;
    const truncatedByEvents = allEvents.length > events.length;
    return {
      events,
      truncated: (truncatedByBytes || truncatedByEvents) ? {
        sourcePath: path,
        maxBytes: opts.maxBytes,
        maxEvents: opts.maxEvents,
        loadedEvents: events.length,
        fileBytes: info.size,
        truncatedByBytes,
        truncatedByEvents,
      } : undefined,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function checkpointEvents(checkpoint: Record<string, unknown> | undefined): MemoryEvent[] {
  const stack = objectValue(checkpoint?.stack);
  return Array.isArray(stack?.events) ? stack.events.filter(isMemoryEvent) : [];
}

function renderReplayFrames(events: MemoryEvent[]): ResearchStreamFrame[] {
  const renderer = new ResearchStreamRenderer({ mode: "transcript", maxTranscriptChars: MAX_REPLAY_TRANSCRIPT_CHARS });
  return events.flatMap((event) => {
    const frame = renderer.render(event);
    return frame ? [frame] : [];
  });
}

function parseJsonlEvents(text: string): MemoryEvent[] {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        return isMemoryEvent(parsed) ? [parsed] : [];
      } catch {
        return [];
      }
    });
}

function trimArrayHead<T>(items: T[], maxLength: number): void {
  if (items.length <= maxLength) return;
  items.splice(0, items.length - maxLength);
}

async function artifactEpisodeResult(
  episodeId: string,
  episodeDir: string,
  checkpoint: Record<string, unknown> | undefined,
  events: MemoryEvent[],
  fallbackTime: string,
): Promise<EpisodeResult | undefined> {
  const checkpointResult = objectValue(checkpoint?.state)?.result;
  if (isEpisodeResult(checkpointResult)) return checkpointResult;
  const reportPath = await existingPath(join(episodeDir, "report.md"))
    ?? await existingPath(join(episodeDir, "incomplete-report.md"))
    ?? await existingPath(join(episodeDir, "report-draft.md"));
  if (!reportPath) return undefined;
  const evidenceIndexPath = await existingPath(join(episodeDir, "evidence-index.json"));
  const evidenceQualityAuditPath = await existingPath(join(episodeDir, "evidence-quality-audit.json"));
  const budgetAuditPath = await existingPath(join(episodeDir, "budget-audit.json"));
  const tracePath = await existingPath(join(episodeDir, "trace.jsonl"));
  const fullTracePath = await existingPath(join(episodeDir, "trace-full.jsonl"));
  const humanReviewPath = await existingPath(join(episodeDir, "human-review.json"));
  const humanReviewResponsePath = await existingPath(join(episodeDir, "human-review-response.json"));
  const humanReview = humanReviewPath
    ? await readFile(humanReviewPath, "utf8").then((text) => JSON.parse(text) as HumanReviewRequest).catch(() => undefined)
    : undefined;
  const stack = objectValue(checkpoint?.stack);
  const reportNodes = arrayValue(stack?.reportNodes);
  const knowledgeNodes = arrayValue(stack?.knowledgeNodes);
  const evidenceLinks = arrayValue(stack?.evidenceLinks);
  const openGaps = arrayValue(stack?.openGaps);
  const tasks = arrayValue(stack?.tasks);
  return {
    episodeId,
    status: basename(reportPath) === "report.md" ? "succeeded" : "needs_human_review",
    reportArtifactPath: reportPath,
    evidenceIndexPath,
    evidenceQualityAuditPath,
    budgetAuditPath,
    tracePath,
    fullTracePath,
    humanReview,
    humanReviewPath,
    humanReviewResponsePath,
    metrics: {
      reportNodeCount: reportNodes.length,
      knowledgeNodeCount: knowledgeNodes.length,
      evidenceLinkCount: evidenceLinks.length,
      completedTaskCount: tasks.filter((task) => {
        const status = objectValue(task)?.status;
        return status === "done" || status === "done_here" || status === "completed";
      }).length,
      openGapCount: openGaps.length,
      citationCount: citationCountFromCheckpoint(checkpoint),
      rubricIssueCount: events.filter((event) => event.eventType === "publish_gate_repair").length,
      publishGatePassed: events.some((event) => event.eventType === "episode_succeeded"),
    },
    closedAt: checkpointString(checkpoint, ["state", "closedAt"]) || checkpointString(checkpoint, ["savedAt"]) || fallbackTime,
  };
}

function artifactSummary(result: EpisodeResult, checkpointPath: string | undefined): ResearchRunSummary {
  return {
    status: result.status,
    episodeId: result.episodeId,
    report: result.reportArtifactPath,
    evidenceIndex: result.evidenceIndexPath,
    evidenceQualityAudit: result.evidenceQualityAuditPath,
    budgetAudit: result.budgetAuditPath,
    humanReviewResponse: result.humanReviewResponsePath,
    trace: result.tracePath,
    fullTrace: result.fullTracePath,
    checkpoint: checkpointPath,
    resumeCommand: checkpointPath ? `pnpm research --resume ${JSON.stringify(checkpointPath)}` : undefined,
    filesExist: {
      report: true,
      evidenceIndex: Boolean(result.evidenceIndexPath),
      evidenceQualityAudit: Boolean(result.evidenceQualityAuditPath),
      budgetAudit: Boolean(result.budgetAuditPath),
      humanReviewResponse: Boolean(result.humanReviewResponsePath),
      trace: Boolean(result.tracePath),
      fullTrace: Boolean(result.fullTracePath),
      checkpoint: Boolean(checkpointPath),
    },
    metrics: result.metrics,
  };
}

function artifactRoot(opts: ResearchHttpHandlerOptions): string | undefined {
  const configured = opts.defaults?.artifactDir;
  return typeof configured === "string" && configured.trim() ? resolve(configured) : undefined;
}

async function existingPath(path: string): Promise<string | undefined> {
  const found = await stat(path).catch(() => undefined);
  return found?.isFile() ? path : undefined;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function checkpointPrompt(checkpoint: Record<string, unknown> | undefined): string {
  return checkpointString(checkpoint, ["state", "submission", "userInput"]);
}

function eventPrompt(events: MemoryEvent[]): string {
  const event = events.find((item) => item.eventType === "main_planner_started");
  return strValue(event?.payload?.objective);
}

function checkpointString(checkpoint: Record<string, unknown> | undefined, path: string[]): string {
  let current: unknown = checkpoint;
  for (const key of path) current = objectValue(current)?.[key];
  return strValue(current);
}

function citationCountFromCheckpoint(checkpoint: Record<string, unknown> | undefined): number {
  const citationMap = objectValue(objectValue(checkpoint?.state)?.reportArtifact)?.citationMap;
  return citationMap ? Object.keys(citationMap).length : 0;
}

function isMemoryEvent(value: unknown): value is MemoryEvent {
  const event = objectValue(value);
  return Boolean(
    event
    && typeof event.eventId === "string"
    && typeof event.episodeId === "string"
    && typeof event.timestamp === "string"
    && typeof event.eventType === "string",
  );
}

function isEpisodeResult(value: unknown): value is EpisodeResult {
  const result = objectValue(value);
  return Boolean(
    result
    && typeof result.episodeId === "string"
    && (result.status === "succeeded" || result.status === "failed" || result.status === "needs_human_review")
    && typeof result.reportArtifactPath === "string"
    && objectValue(result.metrics),
  );
}

function runStatusFromEpisodeResult(result: EpisodeResult): ResearchRunStatus {
  if (result.status === "succeeded") return "succeeded";
  if (result.status === "needs_human_review") return "needs_human_review";
  return "failed";
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function writeReplaySse(res: ServerResponse, record: ResearchRunRecord): void {
  res.writeHead(200, researchSseHeaders);
  res.write(`: replay\n\n`);
  writeResearchSseMessage(res, "run", publicRunRecord(record));
  for (const frame of record.frames) writeResearchSseMessage(res, "frame", { type: "frame", frame: sanitizeReplayFrame(frame) });
  if (record.result && record.summary) writeResearchSseMessage(res, "result", { type: "result", result: record.result, summary: record.summary });
  if (record.error && record.status !== "cancelled") writeResearchSseMessage(res, "error", { error: record.error });
  res.end();
}

function sanitizeReplayFrame(frame: ResearchStreamFrame): ResearchStreamFrame {
  return {
    ...frame,
    event: {
      ...frame.event,
      payload: compactReplayValue(frame.event.payload, 0) as Record<string, unknown> | undefined,
    },
    visual: frame.visual ? {
      ...frame.visual,
      payload: compactReplayValue(frame.visual.payload, 0) as Record<string, unknown>,
    } : undefined,
  };
}

function compactReplayValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") return value.length > MAX_REPLAY_PAYLOAD_STRING_CHARS ? `${value.slice(0, MAX_REPLAY_PAYLOAD_STRING_CHARS)}...` : value;
  if (typeof value !== "object" || value === null) return value;
  if (depth >= MAX_REPLAY_PAYLOAD_DEPTH) return Array.isArray(value) ? `[array:${value.length}]` : "[object]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_REPLAY_PAYLOAD_ARRAY_ITEMS).map((item) => compactReplayValue(item, depth + 1));
    return value.length > items.length ? [...items, `... omitted ${value.length - items.length} items`] : items;
  }
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[key] = compactReplayValue(item, depth + 1);
  return out;
}

function safeWriteResearchSseMessage(res: ServerResponse, event: string, data: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  try {
    writeResearchSseMessage(res, event, data);
  } catch {
    // The HTTP client may disconnect while the backend run continues in the run store.
  }
}

export interface ReadJsonBodyOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export function readJsonBody(req: IncomingMessage, opts: ReadJsonBodyOptions = {}): Promise<Record<string, unknown>> {
  const maxBytes = opts.maxBytes ?? 1_000_000;
  return new Promise((resolve, reject) => {
    let raw = "";
    const onAbort = () => reject(abortError(opts.signal, "request aborted"));
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        reject(new HttpError(413, "request body too large"));
        req.destroy();
      }
    });
    req.on("error", reject);
    req.on("end", () => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!isObject(parsed)) throw new Error("body must be a JSON object");
        resolve(parsed);
      } catch (err) {
        reject(new HttpError(400, err instanceof Error ? err.message : "invalid JSON body"));
      }
    });
  });
}

export function buildResearchHttpInput(
  body: Record<string, unknown>,
  req: IncomingMessage,
  opts: ResearchHttpHandlerOptions,
  signal: AbortSignal,
): ResearchRunInput {
  const prompt = stringValue(body.prompt)?.trim();
  const resumeCheckpointPath = stringValue(body.resumeCheckpointPath) ?? stringValue(body.resume);
  if (!prompt && !resumeCheckpointPath) throw new HttpError(400, "prompt is required");
  const mapped = opts.mapBodyToInput?.(body, req) ?? {};
  const humanReviewResponse = humanReviewResponseValue(body.humanReviewResponse ?? body.reviewResponse)
    ?? mapped.humanReviewResponse
    ?? opts.defaults?.humanReviewResponse;
  const effectiveResumeCheckpointPath = resumeCheckpointPath
    ?? mapped.resumeCheckpointPath
    ?? opts.defaults?.resumeCheckpointPath;
  if (humanReviewResponse && !effectiveResumeCheckpointPath) {
    throw new HttpError(400, "humanReviewResponse requires resumeCheckpointPath");
  }
  return {
    ...opts.defaults,
    ...mapped,
    prompt: prompt || "__resume__",
    sessionId: stringValue(body.sessionId) ?? stringValue(body.session),
    artifactDir: (opts.allowClientArtifactDir ? stringValue(body.artifactDir) : undefined) ?? mapped.artifactDir ?? opts.defaults?.artifactDir,
    language: stringValue(body.language) ?? stringValue(body.lang) ?? mapped.language ?? opts.defaults?.language,
    citationRequired: booleanValue(body.citationRequired) ?? booleanValue(body.citations) ?? mapped.citationRequired ?? opts.defaults?.citationRequired,
    maxCycles: numberValue(body.maxCycles) ?? numberValue(body.cycles) ?? mapped.maxCycles ?? opts.defaults?.maxCycles,
    completionRepairCycles: numberValue(body.completionRepairCycles) ?? mapped.completionRepairCycles ?? opts.defaults?.completionRepairCycles,
    reportMaxTokens: numberValue(body.reportMaxTokens) ?? numberValue(body.reportTokens) ?? mapped.reportMaxTokens ?? opts.defaults?.reportMaxTokens,
    reportMaxCalls: numberValue(body.reportMaxCalls) ?? numberValue(body.reportCalls) ?? mapped.reportMaxCalls ?? opts.defaults?.reportMaxCalls,
    reportContextTokenLimit: numberValue(body.reportContextTokenLimit) ?? numberValue(body.reportContext) ?? mapped.reportContextTokenLimit ?? opts.defaults?.reportContextTokenLimit,
    evidenceTargetSteps: numberValue(body.evidenceTargetSteps) ?? numberValue(body.agentTargetSteps) ?? numberValue(body.agentSteps) ?? mapped.evidenceTargetSteps ?? opts.defaults?.evidenceTargetSteps,
    evidenceTargetFetchCalls: numberValue(body.evidenceTargetFetchCalls) ?? numberValue(body.agentTargetFetchCalls) ?? numberValue(body.agentFetchCalls) ?? mapped.evidenceTargetFetchCalls ?? opts.defaults?.evidenceTargetFetchCalls,
    maxEpisodeCostUsd: numberValue(body.maxEpisodeCostUsd) ?? numberValue(body.maxCostUsd) ?? mapped.maxEpisodeCostUsd ?? opts.defaults?.maxEpisodeCostUsd,
    maxLlmRequests: numberValue(body.maxLlmRequests) ?? mapped.maxLlmRequests ?? opts.defaults?.maxLlmRequests,
    maxEpisodeTokens: numberValue(body.maxEpisodeTokens) ?? numberValue(body.maxTotalTokens) ?? mapped.maxEpisodeTokens ?? opts.defaults?.maxEpisodeTokens,
    adaptiveBudget: booleanValue(body.adaptiveBudget) ?? mapped.adaptiveBudget ?? opts.defaults?.adaptiveBudget,
    humanReview: booleanValue(body.humanReview) ?? booleanValue(body.requireHumanReview) ?? mapped.humanReview ?? opts.defaults?.humanReview,
    humanReviewResponse,
    evidenceQualityMode: evidenceQualityModeValue(body.evidenceQualityMode ?? body.quality) ?? mapped.evidenceQualityMode ?? opts.defaults?.evidenceQualityMode,
    debugSingleBranch: booleanValue(body.debugSingleBranch) ?? booleanValue(body.singleBranch) ?? mapped.debugSingleBranch ?? opts.defaults?.debugSingleBranch,
    debugMaxAspects: numberValue(body.debugMaxAspects) ?? numberValue(body.maxAspects) ?? mapped.debugMaxAspects ?? opts.defaults?.debugMaxAspects,
    debugMaxBranchesPerAspect: numberValue(body.debugMaxBranchesPerAspect) ?? numberValue(body.maxBranchesPerAspect) ?? mapped.debugMaxBranchesPerAspect ?? opts.defaults?.debugMaxBranchesPerAspect,
    debugMaxInitialAgentNodes: numberValue(body.debugMaxInitialAgentNodes) ?? numberValue(body.maxInitialAgentNodes) ?? mapped.debugMaxInitialAgentNodes ?? opts.defaults?.debugMaxInitialAgentNodes,
    debugMaxAgentNodeParts: numberValue(body.debugMaxAgentNodeParts) ?? numberValue(body.maxAgentNodeParts) ?? mapped.debugMaxAgentNodeParts ?? opts.defaults?.debugMaxAgentNodeParts,
    traceLevel: traceLevelValue(body.traceLevel ?? body.trace) ?? mapped.traceLevel ?? opts.defaults?.traceLevel,
    streamMode: streamModeValue(body.streamMode ?? body.stream) ?? mapped.streamMode ?? opts.defaults?.streamMode ?? "steps",
    streamMaxChars: numberValue(body.streamMaxChars) ?? mapped.streamMaxChars ?? opts.defaults?.streamMaxChars,
    checkpointDir: stringValue(body.checkpointDir) ?? mapped.checkpointDir ?? opts.defaults?.checkpointDir,
    resumeCheckpointPath: effectiveResumeCheckpointPath,
    disableCheckpoints: booleanValue(body.disableCheckpoints) ?? booleanValue(body.noCheckpoint) ?? mapped.disableCheckpoints ?? opts.defaults?.disableCheckpoints,
    signal,
    env: opts.env ?? process.env,
  };
}

function evidenceQualityModeValue(value: unknown): ResearchRunInput["evidenceQualityMode"] {
  const mode = stringValue(value)?.toLowerCase();
  if (mode === undefined) return undefined;
  if (mode === "advisory" || mode === "balanced" || mode === "strict") return mode;
  throw new HttpError(400, `unsupported evidence quality mode: ${mode}`);
}

function humanReviewResponseValue(value: unknown): ResearchRunInput["humanReviewResponse"] {
  if (value === undefined || value === null) return undefined;
  if (!isObject(value)) throw new HttpError(400, "humanReviewResponse must be an object");
  const decisions = value.decisions;
  if (!Array.isArray(decisions) || decisions.length === 0) throw new HttpError(400, "humanReviewResponse.decisions must be a non-empty array");
  return value as unknown as NonNullable<ResearchRunInput["humanReviewResponse"]>;
}

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function errorStatus(err: unknown): number {
  if (err instanceof ResearchRunConflictError) return 409;
  return err instanceof HttpError ? err.status : 500;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidRunId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function traceLevelValue(value: unknown): ResearchRunInput["traceLevel"] | undefined {
  return value === "summary" || value === "full" ? value : undefined;
}

function streamModeValue(value: unknown): ResearchRunInput["streamMode"] | undefined {
  return value === "off" || value === "summary" || value === "steps" || value === "full" || value === "transcript" ? value : undefined;
}

async function normalizeResumeBudget(input: ResearchRunInput): Promise<void> {
  if (!input.resumeCheckpointPath) return;
  const cursor = await readCheckpointCursor(input.resumeCheckpointPath).catch(() => undefined);
  const nextCycle = typeof cursor?.nextCycle === "number" ? cursor.nextCycle : undefined;
  if (!nextCycle || nextCycle < 1) return;
  if (input.maxCycles === undefined) input.maxCycles = nextCycle;
}

async function readCheckpointCursor(checkpointPath: string): Promise<{ nextCycle?: number } | undefined> {
  const inspected = await inspectResearchCheckpoint(checkpointPath);
  return inspected.checkpoint.cursor;
}
