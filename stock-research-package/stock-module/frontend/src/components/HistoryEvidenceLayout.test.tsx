import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { HistoryEvidence } from "./HistoryEvidence";

const items = Array.from({ length: 6 }, (_, index) => ({
  report_date: `2026-08-${String(12 - index).padStart(2, "0")}`,
  generated_at: "2026-08-12T09:00:00+08:00",
}));

test("uses larger title styling and compact report chips", () => {
  const { container } = render(<HistoryEvidence items={items} onOpenReport={() => undefined} />);

  expect(container.querySelector(".history-panel")).toHaveClass("history-panel--aligned");
  expect(container.querySelector(".history-title")).toBeInTheDocument();
  const links = screen.getAllByRole("button");
  expect(links).toHaveLength(5);
  links.forEach((link) => expect(link).toHaveClass("history-report-link"));
});
