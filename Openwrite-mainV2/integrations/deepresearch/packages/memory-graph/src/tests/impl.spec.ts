import { describe, expect, it } from "vitest";
import { ValidationError, type MemoryEvent } from "@deepresearch/contracts";
import { InMemoryMemoryGraph, createInMemoryMemoryGraph } from "../index.js";

const ISO = "2026-07-01T00:00:00.000Z";

function makeEvent(overrides: Partial<MemoryEvent> = {}): MemoryEvent {
  return {
    eventId: "ME_1",
    eventType: "episode_started",
    episodeId: "EP_1",
    timestamp: ISO,
    payload: { ok: true },
    ...overrides,
  };
}

describe("InMemoryMemoryGraph v5", () => {
  it("appends and lists events", async () => {
    const memory = createInMemoryMemoryGraph();
    await memory.appendEvent(makeEvent());
    expect((await memory.listEvents({ episodeId: "EP_1" })).length).toBe(1);
  });

  it("filters by task, report node, branch, and event type", async () => {
    const memory = createInMemoryMemoryGraph();
    await memory.appendEvent(makeEvent({
      eventId: "ME_task",
      eventType: "evidence_agent_finished",
      taskId: "T_1",
      reportNodeId: "R_1",
      branchId: "B_1",
      agentRunId: "A_1",
    }));
    await memory.appendEvent(makeEvent({ eventId: "ME_other", eventType: "rubric_created", taskId: "T_2" }));
    expect((await memory.listEvents({ taskId: "T_1" })).map((event) => event.eventId)).toEqual(["ME_task"]);
    expect((await memory.listEvents({ reportNodeId: "R_1" })).map((event) => event.eventId)).toEqual(["ME_task"]);
    expect((await memory.listEvents({ branchId: "B_1" })).map((event) => event.eventId)).toEqual(["ME_task"]);
    expect((await memory.listEvents({ eventType: "rubric_created" })).map((event) => event.eventId)).toEqual(["ME_other"]);
  });

  it("exports JSONL for one episode", async () => {
    const memory = createInMemoryMemoryGraph();
    await memory.appendEvent(makeEvent({ eventId: "ME_1", episodeId: "EP_1" }));
    await memory.appendEvent(makeEvent({ eventId: "ME_2", episodeId: "EP_2" }));
    const jsonl = await memory.exportJsonl!("EP_1");
    expect(jsonl).toContain("ME_1");
    expect(jsonl).not.toContain("ME_2");
  });

  it("validates required event fields", async () => {
    const memory = createInMemoryMemoryGraph();
    await expect(memory.appendEvent(makeEvent({ eventId: "" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("snapshots initial events", async () => {
    const memory = new InMemoryMemoryGraph({ initial: [makeEvent()] });
    expect(memory.snapshot()).toHaveLength(1);
  });
});
