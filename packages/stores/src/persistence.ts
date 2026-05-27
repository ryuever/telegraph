import type { ChatMessage, SessionsState } from './types'

const SESSIONS_KEY = 'telegraph:sessions'
const ACTIVE_SESSION_KEY = 'telegraph:activeSessionId'
const MESSAGES_KEY_PREFIX = 'telegraph:messages:'
const DELETED_SESSION_IDS_KEY = 'telegraph:deletedSessionIds'

/**
 * Persisted threads are always loaded cold: `pending` / `streaming` assistant rows are stale
 * (e.g. ipc race before status flush, or crash mid-run). Normalize so the UI does not stick on
 * loading and localStorage does not keep bogus `streaming` forever.
 */
function sanitizeHydratedMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map(m => {
    if (m.role !== 'assistant') return m
    if (m.status !== 'pending' && m.status !== 'streaming') return m
    return { ...m, status: 'done' }
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

export function loadDeletedSessionIds(): string[] {
  try {
    const data = localStorage.getItem(DELETED_SESSION_IDS_KEY)
    if (!data) return []
    const ids = JSON.parse(data) as unknown
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch (err) {
    console.error('Failed to load deleted session ids:', err)
    return []
  }
}

export function isSessionDeleted(sessionId: string): boolean {
  return loadDeletedSessionIds().includes(sessionId)
}

export function markSessionDeleted(sessionId: string) {
  try {
    const ids = new Set(loadDeletedSessionIds())
    ids.add(sessionId)
    localStorage.setItem(DELETED_SESSION_IDS_KEY, JSON.stringify([...ids]))
  } catch (err) {
    console.error(`Failed to mark session ${sessionId} deleted:`, err)
  }
}

export function clearDeletedSession(sessionId: string) {
  try {
    const ids = loadDeletedSessionIds().filter(id => id !== sessionId)
    localStorage.setItem(DELETED_SESSION_IDS_KEY, JSON.stringify(ids))
  } catch (err) {
    console.error(`Failed to clear deleted marker for session ${sessionId}:`, err)
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
