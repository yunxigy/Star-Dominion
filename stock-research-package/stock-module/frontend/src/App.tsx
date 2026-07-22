import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  loadCandidates,
  loadCurrentMorningReport,
  loadModelProfiles,
  loadMorningReport,
  loadMorningReportHistory,
  loadRefreshTask,
  refreshMorningReport,
} from "./api";
import { AnalysisReport } from "./components/AnalysisReport";
import { CrossHitSummary } from "./components/CrossHitSummary";
import { HistoryEvidence } from "./components/HistoryEvidence";
import { ImportantNews } from "./components/ImportantNews";
import { ModelSettingsPanel } from "./components/ModelSettingsPanel";
import { MomIndexPanel } from "./components/MomIndexPanel";
import { MorningReportPanel } from "./components/MorningReportPanel";
import { MorningNewspaper } from "./components/MorningNewspaper";
import { QuickStockLookup } from "./components/QuickStockLookup";
import { StrategyPanel } from "./components/StrategyPanel";
import { StockDetailDrawer } from "./components/StockDetailDrawer";
import { WorkspaceHeader } from "./components/WorkspaceHeader";
import type {
  AnalysisTask,
  CandidateResponse,
  ModelProfile,
  MorningReport,
  MorningReportHistoryResponse,
} from "./types";

type AppView =
  | { kind: "workbench" }
  | { kind: "newspaper"; reportDate: string }
  | { kind: "analysis"; task: AnalysisTask };

const emptyCandidates: CandidateResponse = { items: [], sources: [] };

export default function App() {
  const [view, setView] = useState<AppView>({ kind: "workbench" });
  const [detailSymbol, setDetailSymbol] = useState<string | null>(null);
  const [morningReport, setMorningReport] = useState<MorningReport | null>(null);
  const [morningHistory, setMorningHistory] = useState<MorningReportHistoryResponse>({ items: [] });
  const [candidates, setCandidates] = useState<CandidateResponse>(emptyCandidates);
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [morningError, setMorningError] = useState("");
  const [candidateError, setCandidateError] = useState("");
  const [profileError, setProfileError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [newspaperReport, setNewspaperReport] = useState<MorningReport | null>(null);
  const [newspaperLoading, setNewspaperLoading] = useState(false);
  const [newspaperError, setNewspaperError] = useState("");
  const detailTrigger = useRef<HTMLElement | null>(null);

  const reloadMorning = useCallback(async () => {
    setMorningError("");
    try {
      setMorningReport(await loadCurrentMorningReport());
    } catch (reason) {
      setMorningError((reason as Error).message);
    }
  }, []);

  const reloadCandidates = useCallback(async () => {
    setCandidateError("");
    try {
      setCandidates(await loadCandidates());
    } catch (reason) {
      setCandidateError((reason as Error).message);
    }
  }, []);

  const reloadHistory = useCallback(async () => {
    try {
      setMorningHistory(await loadMorningReportHistory(20));
    } catch {
      setMorningHistory({ items: [] });
    }
  }, []);

  const reloadProfiles = useCallback(async (redirectUnauthorized = true) => {
    setProfileError("");
    try {
      setProfiles(await loadModelProfiles(redirectUnauthorized));
    } catch (reason) {
      if (redirectUnauthorized) setProfileError((reason as Error).message);
    }
  }, []);

  useEffect(() => { void reloadMorning(); }, [reloadMorning]);
  useEffect(() => { void reloadCandidates(); }, [reloadCandidates]);
  useEffect(() => { void reloadHistory(); }, [reloadHistory]);
  useEffect(() => { void reloadProfiles(false); }, [reloadProfiles]);

  useEffect(() => {
    if (view.kind !== "newspaper") return;
    let active = true;
    setNewspaperLoading(true);
    setNewspaperError("");
    setNewspaperReport(null);
    void loadMorningReport(view.reportDate)
      .then((report) => { if (active) setNewspaperReport(report); })
      .catch((reason: Error) => { if (active) setNewspaperError(reason.message); })
      .finally(() => { if (active) setNewspaperLoading(false); });
    return () => { active = false; };
  }, [view]);

  const refreshAll = async () => {
    setRefreshing(true);
    setRefreshMessage("正在刷新九点猫研与个人策略…");
    try {
      let task = await refreshMorningReport();
      for (let attempt = 0; attempt < 180 && ["queued", "running"].includes(task.status); attempt += 1) {
        task = await loadRefreshTask(task.task_id);
        if (["queued", "running"].includes(task.status)) {
          await new Promise((resolve) => window.setTimeout(resolve, 1000));
        }
      }
      if (["queued", "running"].includes(task.status)) throw new Error("刷新等待超时");
      setRefreshMessage(task.message ?? (task.status === "failed" ? "刷新失败" : "刷新完成"));
      if (task.status === "succeeded" || task.status === "partial") {
        await Promise.all([reloadMorning(), reloadCandidates(), reloadHistory()]);
      }
    } catch (reason) {
      setRefreshMessage((reason as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const catalystSymbols = useMemo(
    () => new Set(morningReport?.catalyst_candidates.map((item) => item.symbol) ?? []),
    [morningReport],
  );

  const openDetail = (symbol: string, trigger?: HTMLElement) => {
    detailTrigger.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setDetailSymbol(symbol);
  };

  const openNewspaper = (reportDate = morningReport?.report_date) => {
    if (reportDate) setView({ kind: "newspaper", reportDate });
  };

  return (
    <div className="app-shell">
      <WorkspaceHeader
        generatedAt={morningReport?.generated_at ?? null}
        freshness={morningReport?.freshness ?? null}
        onOpenSettings={() => {
          void reloadProfiles();
          setSettingsOpen(true);
        }}
      />

      {view.kind === "analysis" ? (
        <main className="workbench-shell">
          <AnalysisReport initialTask={view.task} onBack={() => setView({ kind: "workbench" })} />
        </main>
      ) : view.kind === "newspaper" ? (
        <MorningNewspaper
          report={newspaperReport}
          loading={newspaperLoading}
          error={newspaperError}
          onBack={() => setView({ kind: "workbench" })}
          onOpenDetail={openDetail}
        />
      ) : (
        <main className="workbench-shell">
          <QuickStockLookup onOpenDetail={openDetail} />
          {refreshMessage && <p className="refresh-message" role="status">{refreshMessage}</p>}
          <div className="primary-workbench-grid">
            <MorningReportPanel
              report={morningReport}
              error={morningError}
              refreshing={refreshing}
              onOpenDetail={openDetail}
              onRefresh={() => void refreshAll()}
            />
            <StrategyPanel
              items={candidates.items}
              sources={candidates.sources}
              catalystSymbols={catalystSymbols}
              refreshing={refreshing}
              onOpenDetail={openDetail}
              onRefresh={() => void refreshAll()}
            />
          </div>
          {candidateError && <p className="source-alert strategy-source-error" role="alert">个人策略：{candidateError}</p>}
          <ImportantNews items={morningReport?.important_news ?? []} onReadNewspaper={() => openNewspaper()} />
          <div className="evidence-grid">
            <CrossHitSummary
              catalystCandidates={morningReport?.catalyst_candidates ?? []}
              candidateItems={candidates.items}
              onOpenDetail={openDetail}
            />
            <HistoryEvidence
              items={morningHistory.items}
              candidates={morningReport?.catalyst_candidates ?? []}
              onOpenReport={openNewspaper}
            />
          </div>
          <MomIndexPanel />
          <footer className="research-footer">本模块仅用于研究，不构成投资建议 · 仅覆盖 A 股主板</footer>
        </main>
      )}

      <StockDetailDrawer
        symbol={detailSymbol}
        profiles={profiles}
        returnFocus={detailTrigger.current}
        onClose={() => setDetailSymbol(null)}
        onStarted={(task) => {
          setDetailSymbol(null);
          setView({ kind: "analysis", task });
        }}
        onOpenSettings={() => {
          void reloadProfiles();
          setSettingsOpen(true);
        }}
      />
      {profileError && <p className="floating-error" role="alert">{profileError}</p>}
      <ModelSettingsPanel
        open={settingsOpen}
        profiles={profiles}
        onClose={() => setSettingsOpen(false)}
        onChanged={() => reloadProfiles()}
      />
    </div>
  );
}
