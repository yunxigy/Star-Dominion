export interface WsTextDelta {
  type: 'text_delta'
  content: string
}

export interface WsToolCall {
  type: 'tool_call'
  name: string
  args: Record<string, unknown>
}

export interface WsToolResult {
  type: 'tool_result'
  name: string
  result: unknown
  error?: string
}

export interface WsMessageComplete {
  type: 'message_complete'
  content: string
}

export interface WsError {
  type: 'error'
  message: string
}

export interface WsSystem {
  type: 'system'
  content: string
}

export interface WsProgress {
  type: 'progress'
  stage: string
  percent: number
  message: string
}

export interface WsTaskCompleted {
  type: 'completed'
  result: unknown
}

export interface WsTaskFailed {
  type: 'failed'
  error: string
}

export interface WsTurnSaved {
  type: 'turn_saved'
  turns: number
}

export interface WsStateInfo {
  type: 'state_info'
  stage: string
  current_arc: string
  current_chapter: string
  pending_confirmation: string
}

export interface WsCancelled {
  type: 'cancelled'
}

export type WsServerMessage =
  | WsTextDelta
  | WsToolCall
  | WsToolResult
  | WsMessageComplete
  | WsError
  | WsSystem
  | WsProgress
  | WsTaskCompleted
  | WsTaskFailed
  | WsTurnSaved
  | WsStateInfo
  | WsCancelled

export type WsClientMessage =
  | { type: 'user_message'; content: string }
  | { type: 'cancel' }
