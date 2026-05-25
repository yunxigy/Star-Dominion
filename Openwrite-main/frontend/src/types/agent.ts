export type AgentType = 'dante' | 'goethe'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCalls?: ToolCallRecord[]
  timestamp: number
}

export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result?: unknown
  error?: string
}
