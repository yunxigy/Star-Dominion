import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatMessage, AgentType } from '../types/agent'

interface ChatStore {
  activeAgent: AgentType
  messages: ChatMessage[]
  isStreaming: boolean
  streamingContent: string
  stateInfo: {
    stage: string
    currentArc: string
    currentChapter: string
    pendingConfirmation: string
  } | null
  turnsProcessed: number
  isConnected: boolean

  setAgent: (agent: AgentType) => void
  addMessage: (msg: ChatMessage) => void
  addSystemMessage: (content: string) => void
  startStreaming: () => void
  appendDelta: (content: string) => void
  addToolCall: (id: string, name: string, args: Record<string, unknown>) => void
  completeToolCall: (id: string, name: string, result: unknown, error?: string) => void
  completeStreaming: (finalContent: string) => void
  failStreaming: (error: string) => void
  setStateInfo: (info: ChatStore['stateInfo']) => void
  setTurnsProcessed: (n: number) => void
  setConnected: (v: boolean) => void
  clearMessages: () => void
}

let _nextId = 1
function makeId(): string {
  return `msg_${_nextId++}_${Date.now()}`
}

export const useChatStore = create<ChatStore>()(persist((set) => ({
  activeAgent: 'dante',
  messages: [],
  isStreaming: false,
  streamingContent: '',
  stateInfo: null,
  turnsProcessed: 0,
  isConnected: false,

  setAgent: (agent) => set({ activeAgent: agent }),

  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),

  addSystemMessage: (content) => {
    const sysMsg: ChatMessage = {
      id: makeId(),
      role: 'system',
      content,
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, sysMsg] }))
  },

  startStreaming: () => set({ isStreaming: true, streamingContent: '' }),

  appendDelta: (content) => set((s) => ({
    streamingContent: s.streamingContent + content,
  })),

  addToolCall: (id, name, args) => {
    const toolMsg: ChatMessage = {
      id: id || makeId(),
      role: 'tool',
      content: name,
      toolCalls: [{ name, args }],
      timestamp: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, toolMsg] }))
  },

  completeToolCall: (id, name, result, error) => set((s) => {
    const msgs = [...s.messages]
    for (let i = msgs.length - 1; i >= 0; i--) {
      const tc = msgs[i].toolCalls?.[0]
      if (msgs[i].role === 'tool' && tc && tc.result === undefined && (id ? msgs[i].id === id : tc.name === name)) {
        msgs[i] = {
          ...msgs[i],
          toolCalls: msgs[i].toolCalls!.map((t) =>
            t.result === undefined ? { ...t, result, error } : t
          ),
        }
        break
      }
    }
    return { messages: msgs }
  }),

  completeStreaming: (finalContent) => {
    if (finalContent.trim()) {
      const assistantMsg: ChatMessage = {
        id: makeId(),
        role: 'assistant',
        content: finalContent,
        timestamp: Date.now(),
      }
      set((s) => ({
        messages: [...s.messages, assistantMsg],
        isStreaming: false,
        streamingContent: '',
      }))
    } else {
      set({ isStreaming: false, streamingContent: '' })
    }
  },

  failStreaming: (error) => {
    const errorMsg: ChatMessage = {
      id: makeId(),
      role: 'assistant',
      content: `[错误] ${error}`,
      timestamp: Date.now(),
    }
    set((s) => ({
      messages: [...s.messages, errorMsg],
      isStreaming: false,
      streamingContent: '',
    }))
  },

  setStateInfo: (info) => set({ stateInfo: info }),
  setTurnsProcessed: (n) => set({ turnsProcessed: n }),
  setConnected: (v) => set({ isConnected: v }),
  clearMessages: () => set({ messages: [], streamingContent: '', isStreaming: false }),
}), {
  name: 'openwrite-chat',
  partialize: (state) => ({
    messages: state.messages,
    activeAgent: state.activeAgent,
  }),
}))
