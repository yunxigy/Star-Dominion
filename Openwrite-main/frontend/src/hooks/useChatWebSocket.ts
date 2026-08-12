import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '../store/chatStore'
import { useNovelStore } from '../store/novelStore'
import type { AgentType } from '../types/agent'
import type { WsServerMessage } from '../types/ws'

export function useChatWebSocket(agentType: AgentType) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectRef = useRef<() => void>(() => undefined)
  const { currentNovelId } = useNovelStore()
  const {
    startStreaming,
    appendDelta,
    addToolCall,
    completeToolCall,
    completeStreaming,
    failStreaming,
    addSystemMessage,
    setStateInfo,
    setTurnsProcessed,
    setConnected,
    isConnected,
  } = useChatStore()

  const connect = useCallback(() => {
    // Clean up existing
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/chat/${agentType}?novel_id=${currentNovelId || 'current'}`

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      setConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data)
        switch (msg.type) {
          case 'text_delta':
            appendDelta(msg.content)
            break
          case 'tool_call':
            addToolCall((msg as { id?: string }).id || '', msg.name, msg.args)
            break
          case 'tool_result':
            completeToolCall((msg as { id?: string }).id || '', msg.name, msg.result, (msg as { error?: string }).error)
            break
          case 'message_complete':
            completeStreaming(msg.content)
            break
          case 'error':
            failStreaming(msg.message)
            break
          case 'system':
            // System messages (recovery prompt) shown as system message
            if (msg.content?.trim()) {
              addSystemMessage(msg.content)
            }
            break
          case 'turn_saved':
            setTurnsProcessed(msg.turns)
            break
          case 'state_info':
            setStateInfo({
              stage: msg.stage,
              currentArc: msg.current_arc,
              currentChapter: msg.current_chapter,
              pendingConfirmation: msg.pending_confirmation,
            })
            break
          case 'cancelled':
            // Handled by UI
            break
        }
      } catch {
        // ignore parse errors
      }
    }

    ws.onerror = () => {
      setConnected(false)
    }

    ws.onclose = () => {
      setConnected(false)
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null
        connectRef.current()
      }, 3000)
    }
  }, [agentType, currentNovelId, appendDelta, addToolCall, completeToolCall, completeStreaming, failStreaming, addSystemMessage, setStateInfo, setTurnsProcessed, setConnected])

  useEffect(() => {
    connectRef.current = connect
    connect()
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close()
      }
    }
  }, [connect])

  const sendMessage = useCallback((content: string) => {
    if (wsRef.current?.readyState !== WebSocket.OPEN) {
      failStreaming('WebSocket 未连接，请稍后重试')
      return
    }
    startStreaming()
    wsRef.current.send(JSON.stringify({ type: 'user_message', content }))
  }, [startStreaming, failStreaming])

  const cancel = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel' }))
    }
  }, [])

  return {
    sendMessage,
    cancel,
    isConnected,
  }
}
