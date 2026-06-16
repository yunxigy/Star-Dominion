import { useState, useRef, useEffect } from 'react'
import Markdown from 'react-markdown'
import { useChatStore } from '../store/chatStore'
import { useChatWebSocket } from '../hooks/useChatWebSocket'
import ToolCallCard from '../components/chat/ToolCallCard'
import type { AgentType } from '../types/agent'
import { stageLabels } from '../lib/constants'

export default function ChatPage() {
  const {
    activeAgent, setAgent, messages, isStreaming, streamingContent,
    stateInfo, turnsProcessed, isConnected, clearMessages,
  } = useChatStore()
  const { sendMessage, cancel } = useChatWebSocket(activeAgent)
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  const handleSend = () => {
    const text = input.trim()
    if (!text || isStreaming) return
    sendMessage(text)
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 150) + 'px'
  }

  const agentLabels: { key: AgentType; label: string; desc: string }[] = [
    { key: 'dante', label: 'Dante（写作）', desc: '写章、审查、推进正文' },
    { key: 'goethe', label: 'Goethe（规划）', desc: '灵感、设定、大纲、风格' },
  ]

  return (
    <div className="chat-page">
      {/* Header */}
      <div className="chat-top">
        <div className="chat-top-left">
          <h1>对话</h1>
          <div className="agent-tabs">
            {agentLabels.map((a) => (
              <button
                key={a.key}
                className={`agent-tab ${activeAgent === a.key ? 'active' : ''}`}
                onClick={() => setAgent(a.key)}
                title={a.desc}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>
        <div className="chat-top-right">
          <span className={`conn-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '已连接' : '未连接'}
          </span>
          {turnsProcessed > 0 && (
            <span className="turn-count">已处理 {turnsProcessed} 轮</span>
          )}
          <button className="clear-btn" onClick={clearMessages} title="清空消息">清空</button>
        </div>
      </div>

      {/* State info bar */}
      {stateInfo && (
        <div className="state-info-bar">
          <span>阶段: <strong>{stageLabels[stateInfo.stage] || stateInfo.stage || '-'}</strong></span>
          {stateInfo.currentArc && <span>卷: <strong>{stateInfo.currentArc}</strong></span>}
          {stateInfo.currentChapter && <span>章: <strong>{stateInfo.currentChapter}</strong></span>}
          {stateInfo.pendingConfirmation && (
            <span className="pending-confirmation">待确认: {stateInfo.pendingConfirmation}</span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="chat-messages">
        {messages.length === 0 && !isStreaming && (
          <div className="chat-empty">
            <p>还没有消息。试着输入一句话开始对话，例如：</p>
            <div className="chat-suggestions">
              {[
                '帮我汇总一下当前的想法',
                '写第六章，3500字',
                '查看当前写作状态',
                '把大纲推进到能写第六章的范围',
                '帮我审查一下第五章',
              ].map((s) => (
                <button
                  key={s}
                  className="suggestion-chip"
                  onClick={() => { setInput(s); textareaRef.current?.focus() }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === 'tool' && msg.toolCalls) {
            const tc = msg.toolCalls[0]
            const status = tc.result !== undefined ? (tc.error ? 'error' as const : 'done' as const) : 'calling' as const
            return (
              <div key={msg.id} className="chat-msg chat-msg-tool">
                <ToolCallCard
                  name={tc.name}
                  args={tc.args}
                  result={tc.result}
                  error={tc.error}
                  status={status}
                />
              </div>
            )
          }

          return (
            <div key={msg.id} className={`chat-msg chat-msg-${msg.role}`}>
              <div className="chat-msg-role">
                {msg.role === 'user' ? '你' : msg.role === 'system' ? '系统' : 'Agent'}
              </div>
              <div className="chat-msg-content">
                {msg.role === 'user' ? (
                  <p className="chat-msg-text">{msg.content}</p>
                ) : (
                  <div className="chat-msg-markdown">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Streaming content */}
        {isStreaming && (
          <div className="chat-msg chat-msg-assistant streaming">
            <div className="chat-msg-role">Agent</div>
            <div className="chat-msg-content">
              {streamingContent ? (
                <div className="chat-msg-markdown">
                  <Markdown>{streamingContent}</Markdown>
                  <span className="streaming-cursor">▌</span>
                </div>
              ) : (
                <div className="streaming-placeholder">
                  <span className="dot-pulse">思考中</span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={handleTextareaInput}
          onKeyDown={handleKeyDown}
          placeholder={`给 ${activeAgent === 'dante' ? 'Dante（写作）' : 'Goethe（规划）'} 发消息... (Enter 发送, Shift+Enter 换行)`}
          rows={1}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button className="chat-cancel-btn" onClick={cancel}>停止</button>
        ) : (
          <button className="chat-send-btn" onClick={handleSend} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>

      <style>{`
        .chat-page {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 48px - 28px);
          padding: 24px;
          box-sizing: border-box;
        }

        /* Header */
        .chat-top {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding-bottom: 12px;
          border-bottom: 1px solid #e0e0e0;
        }
        .chat-top-left { display: flex; align-items: center; gap: 16px; }
        .chat-top-left h1 { margin: 0; }
        .chat-top-right { display: flex; align-items: center; gap: 12px; }
        .agent-tabs { display: flex; gap: 4px; }
        .agent-tab {
          padding: 5px 14px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          transition: all 0.15s;
        }
        .agent-tab:hover { border-color: #7c8aff; }
        .agent-tab.active { background: #7c8aff; color: #fff; border-color: #7c8aff; }
        .conn-status {
          font-size: 12px;
          padding: 2px 8px;
          border-radius: 10px;
        }
        .conn-status.connected { background: #d1fae5; color: #065f46; }
        .conn-status.disconnected { background: #fee2e2; color: #991b1b; }
        .turn-count { font-size: 12px; color: #888; }
        .clear-btn {
          padding: 4px 10px;
          border: 1px solid #d0d0d0;
          background: #fff;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          color: #666;
        }
        .clear-btn:hover { background: #f5f5f5; }

        /* State info */
        .state-info-bar {
          display: flex;
          gap: 16px;
          padding: 8px 12px;
          background: #f0f4ff;
          border-radius: 6px;
          margin: 8px 0;
          font-size: 12px;
          color: #444;
        }
        .state-info-bar strong { color: #333; }
        .pending-confirmation { color: #d97706; font-weight: 600; }

        /* Messages */
        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 16px 0;
          min-height: 0;
          word-break: break-word;
        }
        .chat-empty {
          text-align: center;
          color: #999;
          padding: 40px 20px;
        }
        .chat-suggestions {
          display: flex;
          flex-wrap: wrap;
          justify-content: center;
          gap: 8px;
          margin-top: 16px;
        }
        .suggestion-chip {
          padding: 6px 14px;
          background: #f0f4ff;
          border: 1px solid #d0d8f0;
          border-radius: 16px;
          font-size: 13px;
          color: #444;
          cursor: pointer;
          transition: all 0.15s;
        }
        .suggestion-chip:hover { background: #e0e8ff; border-color: #7c8aff; }

        .chat-msg { margin-bottom: 12px; }
        .chat-msg-user {
          background: #e8eaff;
          border-radius: 8px;
          padding: 10px 14px;
          margin-left: 40px;
        }
        .chat-msg-assistant {
          background: #fff;
          border: 1px solid #e0e0e0;
          border-radius: 8px;
          padding: 10px 14px;
          margin-right: 40px;
        }
        .chat-msg-system {
          background: #f0f0f0;
          border-radius: 8px;
          padding: 8px 14px;
          font-style: italic;
          font-size: 13px;
          color: #666;
        }
        .chat-msg-tool { padding: 0 14px; }
        .chat-msg-role {
          font-size: 11px;
          font-weight: 600;
          color: #888;
          margin-bottom: 4px;
        }
        .chat-msg-text {
          margin: 0;
          white-space: pre-wrap;
          word-break: break-word;
          font-size: 14px;
          line-height: 1.6;
        }
        .chat-msg-markdown {
          font-size: 14px;
          line-height: 1.7;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        .chat-msg-markdown p { margin: 4px 0; }
        .chat-msg-markdown pre {
          background: #f5f5f8;
          padding: 8px 12px;
          border-radius: 4px;
          overflow-x: auto;
          font-size: 13px;
        }
        .chat-msg-markdown code {
          background: #f0f0f3;
          padding: 1px 4px;
          border-radius: 3px;
          font-size: 13px;
        }
        .chat-msg-markdown pre code { background: none; padding: 0; }
        .chat-msg-markdown ul, .chat-msg-markdown ol { padding-left: 20px; margin: 4px 0; }
        .chat-msg-markdown blockquote {
          border-left: 3px solid #d0d0d0;
          padding-left: 12px;
          margin: 4px 0;
          color: #666;
        }
        .chat-msg-markdown h1, .chat-msg-markdown h2, .chat-msg-markdown h3 {
          margin: 8px 0 4px;
        }
        .chat-msg-markdown table { border-collapse: collapse; margin: 8px 0; }
        .chat-msg-markdown th, .chat-msg-markdown td {
          border: 1px solid #e0e0e0;
          padding: 4px 8px;
          font-size: 13px;
        }
        .chat-msg-markdown th { background: #f5f5f5; }

        .streaming-cursor {
          color: #7c8aff;
          animation: blink 1s step-end infinite;
        }
        @keyframes blink {
          50% { opacity: 0; }
        }
        .streaming-placeholder {
          color: #aaa;
          font-size: 14px;
        }
        .dot-pulse::after {
          content: '';
          animation: dots 1.5s steps(3, end) infinite;
        }
        @keyframes dots {
          0% { content: ''; }
          33% { content: '.'; }
          66% { content: '..'; }
          100% { content: '...'; }
        }

        /* Input */
        .chat-input-area {
          display: flex;
          gap: 8px;
          padding: 12px 0;
          border-top: 1px solid #e0e0e0;
          align-items: flex-end;
        }
        .chat-input {
          flex: 1;
          padding: 10px 14px;
          border: 1px solid #d0d0d0;
          border-radius: 8px;
          font-size: 14px;
          resize: none;
          font-family: inherit;
          line-height: 1.5;
          max-height: 150px;
        }
        .chat-input:focus { outline: none; border-color: #7c8aff; box-shadow: 0 0 0 2px rgba(124,138,255,0.15); }
        .chat-send-btn, .chat-cancel-btn {
          padding: 10px 24px;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background 0.15s;
        }
        .chat-send-btn { background: #7c8aff; color: #fff; }
        .chat-send-btn:hover { background: #5a6ae0; }
        .chat-send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .chat-cancel-btn { background: #ef4444; color: #fff; }
        .chat-cancel-btn:hover { background: #dc2626; }
      `}</style>
    </div>
  )
}
