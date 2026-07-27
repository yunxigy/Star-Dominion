import { useState } from "react";

import type { KlineBar, StockKline } from "../types";


type StockKlineChartProps = {
  kline: StockKline;
};

type MaKey = "ma5" | "ma10" | "ma20";

const WIDTH = 960;
const HEIGHT = 430;
const LEFT = 58;
const RIGHT = 18;
const PRICE_TOP = 22;
const PRICE_BOTTOM = 310;
const VOLUME_TOP = 334;
const VOLUME_BOTTOM = 402;
const MA_SERIES: Array<{ key: MaKey; label: string }> = [
  { key: "ma5", label: "MA5" },
  { key: "ma10", label: "MA10" },
  { key: "ma20", label: "MA20" },
];


function formatPrice(value: number) {
  return value.toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatVolume(value: number) {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(2)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(2)}万`;
  return value.toLocaleString("zh-CN");
}

function formatChangePercent(value: number | null) {
  if (value == null) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}


function priceY(value: number, minimum: number, range: number) {
  return PRICE_BOTTOM - ((value - minimum) / range) * (PRICE_BOTTOM - PRICE_TOP);
}


function buildMaPath(
  bars: KlineBar[],
  key: MaKey,
  xAt: (index: number) => number,
  minimum: number,
  range: number,
) {
  let drawing = false;
  return bars.reduce((path, bar, index) => {
    const value = bar[key];
    if (value == null) {
      drawing = false;
      return path;
    }
    const command = drawing ? "L" : "M";
    drawing = true;
    return `${path}${command}${xAt(index).toFixed(2)},${priceY(value, minimum, range).toFixed(2)} `;
  }, "").trim();
}


function barLabel(bar: KlineBar) {
  return [
    bar.date,
    `开盘 ${formatPrice(bar.open)}`,
    `最高 ${formatPrice(bar.high)}`,
    `最低 ${formatPrice(bar.low)}`,
    `收盘 ${formatPrice(bar.close)}`,
    `涨跌 ${formatChangePercent(bar.change_pct)}`,
    `成交量 ${formatVolume(bar.volume)}`,
  ].join("，");
}


export function StockKlineChart({ kline }: StockKlineChartProps) {
  const [activeIndex, setActiveIndex] = useState(Math.max(0, kline.bars.length - 1));
  const bars = kline.bars;

  if (bars.length === 0) {
    return <div className="kline-empty">暂无K线数据</div>;
  }

  const values = bars.flatMap((bar) => [
    bar.low,
    bar.high,
    ...MA_SERIES.map(({ key }) => bar[key]).filter((value): value is number => value != null),
  ]);
  const rawMinimum = Math.min(...values);
  const rawMaximum = Math.max(...values);
  const rawRange = rawMaximum - rawMinimum;
  const padding = rawRange > 0 ? rawRange * 0.04 : Math.max(Math.abs(rawMaximum) * 0.01, 1);
  const minimum = rawMinimum - padding;
  const maximum = rawMaximum + padding;
  const range = Math.max(maximum - minimum, 1);
  const maxVolume = Math.max(...bars.map((bar) => bar.volume), 1);
  const plotWidth = WIDTH - LEFT - RIGHT;
  const slotWidth = plotWidth / bars.length;
  const candleWidth = Math.max(2, Math.min(14, slotWidth * 0.58));
  const xAt = (index: number) => LEFT + slotWidth * (index + 0.5);
  const activeBar = bars[Math.min(activeIndex, bars.length - 1)];
  const gridValues = Array.from({ length: 5 }, (_, index) => maximum - (range * index) / 4);

  return (
    <section className="stock-kline-chart">
      <div className="kline-legend" aria-hidden="true">
        <span className="ma5">MA5</span>
        <span className="ma10">MA10</span>
        <span className="ma20">MA20</span>
        <span>红涨绿跌</span>
      </div>
      <div className="kline-svg-scroll">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${kline.name} ${kline.symbol} 日K线图，共${bars.length}个交易日`}
          preserveAspectRatio="xMidYMid meet"
        >
          {gridValues.map((value) => {
            const y = priceY(value, minimum, range);
            return (
              <g className="kline-grid" key={value}>
                <line x1={LEFT} x2={WIDTH - RIGHT} y1={y} y2={y} />
                <text x={LEFT - 8} y={y + 4}>{formatPrice(value)}</text>
              </g>
            );
          })}

          {bars.map((bar, index) => {
            const x = xAt(index);
            const openY = priceY(bar.open, minimum, range);
            const closeY = priceY(bar.close, minimum, range);
            const direction = bar.close >= bar.open ? "up" : "down";
            const volumeHeight = Math.max(1, (bar.volume / maxVolume) * (VOLUME_BOTTOM - VOLUME_TOP));
            return (
              <g key={bar.date}>
                <line
                  className={`kline-wick ${direction}`}
                  x1={x}
                  x2={x}
                  y1={priceY(bar.high, minimum, range)}
                  y2={priceY(bar.low, minimum, range)}
                />
                <rect
                  className={`kline-candle ${direction}`}
                  x={x - candleWidth / 2}
                  y={Math.min(openY, closeY)}
                  width={candleWidth}
                  height={Math.max(1.5, Math.abs(openY - closeY))}
                />
                <rect
                  className={`kline-volume-bar ${direction}`}
                  x={x - candleWidth / 2}
                  y={VOLUME_BOTTOM - volumeHeight}
                  width={candleWidth}
                  height={volumeHeight}
                />
                <rect
                  className="kline-hit-target"
                  x={LEFT + slotWidth * index}
                  y={PRICE_TOP}
                  width={slotWidth}
                  height={VOLUME_BOTTOM - PRICE_TOP}
                  role="button"
                  tabIndex={0}
                  aria-label={barLabel(bar)}
                  onFocus={() => setActiveIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                />
              </g>
            );
          })}

          {MA_SERIES.map(({ key, label }) => (
            <path
              key={key}
              className={`kline-ma-line ${key}`}
              d={buildMaPath(bars, key, xAt, minimum, range)}
              aria-label={label}
            />
          ))}

          <line className="kline-volume-axis" x1={LEFT} x2={WIDTH - RIGHT} y1={VOLUME_TOP} y2={VOLUME_TOP} />
          <text className="kline-axis-label" x={LEFT - 8} y={VOLUME_TOP + 4}>成交量</text>
        </svg>
      </div>
      <div className="kline-bar-detail" aria-live="polite">
        <strong className="kline-detail-date">{activeBar.date}</strong>
        <span>开 {formatPrice(activeBar.open)}</span>
        <span>高 {formatPrice(activeBar.high)}</span>
        <span>低 {formatPrice(activeBar.low)}</span>
        <span>收 {formatPrice(activeBar.close)}</span>
        <span>涨跌 {formatChangePercent(activeBar.change_pct)}</span>
        <span>量 {formatVolume(activeBar.volume)}</span>
      </div>
    </section>
  );
}
