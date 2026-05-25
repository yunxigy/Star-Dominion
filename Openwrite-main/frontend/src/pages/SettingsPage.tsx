import { useEffect, useState } from 'react'
import { useNovelStore } from '../store/novelStore'
import * as novelApi from '../api/novels'
import * as llmApi from '../api/llm'
import type { NovelConfig } from '../types/novel'
import type { LLMConfig, LLMConfigUpdate } from '../api/llm'

interface ProviderPreset {
  id: string
  name: string
  provider: string
  base_url: string
  models: { label: string; value: string }[]
  api_format: string
  website: string
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    base_url: 'https://api.openai.com/v1',
    models: [
      { label: 'GPT-4o', value: 'gpt-4o' },
      { label: 'GPT-4o-mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4.1', value: 'gpt-4.1' },
      { label: 'GPT-4.1-mini', value: 'gpt-4.1-mini' },
      { label: 'GPT-4.1-nano', value: 'gpt-4.1-nano' },
      { label: 'o3', value: 'o3' },
      { label: 'o4-mini', value: 'o4-mini' },
    ],
    api_format: 'chat',
    website: 'https://platform.openai.com',
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com',
    models: [
      { label: 'Claude Opus 4', value: 'claude-opus-4-20250514' },
      { label: 'Claude Sonnet 4', value: 'claude-sonnet-4-20250514' },
      { label: 'Claude Haiku 3.5', value: 'claude-3-5-haiku-20241022' },
    ],
    api_format: 'chat',
    website: 'https://console.anthropic.com',
  },
  {
    id: 'zhipu',
    name: '智谱 AI (GLM)',
    provider: 'custom',
    base_url: 'https://open.bigmodel.cn/api/paas/v4',
    models: [
      { label: 'GLM-4-Plus', value: 'glm-4-plus' },
      { label: 'GLM-4', value: 'glm-4' },
      { label: 'GLM-4-Flash', value: 'glm-4-flash' },
      { label: 'GLM-4-Long', value: 'glm-4-long' },
      { label: 'GLM-4-Air', value: 'glm-4-air' },
      { label: 'GLM-Z1', value: 'glm-z1' },
    ],
    api_format: 'chat',
    website: 'https://open.bigmodel.cn',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'openai',
    base_url: 'https://api.deepseek.com/v1',
    models: [
      { label: 'DeepSeek-V3', value: 'deepseek-chat' },
      { label: 'DeepSeek-R1', value: 'deepseek-reasoner' },
    ],
    api_format: 'chat',
    website: 'https://platform.deepseek.com',
  },
  {
    id: 'qwen',
    name: '阿里通义千问 (Qwen)',
    provider: 'openai',
    base_url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: [
      { label: 'Qwen-Max', value: 'qwen-max' },
      { label: 'Qwen-Plus', value: 'qwen-plus' },
      { label: 'Qwen-Turbo', value: 'qwen-turbo' },
      { label: 'Qwen-Long', value: 'qwen-long' },
      { label: 'Qwen2.5-72B', value: 'qwen2.5-72b-instruct' },
    ],
    api_format: 'chat',
    website: 'https://dashscope.console.aliyun.com',
  },
  {
    id: 'moonshot',
    name: '月之暗面 (Kimi)',
    provider: 'openai',
    base_url: 'https://api.moonshot.cn/v1',
    models: [
      { label: 'Moonshot-v1-128k', value: 'moonshot-v1-128k' },
      { label: 'Moonshot-v1-32k', value: 'moonshot-v1-32k' },
      { label: 'Moonshot-v1-8k', value: 'moonshot-v1-8k' },
    ],
    api_format: 'chat',
    website: 'https://platform.moonshot.cn',
  },
  {
    id: 'baidu',
    name: '百度文心 (ERNIE)',
    provider: 'openai',
    base_url: 'https://qianfan.baidubce.com/v2',
    models: [
      { label: 'ERNIE-4.5-8K', value: 'ernie-4.5-8k' },
      { label: 'ERNIE-4.0-8K', value: 'ernie-4.0-8k' },
      { label: 'ERNIE-3.5-8K', value: 'ernie-3.5-8k' },
    ],
    api_format: 'chat',
    website: 'https://console.bce.baidu.com/qianfan',
  },
  {
    id: 'spark',
    name: '讯飞星火 (Spark)',
    provider: 'openai',
    base_url: 'https://spark-api-open.xf-yun.com/v1',
    models: [
      { label: 'Spark Max', value: 'generalv3.5' },
      { label: 'Spark Pro', value: 'generalv3' },
      { label: 'Spark Lite', value: 'general' },
    ],
    api_format: 'chat',
    website: 'https://xinghuo.xfyun.cn/sparkapi',
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    provider: 'openai',
    base_url: 'https://api.siliconflow.cn/v1',
    models: [
      { label: 'DeepSeek-V3 (托管)', value: 'deepseek-ai/DeepSeek-V3' },
      { label: 'DeepSeek-R1 (托管)', value: 'deepseek-ai/DeepSeek-R1' },
      { label: 'Qwen2.5-72B (托管)', value: 'Qwen/Qwen2.5-72B-Instruct' },
      { label: 'GLM-4-9B (托管)', value: 'THUDM/glm-4-9b-chat' },
    ],
    api_format: 'chat',
    website: 'https://cloud.siliconflow.cn',
  },
  {
    id: 'xiaomi',
    name: '小米 MiMo',
    provider: 'openai',
    base_url: 'https://api.xiaomimimo.com/v1',
    models: [
      { label: 'MiMo-v2.5-Pro', value: 'mimo-v2.5-pro' },
      { label: 'MiMo-v2.5', value: 'mimo-v2.5' },
      { label: 'MiMo-v2-Pro', value: 'mimo-v2-pro' },
      { label: 'MiMo-v2-Omni', value: 'mimo-v2-omni' },
      { label: 'MiMo-v2-Flash', value: 'mimo-v2-flash' },
    ],
    api_format: 'chat',
    website: 'https://platform.xiaomimimo.com',
  },
  {
    id: 'xiaomi-tp',
    name: '小米 MiMo Token Plan',
    provider: 'openai',
    base_url: 'https://token-plan-cn.xiaomimimo.com/v1',
    models: [
      { label: 'MiMo-v2.5-Pro', value: 'mimo-v2.5-pro' },
      { label: 'MiMo-v2.5', value: 'mimo-v2.5' },
      { label: 'MiMo-v2-Pro', value: 'mimo-v2-pro' },
      { label: 'MiMo-v2-Omni', value: 'mimo-v2-omni' },
      { label: 'MiMo-v2-Flash', value: 'mimo-v2-flash' },
    ],
    api_format: 'chat',
    website: 'https://platform.xiaomimimo.com',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    provider: 'openai',
    base_url: 'https://openrouter.ai/api/v1',
    models: [
      { label: 'Claude Sonnet 4', value: 'anthropic/claude-sonnet-4' },
      { label: 'GPT-4o', value: 'openai/gpt-4o' },
      { label: 'DeepSeek-V3', value: 'deepseek/deepseek-chat' },
      { label: 'Gemini 2.5 Pro', value: 'google/gemini-2.5-pro-preview' },
    ],
    api_format: 'chat',
    website: 'https://openrouter.ai',
  },
]

export default function SettingsPage() {
  const { currentNovelId, config, refreshConfig } = useNovelStore()
  const [form, setForm] = useState<NovelConfig>({ novel_id: '' })
  const [saving, setSaving] = useState(false)
  const [doctor, setDoctor] = useState<{ checks: { check: string; ok: boolean }[]; all_ok: boolean } | null>(null)

  // LLM config state
  const [llm, setLlm] = useState<LLMConfig | null>(null)
  const [llmForm, setLlmForm] = useState<LLMConfigUpdate>({})
  const [llmSaving, setLlmSaving] = useState(false)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)
  const [selectedPreset, setSelectedPreset] = useState<string>('')
  const [customModel, setCustomModel] = useState('')
  const [showCustomModel, setShowCustomModel] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (config) setForm(config)
  }, [config])

  useEffect(() => {
    llmApi.getLLMConfig().then((c) => {
      setLlm(c)
      setLlmForm({
        provider: c.provider,
        base_url: c.base_url,
        model: c.model,
        temperature: c.temperature,
        max_tokens: c.max_tokens,
        stream: c.stream,
        api_format: c.api_format,
        timeout_seconds: c.timeout_seconds,
        max_retries: c.max_retries,
      })
      setCustomModel(c.model)
      // Try to match existing config to a preset
      const match = PROVIDER_PRESETS.find((p) => p.base_url === c.base_url)
      if (match) setSelectedPreset(match.id)
    }).catch((e) => {
      console.error('Failed to load LLM config:', e)
    })
  }, [])

  const handlePresetChange = (presetId: string) => {
    setSelectedPreset(presetId)
    const preset = PROVIDER_PRESETS.find((p) => p.id === presetId)
    if (preset) {
      setLlmForm({
        ...llmForm,
        provider: preset.provider,
        base_url: preset.base_url,
        model: preset.models[0]?.value || '',
        api_format: preset.api_format,
      })
      setShowCustomModel(false)
    }
  }

  const handleModelChange = (model: string) => {
    if (model === '__custom__') {
      setShowCustomModel(true)
      setLlmForm({ ...llmForm, model: customModel })
    } else {
      setShowCustomModel(false)
      setLlmForm({ ...llmForm, model })
    }
  }

  const handleSave = async () => {
    if (!currentNovelId) return
    setSaving(true)
    try {
      await novelApi.updateNovelConfig(currentNovelId, form)
      await refreshConfig()
    } catch (e) {
      alert(`保存失败: ${(e as Error).message}`)
    }
    setSaving(false)
  }

  const handleDoctor = async () => {
    if (!currentNovelId) return
    try {
      const result = await novelApi.runDoctor(currentNovelId)
      setDoctor(result)
    } catch (e) {
      alert(`诊断失败: ${(e as Error).message}`)
    }
  }

  const handleLlmSave = async () => {
    setLlmSaving(true)
    try {
      const update: LLMConfigUpdate = { ...llmForm }
      if (apiKeyInput.trim()) {
        update.api_key = apiKeyInput.trim()
      }
      const result = await llmApi.updateLLMConfig(update)
      setLlm(result)
      setApiKeyInput('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      alert(`保存 LLM 配置失败: ${(e as Error).message}`)
    }
    setLlmSaving(false)
  }

  const currentPreset = PROVIDER_PRESETS.find((p) => p.id === selectedPreset)
  const currentModels = currentPreset?.models || []

  return (
    <div className="page settings-page">
      <h1>设置</h1>
      <div className="help-box">
        <p>管理 LLM 模型配置和当前小说的项目配置。选择一个模型厂商后会自动填充 API 地址和模型列表，你只需填写 API Key 即可。配置保存到项目根目录的 <code>.env</code> 文件，立即生效无需重启。</p>
      </div>

      {/* LLM 配置 */}
      <div className="settings-section">
        <h2>LLM 模型配置</h2>

        {/* 厂商预设选择 */}
        <div className="preset-grid">
          {PROVIDER_PRESETS.map((p) => (
            <button
              key={p.id}
              className={`preset-btn ${selectedPreset === p.id ? 'active' : ''}`}
              onClick={() => handlePresetChange(p.id)}
              title={p.website}
            >
              {p.name}
            </button>
          ))}
        </div>

        <div className="settings-form">
          {/* API Key */}
          <label>
            <span>API Key {currentPreset && <a href={currentPreset.website} target="_blank" rel="noreferrer" className="key-link">前往获取</a>}</span>
            <div className="api-key-row">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={llm?.api_key_set ? `已设置 (${llm.api_key_masked})` : '请输入 API Key'}
              />
              <button className="toggle-btn" onClick={() => setShowApiKey(!showApiKey)} type="button">
                {showApiKey ? '隐藏' : '显示'}
              </button>
            </div>
          </label>

          {/* Base URL */}
          <label>
            <span>API 地址 (Base URL)</span>
            <input
              value={llmForm.base_url || ''}
              onChange={(e) => setLlmForm({ ...llmForm, base_url: e.target.value })}
              placeholder="https://api.openai.com/v1"
            />
            {selectedPreset === 'xiaomi-tp' && (
              <div className="cluster-switch">
                <span className="cluster-label">集群：</span>
                {[
                  { label: '中国', url: 'https://token-plan-cn.xiaomimimo.com/v1' },
                  { label: '新加坡', url: 'https://token-plan-sgp.xiaomimimo.com/v1' },
                  { label: '欧洲', url: 'https://token-plan-ams.xiaomimimo.com/v1' },
                ].map((c) => (
                  <button
                    key={c.label}
                    className={`cluster-btn ${llmForm.base_url === c.url ? 'active' : ''}`}
                    onClick={() => setLlmForm({ ...llmForm, base_url: c.url })}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </label>

          {/* 模型 */}
          <label>
            <span>模型</span>
            {currentModels.length > 0 && !showCustomModel ? (
              <div className="model-select-row">
                <select
                  value={llmForm.model || ''}
                  onChange={(e) => handleModelChange(e.target.value)}
                >
                  {currentModels.map((m) => (
                    <option key={m.value} value={m.value}>{m.label} ({m.value})</option>
                  ))}
                  <option value="__custom__">自定义模型名...</option>
                </select>
              </div>
            ) : (
              <div className="model-select-row">
                <input
                  value={llmForm.model || customModel || ''}
                  onChange={(e) => { setCustomModel(e.target.value); setLlmForm({ ...llmForm, model: e.target.value }) }}
                  placeholder="输入模型名称"
                />
                {currentModels.length > 0 && (
                  <button className="toggle-btn" onClick={() => { setShowCustomModel(false); setLlmForm({ ...llmForm, model: currentModels[0]?.value || '' }) }}>
                    返回列表
                  </button>
                )}
              </div>
            )}
          </label>

          {/* 高级参数 */}
          <details className="advanced-section">
            <summary>高级参数</summary>
            <div className="advanced-grid">
              <label>
                <span>提供商类型</span>
                <select
                  value={llmForm.provider || 'openai'}
                  onChange={(e) => setLlmForm({ ...llmForm, provider: e.target.value })}
                >
                  <option value="openai">OpenAI 兼容</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="custom">自定义</option>
                </select>
              </label>
              <label>
                <span>API 格式</span>
                <select
                  value={llmForm.api_format || 'chat'}
                  onChange={(e) => setLlmForm({ ...llmForm, api_format: e.target.value })}
                >
                  <option value="chat">Chat Completions</option>
                  <option value="responses">Responses API</option>
                </select>
              </label>
              <label>
                <span>温度 (0-2)</span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  value={llmForm.temperature ?? 0.7}
                  onChange={(e) => setLlmForm({ ...llmForm, temperature: parseFloat(e.target.value) || 0.7 })}
                />
              </label>
              <label>
                <span>最大输出 Token</span>
                <input
                  type="number"
                  value={llmForm.max_tokens ?? 24000}
                  onChange={(e) => setLlmForm({ ...llmForm, max_tokens: parseInt(e.target.value) || 24000 })}
                />
              </label>
              <label>
                <span>超时（秒）</span>
                <input
                  type="number"
                  value={llmForm.timeout_seconds ?? 120}
                  onChange={(e) => setLlmForm({ ...llmForm, timeout_seconds: parseFloat(e.target.value) || 120 })}
                />
              </label>
              <label>
                <span>重试次数</span>
                <input
                  type="number"
                  value={llmForm.max_retries ?? 3}
                  onChange={(e) => setLlmForm({ ...llmForm, max_retries: parseInt(e.target.value) || 3 })}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={llmForm.stream ?? true}
                  onChange={(e) => setLlmForm({ ...llmForm, stream: e.target.checked })}
                />
                <span>启用流式输出</span>
              </label>
            </div>
          </details>

          <div className="save-row">
            <button className="save-btn" onClick={handleLlmSave} disabled={llmSaving}>
              {llmSaving ? '保存中...' : '保存 LLM 配置'}
            </button>
            {saved && <span className="saved-hint">已保存</span>}
          </div>
        </div>
      </div>

      {/* 小说配置 */}
      <div className="settings-section">
        <h2>小说配置</h2>
        <p className="section-desc">对应 <code>novel_config.yaml</code>，控制当前写作的小说和进度。</p>
        <div className="settings-form">
          <label>
            <span>小说 ID</span>
            <input value={form.novel_id} onChange={(e) => setForm({ ...form, novel_id: e.target.value })} />
          </label>
          <label>
            <span>风格 ID</span>
            <input value={form.style_id || ''} onChange={(e) => setForm({ ...form, style_id: e.target.value })} />
          </label>
          <label>
            <span>当前卷</span>
            <input value={form.current_arc || ''} onChange={(e) => setForm({ ...form, current_arc: e.target.value })} />
          </label>
          <label>
            <span>当前章节</span>
            <input value={form.current_chapter || ''} onChange={(e) => setForm({ ...form, current_chapter: e.target.value })} />
          </label>
          <label>
            <span>默认字数</span>
            <input
              type="number"
              value={form.default_word_count || ''}
              onChange={(e) => setForm({ ...form, default_word_count: Number(e.target.value) || undefined })}
            />
          </label>
          <button className="save-btn" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存小说配置'}
          </button>
        </div>
      </div>

      {/* 环境诊断 */}
      <div className="settings-section">
        <h2>环境诊断</h2>
        <p className="section-desc">检查项目结构、LLM 配置等是否正确。</p>
        <button className="doctor-btn" onClick={handleDoctor}>运行诊断</button>
        {doctor && (
          <div className="doctor-results">
            {doctor.checks.map((c) => (
              <div key={c.check} className={`doctor-check ${c.ok ? 'ok' : 'fail'}`}>
                <span className="doctor-icon">{c.ok ? '✓' : '✗'}</span>
                <span>{c.check}</span>
              </div>
            ))}
            <p className="doctor-summary">
              {doctor.all_ok ? '所有检查通过！' : '部分检查未通过，请修复后重试。'}
            </p>
          </div>
        )}
      </div>

      <style>{`
        .settings-section {
          margin-top: 24px;
          background: #fff;
          border-radius: 8px;
          border: 1px solid #e0e0e0;
          padding: 20px;
        }
        .section-desc { font-size: 13px; color: #888; margin-bottom: 12px; }

        /* Preset grid */
        .preset-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-bottom: 20px;
        }
        .preset-btn {
          padding: 6px 14px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.15s;
        }
        .preset-btn:hover { border-color: #7c8aff; background: #f5f7ff; }
        .preset-btn.active {
          background: #7c8aff;
          color: #fff;
          border-color: #7c8aff;
        }

        /* Cluster switch */
        .cluster-switch {
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 6px;
        }
        .cluster-label { font-size: 12px; color: #888; }
        .cluster-btn {
          padding: 3px 10px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          transition: all 0.15s;
        }
        .cluster-btn:hover { border-color: #7c8aff; }
        .cluster-btn.active { background: #7c8aff; color: #fff; border-color: #7c8aff; }

        /* Form */
        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 12px;
          max-width: 520px;
        }
        .settings-form label {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .settings-form label span { font-size: 13px; color: #666; }
        .settings-form input, .settings-form select {
          padding: 8px 10px;
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          font-size: 14px;
        }
        .settings-form input:focus, .settings-form select:focus {
          outline: none;
          border-color: #7c8aff;
          box-shadow: 0 0 0 2px rgba(124,138,255,0.15);
        }
        .key-link {
          font-size: 12px;
          margin-left: 8px;
        }

        /* API key row */
        .api-key-row { display: flex; gap: 8px; }
        .api-key-row input { flex: 1; }
        .toggle-btn {
          padding: 8px 12px;
          border: 1px solid #d0d0d0;
          border-radius: 6px;
          background: #f5f5f5;
          cursor: pointer;
          font-size: 12px;
          white-space: nowrap;
        }
        .toggle-btn:hover { background: #eee; }

        /* Model select */
        .model-select-row { display: flex; gap: 8px; }
        .model-select-row select, .model-select-row input { flex: 1; }

        /* Checkbox */
        .checkbox-label {
          flex-direction: row !important;
          align-items: center;
          gap: 8px !important;
        }
        .checkbox-label input[type="checkbox"] { width: 16px; height: 16px; }

        /* Advanced */
        .advanced-section {
          border: 1px solid #e0e0e0;
          border-radius: 6px;
          padding: 12px;
        }
        .advanced-section summary {
          cursor: pointer;
          font-size: 13px;
          font-weight: 600;
          color: #666;
        }
        .advanced-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
          margin-top: 12px;
        }

        /* Save */
        .save-row { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
        .save-btn, .doctor-btn {
          padding: 10px 24px;
          background: #7c8aff;
          color: #fff;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }
        .save-btn:hover { background: #5a6ae0; }
        .save-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .saved-hint { color: #10b981; font-size: 13px; font-weight: 500; }

        /* Doctor */
        .doctor-results { margin-top: 12px; }
        .doctor-check {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 0;
          font-size: 14px;
        }
        .doctor-check.ok .doctor-icon { color: #4caf50; }
        .doctor-check.fail .doctor-icon { color: #f44336; }
        .doctor-summary { margin-top: 8px; font-weight: 600; }
      `}</style>
    </div>
  )
}
