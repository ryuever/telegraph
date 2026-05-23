import { create } from 'zustand'
import type { SessionsStore, SessionsState } from './types'
import { persistSessions, loadPersistentSessions } from './persistence'
import { removeSessionStore } from './session.store'

function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
}

const persistent = loadPersistentSessions()

function getInitialState(): SessionsState {
  // If we have persistent data, use it
  if (persistent?.sessions && persistent.sessions.length > 0) {
    const ids = new Set(persistent.sessions.map((s) => s.id))
    let active = persistent.activeSessionId ?? persistent.sessions[0].id
    if (!ids.has(active)) {
      active = persistent.sessions[0].id
    }
    return {
      sessions: persistent.sessions,
      activeSessionId: active,
    }
  }

  // Otherwise, create a default session
  const now = Date.now()
  const defaultSessionId = uid('s_')
  return {
    sessions: [{ id: defaultSessionId, title: 'New chat', createdAt: now, updatedAt: now }],
    activeSessionId: defaultSessionId,
  }
}

export const useSessionsStore = create<SessionsStore>((set) => {
  const initial = getInitialState()
  persistSessions(initial)

  return {
    sessions: initial.sessions,
    activeSessionId: initial.activeSessionId,

    createSession: () => {
      const id = uid('s_')
      const now = Date.now()

      set((state) => {
        const next: SessionsState = {
          sessions: [{ id, title: 'New chat', createdAt: now, updatedAt: now }, ...state.sessions],
          activeSessionId: id,
        }
        persistSessions(next)
        return next
      })

      return id
    },

    upsertSession: (id: string, title: string) =>
      set((state) => {
        const now = Date.now()
        const existing = state.sessions.find(session => session.id === id)
        const sessions = existing
          ? state.sessions.map(session => session.id === id ? { ...session, title, updatedAt: now } : session)
          : [{ id, title, createdAt: now, updatedAt: now }, ...state.sessions]
        const result: SessionsState = {
          sessions,
          activeSessionId: state.activeSessionId ?? id,
        }
        persistSessions(result)
        return result
      }),

    deleteSession: (id: string) =>
      set((state) => {
        removeSessionStore(id)

        const next = state.sessions.filter((s) => s.id !== id)
        let nextActive = state.activeSessionId

        if (nextActive === id) {
          nextActive = next.length > 0 ? next[0].id : null
        }

        const result: SessionsState = {
          sessions: next,
          activeSessionId: nextActive,
        }

        persistSessions(result)
        return result
      }),

    setActiveSession: (id: string) =>
      set((state) => {
        const result: SessionsState = { ...state, activeSessionId: id }
        persistSessions(result)
        return result
      }),

    renameSession: (id: string, title: string) =>
      set((state) => {
        const result: SessionsState = {
          sessions: state.sessions.map((s) => (s.id === id ? { ...s, title, updatedAt: Date.now() } : s)),
          activeSessionId: state.activeSessionId,
        }
        persistSessions(result)
        return result
      }),

    loadSessions: (sessions) =>
      set((state) => {
        const result: SessionsState = { ...state, sessions }
        persistSessions(result)
        return result
      }),
  }
})
