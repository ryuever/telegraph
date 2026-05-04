import type { ChatMessage, SessionsState } from './types'

const SESSIONS_KEY = 'telegraph:sessions'
const ACTIVE_SESSION_KEY = 'telegraph:activeSessionId'
const MESSAGES_KEY_PREFIX = 'telegraph:messages:'

/** Older builds persisted assistant rows as `pending`; after restart that looks "stuck". */
function sanitizeHydratedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    if (m.role !== 'assistant' || m.status !== 'pending') return m
    if ((m.content ?? '').trim().length > 0) {
      return { ...m, status: 'done' }
    }
    return { ...m, status: 'streaming' }
  })
}

export function persistSessions(state: SessionsState) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(state.sessions))
    localStorage.setItem(ACTIVE_SESSION_KEY, state.activeSessionId || '')
  } catch (err) {
    console.error('Failed to persist sessions:', err)
  }
}

export function loadPersistentSessions(): SessionsState | null {
  try {
    const sessions = localStorage.getItem(SESSIONS_KEY)
    const activeSessionId = localStorage.getItem(ACTIVE_SESSION_KEY)

    if (!sessions) return null

    return {
      sessions: JSON.parse(sessions),
      activeSessionId: activeSessionId || null,
    }
  } catch (err) {
    console.error('Failed to load persistent sessions:', err)
    return null
  }
}

export function persistSessionMessages(sessionId: string, messages: ChatMessage[]) {
  try {
    localStorage.setItem(`${MESSAGES_KEY_PREFIX}${sessionId}`, JSON.stringify(messages))
  } catch (err) {
    console.error(`Failed to persist messages for session ${sessionId}:`, err)
  }
}

export function loadPersistentMessages(sessionId: string): ChatMessage[] | null {
  try {
    const data = localStorage.getItem(`${MESSAGES_KEY_PREFIX}${sessionId}`)
    if (!data) return null
    const raw = JSON.parse(data) as ChatMessage[]
    if (!Array.isArray(raw)) return null
    const next = sanitizeHydratedMessages(raw)
    if (JSON.stringify(next) !== JSON.stringify(raw)) {
      persistSessionMessages(sessionId, next)
    }
    return next
  } catch (err) {
    console.error(`Failed to load persistent messages for session ${sessionId}:`, err)
    return null
  }
}

export function deleteSessionMessages(sessionId: string) {
  try {
    localStorage.removeItem(`${MESSAGES_KEY_PREFIX}${sessionId}`)
  } catch (err) {
    console.error(`Failed to delete messages for session ${sessionId}:`, err)
  }
}
