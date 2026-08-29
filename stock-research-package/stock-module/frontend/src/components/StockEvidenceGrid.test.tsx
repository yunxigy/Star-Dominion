import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import type { StockResearchContext } from "../types";
import { StockEvidenceGrid } from "./StockEvidenceGrid";

test("renders structured small-cap factors in stock evidence", () => {
  const context = {
    symbol: "600001",
    name: "小市值样本",
    exchange: "SSE",
    cross_hit: false,
    sources: [
      {
        source_id: "small_cap_absorption",
        source_name: "小市值倍量吸筹",
        score: null,
        reasons: ["首日倍量"],
        factors: {
          market_cap_yuan: 9_000_000_000,
          trigger_date: "2026-08-27",
          volume_multiple: 2.4,
          price_range_pct: 12,
          max_drawdown_pct: 8,
          first_volume_spike: true,
        },
      },
    ],
    catalyst: null,
  } as StockResearchContext;

  render(<StockEvidenceGrid context={context} />);

  expect(screen.getByText("首日倍量")).toBeInTheDocument();
  expect(screen.getByText("2026-08-27")).toBeInTheDocument();
  expect(screen.getByText("2.40 倍")).toBeInTheDocument();
  expect(screen.getByText("90.00 亿元")).toBeInTheDocument();
});
