import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import App from "./App";

const mocks = vi.hoisted(() => ({
  loadCandidates: vi.fn(),
  loadCurrentMorningReport: vi.fn(),
  loadMorningReportHistory: vi.fn(),
  loadMorningReport: vi.fn(),
  loadStockResearchContext: vi.fn(),
  refreshMorningReport: vi.fn(),
  startCandidateRefresh: vi.fn(),
  loadRefreshTask: vi.fn(),
  loadModelProfiles: vi.fn(),
  createModelProfile: vi.fn(),
  updateModelProfile: vi.fn(),
  deleteModelProfile: vi.fn(),
  testModelProfile: vi.fn(),
  loadProfileModels: vi.fn(),
  refreshProfileModels: vi.fn(),
  startAnalysis: vi.fn(),
  loadAnalysisTask: vi.fn(),
  loadAnalysisReport: vi.fn(),
}));

vi.mock("./api", () => mocks);

const importantNews = Array.from({ length: 6 }, (_, index) => ({
  id: `news-${index}`,
  title: `隔夜重要消息 ${index + 1}`,
  summary: `这是一条与今日主板映射有关的事实摘要 ${index + 1}`,
  published_at: `2026-07-22T0${index + 1}:10:00+08:00`,
  source: "公开资讯",
  url: "",
  themes: ["电网设备"],
  symbols: ["000400"],
  importance_score: 90 - index,
  tone: index === 5 ? "risk" : "positive",
}));

const catalystCandidate = {
  symbol: "000400",
  name: "许继电气",
  exchange: "SZSE",
  industry: "电气设备",
  theme: "电网设备",
  total_score: 92,
  rationale: "海外电力资本开支映射",
  dimension_scores: { catalyst: 91, history: 73 },
  historical_stats: { win_rate: 0.67, sample_size: 24 },
  positive_flags: ["订单改善"],
  risk_flags: ["解禁"],
  invalid_conditions: ["主题强度跌破阈值"],
  news: [importantNews[0]],
};

const currentReport = {
  report_date: "2026-07-22",
  generated_at: "2026-07-22T09:02:00+08:00",
  previous_trade_date: "2026-07-21",
  freshness: "current" as const,
  previous_success_date: null,
  market_summary: "AI 算力与半导体走强（信号 100.0）；有色、能源与黄金跟涨（信号 93.2）",
  themes: [
    { id: "grid", name: "电网设备", logic: "海外资本开支扩张", average_change_pct: 1.8, signal_score: 91, breadth: 0.72, summary: "景气与订单共振" },
    { id: "consumer", name: "消费电子", logic: "新品周期", average_change_pct: 0.9, signal_score: 82, breadth: 0.61, summary: "供应链预期改善" },
  ],
  important_news: importantNews,
  catalyst_candidates: [
    catalystCandidate,
    { ...catalystCandidate, symbol: "600312", name: "平高电气", exchange: "SSE", total_score: 88 },
    { ...catalystCandidate, symbol: "002475", name: "立讯精密", theme: "消费电子", total_score: 84 },
  ],
};

const fullReport = {
  ...currentReport,
  important_news: [
    ...importantNews,
    ...Array.from({ length: 4 }, (_, index) => ({
      ...importantNews[0],
      id: `full-news-${index}`,
      title: `报纸完整消息 ${index + 7}`,
    })),
  ],
};

const candidateCollection = {
  items: [
    {
      stock: { symbol: "000400", name: "许继电气", exchange: "SZSE" },
      sources: [
        { source_id: "catalyst", source_name: "九点猫研", score: 92, reasons: ["海外电力资本开支映射"] },
        { source_id: "user_strategy", source_name: "我的选股策略", score: 78, reasons: ["低位放量", "趋势转强"] },
      ],
      generated_at: "2026-07-22T09:02:00+08:00",
    },
    {
      stock: { symbol: "002415", name: "海康威视", exchange: "SZSE" },
      sources: [
        { source_id: "user_strategy", source_name: "我的选股策略", score: 76, reasons: ["估值回归", "放量突破"] },
      ],
      generated_at: "2026-07-22T09:01:00+08:00",
    },
  ],
  sources: [
    { source_id: "catalyst", source_name: "九点猫研", status: "ok", generated_at: "2026-07-22T09:02:00+08:00", error: null },
    { source_id: "user_strategy", source_name: "我的选股策略", status: "ok", generated_at: "2026-07-22T09:01:00+08:00", error: null },
  ],
};

const researchContext = {
  symbol: "000400",
  name: "许继电气",
  exchange: "SZSE",
  cross_hit: true,
  sources: [
    { source_id: "catalyst", source_name: "九点猫研", score: 92, reasons: ["海外电力资本开支映射"] },
    { source_id: "user_strategy", source_name: "我的选股策略", score: 78, reasons: ["低位放量", "趋势转强"] },
  ],
  catalyst: catalystCandidate,
};

beforeEach(() => {
  mocks.loadCurrentMorningReport.mockResolvedValue(structuredClone(currentReport));
  mocks.loadMorningReportHistory.mockResolvedValue({
    items: [{ report_date: "2026-07-22", generated_at: "2026-07-22T09:02:00+08:00" }],
  });
  mocks.loadMorningReport.mockResolvedValue(structuredClone(fullReport));
  mocks.loadCandidates.mockResolvedValue(structuredClone(candidateCollection));
  mocks.loadModelProfiles.mockResolvedValue([]);
  mocks.loadStockResearchContext.mockResolvedValue(structuredClone(researchContext));
  mocks.loadProfileModels.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

test("keeps API configuration visible in the workspace header", async () => {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: "API 配置" }));
  expect(await screen.findByRole("heading", { name: "模型与 API 设置" })).toBeInTheDocument();
});

test("shows 九点猫研 as the primary workspace and removes anchor navigation", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "九点猫研 · 今日晨报" })).toBeInTheDocument();
  expect(screen.getByText("昨夜美股 → 今日 A 股")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "我的选股策略" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "候选雷达" })).not.toBeInTheDocument();
});

test("renders every market theme summary on its own row", async () => {
  render(<App />);

  expect(await screen.findAllByTestId("market-summary-line")).toHaveLength(2);
  expect(screen.getByText("AI 算力与半导体走强（信号 100.0）")).toBeInTheDocument();
  expect(screen.getByText("有色、能源与黄金跟涨（信号 93.2）")).toBeInTheDocument();
});

test("shows no more than eight important news summaries", async () => {
  render(<App />);

  await screen.findByRole("heading", { name: "盘后至开盘前重要消息" });
  expect(screen.getAllByTestId("news-summary")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "阅读每日报纸" })).toBeInTheDocument();
});

test("lists detail actions for both 九研 and personal strategy candidates", async () => {
  render(<App />);

  expect(await screen.findByRole("button", { name: "查看 许继电气 详情" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看 海康威视 详情" })).toBeInTheDocument();
  expect(screen.getAllByText("海外电力资本开支映射").length).toBeGreaterThan(0);
});

test("labels stale report without hiding its candidates", async () => {
  mocks.loadCurrentMorningReport.mockResolvedValueOnce({
    ...structuredClone(currentReport),
    freshness: "stale",
    previous_success_date: "2026-07-21",
  });

  render(<App />);

  expect(await screen.findByText("当前展示最近成功晨报")).toBeInTheDocument();
  expect(screen.getAllByText("许继电气").length).toBeGreaterThan(0);
});

test("keeps personal strategy visible when the morning report fails", async () => {
  mocks.loadCurrentMorningReport.mockRejectedValueOnce(new Error("晨报暂不可用"));

  render(<App />);

  expect(await screen.findByRole("heading", { name: "我的选股策略" })).toBeInTheDocument();
  expect(screen.getByText("海康威视")).toBeInTheDocument();
  expect(screen.getByText("晨报暂不可用")).toBeInTheDocument();
});

test("shows structured evidence before asking for a model", async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "查看 许继电气 详情" }));

  expect(await screen.findByRole("dialog", { name: "股票研究详情" })).toBeInTheDocument();
  expect(screen.getAllByText("海外电力资本开支映射").length).toBeGreaterThan(0);
  expect(screen.getByText("历史优势 73")).toBeInTheDocument();
  expect(screen.getByText("风险：解禁")).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "模型配置" })).toHaveValue("");
  expect(screen.getByRole("combobox", { name: "分析模型" })).toHaveValue("");
});

test("starts the existing analysis flow from the drawer", async () => {
  mocks.loadModelProfiles.mockResolvedValueOnce([{ id: "profile-1", scope: "personal", name: "测试硅基流动", provider: "siliconflow", base_url: "https://api.siliconflow.cn/v1", timeout_seconds: 120, enabled: true, key_configured: true, updated_at: "2026-07-22T08:00:00+08:00" }]);
  mocks.loadProfileModels.mockResolvedValueOnce(["qa/model"]);
  mocks.startAnalysis.mockResolvedValueOnce({ task_id: "analysis-1", symbol: "000400", profile_id: "profile-1", profile_name: "测试硅基流动", profile_scope: "personal", model: "qa/model", report_type: "detailed", force_refresh: false, state: "queued", progress_message: "等待分析", cache_hit: false, error_code: null, error_message: null, created_at: "2026-07-22T09:10:00+08:00", updated_at: "2026-07-22T09:10:00+08:00", started_at: null, finished_at: null });
  mocks.loadAnalysisTask.mockResolvedValueOnce({ task_id: "analysis-1", symbol: "000400", profile_id: "profile-1", profile_name: "测试硅基流动", profile_scope: "personal", model: "qa/model", report_type: "detailed", force_refresh: false, state: "failed", progress_message: "测试结束", cache_hit: false, error_code: "TEST", error_message: "测试任务", created_at: "2026-07-22T09:10:00+08:00", updated_at: "2026-07-22T09:10:01+08:00", started_at: null, finished_at: "2026-07-22T09:10:01+08:00" });
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "查看 许继电气 详情" }));
  fireEvent.change(await screen.findByRole("combobox", { name: "模型配置" }), { target: { value: "profile-1" } });
  fireEvent.change(await screen.findByRole("combobox", { name: "分析模型" }), { target: { value: "qa/model" } });
  fireEvent.click(screen.getByRole("button", { name: "生成个股详细分析" }));

  expect(await screen.findByRole("heading", { name: "个股详细分析" })).toBeInTheDocument();
  expect(mocks.startAnalysis).toHaveBeenCalledWith(expect.objectContaining({ profile_id: "profile-1", model: "qa/model" }));
});

test("opens the same drawer for an arbitrary valid main-board code", async () => {
  mocks.loadStockResearchContext.mockResolvedValueOnce({ symbol: "600519", name: "600519", exchange: "SSE", cross_hit: false, sources: [], catalyst: null });
  render(<App />);

  fireEvent.change(await screen.findByLabelText("直接输入股票代码"), { target: { value: "600519" } });
  fireEvent.click(screen.getByRole("button", { name: "查看股票详情" }));

  expect(await screen.findByRole("dialog", { name: "股票研究详情" })).toBeInTheDocument();
  expect(screen.getAllByText("600519").length).toBeGreaterThan(0);
});

test("closes the drawer with Escape and restores trigger focus", async () => {
  render(<App />);
  const trigger = await screen.findByRole("button", { name: "查看 海康威视 详情" });
  fireEvent.click(trigger);
  expect(await screen.findByRole("dialog", { name: "股票研究详情" })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: "Escape" });

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "股票研究详情" })).not.toBeInTheDocument());
  expect(trigger).toHaveFocus();
});

test("renders the full report and returns without losing the workbench", async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole("button", { name: "阅读每日报纸" }));

  expect(await screen.findByRole("heading", { name: "九点猫研每日报纸" })).toBeInTheDocument();
  expect(screen.getAllByTestId("newspaper-news")).toHaveLength(fullReport.important_news.length);
  fireEvent.click(screen.getByRole("button", { name: "返回晨报工作台" }));
  expect(await screen.findByRole("heading", { name: "九点猫研 · 今日晨报" })).toBeInTheDocument();
});

test("keeps 宝妈指数 independent from candidate scores", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "宝妈指数" })).toBeInTheDocument();
  expect(screen.getAllByText("不参与候选排序").length).toBeGreaterThan(0);
});
