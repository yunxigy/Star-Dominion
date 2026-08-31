import { afterEach, describe, expect, it } from "vitest";
import { ValidationError, type MemoryEvent } from "@deepresearch/contracts";
import { SqliteMemoryGraph } from "../impl/sqlite.js";

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

describe("SqliteMemoryGraph v5", () => {
  const graphs: SqliteMemoryGraph[] = [];
  function makeGraph(): SqliteMemoryGraph {
    const graph = new SqliteMemoryGraph({ dbPath: ":memory:" });
    graphs.push(graph);
    return graph;
  }

  afterEach(() => {
    for (const graph of graphs) graph.close();
    graphs.length = 0;
  });

  it("appends and lists events", async () => {
    const graph = makeGraph();
    await graph.appendEvent(makeEvent());
    expect((await graph.listEvents({ episodeId: "EP_1" })).length).toBe(1);
  });

  it("filters events", async () => {
    const graph = makeGraph();
    await graph.appendEvent(makeEvent({ eventId: "ME_1", eventType: "root_created", reportNodeId: "R_root" }));
    await graph.appendEvent(makeEvent({ eventId: "ME_2", eventType: "rubric_created", reportNodeId: "R_other" }));
    expect((await graph.listEvents({ reportNodeId: "R_root" })).map((event) => event.eventId)).toEqual(["ME_1"]);
    expect((await graph.listEvents({ eventType: "rubric_created" })).map((event) => event.eventId)).toEqual(["ME_2"]);
  });

  it("exports JSONL", async () => {
    const graph = makeGraph();
    await graph.appendEvent(makeEvent({ eventId: "ME_1", episodeId: "EP_1" }));
    const jsonl = await graph.exportJsonl!("EP_1");
    expect(JSON.parse(jsonl).eventId).toBe("ME_1");
  });

  it("validates required fields", async () => {
    const graph = makeGraph();
    await expect(graph.appendEvent(makeEvent({ episodeId: "" }))).rejects.toBeInstanceOf(ValidationError);
  });
});
