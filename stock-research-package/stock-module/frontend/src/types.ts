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

export type RefreshTaskStatus = "queued" | "running" | "succeeded" | "partial" | "failed" | "skipped";

export type RefreshTask = {
  task_id: string;
  status: RefreshTaskStatus;
  message: string | null;
};

export type MomPostEvidence = {
  platform: "eastmoney" | "xiaohongshu";
  platform_id: string;
  title: string;
  url: string | null;
  published_at: string | null;
  collected_at: string;
  reasoning: string;
  intent: "buy" | "sell" | "neutral";
};

export type MomSourceStatus = {
  source_id: "eastmoney" | "xiaohongshu";
  status: "ok" | "error" | "login_required" | "risk_controlled";
  collected_at: string;
  post_count: number;
  message: string | null;
};

export type MomSectorIndex = {
  sector_id: "nasdaq" | "gold" | "cpo" | "semiconductor";
  name: string;
  index: number;
  buy_index: number;
  sell_index: number;
  total_posts: number;
  valid_posts: number;
  newbie_posts: number;
  newbie_ratio: number;
  buy_count: number;
  sell_count: number;
  risk_level: "cold" | "normal" | "warming" | "warning" | "extreme";
  interpretation: string;
  top_posts: MomPostEvidence[];
};

export type MomIndexSnapshot = {
  snapshot_date: string;
  generated_at: string;
  completeness: "complete" | "partial";
  sectors: Record<string, MomSectorIndex>;
  sources: MomSourceStatus[];
  stale: boolean;
};

export type MomIndexHistoryResponse = {
  items: MomIndexSnapshot[];
};

export type XhsLoginResponse = {
  session_id?: string;
  sessionId?: string;
  qr_code?: string;
  qrCode?: string;
  qrCodeUrl?: string;
  status?: string;
  message?: string;
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
