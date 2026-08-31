import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_REQUIRED_EVENT,
  buildSiteLoginUrl,
  loadCurrentMomIndex,
  loadMomIndexHistory,
  loadCurrentMorningReport,
  loadMorningReportHistory,
  loadStockKline,
  loadStockResearchContext,
  startAnalysis,
} from "./api";

const news = Array.from({ length: 6 }, (_, index) => ({
  id: `news-${index + 1}`,
  title: `重要消息 ${index + 1}`,
  summary: `消息摘要 ${index + 1}`,
  published_at: `2026-07-22T0${index + 1}:00:00+08:00`,
  source: "公开资讯",
  url: "",
  themes: ["电网设备"],
  symbols: ["000400"],
  importance_score: 90 - index,
  tone: "positive",
}));

const candidate = (symbol: string, name: string, score: number) => ({
  symbol,
  name,
  exchange: symbol.startsWith("6") ? "SSE" : "SZSE",
  industry: "电气设备",
  theme: "电网设备",
  total_score: score,
  rationale: "海外电力资本开支映射",
  dimension_scores: { catalyst: score },
  historical_stats: { win_rate: 0.62 },
  positive_flags: ["订单改善"],
  risk_flags: ["板块波动"],
  invalid_conditions: ["主题强度跌破阈值"],
  news: [news[0]],
});

const morningReportFixture = {
  report_date: "2026-07-22",
  generated_at: "2026-07-22T09:02:00+08:00",
  previous_trade_date: "2026-07-21",
  freshness: "current",
  previous_success_date: null,
  market_summary: "电网设备与消费电子主题信号居前。",
  themes: [
    {
      id: "power-grid",
      name: "电网设备",
      logic: "海外资本开支扩张",
      average_change_pct: 1.8,
      signal_score: 91,
      breadth: 0.72,
      summary: "订单与景气度共振",
    },
    {
      id: "consumer-electronics",
      name: "消费电子",
      logic: "新品周期",
      average_change_pct: 0.9,
      signal_score: 82,
      breadth: 0.61,
      summary: "供应链预期改善",
    },
  ],
  important_news: news,
  catalyst_candidates: [
    candidate("000400", "许继电气", 92),
    candidate("600312", "平高电气", 88),
    candidate("002475", "立讯精密", 84),
  ],
};

const researchContextFixture = {
  symbol: "600519",
  name: "贵州茅台",
  exchange: "SSE",
  cross_hit: false,
  sources: [],
  catalyst: null,
};

describe("morning report API contracts", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the current morning report from the public stock API", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(morningReportFixture));

    await expect(loadCurrentMorningReport()).resolves.toEqual(morningReportFixture);
    expect(fetch).toHaveBeenCalledWith(
      "/stock-api/api/v1/morning-report/current",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("loads report history with a bounded limit", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({
      items: [{ report_date: "2026-07-22", generated_at: "2026-07-22T09:02:00+08:00" }],
    }));

    await loadMorningReportHistory(20);

    expect(fetch).toHaveBeenCalledWith(
      "/stock-api/api/v1/morning-reports?limit=20",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("loads an arbitrary stock research context", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(researchContextFixture));

    await loadStockResearchContext("600519");

    expect(fetch).toHaveBeenCalledWith(
      "/stock-api/api/v1/stocks/600519/research-context",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("loads a typed stock K-line series for the requested period", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ bars: [] }));

    await loadStockKline("600519", 120);

    expect(fetch).toHaveBeenCalledWith(
      "/stock-api/api/v1/stocks/600519/kline?days=120",
      expect.objectContaining({ credentials: "include", cache: "no-store" }),
    );
  });

  it("loads the current mom index and bounded history from public endpoints", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ snapshot_date: "2026-07-27" }))
      .mockResolvedValueOnce(Response.json({ items: [] }));

    await loadCurrentMomIndex();
    await loadMomIndexHistory(30);

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "/stock-api/api/v1/mom-index/current",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/stock-api/api/v1/mom-index/history?limit=30",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("sends credentials and CSRF for protected mutations", async () => {
    document.cookie = "sd_csrf=csrf-value; path=/";
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ task_id: "analysis-1" }));

    await startAnalysis({
      symbol: "600519",
      profile_id: "profile-1",
      model: "model-a",
      report_type: "detailed",
      force_refresh: false,
    });

    expect(fetch).toHaveBeenCalledWith(
      "/stock-api/api/v1/analyses",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-value",
        }),
      }),
    );
  });

  it("announces a safe central-login redirect on 401", async () => {
    window.history.replaceState({}, "", "/stock/?symbol=600519");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ detail: "需要登录" }, { status: 401 }));
    const redirects: string[] = [];
    const listener = (event: Event) => {
      event.preventDefault();
      redirects.push((event as CustomEvent<{ url: string }>).detail.url);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, listener);

    await expect(loadCurrentMorningReport()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    window.removeEventListener(AUTH_REQUIRED_EVENT, listener);

    expect(redirects).toEqual([
      "/auth/login?next=%2Fstock%2F%3Fsymbol%3D600519",
    ]);
  });

  it("uses the configured main-site origin for local login", () => {
    vi.stubEnv("VITE_SITE_URL", "http://127.0.0.1:8013/");

    expect(buildSiteLoginUrl("/stock/")).toBe(
      "http://127.0.0.1:8013/auth/login?next=%2Fstock%2F",
    );
  });
});
