import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useSessionsStore, getSessionStore } from '@telegraph/stores'
import type { AgentService, ChatConversation, ChatMessage } from './types'
import { MockAgentService } from './agent-service'

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
}

export function useChat({ agent }: UseChatOptions = {}) {
  const agentRef = useRef<AgentService>(agent ?? new MockAgentService())
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession, renameSession } = useSessionsStore()

  useEffect(() => {
    agentRef.current = agent ?? new MockAgentService()
  }, [agent])

  const active = useMemo<ChatConversation>(() => {
    if (!activeSessionId) {
      return { id: '', title: '', createdAt: 0, updatedAt: 0, messages: [] }
    }

    const store = getSessionStore(activeSessionId)
    const state = store.getState()

    return {
      id: activeSessionId,
      title: state.title,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      messages: state.messages,
    }
  }, [activeSessionId])

  const conversations = useMemo<ChatConversation[]>(() => {
    return sessions.map((s) => {
      const store = getSessionStore(s.id)
      const state = store.getState()
      return {
        id: s.id,
        title: state.title,
        createdAt: state.createdAt,
        updatedAt: state.updatedAt,
        messages: state.messages,
      }
    })
  }, [sessions])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return

      let currentSessionId = activeSessionId

      if (!currentSessionId) {
        currentSessionId = createSession()
        await new Promise((r) => setTimeout(r, 0))
      }

      const store = getSessionStore(currentSessionId)
      let state = store.getState()

      if (state.isStreaming) return

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

      state = store.getState()
      const isFirst = state.messages.length === 0

      if (isFirst) {
        store.updateTitle(deriveTitle(trimmed))
        renameSession(currentSessionId, deriveTitle(trimmed))
      }

      store.addMessage(userMsg)
      store.addMessage(assistantMsg)

      const controller = new AbortController()
      store.setStreaming(true, controller)

      try {
        const snapshot: ChatConversation = {
          id: currentSessionId,
          title: store.getState().title,
          createdAt: store.getState().createdAt,
          updatedAt: store.getState().updatedAt,
          messages: [...store.getState().messages],
        }

        await agentRef.current.send({
          conversation: snapshot,
          signal: controller.signal,
          onChunk: (delta) => {
            store.updateMessage(assistantMsg.id, (m) => ({
              ...m,
              content: m.content + delta,
            }))
          },
          onToolCall: (call) => {
            store.updateMessage(assistantMsg.id, (m) => ({
              ...m,
              toolCalls: [...(m.toolCalls ?? []), call],
            }))
          },
        })

        store.updateMessage(assistantMsg.id, (m) => ({
          ...m,
          status: 'done',
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        store.updateMessage(assistantMsg.id, (m) => ({
          ...m,
          status: 'error',
          errorMessage: message,
        }))
      } finally {
        store.setStreaming(false)
      }
    },
    [activeSessionId, createSession, renameSession]
  )

  const stop = useCallback(() => {
    if (!activeSessionId) return
    const store = getSessionStore(activeSessionId)
    store.stop()
  }, [activeSessionId])

  const createConversation = useCallback(() => {
    createSession()
  }, [createSession])

  const deleteConversation = useCallback(
    (id: string) => {
      deleteSession(id)
    },
    [deleteSession]
  )

  const renameConversation = useCallback(
    (id: string, title: string) => {
      renameSession(id, title || 'Untitled')
    },
    [renameSession]
  )

  return {
    conversations,
    active,
    activeId: activeSessionId || '',
    isStreaming: activeSessionId ? getSessionStore(activeSessionId).getState().isStreaming : false,
    setActiveId: setActiveSession,
    createConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stop,
  }
}
