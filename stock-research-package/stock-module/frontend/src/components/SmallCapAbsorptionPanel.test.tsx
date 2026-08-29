import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { SmallCapAbsorptionPanel } from "./SmallCapAbsorptionPanel";

afterEach(cleanup);

const candidate = {
  stock: { symbol: "600001", name: "小市值样本", exchange: "SSE" },
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
  generated_at: "2026-08-29T09:00:00+08:00",
};

test("renders first-day volume spike and structured absorption factors", () => {
  render(
    <SmallCapAbsorptionPanel
      items={[candidate]}
      sources={[
        {
          source_id: "small_cap_absorption",
          source_name: "小市值倍量吸筹",
          status: "ok",
          generated_at: "2026-08-29T09:00:00+08:00",
          error: null,
        },
      ]}
      onOpenDetail={vi.fn()}
      onRefresh={vi.fn()}
      refreshing={false}
    />,
  );

  expect(screen.getByText("小市值倍量吸筹")).toBeInTheDocument();
  expect(screen.getByText("首日倍量")).toBeInTheDocument();
  expect(screen.getByText("2026-08-27")).toBeInTheDocument();
  expect(screen.getByText("2.40 倍")).toBeInTheDocument();
  expect(screen.getByText("90.00 亿元")).toBeInTheDocument();
  expect(screen.getByText("12.00%")).toBeInTheDocument();
  expect(screen.getByText("8.00%")).toBeInTheDocument();
});

test("opens the shared research detail from an absorption candidate", () => {
  const onOpenDetail = vi.fn();

  render(
    <SmallCapAbsorptionPanel
      items={[candidate]}
      sources={[]}
      onOpenDetail={onOpenDetail}
      onRefresh={vi.fn()}
      refreshing={false}
    />,
  );

  fireEvent.click(screen.getByRole("button", { name: /600001/ }));

  expect(onOpenDetail).toHaveBeenCalledWith("600001", expect.any(HTMLElement));
});

test("shows stale status while retaining the previous absorption candidates", () => {
  render(
    <SmallCapAbsorptionPanel
      items={[candidate]}
      sources={[
        {
          source_id: "small_cap_absorption",
          source_name: "小市值倍量吸筹",
          status: "stale",
          generated_at: "2026-08-28T09:00:00+08:00",
          error: "市值接口失败",
        },
      ]}
      onOpenDetail={vi.fn()}
      onRefresh={vi.fn()}
      refreshing={false}
    />,
  );

  expect(screen.getByText(/沿用上一份小市值快照/)).toBeInTheDocument();
  expect(screen.getByText("小市值样本")).toBeInTheDocument();
});
