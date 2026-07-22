import { useEffect, useMemo, useState } from "react";

import { loadAnalysisReport, loadAnalysisTask } from "../api";
import type { AnalysisReport as AnalysisReportPayload, AnalysisTask } from "../types";

type Props = {
  initialTask: AnalysisTask;
  onBack: () => void;
};

const stateLabel: Record<AnalysisTask["state"], string> = {
  queued: "等待分析",
  collecting: "采集数据",
  analyzing: "大模型分析",
  rendering: "整理报告",
  succeeded: "分析完成",
  failed: "分析失败",
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(" · ");
  return "";
}

function ReportSection({ title, value }: { title: string; value: unknown }) {
  const content = text(value);
  if (!content) return null;
  return (
    <section className="report-section">
      <h3>{title}</h3>
      <p>{content}</p>
    </section>
  );
}

export function AnalysisReport({ initialTask, onBack }: Props) {
  const [task, setTask] = useState(initialTask);
  const [payload, setPayload] = useState<AnalysisReportPayload | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    setTask(initialTask);
    setPayload(null);
    setError("");

    const fetchReport = async (taskId: string) => {
      try {
        const report = await loadAnalysisReport(taskId);
        if (!cancelled) setPayload(report);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      }
    };

    const poll = async (attempt = 0): Promise<void> => {
      if (cancelled) return;
      try {
        const current = await loadAnalysisTask(initialTask.task_id);
        if (cancelled) return;
        setTask(current);
        if (current.state === "succeeded") {
          await fetchReport(current.task_id);
          return;
        }
        if (current.state === "failed") return;
        if (attempt >= 1799) {
          setError("分析等待超过 30 分钟，请稍后返回查看任务");
          return;
        }
        timer = window.setTimeout(() => void poll(attempt + 1), 1000);
      } catch (reason) {
        if (!cancelled) setError((reason as Error).message);
      }
    };

    if (initialTask.state === "succeeded") {
      void fetchReport(initialTask.task_id);
    } else if (initialTask.state !== "failed") {
      void poll();
    }
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [initialTask]);

  const sections = useMemo(() => {
    const report = record(payload?.report);
    return {
      meta: record(report.meta),
      summary: record(report.summary),
      strategy: record(report.strategy),
      details: record(report.details),
    };
  }, [payload]);

  return (
    <section className="analysis-report" aria-labelledby="analysis-report-title">
      <div className="report-heading">
        <div>
          <span className="section-number">INDIVIDUAL ANALYSIS / {task.symbol}</span>
          <h2 id="analysis-report-title">个股详细分析</h2>
          <p>{task.profile_name} · {task.model}</p>
        </div>
        <button className="secondary-button" type="button" onClick={onBack}>返回研究台</button>
      </div>

      {!payload && (
        <div className={`task-progress state-${task.state}`} role="status">
          <span>{stateLabel[task.state]}</span>
          <strong>{task.progress_message}</strong>
        </div>
      )}
      {task.state === "failed" && <p className="inline-error" role="alert">{task.error_message ?? "分析任务失败"}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}

      {payload && (
        <div className="report-body">
          <ReportSection title="核心结论" value={sections.summary.analysis_summary} />
          <ReportSection title="操作观察" value={sections.summary.operation_advice} />
          <ReportSection title="趋势判断" value={sections.summary.trend_prediction} />
          <ReportSection title="风险提示" value={sections.details.risk_warning} />
          <ReportSection title="技术分析" value={sections.details.technical_analysis} />
          <ReportSection title="基本面" value={sections.details.fundamental_analysis} />
          <ReportSection title="新闻与催化" value={sections.details.news_summary} />
          {Object.keys(sections.strategy).length > 0 && (
            <section className="report-section strategy-section">
              <h3>策略价位</h3>
              <dl>
                {Object.entries(sections.strategy).map(([key, value]) => text(value) && (
                  <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>
                ))}
              </dl>
            </section>
          )}
          <div className="report-meta">
            <span>报告时间：{task.finished_at ? new Date(task.finished_at).toLocaleString("zh-CN") : "—"}</span>
            {text(sections.meta.model_used) && <span>上游模型：{text(sections.meta.model_used)}</span>}
            <span>{task.cache_hit ? "命中同配置缓存" : "本次新生成"}</span>
          </div>
          <p className="report-disclaimer">本报告由自动化数据与大模型生成，仅用于研究，不构成投资建议。请独立核验数据并自行承担决策风险。</p>
        </div>
      )}
    </section>
  );
}
