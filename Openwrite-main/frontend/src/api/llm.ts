import api from './client'

export interface LLMConfig {
  provider: string
  api_key_set: boolean
  api_key_masked: string
  base_url: string
  model: string
  temperature: number
  max_tokens: number
  stream: boolean
  api_format: string
  timeout_seconds: number
  max_retries: number
}

export interface LLMConfigUpdate {
  provider?: string
  api_key?: string
  base_url?: string
  model?: string
  temperature?: number
  max_tokens?: number
  stream?: boolean
  api_format?: string
  timeout_seconds?: number
  max_retries?: number
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const { data } = await api.get('/llm-config')
  return data
}

export async function updateLLMConfig(update: LLMConfigUpdate): Promise<LLMConfig> {
  const { data } = await api.put('/llm-config', update)
  return data
}
