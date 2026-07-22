import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import type { AnalysisTask } from "../types";
import { AnalysisReport } from "./AnalysisReport";

const mocks = vi.hoisted(() => ({
  loadAnalysisTask: vi.fn(),
  loadAnalysisReport: vi.fn(),
}));

vi.mock("../api", () => ({
  loadAnalysisTask: mocks.loadAnalysisTask,
  loadAnalysisReport: mocks.loadAnalysisReport,
}));

function task(state: AnalysisTask["state"], model = "m1"): AnalysisTask {
  return {
    task_id: `task-${model}`,
    symbol: "600519",
    profile_id: "p1",
    profile_name: "硅基流动",
    profile_scope: "personal",
    model,
    report_type: "detailed",
    force_refresh: false,
    state,
    progress_message: state,
    cache_hit: false,
    error_code: state === "failed" ? "ANALYSIS_UPSTREAM_FAILED" : null,
    error_message: state === "failed" ? "个股分析服务暂时不可用，请稍后重试" : null,
    created_at: "2026-07-21T00:00:00Z",
    updated_at: "2026-07-21T00:00:00Z",
    started_at: null,
    finished_at: state === "succeeded" || state === "failed" ? "2026-07-21T00:01:00Z" : null,
  };
}

afterEach(() => {
  cleanup();
  mocks.loadAnalysisTask.mockReset();
  mocks.loadAnalysisReport.mockReset();
  vi.useRealTimers();
});

test("polls collecting, analyzing and rendering before loading the report", async () => {
  vi.useFakeTimers();
  mocks.loadAnalysisTask
    .mockResolvedValueOnce(task("collecting"))
    .mockResolvedValueOnce(task("analyzing"))
    .mockResolvedValueOnce(task("rendering"))
    .mockResolvedValueOnce(task("succeeded"));
  mocks.loadAnalysisReport.mockResolvedValue({
    task_id: "task-m1",
    report: { summary: { analysis_summary: "完成结论" } },
  });
  render(<AnalysisReport initialTask={task("queued")} onBack={() => undefined} />);

  await act(async () => undefined);
  expect(screen.getByText("采集数据")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText("大模型分析")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText("整理报告")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(screen.getByText("完成结论")).toBeInTheDocument();
});

test("shows a terminal safe failure without polling again", () => {
  render(<AnalysisReport initialTask={task("failed")} onBack={() => undefined} />);

  expect(screen.getByRole("alert")).toHaveTextContent("个股分析服务暂时不可用");
  expect(mocks.loadAnalysisTask).not.toHaveBeenCalled();
});

test("keeps reports for the same stock distinguishable by selected model", async () => {
  mocks.loadAnalysisReport
    .mockResolvedValueOnce({ task_id: "task-m1", report: { summary: { analysis_summary: "模型一结论" } } })
    .mockResolvedValueOnce({ task_id: "task-m2", report: { summary: { analysis_summary: "模型二结论" } } });
  const view = render(<AnalysisReport initialTask={task("succeeded", "m1")} onBack={() => undefined} />);
  expect(await screen.findByText("模型一结论")).toBeInTheDocument();
  expect(screen.getByText("硅基流动 · m1")).toBeInTheDocument();

  view.rerender(<AnalysisReport initialTask={task("succeeded", "m2")} onBack={() => undefined} />);
  expect(await screen.findByText("模型二结论")).toBeInTheDocument();
  expect(screen.getByText("硅基流动 · m2")).toBeInTheDocument();
});
