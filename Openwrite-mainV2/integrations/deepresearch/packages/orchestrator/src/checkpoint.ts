import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { gunzip, gzip } from "node:zlib";
import type {
  AgentRunResult,
  EpisodeResult,
  GlobalRubric,
  MemoryEvent,
  ReportArtifact,
  ReportBundle,
  Reportlet,
  ReportNode,
  RuntimeProfile,
  TaskItem,
  TaskSubmission,
} from "@deepresearch/contracts";
import { createInMemoryKgService } from "@deepresearch/knowledge-graph";
import { createInMemoryMemoryGraph } from "@deepresearch/memory-graph";
import { createInMemoryTaskLedger } from "@deepresearch/task-ledger";
import type { EpisodeRunState, PhaseContext, SourceGuard, V5OrchestratorOptions } from "./types.js";
import { createPhaseContext } from "./phase-runner.js";
import { resolveEvidenceQualityPolicy } from "./evidence-quality.js";
import { exportFullTrace, exportSummaryTrace, wantsFullTrace } from "./trace.js";

export type ResumeStage =
  | "after_rubric"
  | "after_root"
  | "after_scout"
  | "after_main_planner"
  | "after_dispatch"
  | "after_structure_review"
  | "after_human_review"
  | "after_report";

export interface CheckpointCursor {
  stage: ResumeStage;
  nextCycle: number;
  pass: number;
  draftPath?: string;
}

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);
const EVENT_STORE_FILE = "events.jsonl.gz";
const VERSIONED_EVENT_STORE_PATTERN = /^events-[a-f0-9]{24}\.jsonl\.gz$/;
const DEFAULT_MAX_CHECKPOINT_FILES = 4;
const MAX_CHECKPOINT_BYTES = 256 * 1024 * 1024;
const MAX_EVENT_STORE_COMPRESSED_BYTES = 256 * 1024 * 1024;
const MAX_EVENT_STORE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

export interface ResearchCheckpoint {
  version: 1 | 2 | 3;
  savedAt: string;
  cursor: CheckpointCursor;
  state: SerializableRunState;
  stack: {
    reportNodes: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listReportNodes"]>>;
    knowledgeNodes: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listKnowledgeNodes"]>>;
    evidenceLinks: Awaited<ReturnType<PhaseContext["stack"]["kg"]["listEvidenceLinks"]>>;
    openGaps: NonNullable<Awaited<ReturnType<NonNullable<PhaseContext["stack"]["kg"]["listOpenGaps"]>>>>;
    reportlets: Reportlet[];
    tasks: TaskItem[];
    events?: MemoryEvent[];
  };
  eventStore?: {
    path: string;
    encoding: "gzip-jsonl";
    count: number;
    sha256?: string;
    compressedBytes?: number;
  };
}

export interface SerializableRunState {
  submission: TaskSubmission;
  runtimeProfile: RuntimeProfile;
  episodeId: string;
  startedAt: string;
  closedAt?: string;
  globalRubric?: GlobalRubric;
  rootTask?: TaskItem;
  rootNode?: ReportNode;
  scoutResult?: AgentRunResult;
  agentResults: AgentRunResult[];
  reportBundle?: ReportBundle;
  reportArtifact?: ReportArtifact;
  result?: EpisodeResult;
  fetchCache: Array<[string, { url: string; title: string; content: string; description?: string } | undefined]>;
  sourceGuards?: SourceGuard[];
  eventSequence?: number;
  issueWaivers?: EpisodeRunState["issueWaivers"];
  humanReviewResponsePath?: string;
  budgetUsage?: EpisodeRunState["budgetUsage"];
  budgetBreaches?: EpisodeRunState["budgetBreaches"];
  cycleGains?: EpisodeRunState["cycleGains"];
  adaptiveStop?: EpisodeRunState["adaptiveStop"];
}

export interface RestoredCheckpoint {
  ctx: PhaseContext;
  cursor: CheckpointCursor;
  checkpointPath: string;
}

export interface InspectedResearchCheckpoint {
  checkpoint: ResearchCheckpoint;
  checkpointPath: string;
  events: MemoryEvent[];
}

export async function saveResearchCheckpoint(
  ctx: PhaseContext,
  cursor: CheckpointCursor,
  opts: Pick<V5OrchestratorOptions, "checkpointDir" | "disableCheckpoints" | "maxCheckpointFiles"> = {},
): Promise<string | undefined> {
  if (opts.disableCheckpoints) return undefined;
  if (!ctx.state.episodeId) return undefined;
  const dir = checkpointDir(ctx, opts.checkpointDir);
  await mkdir(dir, { recursive: true });
  const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
  const eventStore = await writeEventStore(dir, events);
  const checkpoint = await buildCheckpoint(ctx, cursor, eventStore);
  const name = `${String(Date.now()).padStart(13, "0")}_${process.hrtime.bigint().toString().padStart(20, "0")}_${cursor.stage}_${randomUUID().slice(0, 8)}.json`;
  const path = join(dir, name);
  const json = `${JSON.stringify(checkpoint)}\n`;
  await atomicWriteFile(path, json);
  await atomicWriteFile(join(dir, "latest.json"), json);
  await atomicWriteFile(join(dir, "latest-path.txt"), `${path}\n`);
  await pruneCheckpointFiles(dir, opts.maxCheckpointFiles ?? DEFAULT_MAX_CHECKPOINT_FILES, name, eventStore.path);
  return path;
}

export async function restoreResearchCheckpoint(
  checkpointPath: string,
  opts: V5OrchestratorOptions,
): Promise<RestoredCheckpoint> {
  const candidates = await resolveCheckpointCandidates(checkpointPath);
  const failures: string[] = [];
  for (const resolved of candidates) {
    try {
      return await restoreCheckpointFile(resolved, opts);
    } catch (err) {
      if (candidates.length === 1) throw err;
      failures.push(`${basename(resolved)}: ${errorMessage(err)}`);
    }
  }
  throw new Error(`No restorable checkpoint found in ${resolve(checkpointPath)}. ${failures.join(" | ")}`);
}

export async function inspectResearchCheckpoint(checkpointPath: string): Promise<InspectedResearchCheckpoint> {
  const candidates = await resolveCheckpointCandidates(checkpointPath);
  const failures: string[] = [];
  for (const resolved of candidates) {
    try {
      const checkpoint = await readValidatedCheckpoint(resolved);
      const events = await readResearchCheckpointEvents(checkpoint, resolved);
      return { checkpoint, checkpointPath: resolved, events };
    } catch (err) {
      if (candidates.length === 1) throw err;
      failures.push(`${basename(resolved)}: ${errorMessage(err)}`);
    }
  }
  throw new Error(`No valid checkpoint found in ${resolve(checkpointPath)}. ${failures.join(" | ")}`);
}

export async function writeCheckpointFailure(
  ctx: PhaseContext | undefined,
  err: unknown,
  opts: Pick<V5OrchestratorOptions, "checkpointDir" | "disableCheckpoints"> = {},
): Promise<void> {
  if (!ctx || opts.disableCheckpoints || !ctx.state.episodeId) return;
  const dir = checkpointDir(ctx, opts.checkpointDir);
  await mkdir(dir, { recursive: true });
  await writeFailureTraceArtifacts(ctx).catch(() => undefined);
  await atomicWriteFile(join(dir, "last-error.json"), `${JSON.stringify({
    episodeId: ctx.state.episodeId,
    failedAt: new Date(ctx.now()).toISOString(),
    error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { message: String(err) },
  }, null, 2)}\n`);
}

function checkpointDir(ctx: PhaseContext, override?: string): string {
  return resolve(override ?? join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId, "checkpoints"));
}

async function writeFailureTraceArtifacts(ctx: PhaseContext): Promise<void> {
  const artifactDir = resolve(join(ctx.state.runtimeProfile.artifactDir, ctx.state.episodeId));
  await mkdir(artifactDir, { recursive: true });
  await writeFile(join(artifactDir, "trace.jsonl"), await exportSummaryTrace(ctx), "utf8");
  if (wantsFullTrace(ctx)) {
    await writeFile(join(artifactDir, "trace-full.jsonl"), await exportFullTrace(ctx), "utf8");
  }
}

async function buildCheckpoint(
  ctx: PhaseContext,
  cursor: CheckpointCursor,
  eventStore: NonNullable<ResearchCheckpoint["eventStore"]>,
): Promise<ResearchCheckpoint> {
  return {
    version: 3,
    savedAt: new Date(ctx.now()).toISOString(),
    cursor,
    state: serializeState(ctx.state),
    stack: {
      reportNodes: await ctx.stack.kg.listReportNodes(),
      knowledgeNodes: await ctx.stack.kg.listKnowledgeNodes(),
      evidenceLinks: await ctx.stack.kg.listEvidenceLinks(),
      openGaps: await ctx.stack.kg.listOpenGaps?.() ?? [],
      reportlets: await ctx.stack.kg.listReportlets?.() ?? [],
      tasks: await ctx.stack.ledger.listAll(),
    },
    eventStore,
  };
}

function serializeState(state: EpisodeRunState): SerializableRunState {
  return {
    submission: state.submission,
    runtimeProfile: state.runtimeProfile,
    episodeId: state.episodeId,
    startedAt: state.startedAt,
    closedAt: state.closedAt,
    globalRubric: state.globalRubric,
    rootTask: state.rootTask,
    rootNode: state.rootNode,
    scoutResult: state.scoutResult,
    agentResults: state.agentResults,
    reportBundle: state.reportBundle,
    reportArtifact: state.reportArtifact,
    result: state.result,
    fetchCache: Array.from(state.fetchCache.entries()),
    sourceGuards: state.sourceGuards,
    eventSequence: state.eventSequence,
    issueWaivers: state.issueWaivers,
    humanReviewResponsePath: state.humanReviewResponsePath,
    budgetUsage: state.budgetUsage,
    budgetBreaches: state.budgetBreaches,
    cycleGains: state.cycleGains,
    adaptiveStop: state.adaptiveStop,
  };
}

async function restoreStack(checkpoint: ResearchCheckpoint, checkpointPath: string): Promise<Required<Pick<PhaseContext["stack"], "kg" | "ledger" | "memory">>> {
  const kg = createInMemoryKgService();
  for (const node of checkpoint.stack.reportNodes) await kg.upsertReportNode(node);
  for (const node of checkpoint.stack.knowledgeNodes) await kg.upsertKnowledgeNode(node);
  for (const link of checkpoint.stack.evidenceLinks) await kg.upsertEvidenceLink(link);
  for (const gap of checkpoint.stack.openGaps) await kg.addOpenGap?.(gap);
  for (const reportlet of checkpoint.stack.reportlets ?? []) await kg.upsertReportlet?.(reportlet);
  const events = await readResearchCheckpointEvents(checkpoint, checkpointPath);
  return {
    kg,
    ledger: createInMemoryTaskLedger({ initial: checkpoint.stack.tasks }),
    memory: createInMemoryMemoryGraph({ initial: events }),
  };
}

export async function readResearchCheckpointEvents(
  checkpoint: ResearchCheckpoint,
  checkpointPath: string,
): Promise<MemoryEvent[]> {
  return checkpoint.eventStore
    ? await readEventStore(dirname(checkpointPath), checkpoint.eventStore)
    : checkpoint.stack.events ?? [];
}

async function writeEventStore(
  dir: string,
  events: MemoryEvent[],
): Promise<NonNullable<ResearchCheckpoint["eventStore"]>> {
  const content = events.map((event) => JSON.stringify(event)).join("\n");
  const compressed = await gzipAsync(Buffer.from(content, "utf8"), { level: 1 });
  const sha256 = createHash("sha256").update(compressed).digest("hex");
  const filename = `events-${sha256.slice(0, 24)}.jsonl.gz`;
  await atomicWriteFile(join(dir, filename), compressed);
  return {
    path: filename,
    encoding: "gzip-jsonl",
    count: events.length,
    sha256,
    compressedBytes: compressed.byteLength,
  };
}

async function readEventStore(
  dir: string,
  store: NonNullable<ResearchCheckpoint["eventStore"]>,
): Promise<MemoryEvent[]> {
  const path = resolveEventStorePath(dir, store.path);
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("Checkpoint event store must be a regular file");
  if (fileStat.size > MAX_EVENT_STORE_COMPRESSED_BYTES) {
    throw new Error(`Checkpoint event store exceeds ${MAX_EVENT_STORE_COMPRESSED_BYTES} compressed bytes`);
  }
  const compressed = await readFile(path);
  if (store.compressedBytes !== undefined && compressed.byteLength !== store.compressedBytes) {
    throw new Error(`Checkpoint event store size mismatch: expected ${store.compressedBytes}, observed ${compressed.byteLength}`);
  }
  if (store.sha256) {
    const observed = createHash("sha256").update(compressed).digest("hex");
    if (observed !== store.sha256) throw new Error("Checkpoint event store checksum mismatch");
  }
  const content = (await gunzipAsync(compressed, { maxOutputLength: MAX_EVENT_STORE_UNCOMPRESSED_BYTES })).toString("utf8");
  if (!content) {
    if (store.count > 0) throw new Error(`Checkpoint event store expected ${store.count} events, observed 0`);
    return [];
  }
  const parsed = content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as MemoryEvent);
  if (parsed.length < store.count) {
    throw new Error(`Checkpoint event store expected ${store.count} events, observed ${parsed.length}`);
  }
  return parsed.slice(0, store.count);
}

async function pruneCheckpointFiles(dir: string, maxFiles: number, currentName: string, currentEventStore: string): Promise<void> {
  const keep = Number.isFinite(maxFiles) ? Math.max(1, Math.floor(maxFiles)) : DEFAULT_MAX_CHECKPOINT_FILES;
  const files = (await readdir(dir))
    .filter((name) => /^\d{13}_.+\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a));
  const retained = new Set([currentName, ...files.filter((name) => name !== currentName).slice(0, keep - 1)]);
  await Promise.all(files.filter((name) => !retained.has(name)).map((name) => unlink(join(dir, name))));
  await pruneEventStoreFiles(dir, retained, currentEventStore);
}

function restoreState(state: EpisodeRunState, snapshot: SerializableRunState): void {
  state.submission = snapshot.submission;
  state.runtimeProfile = {
    ...snapshot.runtimeProfile,
    evidenceQuality: resolveEvidenceQualityPolicy(snapshot.runtimeProfile.evidenceQuality),
  };
  state.episodeId = snapshot.episodeId;
  state.startedAt = snapshot.startedAt;
  state.closedAt = snapshot.closedAt;
  state.globalRubric = snapshot.globalRubric;
  state.rootTask = snapshot.rootTask;
  state.rootNode = snapshot.rootNode;
  state.scoutResult = snapshot.scoutResult;
  state.agentResults = snapshot.agentResults ?? [];
  state.reportBundle = snapshot.reportBundle;
  state.reportArtifact = snapshot.reportArtifact;
  state.result = snapshot.result;
  state.fetchCache = new Map(snapshot.fetchCache ?? []);
  state.sourceGuards = snapshot.sourceGuards ?? [];
  state.eventSequence = snapshot.eventSequence ?? 0;
  state.issueWaivers = snapshot.issueWaivers ?? [];
  state.humanReviewResponsePath = snapshot.humanReviewResponsePath;
  state.budgetUsage = snapshot.budgetUsage ?? {};
  state.budgetBreaches = snapshot.budgetBreaches ?? [];
  state.cycleGains = snapshot.cycleGains ?? [];
  state.adaptiveStop = snapshot.adaptiveStop;
}

function eventSequenceFromId(event: MemoryEvent): number {
  const match = event.eventId.match(/_(\d+)$/);
  const sequence = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}

async function restoreCheckpointFile(resolved: string, opts: V5OrchestratorOptions): Promise<RestoredCheckpoint> {
  const checkpoint = await readValidatedCheckpoint(resolved);
  const stack = await restoreStack(checkpoint, resolved);
  const ctx = createPhaseContext(checkpoint.state.submission, {
    ...opts,
    runtimeProfile: opts.runtimeProfile ?? checkpoint.state.runtimeProfile,
    artifactDir: opts.artifactDir ?? checkpoint.state.runtimeProfile.artifactDir,
    stack: { ...opts.stack, ...stack },
  });
  restoreState(ctx.state, checkpoint.state);
  const restoredEvents = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
  ctx.state.eventSequence = Math.max(
    ctx.state.eventSequence,
    restoredEvents.length,
    ...restoredEvents.map(eventSequenceFromId),
  );
  if (opts.runtimeProfile) ctx.state.runtimeProfile = opts.runtimeProfile;
  if (opts.artifactDir) ctx.state.runtimeProfile.artifactDir = opts.artifactDir;
  return { ctx, cursor: checkpoint.cursor, checkpointPath: resolved };
}

async function resolveCheckpointCandidates(input: string): Promise<string[]> {
  const resolved = resolve(input);
  if (resolved.endsWith(".json") && basename(resolved) !== "latest.json") return [resolved];
  const dir = basename(resolved) === "latest.json" ? dirname(resolved) : resolved;
  const files = await readdir(dir);
  const timestamped = files
    .filter((name) => /^\d{13}_.+\.json$/.test(name))
    .sort((a, b) => b.localeCompare(a))
    .map((name) => join(dir, name));
  return [join(dir, "latest.json"), ...timestamped];
}

async function readValidatedCheckpoint(path: string): Promise<ResearchCheckpoint> {
  const fileStat = await lstat(path);
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error("Checkpoint must be a regular file");
  if (fileStat.size > MAX_CHECKPOINT_BYTES) throw new Error(`Checkpoint exceeds ${MAX_CHECKPOINT_BYTES} bytes`);
  const checkpoint = JSON.parse(await readFile(path, "utf8")) as ResearchCheckpoint;
  validateCheckpoint(checkpoint);
  return checkpoint;
}

function validateCheckpoint(checkpoint: ResearchCheckpoint): void {
  if (!checkpoint || typeof checkpoint !== "object") throw new Error("Checkpoint must be a JSON object");
  if (checkpoint.version !== 1 && checkpoint.version !== 2 && checkpoint.version !== 3) {
    throw new Error(`Unsupported checkpoint version: ${String(checkpoint.version)}`);
  }
  if (!checkpoint.cursor || !isResumeStage(checkpoint.cursor.stage)) throw new Error("Checkpoint cursor stage is invalid");
  if (!Number.isSafeInteger(checkpoint.cursor.nextCycle) || checkpoint.cursor.nextCycle < 1
    || !Number.isSafeInteger(checkpoint.cursor.pass) || checkpoint.cursor.pass < 0) {
    throw new Error("Checkpoint cursor counters are invalid");
  }
  if (!checkpoint.state || typeof checkpoint.state.episodeId !== "string" || !checkpoint.state.episodeId) {
    throw new Error("Checkpoint state episodeId is required");
  }
  if (!checkpoint.state.submission || !checkpoint.state.runtimeProfile) throw new Error("Checkpoint state submission and runtimeProfile are required");
  if (!checkpoint.stack || !Array.isArray(checkpoint.stack.reportNodes) || !Array.isArray(checkpoint.stack.knowledgeNodes)
    || !Array.isArray(checkpoint.stack.evidenceLinks) || !Array.isArray(checkpoint.stack.openGaps)
    || !Array.isArray(checkpoint.stack.tasks)) {
    throw new Error("Checkpoint stack arrays are invalid");
  }
  if (checkpoint.eventStore) {
    if (checkpoint.eventStore.encoding !== "gzip-jsonl") throw new Error("Checkpoint event store encoding is unsupported");
    if (!Number.isSafeInteger(checkpoint.eventStore.count) || checkpoint.eventStore.count < 0) {
      throw new Error("Checkpoint event store count is invalid");
    }
    resolveEventStorePath(".", checkpoint.eventStore.path);
    if (checkpoint.eventStore.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(checkpoint.eventStore.sha256)) {
      throw new Error("Checkpoint event store checksum is invalid");
    }
    if (checkpoint.eventStore.compressedBytes !== undefined
      && (!Number.isSafeInteger(checkpoint.eventStore.compressedBytes) || checkpoint.eventStore.compressedBytes < 0)) {
      throw new Error("Checkpoint event store compressed size is invalid");
    }
    if (checkpoint.version === 3 && (!checkpoint.eventStore.sha256 || checkpoint.eventStore.compressedBytes === undefined
      || !VERSIONED_EVENT_STORE_PATTERN.test(checkpoint.eventStore.path))) {
      throw new Error("Checkpoint v3 requires an immutable checksummed event store");
    }
  }
}

function isResumeStage(value: unknown): value is ResumeStage {
  return [
    "after_rubric",
    "after_root",
    "after_scout",
    "after_main_planner",
    "after_dispatch",
    "after_structure_review",
    "after_human_review",
    "after_report",
  ].includes(String(value));
}

function resolveEventStorePath(dir: string, filename: string): string {
  if (typeof filename !== "string" || basename(filename) !== filename
    || (filename !== EVENT_STORE_FILE && !VERSIONED_EVENT_STORE_PATTERN.test(filename))) {
    throw new Error(`Checkpoint event store path is invalid: ${String(filename)}`);
  }
  return resolve(dir, filename);
}

async function pruneEventStoreFiles(dir: string, retainedCheckpoints: Set<string>, currentEventStore: string): Promise<void> {
  const referenced = new Set([currentEventStore]);
  for (const filename of ["latest.json", ...retainedCheckpoints]) {
    try {
      const checkpoint = JSON.parse(await readFile(join(dir, filename), "utf8")) as ResearchCheckpoint;
      if (checkpoint.eventStore?.path && VERSIONED_EVENT_STORE_PATTERN.test(checkpoint.eventStore.path)) {
        referenced.add(checkpoint.eventStore.path);
      }
    } catch {
      // A malformed retained checkpoint is left for restore fallback diagnostics.
    }
  }
  const files = await readdir(dir);
  await Promise.all(files
    .filter((name) => VERSIONED_EVENT_STORE_PATTERN.test(name) && !referenced.has(name))
    .map((name) => unlink(join(dir, name))));
}

async function atomicWriteFile(path: string, data: string | Uint8Array): Promise<void> {
  const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  let closed = false;
  let renamed = false;
  try {
    if (typeof data === "string") await handle.writeFile(data, "utf8");
    else await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    closed = true;
    await rename(temporaryPath, path);
    renamed = true;
    await syncDirectory(dirname(path));
  } finally {
    if (!closed) await handle.close().catch(() => undefined);
    if (!renamed) await unlink(temporaryPath).catch(() => undefined);
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r").catch(() => undefined);
  if (!handle) return;
  try {
    await handle.sync().catch(() => undefined);
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
