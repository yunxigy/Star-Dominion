import { afterEach, describe, expect, it } from "vitest";
import { ValidationError, type TaskItem } from "@deepresearch/contracts";
import { SqliteTaskLedger } from "../impl/sqlite.js";

const ISO = "2026-07-01T00:00:00.000Z";

function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
  return {
    taskId: "T_1",
    parentTaskId: null,
    reportNodeId: "R_hyp_1",
    title: "Verify claim",
    objective: "Find supporting or contradicting evidence.",
    status: "queued",
    priority: 100,
    branchId: "B_1",
    acceptanceCriteria: ["At least one credible source."],
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

describe("SqliteTaskLedger v5", () => {
  const ledgers: SqliteTaskLedger[] = [];
  function makeLedger(): SqliteTaskLedger {
    const ledger = new SqliteTaskLedger({ dbPath: ":memory:" });
    ledgers.push(ledger);
    return ledger;
  }

  afterEach(() => {
    for (const ledger of ledgers) ledger.close();
    ledgers.length = 0;
  });

  it("upserts and reads tasks", async () => {
    const ledger = makeLedger();
    await ledger.upsert(makeTask());
    expect((await ledger.getById("T_1"))?.status).toBe("queued");
  });

  it("lists queued tasks by priority", async () => {
    const ledger = makeLedger();
    await ledger.upsert(makeTask({ taskId: "T_low", priority: 10 }));
    await ledger.upsert(makeTask({ taskId: "T_high", priority: 90 }));
    expect((await ledger.listByStatus("queued")).map((task) => task.taskId)).toEqual(["T_high", "T_low"]);
  });

  it("updates status through valid transitions", async () => {
    const ledger = makeLedger();
    await ledger.upsert(makeTask());
    await ledger.updateStatus("T_1", "running");
    await ledger.updateStatus("T_1", "blocked");
    await ledger.updateStatus("T_1", "queued");
    expect((await ledger.getById("T_1"))?.status).toBe("queued");
  });

  it("rejects illegal transition", async () => {
    const ledger = makeLedger();
    await ledger.upsert(makeTask());
    await expect(ledger.upsert(makeTask({ status: "completed" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("supports listAll/listByBranch/listByReportNode", async () => {
    const ledger = makeLedger();
    await ledger.upsert(makeTask({ taskId: "T_1", branchId: "B_a" }));
    await ledger.upsert(makeTask({ taskId: "T_2", branchId: "B_b" }));
    expect((await ledger.listAll()).length).toBe(2);
    expect((await ledger.listByBranch("B_a")).map((task) => task.taskId)).toEqual(["T_1"]);
    expect((await ledger.listByReportNode("R_hyp_1")).map((task) => task.taskId)).toEqual(["T_1", "T_2"]);
  });
});
