import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { LlmChat, SearchProvider } from "@deepresearch/contracts";
import { CheckpointPauseError, createInMemoryOrchestrator, loadDefaultRuntimeProfile } from "../index.js";
import { restoreResearchCheckpoint, saveResearchCheckpoint, writeCheckpointFailure } from "../checkpoint.js";
import { EchoJsonLlm } from "../infra/mock-llm.js";
import { createPhaseContext } from "../phase-runner.js";
import { cycleReflectionPhase } from "../phases/cycle-reflection.js";
import { agentNodePartPlans, evidenceTaskRuntimeBudget } from "../phases/dispatch-evidence.js";
import { fixedNow, submission, node, task, agentResultWithGap } from "./helpers/v5-orchestrator-fixtures.js";

describe("v5 Orchestrator", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  async function artifactDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "dr-v5-orch-"));
    dirs.push(dir);
    return dir;
  }
  it("resumes from the latest checkpoint after a publish failure without rerunning main planning", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.hilMode = "explicit";
    if (!runtimeProfile.phases.dispatchEvidence) throw new Error("dispatchEvidence phase config required");
    runtimeProfile.phases.dispatchEvidence.maxCycles = 1;
    const echo = new EchoJsonLlm();
    const failingPublishLlm: LlmChat = {
      name: "echo-scripted-publish-failure",
      async chat(req) {
        if (req.user.includes("Semantic publish review")) return { content: JSON.stringify({
          decision: "needs_repair",
          reasoningSummary: "The draft retains an unsupported central claim.",
          issues: [{ code: "overclaim", severity: "error", message: "Unsupported central claim remains in the draft." }],
        }) };
        return echo.chat(req);
      },
    };
    const search: SearchProvider = {
      name: "checkpoint-resume-search",
      async search(query, topK) {
        return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
          url: `https://example.test/resume/${index + 1}`,
          title: `Resume source ${index + 1}`,
          snippet: `Evidence for ${query}`,
        }));
      },
    };

    const failedPublish = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: failingPublishLlm,
      search,
      checkpointDir,
    }).runEpisode(submission());
    expect(failedPublish.status).toBe("needs_human_review");
    expect(failedPublish.humanReview?.stage).toBe("publish_gate");
    expect(failedPublish.humanReview?.questions.length).toBeGreaterThan(0);
    expect(await readFile(failedPublish.reportArtifactPath, "utf8")).toContain("报告发布需要你的决定");

    const checkpoint = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as { cursor: { stage: string } };
    expect(checkpoint.cursor.stage).toBe("after_report");

    let mainPlannerCallsAfterResume = 0;
    const resumeLlm: LlmChat = {
      name: "echo-json",
      async chat(req) {
        if (req.user.startsWith("Build GlobalRubric JSON")) mainPlannerCallsAfterResume += 1;
        return echo.chat(req);
      },
    };

    const resumed = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: resumeLlm,
      search,
      resumeCheckpointPath: checkpointDir,
      checkpointDir,
    }).runEpisode(submission());

    expect(resumed.status).toBe("succeeded");
    expect(mainPlannerCallsAfterResume).toBe(0);
  });

  it("pauses cleanly at one checkpoint and resumes to the next checkpoint", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "step-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const first = createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      checkpointDir,
      pauseAfterCheckpoint: "after_rubric",
    }).runEpisode(submission(), { episodeId: "EP_step_checkpoint" });

    await expect(first).rejects.toMatchObject({
      name: "CheckpointPauseError",
      stage: "after_rubric",
    } satisfies Partial<CheckpointPauseError>);
    const firstCheckpoint = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as { cursor: { stage: string } };
    expect(firstCheckpoint.cursor.stage).toBe("after_rubric");
    await expect(readFile(join(checkpointDir, "last-error.json"), "utf8")).rejects.toThrow();

    const second = createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: new EchoJsonLlm(),
      checkpointDir,
      resumeCheckpointPath: checkpointDir,
      pauseAfterCheckpoint: "after_root",
    }).runEpisode(submission());

    await expect(second).rejects.toMatchObject({
      name: "CheckpointPauseError",
      stage: "after_root",
    } satisfies Partial<CheckpointPauseError>);
    const checkpoint = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as { state: { episodeId: string }; cursor: { stage: string } };
    expect(checkpoint).toMatchObject({ state: { episodeId: "EP_step_checkpoint" }, cursor: { stage: "after_root" } });
  });

  it("resumes main planning from the scout checkpoint after architect failure", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "planner-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const echo = new EchoJsonLlm();
    const failingArchitectLlm: LlmChat = {
      name: "scripted-architect-failure",
      async chat(req) {
        if (req.user.includes("Initial source map:")) throw new Error("architect failed");
        return echo.chat(req);
      },
    };
    const search: SearchProvider = {
      name: "checkpoint-planner-search",
      async search(query, topK) {
        return Array.from({ length: Math.min(topK, 3) }, (_, index) => ({
          url: `https://example.test/planner/${index + 1}`,
          title: `Planner source ${index + 1}`,
          snippet: `Evidence for ${query}`,
        }));
      },
    };

    await expect(createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: failingArchitectLlm,
      search,
      checkpointDir,
    }).runEpisode(submission())).rejects.toThrow("architect failed");

    const checkpoint = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as { cursor: { stage: string } };
    expect(checkpoint.cursor.stage).toBe("after_scout");

    let scoutCallsAfterResume = 0;
    const resumeLlm: LlmChat = {
      name: "echo-json",
      async chat(req) {
        if (req.user.includes("Plan scout searches")) scoutCallsAfterResume += 1;
        return echo.chat(req);
      },
    };

    const resumed = await createInMemoryOrchestrator({
      now: fixedNow,
      artifactDir: dir,
      runtimeProfile,
      llm: resumeLlm,
      search,
      resumeCheckpointPath: checkpointDir,
      checkpointDir,
    }).runEpisode(submission());

    expect(resumed.status).toBe("succeeded");
    expect(scoutCallsAfterResume).toBe(0);
  });

  it("preserves runtime overrides when restoring a checkpoint", async () => {
    const dir = await artifactDir();
    const checkpointPath = join(dir, "checkpoint.json");
    const snapshotProfile = loadDefaultRuntimeProfile();
    snapshotProfile.artifactDir = join(dir, "old-artifacts");
    const overrideProfile = loadDefaultRuntimeProfile();
    overrideProfile.artifactDir = join(dir, "new-artifacts");
    await writeFile(checkpointPath, JSON.stringify({
      version: 1,
      savedAt: new Date(fixedNow()).toISOString(),
      cursor: { stage: "after_main_planner", nextCycle: 1, pass: 1 },
      state: {
        submission: submission(),
        runtimeProfile: snapshotProfile,
        episodeId: "EP_restore_override",
        startedAt: new Date(fixedNow()).toISOString(),
        agentResults: [],
        fetchCache: [],
      },
      stack: {
        reportNodes: [],
        knowledgeNodes: [],
        evidenceLinks: [],
        openGaps: [],
        tasks: [],
        events: [],
      },
    }, null, 2), "utf8");

    const restored = await restoreResearchCheckpoint(checkpointPath, {
      now: fixedNow,
      runtimeProfile: overrideProfile,
      artifactDir: overrideProfile.artifactDir,
      llm: new EchoJsonLlm(),
    });

    expect(restored.ctx.state.runtimeProfile.artifactDir).toBe(overrideProfile.artifactDir);
    expect(restored.ctx.state.issueWaivers).toEqual([]);
    expect(restored.ctx.state.humanReviewResponsePath).toBeUndefined();
  });

  it("restores temporal reportlet plans and their bounded fetch budget", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "temporal-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_temporal_checkpoint";
    const reportNode = node({ nodeId: "R_temporal_checkpoint", nodeKind: "hypothesis", label: "2015-2022 年在建线路总里程" });
    const original = task({
      taskId: "T_temporal_checkpoint",
      reportNodeId: reportNode.nodeId,
      title: "逐年在建里程",
      acceptanceCriteria: ["提供2015-2022年每年数据，单位公里"],
    });
    original.plannedReportlets = agentNodePartPlans(original, reportNode, 2, "zh-CN");
    await ctx.stack.ledger.upsert(original);

    const checkpointPath = await saveResearchCheckpoint(ctx, { stage: "after_main_planner", nextCycle: 1, pass: 1 }, { checkpointDir });
    const restored = await restoreResearchCheckpoint(checkpointPath!, { now: fixedNow, llm: new EchoJsonLlm() });
    const restoredTask = await restored.ctx.stack.ledger.getById(original.taskId);

    expect(restoredTask?.plannedReportlets?.map((part) => part.researchQuestion)).toEqual([
      expect.stringContaining("2015-2018"),
      expect.stringContaining("2019-2022"),
    ]);
    expect(evidenceTaskRuntimeBudget(restoredTask!, {
      maxReactSteps: 12,
      maxToolCalls: 11,
      maxSearchCalls: 2,
      maxFetchCalls: 3,
    }).maxFetchCalls).toBe(4);
  });

  it("stores checkpoint events in immutable verified sidecars and restores each event cursor", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "compact-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_compact_checkpoint";
    await ctx.emit({ eventType: "episode_started", payload: { objective: "compact checkpoint", large: "x".repeat(200_000) } });

    const firstPath = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    await ctx.emit({ eventType: "rubric_created", payload: { rubricId: "RB_after_first_checkpoint" } });
    await saveResearchCheckpoint(ctx, { stage: "after_scout", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });

    const latest = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as {
      version: number;
      stack: { events?: unknown[] };
      eventStore: { path: string; count: number; sha256?: string; compressedBytes?: number };
    };
    expect(latest.version).toBe(3);
    expect(latest.stack.events).toBeUndefined();
    expect(latest.eventStore).toMatchObject({ count: 2 });
    expect(latest.eventStore.path).toMatch(/^events-[a-f0-9]{24}\.jsonl\.gz$/);
    expect(latest.eventStore.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(latest.eventStore.compressedBytes).toBeGreaterThan(0);
    expect((await stat(join(checkpointDir, "latest.json"))).size).toBeLessThan(20_000);
    expect((await stat(join(checkpointDir, latest.eventStore.path))).size).toBeLessThan(20_000);

    const restoredFirst = await restoreResearchCheckpoint(firstPath!, { now: fixedNow, llm: new EchoJsonLlm() });
    const firstEvents = await restoredFirst.ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(firstEvents.map((event) => event.eventType)).toEqual(["episode_started"]);

    const restoredLatest = await restoreResearchCheckpoint(checkpointDir, { now: fixedNow, llm: new EchoJsonLlm() });
    const latestEvents = await restoredLatest.ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(latestEvents.map((event) => event.eventType)).toEqual(["episode_started", "rubric_created"]);
    expect(latestEvents[0]?.payload?.large).toBe("x".repeat(200_000));
  });

  it("falls back to the newest valid timestamped checkpoint when latest.json is corrupt", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "fallback-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_checkpoint_fallback";
    await ctx.emit({ eventType: "episode_started", payload: { objective: "fallback" } });
    await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    await ctx.emit({ eventType: "rubric_created", payload: { rubricId: "RB_fallback" } });
    const newest = await saveResearchCheckpoint(ctx, { stage: "after_scout", nextCycle: 2, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    await writeFile(join(checkpointDir, "latest.json"), "{interrupted", "utf8");

    const restored = await restoreResearchCheckpoint(checkpointDir, { now: fixedNow, llm: new EchoJsonLlm() });
    const events = await restored.ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });

    expect(restored.checkpointPath).toBe(newest);
    expect(restored.cursor).toMatchObject({ stage: "after_scout", nextCycle: 2 });
    expect(events.map((event) => event.eventType)).toEqual(["episode_started", "rubric_created"]);
  });

  it("falls back to an older checkpoint when the newest immutable event snapshot is corrupt", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "event-fallback-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_event_checkpoint_fallback";
    await ctx.emit({ eventType: "episode_started", payload: { objective: "event fallback" } });
    const older = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    await ctx.emit({ eventType: "rubric_created", payload: { rubricId: "RB_event_fallback" } });
    await saveResearchCheckpoint(ctx, { stage: "after_scout", nextCycle: 2, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    const latest = JSON.parse(await readFile(join(checkpointDir, "latest.json"), "utf8")) as { eventStore: { path: string } };
    await writeFile(join(checkpointDir, latest.eventStore.path), "corrupt gzip bytes", "utf8");

    const restored = await restoreResearchCheckpoint(checkpointDir, { now: fixedNow, llm: new EchoJsonLlm() });
    const events = await restored.ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });

    expect(restored.checkpointPath).toBe(older);
    expect(restored.cursor.stage).toBe("after_root");
    expect(events.map((event) => event.eventType)).toEqual(["episode_started"]);
  });

  it("rejects event-store path traversal and checksum corruption for explicit checkpoints", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "validated-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_validated_checkpoint";
    await ctx.emit({ eventType: "episode_started", payload: { objective: "validated" } });
    const checkpointPath = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir });
    const checkpoint = JSON.parse(await readFile(checkpointPath!, "utf8")) as { eventStore: { path: string } };
    const traversalPath = join(checkpointDir, "traversal.json");
    await writeFile(traversalPath, JSON.stringify({ ...checkpoint, eventStore: { ...checkpoint.eventStore, path: "../escape.gz" } }), "utf8");

    await expect(restoreResearchCheckpoint(traversalPath, { now: fixedNow, llm: new EchoJsonLlm() }))
      .rejects.toThrow("event store path is invalid");

    await writeFile(join(checkpointDir, checkpoint.eventStore.path), "corrupt", "utf8");
    await expect(restoreResearchCheckpoint(checkpointPath!, { now: fixedNow, llm: new EchoJsonLlm() }))
      .rejects.toThrow(/size mismatch|checksum mismatch/);
  });

  it("creates unique atomic checkpoint files without leaving temporary files", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "atomic-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_atomic_checkpoint";
    const first = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });
    const second = await saveResearchCheckpoint(ctx, { stage: "after_root", nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 10 });

    expect(first).not.toBe(second);
    const files = await readdir(checkpointDir);
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(files.filter((name) => /^\d{13}_.+\.json$/.test(name))).toHaveLength(2);
  });

  it("retains only the configured number of timestamped checkpoints", async () => {
    const dir = await artifactDir();
    const checkpointDir = join(dir, "retained-checkpoints");
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_checkpoint_retention";
    const stages = ["after_rubric", "after_root", "after_scout", "after_main_planner", "after_dispatch", "after_structure_review"] as const;

    for (const stage of stages) {
      await ctx.emit({ eventType: "checkpoint_test_event", payload: { stage } });
      await saveResearchCheckpoint(ctx, { stage, nextCycle: 1, pass: 1 }, { checkpointDir, maxCheckpointFiles: 3 });
    }

    const timestamped = (await readdir(checkpointDir)).filter((name) => /^\d{13}_.+\.json$/.test(name));
    expect(timestamped).toHaveLength(3);
    await expect(readFile(join(checkpointDir, "latest.json"), "utf8")).resolves.toContain("after_structure_review");
    const eventStores = (await readdir(checkpointDir)).filter((name) => /^events-[a-f0-9]{24}\.jsonl\.gz$/.test(name));
    expect(eventStores).toHaveLength(3);
    await Promise.all(eventStores.map((name) => expect(readFile(join(checkpointDir, name))).resolves.toBeInstanceOf(Buffer)));
  });

  it("writes trace artifacts when checkpoint failure is recorded", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm: new EchoJsonLlm() });
    ctx.state.episodeId = "EP_failure_trace";
    await ctx.emit({ eventType: "episode_started", payload: { objective: "failure trace" } });

    await writeCheckpointFailure(ctx, new Error("boom"));

    await expect(readFile(join(dir, "EP_failure_trace", "trace.jsonl"), "utf8")).resolves.toContain("episode_started");
    await expect(readFile(join(dir, "EP_failure_trace", "trace-full.jsonl"), "utf8")).resolves.toContain("episode_started");
    await expect(readFile(join(dir, "EP_failure_trace", "checkpoints", "last-error.json"), "utf8")).resolves.toContain("boom");
  });

  it("creates follow-up repair tasks when reflection requeues completed work", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: [{ taskId: "T_done", newStatus: "queued", reason: "Evidence gap still needs a primary-source check." }],
          newTasks: [],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflect_repair";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", label: "Hypothesis", parentNodeId: "R_root", status: "partially_supported" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_1", status: "completed" }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_1")]);

    expect(reflection.continueDispatch).toBe(true);
    const queued = await ctx.stack.ledger.listByStatus("queued");
    expect(queued.some((item) => item.taskId.startsWith("T_repair_") && item.parentTaskId === "T_done")).toBe(true);
    await expect(ctx.stack.ledger.getById("T_done")).resolves.toMatchObject({ status: "completed" });
  });

  it("skips illegal reflection status updates for completed tasks", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-reflection-illegal-status",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: false,
          taskUpdates: [{ taskId: "T_done", newStatus: "failed", reason: "The completed task still has unresolved gaps." }],
          newTasks: [],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflect_illegal_status";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", label: "Hypothesis", parentNodeId: "R_root", status: "partially_supported" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_1", status: "completed" }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_1")]);

    expect(reflection.continueDispatch).toBe(true);
    await expect(ctx.stack.ledger.getById("T_done")).resolves.toMatchObject({ status: "completed" });
    expect((await ctx.stack.ledger.listByStatus("queued")).some((task) => task.taskId.startsWith("T_gap_"))).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.ledger.updateStatusSkipped" && event.payload?.reason === "illegal_terminal_task_update")).toBe(true);
  });

  it("runs ReflectionSchedulerAgent through AgentRuntime tools before redispatching", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-agent-runtime",
      async chat(req) {
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("Previous steps:\n[]")) {
          return {
            content: JSON.stringify({
              thoughtSummary: "Inspect all open gaps before deciding repair work.",
              action: "tool",
              toolName: "list_open_gaps",
              args: {},
            }),
          };
        }
        return {
          content: JSON.stringify({
            thoughtSummary: "Create a targeted follow-up for the unresolved gap.",
            action: "finish",
            finish: {
              continueDispatch: true,
              taskUpdates: [],
              newTasks: [{
                parentTaskId: "T_done",
                reportNodeId: "R_hyp_agent_reflect",
                title: "Close primary-source gap",
                objective: "Find a primary source that closes the unresolved reflection gap.",
                priority: 92,
                acceptanceCriteria: ["Find primary-source evidence or explain why it cannot be found."],
              }],
              skipReasons: [],
            },
          }),
        };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_agent_runtime";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_agent_reflect",
      nodeKind: "hypothesis",
      label: "Agent reflection hypothesis",
      parentNodeId: "R_root",
      status: "partially_supported",
      coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
    }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_agent_reflect", status: "completed" }));

    const reflection = await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_agent_reflect", "Need a primary-source check.")]);

    expect(reflection.continueDispatch).toBe(true);
    expect((await ctx.stack.ledger.listByStatus("queued")).some((item) => item.taskId.startsWith("T_reflect_"))).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    const visualEvents = events.filter((event) => event.eventType === "agent_runtime_visual");
    expect(visualEvents.some((event) => event.payload?.visual && (event.payload.visual as { actor?: { title?: string } }).actor?.title === "ReflectionSchedulerAgent")).toBe(true);
    expect(visualEvents.some((event) => event.payload?.visual && (event.payload.visual as { kind?: string; ui?: { title?: string } }).kind === "tool_started" && (event.payload.visual as { ui?: { title?: string } }).ui?.title === "list_open_gaps")).toBe(true);
  });

  it("lets ReflectionSchedulerAgent inspect written reportlets for a report node", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    let inspectedReportlet = false;
    let sawWrittenBranchDraft = false;
    const llm: LlmChat = {
      name: "scripted-reflection-reportlet-inspection",
      async chat(req) {
        if (req.user.includes("writtenBranchDrafts") && req.user.includes("Draft summary for reportlet reflection")) {
          sawWrittenBranchDraft = true;
        }
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("Previous steps:\n[]")) {
          return { content: JSON.stringify({
            thoughtSummary: "Inspect written reportlets before deciding.",
            action: "tool",
            toolName: "list_relevant_evidence",
            args: { nodeIds: ["R_hyp_reportlet_reflect"] },
          }) };
        }
        inspectedReportlet = req.user.includes("RL_reflect_reportlet") && req.user.includes("Written reportlet paragraph");
        return { content: JSON.stringify({
          thoughtSummary: "Existing reportlet is enough.",
          action: "finish",
          finish: { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_reportlet_inspection";
    const now = new Date(fixedNow()).toISOString();
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_reportlet_reflect",
      nodeKind: "hypothesis",
      label: "Reportlet reflection",
      parentNodeId: "R_root",
      status: "supported",
      draftSummary: "Draft summary for reportlet reflection.",
      draftMarkdown: "### Reportlet reflection\n\nDraft body synthesized from reportlets.",
    }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_reflect_reportlet",
      nodeType: "WebPage",
      title: "Reportlet reflection source",
      url: "https://example.test/reportlet-reflection",
      contentHash: "sha256:reportlet-reflection",
      summary: "Source summary for reportlet reflection.",
      sourceTier: "secondary",
      qualityScore: 0.8,
      retrievedByTaskId: "T_reflect_reportlet",
      retrievedAt: now,
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_reflect_reportlet",
      reportNodeId: "R_hyp_reportlet_reflect",
      knowledgeNodeId: "K_reflect_reportlet",
      relation: "supports",
      claimText: "The source supports the reportlet.",
      confidence: 0.8,
      createdByTaskId: "T_reflect_reportlet",
      createdAt: now,
    });
    await ctx.stack.kg.upsertReportlet?.({
      reportletId: "RL_reflect_reportlet",
      reportNodeId: "R_hyp_reportlet_reflect",
      taskId: "T_reflect_reportlet",
      title: "Reportlet reflection",
      markdown: "#### Reportlet reflection\n\nWritten reportlet paragraph [E:E_reflect_reportlet].",
      citedEvidenceLinkIds: ["E_reflect_reportlet"],
      citedKnowledgeNodeIds: ["K_reflect_reportlet"],
      createdAt: now,
      updatedAt: now,
    });

    await cycleReflectionPhase(ctx, [{
      ...agentResultWithGap("T_reflect_reportlet", "R_hyp_reportlet_reflect", "Minor gap already covered by reportlet."),
      evidenceLinkIds: ["E_reflect_reportlet"],
      knowledgeNodeIds: ["K_reflect_reportlet"],
      reportletIds: ["RL_reflect_reportlet"],
      openGaps: [],
    }]);

    expect(inspectedReportlet).toBe(true);
    expect(sawWrittenBranchDraft).toBe(true);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "agent_runtime_visual" && (event.payload?.visual as { ui?: { title?: string } } | undefined)?.ui?.title === "list_relevant_evidence")).toBe(true);
  });

  it("lets ReflectionSchedulerAgent create real cross-hypothesis evidence links without topic-specific rules", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    runtimeProfile.traceLevel = "full";
    const llm: LlmChat = {
      name: "scripted-reflection-link-evidence",
      async chat(req) {
        if (req.user.includes("DeepResearch AgentRuntime") && req.user.includes("Previous steps:\n[]")) {
          return {
            content: JSON.stringify({
              thoughtSummary: "A broad cloud migration source also supports the deployment hypothesis, so link it directly.",
              action: "tool",
              toolName: "link_evidence",
              args: {
                reportNodeId: "R_hyp_deployment",
                knowledgeNodeId: "K_cloud_strategy",
                relation: "supports",
                claimText: "The cloud migration strategy source covers both planning and deployment execution considerations.",
                confidence: 0.68,
              },
            }),
          };
        }
        return {
          content: JSON.stringify({
            thoughtSummary: "Cross-link created; no more dispatch is needed.",
            action: "finish",
            finish: { continueDispatch: false, taskUpdates: [], newTasks: [], skipReasons: [] },
          }),
        };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_cross_link";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_aspect_cloud", nodeKind: "aspect", label: "Cloud migration", parentNodeId: "R_root" }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_planning",
      nodeKind: "hypothesis",
      label: "Migration planning",
      parentNodeId: "R_aspect_cloud",
      status: "supported",
    }));
    await ctx.stack.kg.upsertReportNode(node({
      nodeId: "R_hyp_deployment",
      nodeKind: "hypothesis",
      label: "Deployment execution",
      parentNodeId: "R_aspect_cloud",
      status: "partially_supported",
    }));
    await ctx.stack.kg.upsertKnowledgeNode({
      nodeId: "K_cloud_strategy",
      nodeType: "WebPage",
      title: "Cloud migration strategy guide",
      url: "https://example.test/cloud-strategy",
      contentHash: "sha256:cloud-strategy",
      summary: "Covers migration planning, deployment sequencing, rollback, and operational governance.",
      sourceTier: "primary",
      qualityScore: 0.9,
      retrievedByTaskId: "T_planning",
      retrievedAt: new Date(fixedNow()).toISOString(),
      metadata: {},
    });
    await ctx.stack.kg.upsertEvidenceLink({
      linkId: "E_cloud_strategy_planning",
      reportNodeId: "R_hyp_planning",
      knowledgeNodeId: "K_cloud_strategy",
      relation: "supports",
      claimText: "The source supports cloud migration planning.",
      confidence: 0.8,
      createdByTaskId: "T_planning",
      createdAt: new Date(fixedNow()).toISOString(),
    });

    const reflection = await cycleReflectionPhase(ctx, []);

    expect(reflection.continueDispatch).toBe(false);
    const linksForKnowledge = await ctx.stack.kg.listEvidenceLinksByKnowledgeNode("K_cloud_strategy");
    expect(linksForKnowledge.map((link) => link.reportNodeId).sort()).toEqual(["R_hyp_deployment", "R_hyp_planning"]);
    expect(linksForKnowledge.find((link) => link.reportNodeId === "R_hyp_deployment")).toMatchObject({
      createdByTaskId: "T_reflection_link_evidence",
      relation: "supports",
      confidence: 0.68,
    });
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "full.kg.upsertEvidenceLink" && event.payload?.source === "reflection_scheduler")).toBe(true);
  });

  it("consolidates same-node reflection repair tasks into one agent task", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-newtasks",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: [],
          newTasks: [
            {
              parentTaskId: "T_done",
              reportNodeId: "R_hyp_1",
              title: "收集法国渠道贡献的定量证据",
              objective: "Find quantitative evidence for the French channel.",
              priority: 91,
              acceptanceCriteria: ["Find French channel evidence."],
            },
            {
              parentTaskId: "T_done",
              reportNodeId: "R_hyp_1",
              title: "收集俄国渠道贡献的定量证据",
              objective: "Find quantitative evidence for the Russian channel.",
              priority: 90,
              acceptanceCriteria: ["Find Russian channel evidence."],
            },
          ],
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflect_unique_tasks";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_hyp_1", nodeKind: "hypothesis", label: "Hypothesis", parentNodeId: "R_root", status: "partially_supported" }));
    await ctx.stack.ledger.upsert(task({ taskId: "T_done", reportNodeId: "R_hyp_1", status: "completed" }));

    await cycleReflectionPhase(ctx, [agentResultWithGap("T_done", "R_hyp_1")]);

    const queued = (await ctx.stack.ledger.listByStatus("queued")).filter((item) => item.taskId.startsWith("T_reflect_"));
    expect(queued).toHaveLength(1);
    expect(queued[0]?.reportNodeId).toBe("R_hyp_1");
    expect(queued[0]?.objective).toContain("French channel");
    expect(queued[0]?.objective).toContain("Russian channel");
    expect(queued[0]?.priority).toBe(91);
    expect(queued[0]?.acceptanceCriteria).toEqual(expect.arrayContaining([
      "Find French channel evidence.",
      "Find Russian channel evidence.",
    ]));
  });

  it("caps total reflection-created repair work across requeues, new tasks, and gaps", async () => {
    const dir = await artifactDir();
    const runtimeProfile = loadDefaultRuntimeProfile();
    runtimeProfile.artifactDir = dir;
    const llm: LlmChat = {
      name: "scripted-reflection-overflow",
      async chat() {
        return { content: JSON.stringify({
          continueDispatch: true,
          taskUpdates: Array.from({ length: 4 }, (_, index) => ({
            taskId: `T_done_${index + 1}`,
            newStatus: "queued",
            reason: `Repair completed task ${index + 1}.`,
          })),
          newTasks: Array.from({ length: 6 }, (_, index) => ({
            parentTaskId: "T_root",
            reportNodeId: `R_hyp_${index + 1}`,
            title: `Extra repair ${index + 1}`,
            objective: `Find extra repair evidence ${index + 1}.`,
            priority: 90 - index,
            acceptanceCriteria: [`Repair ${index + 1}.`],
          })),
          skipReasons: [],
        }) };
      },
    };
    const ctx = createPhaseContext(submission(), { now: fixedNow, runtimeProfile, artifactDir: dir, llm });
    ctx.state.episodeId = "EP_reflection_cap";
    await ctx.stack.kg.upsertReportNode(node({ nodeId: "R_root", nodeKind: "root", label: "Root", parentNodeId: null }));
    for (let i = 1; i <= 8; i++) {
      await ctx.stack.kg.upsertReportNode(node({
        nodeId: `R_hyp_${i}`,
        nodeKind: "hypothesis",
        label: `Hypothesis ${i}`,
        parentNodeId: "R_root",
        status: "partially_supported",
        coverage: { supportingCount: 1, contradictingCount: 0, openGapCount: 1 },
      }));
      await ctx.stack.ledger.upsert(task({ taskId: `T_done_${i}`, reportNodeId: `R_hyp_${i}`, status: "completed" }));
    }

    await cycleReflectionPhase(ctx, Array.from({ length: 8 }, (_, index) => agentResultWithGap(`T_done_${index + 1}`, `R_hyp_${index + 1}`, `Gap ${index + 1}.`)));

    const repairLike = (await ctx.stack.ledger.listByStatus("queued"))
      .filter((item) => /^(T_repair_|T_reflect_|T_gap_)/.test(item.taskId));
    expect(repairLike).toHaveLength(5);
    expect(repairLike.filter((item) => item.taskId.startsWith("T_repair_"))).toHaveLength(4);
    // The one surviving new-task slot targets R_hyp_1, whose requeued repair
    // already fills the node's one-repair capacity, so no T_reflect_ task is
    // created; the freed slot goes to synthesized gap work instead.
    expect(repairLike.filter((item) => item.taskId.startsWith("T_reflect_"))).toHaveLength(0);
    expect(repairLike.filter((item) => item.taskId.startsWith("T_gap_"))).toHaveLength(1);
    const events = await ctx.stack.memory.listEvents({ episodeId: ctx.state.episodeId });
    expect(events.some((event) => event.eventType === "cycle_reflection" && event.payload?.repairTaskLimit === 5)).toBe(true);
  });
});
