import { useEffect, useState } from "react";

import { loadProfileModels, refreshProfileModels, startAnalysis } from "../api";
import type { AnalysisTask, ModelProfile } from "../types";

type Props = {
  symbol: string;
  profiles: ModelProfile[];
  submitLabel?: string;
  onStarted: (task: AnalysisTask) => void;
  onOpenSettings: () => void;
};

const MAIN_BOARD = /^(600|601|603|605|000|001|002)\d{3}$/;

export function AnalysisControls({ symbol, profiles, submitLabel = "开始分析", onStarted, onOpenSettings }: Props) {
  const [profileId, setProfileId] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [manual, setManual] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setModels([]);
    setModel("");
    setManual(false);
    setError("");
    if (!profileId) return () => { active = false; };
    setLoadingModels(true);
    void loadProfileModels(profileId)
      .then((items) => {
        if (!active) return;
        setModels(items);
        setManual(items.length === 0);
      })
      .catch((reason: Error) => {
        if (!active) return;
        setError(reason.message);
        setManual(true);
      })
      .finally(() => { if (active) setLoadingModels(false); });
    return () => { active = false; };
  }, [profileId]);

  const refreshModels = async () => {
    if (!profileId) return;
    setLoadingModels(true);
    setError("");
    try {
      const items = await refreshProfileModels(profileId);
      setModels(items);
      setModel("");
      setManual(items.length === 0);
    } catch (reason) {
      setError((reason as Error).message);
      setManual(true);
    } finally {
      setLoadingModels(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!MAIN_BOARD.test(symbol) || !profileId || !model.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      onStarted(await startAnalysis({
        symbol,
        profile_id: profileId,
        model: model.trim(),
        report_type: "detailed",
        force_refresh: false,
      }));
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = MAIN_BOARD.test(symbol) && Boolean(profileId) && Boolean(model.trim()) && !submitting;

  return (
    <form className="analysis-controls" onSubmit={(event) => void submit(event)}>
      <div className="control-heading">
        <h3>生成个股详细分析</h3>
        <p>每次都由你明确选择配置和模型，不设置默认项。</p>
      </div>
      <label>
        <span>模型配置</span>
        <select aria-label="模型配置" value={profileId} onChange={(event) => setProfileId(event.target.value)}>
          <option value="">请选择配置</option>
          {profiles.filter((profile) => profile.enabled).map((profile) => (
            <option value={profile.id} key={profile.id}>{profile.name}（{profile.scope === "platform" ? "平台" : "个人"}）</option>
          ))}
        </select>
      </label>
      <label>
        <span>分析模型</span>
        {!manual ? (
          <select aria-label="分析模型" value={model} onChange={(event) => setModel(event.target.value)} disabled={!profileId || loadingModels}>
            <option value="">{loadingModels ? "正在加载模型…" : "请选择模型"}</option>
            {models.map((item) => <option value={item} key={item}>{item}</option>)}
          </select>
        ) : (
          <input aria-label="手动填写模型 ID" value={model} onChange={(event) => setModel(event.target.value)} placeholder="例如 deepseek-ai/DeepSeek-V3" />
        )}
      </label>
      <div className="analysis-control-actions">
        <button className="secondary-button" type="button" onClick={onOpenSettings}>配置 API</button>
        <button className="secondary-button" type="button" disabled={!profileId || loadingModels} onClick={() => void refreshModels()}>刷新模型</button>
        <button className="primary-button" type="submit" disabled={!canSubmit}>{submitting ? "创建任务中…" : submitLabel}</button>
      </div>
      {profiles.length === 0 && <p className="inline-message">请先配置个人 API，或选择主站未来提供的平台配置。</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>
  );
}
