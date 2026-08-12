import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { HistoryEvidence } from "./HistoryEvidence";

const historyItems = Array.from({ length: 6 }, (_, index) => ({
  report_date: `2026-08-${String(12 - index).padStart(2, "0")}`,
  generated_at: `2026-08-${String(12 - index).padStart(2, "0")}T09:00:00+08:00`,
}));

test("shows the title above five horizontal morning-report links without sample metrics", () => {
  const { container } = render(
    <HistoryEvidence items={historyItems} onOpenReport={() => undefined} />,
  );

  const panel = container.querySelector(".history-panel");
  expect(panel?.firstElementChild).toHaveClass("history-heading");
  expect(panel?.querySelector(".history-links")).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /查看晨报/ })).toHaveLength(5);
  expect(screen.queryByText("当前候选公开历史样本")).not.toBeInTheDocument();
  expect(screen.queryByText("—")).not.toBeInTheDocument();
});
