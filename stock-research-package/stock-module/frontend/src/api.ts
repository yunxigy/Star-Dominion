import type {
  AnalysisCreate,
  AnalysisReport,
  AnalysisTask,
  CandidateResponse,
  ModelProfile,
  ModelProfileCreate,
  MomIndexHistoryResponse,
  MomIndexSnapshot,
  MorningReport,
  MorningReportHistoryResponse,
  RefreshTask,
  StockResearchContext,
  XhsLoginResponse,
} from "./types";

export class PublicApiError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "PublicApiError";
  }
}

export const AUTH_REQUIRED_EVENT = "site-auth-required";

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const prefix = `${encodeURIComponent(name)}=`;
  const item = document.cookie.split("; ").find((part) => part.startsWith(prefix));
  return item ? decodeURIComponent(item.slice(prefix.length)) : undefined;
}

function withSiteSession(init?: RequestInit): RequestInit {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = {
    ...((init?.headers ?? {}) as Record<string, string>),
  };
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const csrf = readCookie("sd_csrf");
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  return { ...init, headers, credentials: "include" };
}

function announceLoginRequired(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const safeNext = next.startsWith("/") ? next : "/stock/";
  const url = `/auth/login?next=${encodeURIComponent(safeNext)}`;
  const event = new CustomEvent<{ url: string }>(AUTH_REQUIRED_EVENT, {
    cancelable: true,
    detail: { url },
  });
  if (window.dispatchEvent(event)) window.location.assign(url);
}

async function readResponse<T>(
  response: Response,
  fallback: string,
  redirectUnauthorized = true,
): Promise<T> {
  if (response.ok) {
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }
  if (response.status === 401) {
    if (redirectUnauthorized) announceLoginRequired();
    throw new PublicApiError("AUTH_REQUIRED", "请先登录后继续");
  }
  let code = "REQUEST_FAILED";
  let message = fallback;
  try {
    const body = await response.json() as {
      detail?: string | { code?: unknown; message?: unknown };
    };
    if (typeof body.detail === "string") message = body.detail;
    if (body.detail && typeof body.detail === "object") {
      if (typeof body.detail.code === "string") code = body.detail.code;
      if (typeof body.detail.message === "string") message = body.detail.message;
    }
  } catch {
    // Never expose raw provider or server bodies to the browser.
  }
  throw new PublicApiError(code, message);
}

async function request<T>(
  url: string,
  fallback: string,
  init?: RequestInit,
  redirectUnauthorized = true,
): Promise<T> {
  const response = await fetch(url, withSiteSession(init));
  return readResponse<T>(response, fallback, redirectUnauthorized);
}

export const loadCurrentMorningReport = () =>
  request<MorningReport>("/stock-api/api/v1/morning-report/current", "九点猫研晨报加载失败");

export const loadMorningReport = (reportDate: string) =>
  request<MorningReport>(
    `/stock-api/api/v1/morning-reports/${encodeURIComponent(reportDate)}`,
    "每日报纸加载失败",
  );

export const loadMorningReportHistory = (limit = 20) =>
  request<MorningReportHistoryResponse>(
    `/stock-api/api/v1/morning-reports?limit=${Math.min(100, Math.max(1, limit))}`,
    "历史晨报加载失败",
  );

export const refreshMorningReport = () =>
  request<RefreshTask>(
    "/stock-api/api/v1/morning-report/refresh",
    "九点猫研刷新失败",
    { method: "POST" },
  );

export const loadStockResearchContext = (symbol: string) =>
  request<StockResearchContext>(
    `/stock-api/api/v1/stocks/${encodeURIComponent(symbol)}/research-context`,
    "股票详情加载失败",
  );

export const loadCandidates = () =>
  request<CandidateResponse>("/stock-api/api/v1/candidates", "候选股加载失败");

export const startCandidateRefresh = () =>
  request<RefreshTask>(
    "/stock-api/api/v1/candidates/refresh",
    "候选股刷新任务创建失败",
    { method: "POST" },
  );

export const loadRefreshTask = (taskId: string) =>
  request<RefreshTask>(
    `/stock-api/api/v1/candidates/refresh/${encodeURIComponent(taskId)}`,
    "候选股刷新状态加载失败",
  );

export const loadCurrentMomIndex = () =>
  request<MomIndexSnapshot>(
    "/stock-api/api/v1/mom-index/current",
    "宝妈指数加载失败",
  );

export const loadMomIndexHistory = (limit = 30) =>
  request<MomIndexHistoryResponse>(
    `/stock-api/api/v1/mom-index/history?limit=${Math.min(100, Math.max(1, limit))}`,
    "宝妈指数历史加载失败",
  );

export const refreshMomIndex = () =>
  request<RefreshTask>(
    "/stock-api/api/v1/mom-index/refresh",
    "宝妈指数刷新任务创建失败",
    { method: "POST" },
  );

export const loadMomRefreshTask = (taskId: string) =>
  request<RefreshTask>(
    `/stock-api/api/v1/mom-index/refresh/${encodeURIComponent(taskId)}`,
    "宝妈指数刷新状态加载失败",
  );

export const loadXhsStatus = (redirectUnauthorized = true) =>
  request<XhsLoginResponse>(
    "/stock-api/api/v1/mom-index/xhs/status",
    "小红书登录状态加载失败",
    undefined,
    redirectUnauthorized,
  );

export const startXhsLogin = () =>
  request<XhsLoginResponse>(
    "/stock-api/api/v1/mom-index/xhs/login",
    "小红书扫码登录启动失败",
    { method: "POST" },
  );

export const pollXhsLogin = (sessionId: string) =>
  request<XhsLoginResponse>(
    `/stock-api/api/v1/mom-index/xhs/login/${encodeURIComponent(sessionId)}`,
    "小红书登录状态检查失败",
  );

export async function loadModelProfiles(redirectUnauthorized = true): Promise<ModelProfile[]> {
  const body = await request<{ items: ModelProfile[] }>(
    "/stock-api/api/v1/model-profiles",
    "模型配置加载失败",
    undefined,
    redirectUnauthorized,
  );
  return body.items;
}

export const createModelProfile = (payload: ModelProfileCreate) =>
  request<ModelProfile>("/stock-api/api/v1/model-profiles", "模型配置保存失败", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const updateModelProfile = (
  profileId: string,
  payload: Partial<ModelProfileCreate> & { enabled?: boolean },
) =>
  request<ModelProfile>(
    `/stock-api/api/v1/model-profiles/${encodeURIComponent(profileId)}`,
    "模型配置更新失败",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

export const deleteModelProfile = (profileId: string) =>
  request<void>(
    `/stock-api/api/v1/model-profiles/${encodeURIComponent(profileId)}`,
    "模型配置删除失败",
    { method: "DELETE" },
  );

export const testModelProfile = (profileId: string, model?: string) =>
  request<unknown>(
    `/stock-api/api/v1/model-profiles/${encodeURIComponent(profileId)}/test`,
    "模型连接测试失败",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(model ? { model } : {}),
    },
  );

export async function loadProfileModels(profileId: string): Promise<string[]> {
  const body = await request<{ items: string[] }>(
    `/stock-api/api/v1/model-profiles/${encodeURIComponent(profileId)}/models`,
    "模型列表加载失败",
  );
  return body.items;
}

export async function refreshProfileModels(profileId: string): Promise<string[]> {
  const body = await request<{ items: string[] }>(
    `/stock-api/api/v1/model-profiles/${encodeURIComponent(profileId)}/models/refresh`,
    "模型列表刷新失败",
    { method: "POST" },
  );
  return body.items;
}

export const startAnalysis = (payload: AnalysisCreate) =>
  request<AnalysisTask>("/stock-api/api/v1/analyses", "分析任务创建失败", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const loadAnalysisTask = (taskId: string) =>
  request<AnalysisTask>(
    `/stock-api/api/v1/analyses/${encodeURIComponent(taskId)}`,
    "分析状态加载失败",
  );

export const loadAnalysisReport = (taskId: string) =>
  request<AnalysisReport>(
    `/stock-api/api/v1/analyses/${encodeURIComponent(taskId)}/report`,
    "分析报告加载失败",
  );
