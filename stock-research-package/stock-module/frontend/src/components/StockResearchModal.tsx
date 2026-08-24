import { useCallback, useEffect, useRef, useState } from "react";

import { loadStockKline, loadStockResearchContext } from "../api";
import type {
  AnalysisTask,
  KlineDays,
  ModelProfile,
  StockKline,
  StockResearchContext,
} from "../types";
import { AnalysisControls } from "./AnalysisControls";
import { StockEvidenceGrid } from "./StockEvidenceGrid";
import { StockKlineChart } from "./StockKlineChart";
import { StockQuoteSummary } from "./StockQuoteSummary";

type Props = {
  symbol: string | null;
  profiles: ModelProfile[];
  returnFocus: HTMLElement | null;
  onClose: () => void;
  onStarted: (task: AnalysisTask) => void;
  onOpenSettings: () => void;
};

const PERIODS: KlineDays[] = [20, 60, 120];

export function StockResearchModal(props: Props) {
  if (!props.symbol) return null;
  return <StockResearchModalContent key={props.symbol} {...props} symbol={props.symbol} />;
}

function StockResearchModalContent({
  symbol,
  profiles,
  returnFocus,
  onClose,
  onStarted,
  onOpenSettings,
}: Omit<Props, "symbol"> & { symbol: string }) {
  const [context, setContext] = useState<StockResearchContext | null>(null);
  const [contextError, setContextError] = useState("");
  const [days, setDays] = useState<KlineDays>(60);
  const [kline, setKline] = useState<StockKline | null>(null);
  const [klineError, setKlineError] = useState("");
  const [klineLoading, setKlineLoading] = useState(true);
  const closeButton = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    onClose();
    queueMicrotask(() => returnFocus?.focus());
  }, [onClose, returnFocus]);

  useEffect(() => {
    let active = true;
    setContext(null);
    setContextError("");
    void loadStockResearchContext(symbol)
      .then((value) => {
        if (active) setContext(value);
      })
      .catch((reason: Error) => {
        if (active) setContextError(reason.message);
      });
    return () => {
      active = false;
    };
  }, [symbol]);

  useEffect(() => {
    let active = true;
    setKlineLoading(true);
    setKlineError("");
    void loadStockKline(symbol, days)
      .then((value) => {
        if (active) setKline(value);
      })
      .catch((reason: Error) => {
        if (active) setKlineError(reason.message);
      })
      .finally(() => {
        if (active) setKlineLoading(false);
      });
    return () => {
      active = false;
    };
  }, [days, symbol]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
    };
  }, [close]);

  const displayName = context?.name ?? kline?.name ?? symbol;
  const exchange = context?.exchange ?? kline?.exchange;

  return (
    <div
      className="research-modal-backdrop"
      data-testid="research-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section
        className="stock-research-modal"
        role="dialog"
        aria-modal="true"
        aria-label="股票研究详情"
      >
        <header className="research-modal-heading">
          <div>
            <span className="section-kicker">A 股主板 · 研报与真实行情</span>
            <h2>{displayName}</h2>
            <p>{symbol}{exchange ? ` · ${exchange}` : ""}</p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            type="button"
            aria-label="关闭股票详情"
            onClick={close}
          >
            ×
          </button>
        </header>

        <div className="research-modal-content">
          <section className="research-market-section" aria-label="当前K线行情">
            <div className="kline-period-heading">
              <div>
                <h3>日K线</h3>
              <p>新浪前复权日线 · 均线与成交量</p>
              </div>
              <div className="kline-period-controls" aria-label="K线时间范围">
                {PERIODS.map((period) => (
                  <button
                    key={period}
                    type="button"
                    aria-pressed={days === period}
                    onClick={() => setDays(period)}
                  >
                    近{period}日
                  </button>
                ))}
              </div>
            </div>

            {kline && (
              <>
                <StockQuoteSummary kline={kline} />
                <StockKlineChart kline={kline} />
              </>
            )}
            {klineLoading && (
              <p className="research-loading" role="status">
                {kline ? `正在更新${days}日K线…` : `正在加载${days}日K线…`}
              </p>
            )}
            {klineError && <p className="inline-error" role="alert">{klineError}</p>}
          </section>

          <section className="research-evidence-section" aria-label="结构化研究依据">
            <div className="research-section-heading">
              <h3>结构化研究依据</h3>
              <p>九点猫研与个人策略的当日命中证据</p>
            </div>
            {contextError && <p className="inline-error" role="alert">{contextError}</p>}
            {!context && !contextError && (
              <p className="research-loading" role="status">正在加载选股依据…</p>
            )}
            {context && <StockEvidenceGrid context={context} />}
          </section>

          <AnalysisControls
            symbol={symbol}
            profiles={profiles}
            submitLabel="生成个股详细分析"
            onStarted={onStarted}
            onOpenSettings={onOpenSettings}
          />
        </div>
      </section>
    </div>
  );
}
