import { useState } from "react";

import {
  createModelProfile,
  deleteModelProfile,
  testModelProfile,
} from "../api";
import type { ModelProfile } from "../types";

type Props = {
  open: boolean;
  profiles: ModelProfile[];
  onClose: () => void;
  onChanged: () => Promise<void>;
};

const SILICONFLOW_URL = "https://api.siliconflow.cn/v1";

export function ModelSettingsPanel({ open, profiles, onClose, onChanged }: Props) {
  const [preset, setPreset] = useState<"siliconflow" | "openai_compatible">("siliconflow");
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState(SILICONFLOW_URL);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  if (!open) return null;

  const changePreset = (value: "siliconflow" | "openai_compatible") => {
    setPreset(value);
    setBaseUrl(value === "siliconflow" ? SILICONFLOW_URL : "");
    setApiKey("");
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    let saved = false;
    try {
      await createModelProfile({
        name: name.trim(),
        provider: preset,
        base_url: baseUrl.trim(),
        api_key: apiKey,
        timeout_seconds: 120,
      });
      saved = true;
      setName("");
      setMessage("配置已加密保存");
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      if (saved) setApiKey("");
      setSaving(false);
    }
  };

  const testConnection = async (profile: ModelProfile) => {
    setError("");
    setMessage("正在验证鉴权与模型列表，不发起正式个股分析");
    try {
      await testModelProfile(profile.id);
      setMessage(`${profile.name} 连接可用`);
    } catch (reason) {
      setMessage("");
      setError((reason as Error).message);
    }
  };

  const remove = async (profile: ModelProfile) => {
    setError("");
    try {
      await deleteModelProfile(profile.id);
      await onChanged();
    } catch (reason) {
      setError((reason as Error).message);
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-panel" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <div className="settings-heading">
          <div>
            <span className="section-number">MODEL ROUTING</span>
            <h2 id="model-settings-title">模型与 API 设置</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭模型设置">×</button>
        </div>

        <p className="settings-note">每次分析都由你重新选择配置与模型。API Key 只提交到后端加密保存，不写入浏览器存储。</p>
        <form className="settings-form" onSubmit={(event) => void save(event)}>
          <label>
            <span>服务商预设</span>
            <select value={preset} onChange={(event) => changePreset(event.target.value as typeof preset)}>
              <option value="siliconflow">硅基流动</option>
              <option value="openai_compatible">其他 OpenAI 兼容服务</option>
            </select>
          </label>
          <label>
            <span>配置名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </label>
          <label>
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} required type="url" />
          </label>
          <label>
            <span>API Key</span>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              required
              type="password"
              autoComplete="new-password"
              spellCheck={false}
            />
          </label>
          <button className="primary-button" type="submit" disabled={saving || !name.trim() || !baseUrl.trim() || !apiKey}>
            {saving ? "保存中…" : "保存配置"}
          </button>
        </form>

        {message && <p className="inline-message" role="status">{message}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}

        <div className="profile-list" aria-label="已保存的模型配置">
          {profiles.map((profile) => (
            <article className="profile-row" key={profile.id}>
              <div>
                <strong>{profile.name}</strong>
                <span>{profile.scope === "platform" ? "平台提供" : "个人配置"} · {profile.base_url}</span>
              </div>
              <div className="profile-actions">
                <button type="button" onClick={() => void testConnection(profile)}>测试连接</button>
                {profile.scope === "personal" && (
                  <button type="button" onClick={() => void remove(profile)}>删除</button>
                )}
              </div>
            </article>
          ))}
          {profiles.length === 0 && <p className="muted-copy">尚未保存模型配置</p>}
        </div>
      </section>
    </div>
  );
}

