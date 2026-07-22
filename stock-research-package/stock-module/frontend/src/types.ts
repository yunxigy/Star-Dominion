export type CandidateSource = {
  source_id: string;
  source_name: string;
  score: number | null;
  reasons: string[];
};

export type CandidateStock = {
  stock: {
    symbol: string;
    name: string;
    exchange: string;
  };
  sources: CandidateSource[];
  generated_at: string;
};

export type CandidateResponse = {
  items: CandidateStock[];
  sources: CandidateSourceStatus[];
};

export type CandidateSourceStatus = {
  source_id: string;
  source_name: string;
  status: "ok" | "stale" | "error" | "not_configured";
  generated_at: string | null;
  error: string | null;
};

export type RefreshTaskStatus = "queued" | "running" | "succeeded" | "partial" | "failed";

export type RefreshTask = {
  task_id: string;
  status: RefreshTaskStatus;
  message: string | null;
};

export type ImportantNewsItem = {
  id: string;
  title: string;
  summary: string;
  published_at: string;
  source: string;
  url: string;
  themes: string[];
  symbols: string[];
  importance_score: number;
  tone: "positive" | "risk" | "neutral";
};

export type ThemeSignal = {
  id: string;
  name: string;
  logic: string;
  average_change_pct: number;
  signal_score: number;
  breadth: number;
  summary: string;
};

export type CandidateEvidence = {
  symbol: string;
  name: string;
  exchange: string;
  industry: string;
  theme: string;
  total_score: number;
  rationale: string;
  dimension_scores: Record<string, number>;
  historical_stats: Record<string, number | string | null>;
  positive_flags: string[];
  risk_flags: string[];
  invalid_conditions: string[];
  news: ImportantNewsItem[];
};

export type MorningReport = {
  report_date: string;
  generated_at: string;
  previous_trade_date: string;
  freshness: "current" | "stale";
  previous_success_date: string | null;
  market_summary: string;
  themes: ThemeSignal[];
  important_news: ImportantNewsItem[];
  catalyst_candidates: CandidateEvidence[];
};

export type MorningReportHistoryResponse = {
  items: Array<{ report_date: string; generated_at: string }>;
};

export type ResearchSourceEvidence = {
  source_id: "catalyst" | "user_strategy";
  source_name: string;
  score: number | null;
  reasons: string[];
};

export type StockResearchContext = {
  symbol: string;
  name: string;
  exchange: string;
  cross_hit: boolean;
  sources: ResearchSourceEvidence[];
  catalyst: CandidateEvidence | null;
};

export type ModelProfile = {
  id: string;
  scope: "platform" | "personal";
  name: string;
  provider: "siliconflow" | "openai_compatible";
  base_url: string;
  timeout_seconds: number;
  enabled: boolean;
  key_configured: boolean;
  updated_at: string;
};

export type ModelProfileCreate = {
  name: string;
  provider: ModelProfile["provider"];
  base_url: string;
  api_key: string;
  timeout_seconds: number;
};

export type AnalysisState =
  | "queued"
  | "collecting"
  | "analyzing"
  | "rendering"
  | "succeeded"
  | "failed";

export type AnalysisCreate = {
  symbol: string;
  profile_id: string;
  model: string;
  report_type: "detailed" | "brief";
  force_refresh: boolean;
};

export type AnalysisTask = {
  task_id: string;
  symbol: string;
  profile_id: string;
  profile_name: string;
  profile_scope: ModelProfile["scope"];
  model: string;
  report_type: "detailed" | "brief";
  force_refresh: boolean;
  state: AnalysisState;
  progress_message: string;
  cache_hit: boolean;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type AnalysisReport = {
  task_id: string;
  report: Record<string, unknown>;
};
