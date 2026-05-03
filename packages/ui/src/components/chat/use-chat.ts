import { useCallback, useMemo, useRef, useState } from 'react'
import type {
  AgentService,
  ChatConversation,
  ChatMessage,
} from './types'
import { MockAgentService } from './agent-service'

function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

function newConversation(title = 'New chat'): ChatConversation {
  const now = Date.now()
  return { id: uid('c_'), title, createdAt: now, updatedAt: now, messages: [] }
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
  const [conversations, setConversations] = useState<ChatConversation[]>(() => [newConversation()])
  const [activeId, setActiveId] = useState<string>(() => conversations[0].id)
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const active = useMemo(
    () => conversations.find(c => c.id === activeId) ?? conversations[0],
    [conversations, activeId]
  )

  const updateConversation = useCallback(
    (id: string, updater: (c: ChatConversation) => ChatConversation) => {
      setConversations(prev => prev.map(c => (c.id === id ? updater(c) : c)))
    },
    []
  )

  const createConversation = useCallback(() => {
    const c = newConversation()
    setConversations(prev => [c, ...prev])
    setActiveId(c.id)
  }, [])

  const deleteConversation = useCallback(
    (id: string) => {
      setConversations(prev => {
        const next = prev.filter(c => c.id !== id)
        if (next.length === 0) {
          const fresh = newConversation()
          setActiveId(fresh.id)
          return [fresh]
        }
        if (id === activeId) setActiveId(next[0].id)
        return next
      })
    },
    [activeId]
  )

  const renameConversation = useCallback(
    (id: string, title: string) => {
      updateConversation(id, c => ({ ...c, title: title || 'Untitled', updatedAt: Date.now() }))
    },
    [updateConversation]
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || isStreaming) return

      const conversationId = active.id
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

      // Title the conversation from the first user message.
      updateConversation(conversationId, c => {
        const isFirst = c.messages.length === 0
        return {
          ...c,
          title: isFirst ? deriveTitle(trimmed) : c.title,
          updatedAt: Date.now(),
          messages: [...c.messages, userMsg, assistantMsg],
        }
      })

      setIsStreaming(true)
      const controller = new AbortController()
      abortRef.current = controller

      try {
        const snapshot: ChatConversation = {
          ...active,
          messages: [...active.messages, userMsg],
        }
        await agentRef.current.send({
          conversation: snapshot,
          signal: controller.signal,
          onChunk: delta => {
            updateConversation(conversationId, c => ({
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map(m =>
                m.id === assistantMsg.id ? { ...m, content: m.content + delta } : m
              ),
            }))
          },
          onToolCall: call => {
            updateConversation(conversationId, c => ({
              ...c,
              updatedAt: Date.now(),
              messages: c.messages.map(m =>
                m.id === assistantMsg.id
                  ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] }
                  : m
              ),
            }))
          },
        })
        updateConversation(conversationId, c => ({
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantMsg.id ? { ...m, status: 'done' } : m
          ),
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        updateConversation(conversationId, c => ({
          ...c,
          messages: c.messages.map(m =>
            m.id === assistantMsg.id
              ? { ...m, status: 'error', errorMessage: message }
              : m
          ),
        }))
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [active, isStreaming, updateConversation]
  )

  return {
    conversations,
    active,
    activeId,
    isStreaming,
    setActiveId,
    createConversation,
    deleteConversation,
    renameConversation,
    sendMessage,
    stop,
  }
}
