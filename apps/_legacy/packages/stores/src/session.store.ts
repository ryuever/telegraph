import { create } from 'zustand'
import type { ChatMessage, SessionStore, SessionState, SessionActions } from './types'
import { persistSessionMessages, loadPersistentMessages, deleteSessionMessages } from './persistence'

function createSessionStoreImpl(sessionId: string, initialTitle = 'New chat') {
  const hook = create<SessionStore>((set) => ({
    sessionId,
    title: initialTitle,
    messages: loadPersistentMessages(sessionId) ?? [],
    isStreaming: false,
    abortController: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),

    addMessage: (message: ChatMessage) =>
      set((state) => {
        const next = {
          ...state,
          messages: [...state.messages, message],
          updatedAt: Date.now(),
        }
        persistSessionMessages(sessionId, next.messages)
        return next
      }),

    updateMessage: (messageId: string, updater: (m: ChatMessage) => ChatMessage) =>
      set((state) => {
        const next = {
          ...state,
          messages: state.messages.map((m) => (m.id === messageId ? updater(m) : m)),
          updatedAt: Date.now(),
        }
        persistSessionMessages(sessionId, next.messages)
        return next
      }),

    setStreaming: (isStreaming: boolean, controller?: AbortController | null) =>
      set({
        isStreaming,
        abortController: controller ?? null,
      }),

    stop: () =>
      set((state) => {
        state.abortController?.abort()
        return { isStreaming: false, abortController: null }
      }),

    updateTitle: (title: string) =>
      set({
        title,
        updatedAt: Date.now(),
      }),

    reset: () =>
      set({
        messages: [],
        isStreaming: false,
        abortController: null,
        title: 'New chat',
        updatedAt: Date.now(),
      }),
  }))

  // 返回一个对象，既可以用作 hook，也提供了直接方法调用的接口
  return {
    use: hook,
    getState: () => hook.getState(),
    setState: (partial: Partial<SessionStore>) => hook.setState(partial),
    subscribe: hook.subscribe,

    // 便利方法，直接调用而无需 React hook
    addMessage: (message: ChatMessage) => hook.getState().addMessage(message),
    updateMessage: (messageId: string, updater: (m: ChatMessage) => ChatMessage) =>
      hook.getState().updateMessage(messageId, updater),
    setStreaming: (isStreaming: boolean, controller?: AbortController | null) =>
      hook.getState().setStreaming(isStreaming, controller),
    stop: () => hook.getState().stop(),
    updateTitle: (title: string) => hook.getState().updateTitle(title),
    reset: () => hook.getState().reset(),
  }
}

type SessionStoreType = ReturnType<typeof createSessionStoreImpl>

const sessionStores = new Map<string, SessionStoreType>()

export function getSessionStore(sessionId: string, initialTitle?: string): SessionStoreType {
  if (!sessionStores.has(sessionId)) {
    sessionStores.set(sessionId, createSessionStoreImpl(sessionId, initialTitle))
  }
  return sessionStores.get(sessionId)!
}

export function removeSessionStore(sessionId: string) {
  sessionStores.delete(sessionId)
  deleteSessionMessages(sessionId)
}
