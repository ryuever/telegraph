export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  createdAt: number
  status?: 'pending' | 'streaming' | 'done' | 'error'
  toolCalls?: {
    id: string
    name: string
    input?: unknown
    output?: unknown
    status: 'running' | 'done' | 'error'
    errorMessage?: string
  }[]
  subagentGroups?: {
    id: string
    parentRunId: string
    title: string
    agents: {
      runId: string
      name: string
      task?: string
      status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
      lastUpdate?: string
      summary?: string
      elapsedMs?: number
      startedAt?: number
      completedAt?: number
    }[]
    updatedAt: number
  }[]
  errorMessage?: string
}

export interface SessionState {
  sessionId: string
  title: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
  isStreaming: boolean
  abortController: AbortController | null
}

export interface SessionActions {
  addMessage: (message: ChatMessage) => void
  updateMessage: (messageId: string, updater: (m: ChatMessage) => ChatMessage) => void
  setStreaming: (isStreaming: boolean, controller?: AbortController | null) => void
  stop: () => void
  updateTitle: (title: string) => void
  reset: () => void
}

export type SessionStore = SessionState & SessionActions

export interface SessionsState {
  sessions: Array<{
    id: string
    title: string
    createdAt: number
    updatedAt: number
  }>
  activeSessionId: string | null
}

export interface SessionsActions {
  createSession: () => string
  deleteSession: (id: string) => void
  setActiveSession: (id: string) => void
  renameSession: (id: string, title: string) => void
  loadSessions: (sessions: SessionsState['sessions']) => void
}

export type SessionsStore = SessionsState & SessionsActions
