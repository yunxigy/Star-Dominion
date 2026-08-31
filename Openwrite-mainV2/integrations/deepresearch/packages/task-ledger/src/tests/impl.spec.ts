import { describe, expect, it } from "vitest";
import { ValidationError, type TaskItem } from "@deepresearch/contracts";
import { InMemoryTaskLedger } from "../impl/in-memory.js";
import { createInMemoryTaskLedger } from "../index.js";

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

describe("InMemoryTaskLedger v5", () => {
  it("upserts and reads tasks", async () => {
    const ledger = createInMemoryTaskLedger();
    await ledger.upsert(makeTask());
    expect((await ledger.getById("T_1"))?.status).toBe("queued");
  });

  it("lists all, by branch, by report node, and by status", async () => {
    const ledger = createInMemoryTaskLedger();
    await ledger.upsert(makeTask({ taskId: "T_low", priority: 10 }));
    await ledger.upsert(makeTask({ taskId: "T_high", branchId: "B_2", priority: 90 }));
    expect((await ledger.listAll()).length).toBe(2);
    expect((await ledger.listByBranch("B_2")).map((task) => task.taskId)).toEqual(["T_high"]);
    expect((await ledger.listByReportNode("R_hyp_1")).map((task) => task.taskId)).toEqual(["T_high", "T_low"]);
    expect((await ledger.listByStatus("queued", { limit: 1 })).map((task) => task.taskId)).toEqual(["T_high"]);
  });

  it("requires non-empty acceptance criteria", async () => {
    const ledger = createInMemoryTaskLedger();
    await expect(ledger.upsert(makeTask({ acceptanceCriteria: [] }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("allows normal queued -> running -> completed transition", async () => {
    const ledger = createInMemoryTaskLedger();
    await ledger.upsert(makeTask());
    await ledger.updateStatus("T_1", "running");
    await ledger.updateStatus("T_1", "completed");
    expect((await ledger.getById("T_1"))?.status).toBe("completed");
  });

  it("rejects illegal queued -> completed transition", async () => {
    const ledger = createInMemoryTaskLedger();
    await ledger.upsert(makeTask());
    await expect(ledger.upsert(makeTask({ status: "completed", updatedAt: "2026-07-01T00:01:00.000Z" })))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("snapshots and restores", async () => {
    const ledger = new InMemoryTaskLedger();
    await ledger.upsert(makeTask());
    const restored = InMemoryTaskLedger.restore(ledger.snapshot());
    expect((await restored.getById("T_1"))?.objective).toContain("evidence");
  });
});
