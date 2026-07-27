import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import type { StockKline } from "../types";
import { StockKlineChart } from "./StockKlineChart";
import { StockQuoteSummary } from "./StockQuoteSummary";

afterEach(cleanup);


const kline: StockKline = {
  symbol: "600519",
  name: "贵州茅台",
  exchange: "SSE",
  period: "daily",
  adjustment: "qfq",
  days: 20,
  source: "eastmoney",
  generated_at: "2026-07-27T15:01:00+08:00",
  stale: true,
  latest: {
    trade_date: "2026-07-25",
    price: 1501.25,
    change: 12.5,
    change_pct: 0.84,
    high: 1512,
    low: 1480,
    volume: 1234567,
  },
  bars: [
    {
      date: "2026-07-24",
      open: 1500,
      high: 1510,
      low: 1470,
      close: 1488.75,
      volume: 900000,
      change_pct: -0.75,
      ma5: 1492,
      ma10: 1494,
      ma20: 1490,
    },
    {
      date: "2026-07-25",
      open: 1490,
      high: 1512,
      low: 1480,
      close: 1501.25,
      volume: 1234567,
      change_pct: 0.84,
      ma5: 1495,
      ma10: 1493,
      ma20: 1491,
    },
  ],
};


it("renders the quote summary with price, movement, range, volume, time and stale state", () => {
  render(<StockQuoteSummary kline={kline} />);

  expect(screen.getByText("1,501.25")).toBeInTheDocument();
  expect(screen.getByText("+12.50（+0.84%）")).toBeInTheDocument();
  expect(screen.getByText("1,512.00")).toBeInTheDocument();
  expect(screen.getByText("1,480.00")).toBeInTheDocument();
  expect(screen.getByText("123.46万")).toBeInTheDocument();
  expect(screen.getByText("2026-07-25")).toBeInTheDocument();
  expect(screen.getByText("最近缓存")).toBeInTheDocument();
});


it("renders accessible candles, shadows, moving averages and volume bars", () => {
  const { container } = render(<StockKlineChart kline={kline} />);

  expect(screen.getByRole("img", { name: "贵州茅台 600519 日K线图，共2个交易日" })).toBeInTheDocument();
  expect(container.querySelectorAll(".kline-candle")).toHaveLength(2);
  expect(container.querySelectorAll(".kline-wick")).toHaveLength(2);
  expect(container.querySelectorAll(".kline-candle.up")).toHaveLength(1);
  expect(container.querySelectorAll(".kline-candle.down")).toHaveLength(1);
  expect(container.querySelectorAll(".kline-volume-bar")).toHaveLength(2);
  expect(container.querySelectorAll(".kline-ma-line")).toHaveLength(3);
  expect(screen.getAllByRole("button", { name: /开盘/ })).toHaveLength(2);
});


it("shows complete bar details when a keyboard user focuses a data point", () => {
  render(<StockKlineChart kline={kline} />);

  fireEvent.focus(screen.getByRole("button", { name: /2026-07-25/ }));

  expect(screen.getByRole("button", { name: /2026-07-25.*涨跌 \+0\.84%/ })).toBeInTheDocument();
  expect(screen.getByText("2026-07-25", { selector: ".kline-detail-date" })).toBeInTheDocument();
  expect(screen.getByText(/开 1,490\.00/)).toBeInTheDocument();
  expect(screen.getByText(/高 1,512\.00/)).toBeInTheDocument();
  expect(screen.getByText(/低 1,480\.00/)).toBeInTheDocument();
  expect(screen.getByText(/收 1,501\.25/)).toBeInTheDocument();
  expect(screen.getByText(/量 123\.46万/)).toBeInTheDocument();
  expect(screen.getByText("涨跌 +0.84%")).toBeInTheDocument();
});


it("formats a negative percentage with one minus sign and describes fresh data conservatively", () => {
  const fresh = { ...kline, stale: false };
  const { rerender } = render(<StockKlineChart kline={fresh} />);

  fireEvent.focus(screen.getByRole("button", { name: /2026-07-24/ }));
  expect(screen.getByText("涨跌 -0.75%")).toBeInTheDocument();
  expect(screen.queryByText(/--0\.75%/)).not.toBeInTheDocument();

  rerender(<StockQuoteSummary kline={fresh} />);
  expect(screen.getByText("东方财富真实日线")).toBeInTheDocument();
  expect(screen.queryByText(/实时/)).not.toBeInTheDocument();
});


it("guards empty and flat data without invalid SVG coordinates", () => {
  const empty = { ...kline, bars: [] };
  const flat = {
    ...kline,
    bars: [
      {
        ...kline.bars[0],
        open: 100,
        high: 100,
        low: 100,
        close: 100,
        volume: 0,
        ma5: 100,
        ma10: 100,
        ma20: 100,
      },
    ],
  };

  const { rerender, container } = render(<StockKlineChart kline={empty} />);
  expect(screen.getByText("暂无K线数据")).toBeInTheDocument();

  rerender(<StockKlineChart kline={flat} />);
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  expect(container.querySelectorAll(".kline-candle")).toHaveLength(1);
});
