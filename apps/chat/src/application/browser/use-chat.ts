import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSessionsStore, getSessionStore } from '@/packages/stores'
import type { AgentService, ChatConversation, ChatMessage, LlmTracePayload } from './types'
import { MockAgentService } from './mock-agent-service'
import type { ChatMessage as CommonChatMessage } from '@/apps/chat/application/common'

function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function deriveTitle(text: string) {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return 'New chat'
  return trimmed.length > 40 ? trimmed.slice(0, 40) + '…' : trimmed
}

export interface UseChatOptions {
  agent?: AgentService
  onLlmTrace?: (info: { sessionId: string; runId: string; trace: LlmTracePayload }) => void
}

export function useChat({ agent, onLlmTrace }: UseChatOptions = {}) {
  const agentRef = useRef<AgentService>(agent ?? new MockAgentService())
  const onLlmTraceRef = useRef(onLlmTrace)
  const sendChainsRef = useRef<Map<string, Promise<unknown>>>(new Map())
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession, renameSession } = useSessionsStore()
  const [updateTrigger, setUpdateTrigger] = useState(0)

  const listTitle = useCallback(
    (sessionId: string) => sessions.find((s: { id: string }) => s.id === sessionId)?.title ?? 'New chat',
    [sessions]
  )

  const sessionIdsKey = useMemo(() => sessions.map((s: { id: string }) => s.id).join('\u0001'), [sessions])
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const bumpUi = useCallback(() => {
    setUpdateTrigger(v => v + 1)
  }, [])

  useEffect(() => {
    agentRef.current = agent ?? new MockAgentService()
  }, [agent])

  useEffect(() => {
    onLlmTraceRef.current = onLlmTrace
  }, [onLlmTrace])

  useLayoutEffect(() => {
    const list = sessionsRef.current
    const unsubscribers = list.map((s: { id: string; title: string }) => {
      const store = getSessionStore(s.id, s.title)
      return store.subscribe(() => {
        setUpdateTrigger(v => v + 1)
      })
    })
    return () => {
      unsubscribers.forEach((unsub: () => void) => { unsub(); })
    }
  }, [sessionIdsKey])

  const active = useMemo<ChatConversation>(() => {
    if (!activeSessionId) {
      return { id: '', title: '', createdAt: 0, updatedAt: 0, messages: [] }
    }

    const store = getSessionStore(activeSessionId, listTitle(activeSessionId))
    const state = store.getState()

    return {
      id: activeSessionId,
      title: state.title,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      messages: state.messages,
    }
  }, [activeSessionId, listTitle, updateTrigger])

  const conversations = useMemo<ChatConversation[]>(() => {
    return sessions.map((s: { id: string; title: string }) => {
      const store = getSessionStore(s.id, s.title)
      const state = store.getState()
      return {
        id: s.id,
        title: state.title,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        messages: state.messages,
      }
    })
  }, [sessions, updateTrigger])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      let targetSessionId = useSessionsStore.getState().activeSessionId
      if (!targetSessionId) {
        targetSessionId = createSession()
      }

      const run = async () => {
        const store = getSessionStore(targetSessionId, listTitle(targetSessionId))

        const userMsg: ChatMessage = {
          id: uid('m_'),
          role: 'user',
          content: trimmed,
          createdAt: Date.now(),
          status: 'done',
        }
        const assistantMsg: ChatMessage = {
          id: uid('m_'),
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'streaming',
        }

        const isFirst = store.getState().messages.length === 0

        store.addMessage(userMsg)
        if (isFirst) {
          store.updateTitle(deriveTitle(trimmed))
          renameSession(targetSessionId, deriveTitle(trimmed))
        }
        bumpUi()

        const controller = new AbortController()
        store.setStreaming(true, controller)

        try {
          const snapshot: ChatConversation = {
            id: targetSessionId,
            title: store.getState().title,
            createdAt: store.getState().createdAt,
            updatedAt: store.getState().updatedAt,
            messages: [...store.getState().messages],
          }

          store.addMessage(assistantMsg)
          bumpUi()

          await agentRef.current.send({
            conversation: snapshot,
            signal: controller.signal,
            onStatus: status => {
              store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => {
                if (status === 'queued') return { ...m, status: 'streaming' }
                if (status === 'running') return { ...m, status: 'streaming' }
                if (status === 'completed') return { ...m, status: 'done' }
                return { ...m, status: 'error' }
              })
            },
            onChunk: (delta) => {
              store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => ({
                ...m,
                status: m.status === 'pending' ? 'streaming' : m.status,
                content: m.content + delta,
              }))
            },
            onToolCall: (call) => {
              store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => ({
                ...m,
                toolCalls: [...(m.toolCalls ?? []), call],
              }))
            },
            onLlmTrace: info =>
              onLlmTraceRef.current?.({
                sessionId: info.sessionId || targetSessionId,
                runId: info.runId,
                trace: info.trace,
              }),
          })

          store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => ({
            ...m,
            status: 'done',
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => ({
            ...m,
            status: 'error',
            errorMessage: message,
          }))
        } finally {
          store.setStreaming(false)
          store.updateMessage(assistantMsg.id, (m: CommonChatMessage) => {
            if (m.status !== 'streaming' && m.status !== 'pending') return m
            return { ...m, status: 'done' }
          })
        }
      }

      const sid = targetSessionId
      const prev = sendChainsRef.current.get(sid) ?? Promise.resolve()
      const next = prev.then(run)
      sendChainsRef.current.set(sid, next.catch(() => {}))
      await next
    },
    [bumpUi, createSession, listTitle, renameSession]
  )

  const stop = useCallback(() => {
    if (!activeSessionId) return
    const store = getSessionStore(activeSessionId, listTitle(activeSessionId))
    store.stop()
  }, [activeSessionId, listTitle])

  const createConversation = useCallback(() => {
    createSession()
  }, [createSession])

  const deleteConversation = useCallback(
    (id: string) => {
      sendChainsRef.current.delete(id)
      deleteSession(id)
    },
    [deleteSession]
  )

  const renameConversation = useCallback(
    (id: string, title: string) => {
      const next = title || 'Untitled'
      renameSession(id, next)
      getSessionStore(id, next).updateTitle(next)
    },
    [renameSession]
  )

  const isStreaming = useMemo(() => {
    if (!activeSessionId) return false
    const store = getSessionStore(activeSessionId, listTitle(activeSessionId))
    return store.getState().isStreaming
  }, [activeSessionId, listTitle, updateTrigger])

  return {
    conversations,
    active,
    activeId: activeSessionId || '',
    isStreaming,
    setActiveId: setActiveSession,
    createConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stop,
  }
}
