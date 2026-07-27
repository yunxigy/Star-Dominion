import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { StockKline, StockResearchContext } from "../types";
import { StockResearchModal } from "./StockResearchModal";

const mocks = vi.hoisted(() => ({
  loadStockKline: vi.fn(),
  loadStockResearchContext: vi.fn(),
}));

vi.mock("../api", () => mocks);

const context: StockResearchContext = {
  symbol: "000400",
  name: "许继电气",
  exchange: "SZSE",
  cross_hit: true,
  sources: [
    {
      source_id: "catalyst",
      source_name: "九点猫研",
      score: 92,
      reasons: ["海外电力资本开支映射"],
    },
  ],
  catalyst: {
    symbol: "000400",
    name: "许继电气",
    exchange: "SZSE",
    industry: "电气设备",
    theme: "电网设备",
    total_score: 92,
    rationale: "订单和景气共振",
    dimension_scores: { catalyst: 91, history: 73 },
    historical_stats: { win_rate: 0.67, sample_size: 24 },
    positive_flags: ["订单改善"],
    risk_flags: ["解禁"],
    invalid_conditions: ["主题强度跌破阈值"],
    news: [],
  },
};

function makeKline(days: 20 | 60 | 120, symbol = "000400"): StockKline {
  const bars = Array.from({ length: days }, (_, index) => ({
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    open: 10 + index / 10,
    high: 10.6 + index / 10,
    low: 9.8 + index / 10,
    close: 10.4 + index / 10,
    volume: 100_000 + index,
    change_pct: 1,
    ma5: index >= 4 ? 10.2 + index / 10 : null,
    ma10: index >= 9 ? 10 + index / 10 : null,
    ma20: index >= 19 ? 9.5 + index / 10 : null,
  }));
  const latest = bars.at(-1)!;
  return {
    symbol,
    name: symbol === "000400" ? "许继电气" : "贵州茅台",
    exchange: symbol.startsWith("6") ? "SSE" : "SZSE",
    period: "daily",
    adjustment: "qfq",
    days,
    source: "eastmoney",
    generated_at: "2026-07-27T15:05:00+08:00",
    stale: false,
    latest: {
      trade_date: latest.date,
      price: latest.close,
      change: 0.4,
      change_pct: 1,
      high: latest.high,
      low: latest.low,
      volume: latest.volume,
    },
    bars,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const defaultProps = {
  symbol: "000400",
  profiles: [],
  returnFocus: null,
  onClose: vi.fn(),
  onStarted: vi.fn(),
  onOpenSettings: vi.fn(),
};

beforeEach(() => {
  mocks.loadStockResearchContext.mockResolvedValue(structuredClone(context));
  mocks.loadStockKline.mockImplementation((_symbol: string, days: 20 | 60 | 120) =>
    Promise.resolve(makeKline(days)),
  );
});

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  Object.values(defaultProps).forEach((value) => {
    if (typeof value === "function" && "mockReset" in value) value.mockReset();
  });
  document.body.style.overflow = "";
});

test("loads research context and the default 60-day chart in a wide dialog", async () => {
  render(<StockResearchModal {...defaultProps} />);

  expect(screen.getByRole("dialog", { name: "股票研究详情" })).toHaveClass("stock-research-modal");
  expect(mocks.loadStockResearchContext).toHaveBeenCalledWith("000400");
  expect(mocks.loadStockKline).toHaveBeenCalledWith("000400", 60);
  expect(await screen.findByRole("img", { name: /许继电气 000400 日K线图，共60个交易日/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "近60日" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "近20日" })).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByRole("button", { name: "近120日" })).toHaveAttribute("aria-pressed", "false");
});

test("keeps evidence and analysis controls visible when the K-line request fails", async () => {
  mocks.loadStockKline.mockRejectedValueOnce(new Error("K线暂不可用"));

  render(<StockResearchModal {...defaultProps} />);

  expect(await screen.findByText("历史优势 73")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("K线暂不可用");
  expect(screen.getByRole("button", { name: "生成个股详细分析" })).toBeInTheDocument();
});

test("keeps the prior chart while a period switch is pending and after it fails", async () => {
  const switched = deferred<StockKline>();
  mocks.loadStockKline
    .mockResolvedValueOnce(makeKline(60))
    .mockReturnValueOnce(switched.promise);

  render(<StockResearchModal {...defaultProps} />);
  expect(await screen.findByRole("img", { name: /共60个交易日/ })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "近120日" }));

  expect(mocks.loadStockKline).toHaveBeenLastCalledWith("000400", 120);
  expect(screen.getByRole("img", { name: /共60个交易日/ })).toBeInTheDocument();
  expect(screen.getByText("正在更新120日K线…")).toBeInTheDocument();
  switched.reject(new Error("120日数据获取失败"));

  expect(await screen.findByRole("alert")).toHaveTextContent("120日数据获取失败");
  expect(screen.getByRole("img", { name: /共60个交易日/ })).toBeInTheDocument();
});

test("keeps a successful chart and analysis controls when research context fails", async () => {
  mocks.loadStockResearchContext.mockRejectedValueOnce(new Error("研究依据暂不可用"));

  render(<StockResearchModal {...defaultProps} />);

  expect(await screen.findByRole("img", { name: /共60个交易日/ })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("研究依据暂不可用");
  expect(screen.getByRole("button", { name: "生成个股详细分析" })).toBeInTheDocument();
});

test("closes from Escape, backdrop, and close button while restoring trigger focus", async () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const onClose = vi.fn();
  const { rerender } = render(
    <StockResearchModal {...defaultProps} returnFocus={trigger} onClose={onClose} />,
  );

  expect(document.body.style.overflow).toBe("hidden");
  expect(screen.getByRole("button", { name: "关闭股票详情" })).toHaveFocus();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(trigger).toHaveFocus());

  rerender(<StockResearchModal {...defaultProps} returnFocus={trigger} onClose={onClose} />);
  fireEvent.mouseDown(screen.getByTestId("research-modal-backdrop"));
  expect(onClose).toHaveBeenCalledTimes(2);

  fireEvent.click(screen.getByRole("button", { name: "关闭股票详情" }));
  expect(onClose).toHaveBeenCalledTimes(3);
  trigger.remove();
});

test("ignores context and K-line responses from the previous symbol", async () => {
  const oldContext = deferred<StockResearchContext>();
  const oldKline = deferred<StockKline>();
  mocks.loadStockResearchContext
    .mockReturnValueOnce(oldContext.promise)
    .mockResolvedValueOnce({ ...context, symbol: "600519", name: "贵州茅台", exchange: "SSE" });
  mocks.loadStockKline
    .mockReturnValueOnce(oldKline.promise)
    .mockResolvedValueOnce(makeKline(60, "600519"));
  const { rerender } = render(<StockResearchModal {...defaultProps} />);

  rerender(<StockResearchModal {...defaultProps} symbol="600519" />);
  expect(await screen.findByRole("img", { name: /贵州茅台 600519/ })).toBeInTheDocument();

  oldContext.resolve(context);
  oldKline.resolve(makeKline(60));
  await Promise.resolve();

  expect(screen.getByRole("img", { name: /贵州茅台 600519/ })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: /许继电气 000400/ })).not.toBeInTheDocument();
});
