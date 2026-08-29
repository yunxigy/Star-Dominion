import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { StrategyPanel } from "./StrategyPanel";

test("does not render small-cap candidates in the original strategy panel", () => {
  render(
    <StrategyPanel
      items={[
        {
          stock: { symbol: "600001", name: "小市值样本", exchange: "SSE" },
          sources: [
            {
              source_id: "small_cap_absorption",
              source_name: "小市值倍量吸筹",
              score: null,
              reasons: ["首日倍量"],
            },
          ],
          generated_at: "2026-08-29T09:00:00+08:00",
        },
      ]}
      sources={[]}
      catalystSymbols={new Set()}
      refreshing={false}
      onOpenDetail={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );

  expect(screen.getByText("暂未生成个人策略候选。")).toBeInTheDocument();
  expect(screen.queryByText("小市值样本")).not.toBeInTheDocument();
});
