import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Toolbar } from '@/packages/ui/components/Toolbar'
import { ChatSidebar } from './ChatSidebar'
import { ChatMessages } from './ChatMessages'
import { ChatComposer } from './ChatComposer'
import { ChatSettingsDialog } from './ChatSettingsDialog'
import { ModelBadge } from './ModelBadge'
import { LlmTracePanel } from './LlmTracePanel'
import {
  appendLlmTraceRow,
  clearLlmTraceRowsForSession,
  getLlmTraceRowsSnapshot,
  subscribeLlmTraceRows,
} from '../llm-trace-store'
import { useChat } from '../use-chat'
import { useSessionsStore } from '@/packages/stores'
import { PageletAgentService } from '../pagelet-agent-service'
import {
  loadSettings,
  saveSettings,
  loadEnvModels,
  getDefaultModelFromEnv,
  type ChatModelSettings,
} from '../model-settings'
import type { AgentService, LlmTracePayload } from '../types'

interface Props {
  agent?: AgentService
}

const LLM_TRACE_OPEN_KEY = 'telegraph:chat:llmTraceOpen'

function readLlmTraceOpenFromStorage(): boolean {
  try {
    return sessionStorage.getItem(LLM_TRACE_OPEN_KEY) === '1'
  } catch {
    return false
  }
}

const SUGGESTIONS = [
  'Summarize what Telegraph does',
  'Help me debug an Electron preload bridge',
  'Draft a release note for the latest commits',
  'Explain how my renderer talks to the main process',
]

export function ChatPanel({ agent }: Props) {
  const [settings, setSettings] = useState<ChatModelSettings>(() => loadSettings())
  const [_envModels, setEnvModels] = useState<import('../model-settings').EnvModelConfig[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [_isLoadingEnv, setIsLoadingEnv] = useState(true)
  const [tracePanelOpen, setTracePanelOpenInner] = useState(readLlmTraceOpenFromStorage)

  const setTracePanelOpen = useCallback((next: React.SetStateAction<boolean>) => {
    setTracePanelOpenInner(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next
      try {
        sessionStorage.setItem(LLM_TRACE_OPEN_KEY, resolved ? '1' : '0')
      } catch { /* noop */ }
      return resolved
    })
  }, [])
  const [traceScopeAllChats, setTraceScopeAllChats] = useState(true)

  const traceRows = useSyncExternalStore(subscribeLlmTraceRows, getLlmTraceRowsSnapshot, getLlmTraceRowsSnapshot)

  const appendLlmTrace = useCallback((info: { sessionId: string; runId: string; trace: LlmTracePayload }) => {
    appendLlmTraceRow({ ...info, ts: Date.now() })
  }, [])

  useEffect(() => {
    let isMounted = true

    function initEnvConfig() {
      try {
        const models = loadEnvModels()
        if (!isMounted) return

        setEnvModels(models)
        const currentSettings = loadSettings()

        const defaultFromEnv = getDefaultModelFromEnv(models)
        if (defaultFromEnv && !models.some(m => m.provider === currentSettings.provider)) {
          const updated = {
            ...currentSettings,
            provider: defaultFromEnv.provider,
            modelId: defaultFromEnv.modelId,
          }
          setSettings(updated)
          saveSettings(updated)
        } else {
          setSettings(currentSettings)
        }
      } catch (err) {
        console.error('[ChatPanel] Failed to load env config:', err)
      } finally {
        if (isMounted) setIsLoadingEnv(false)
      }
    }

    initEnvConfig()

    return () => {
      isMounted = false
    }
  }, [])

  const agentService = useMemo<AgentService>(() => {
    if (agent) return agent
    return new PageletAgentService()
  }, [agent])

  const {
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
  } = useChat({ agent: agentService, onLlmTrace: appendLlmTrace })

  const displayedTraceRows = useMemo(
    () =>
      traceScopeAllChats ? traceRows : traceRows.filter(r => r.sessionId === activeId),
    [traceScopeAllChats, traceRows, activeId]
  )

  const clearVisibleTraces = useCallback(() => {
    clearLlmTraceRowsForSession(activeId)
  }, [activeId])

  const composerSessionId = useSessionsStore((s: { activeSessionId: string | null }) => s.activeSessionId)
  const composerKey = composerSessionId ?? ''

  const [draftBySession, setDraftBySession] = useState<Record<string, string>>({})
  const persistSessionDraft = useCallback((sessionId: string, text: string) => {
    if (!sessionId) return
    setDraftBySession(prev => ({ ...prev, [sessionId]: text }))
  }, [])
  const seedText = composerKey ? (draftBySession[composerKey] ?? '') : ''
  const [composerRemountKey, setComposerRemountKey] = useState(0)

  const handleSendMessage = useCallback(
    (text: string) => {
      void sendMessage(text)
    },
    [sendMessage]
  )
  const [collapsed, setCollapsed] = useState(false)

  const handleSaveSettings = (next: ChatModelSettings) => {
    setSettings(next)
    saveSettings(next)
  }

  return (
    <div className="flex h-full w-full flex-col bg-zinc-950 text-zinc-100">
      <Toolbar>
        <div
          className="text-[11px] font-medium tracking-tight text-zinc-300"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {active.title}
        </div>
      </Toolbar>

      <div className="flex min-h-0 flex-1">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          collapsed={collapsed}
          onSelect={setActiveId}
          onCreate={createConversation}
          onDelete={deleteConversation}
          onRename={renameConversation}
          onToggleCollapse={() => { setCollapsed(c => !c); }}
        />

        <div className="flex min-h-0 min-w-0 flex-1">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            <Header
              title={active.title}
              messageCount={active.messages.length}
              isStreaming={isStreaming}
              provider={settings.provider}
              modelId={settings.modelId}
              tracePanelOpen={tracePanelOpen}
              onToggleTracePanel={() => { setTracePanelOpen(o => !o); }}
              onOpenSettings={() => { setSettingsOpen(true); }}
            />
            <div className="min-h-0 flex-1">
              {active.messages.length === 0 ? (
              <EmptyState
                onSuggest={text => {
                  const id = useSessionsStore.getState().activeSessionId
                  if (id) {
                    setDraftBySession(prev => ({ ...prev, [id]: '' }))
                    setComposerRemountKey(k => k + 1)
                  }
                  void sendMessage(text)
                }}
              />
              ) : (
                <ChatMessages messages={active.messages} isStreaming={isStreaming} />
              )}
            </div>
            <ChatComposer
              key={`${composerKey}|${String(composerRemountKey)}`}
              sessionId={composerKey}
              seedText={seedText}
              onPersistSessionDraft={persistSessionDraft}
              onSendMessage={handleSendMessage}
              onStop={stop}
              isStreaming={isStreaming}
            />
          </main>
          <LlmTracePanel
            open={tracePanelOpen}
            rows={displayedTraceRows}
            storedTraceRowCount={traceRows.length}
            scopeAllChats={traceScopeAllChats}
            onScopeAllChatsChange={setTraceScopeAllChats}
            onClear={clearVisibleTraces}
            onClose={() => { setTracePanelOpen(false); }}
          />
        </div>
      </div>

      <ChatSettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => { setSettingsOpen(false); }}
        onSave={handleSaveSettings}
      />
    </div>
  )
}

function Header({
  title,
  messageCount,
  isStreaming,
  provider,
  modelId,
  tracePanelOpen,
  onToggleTracePanel,
  onOpenSettings,
}: {
  title: string
  messageCount: number
  isStreaming: boolean
  provider: string
  modelId: string
  tracePanelOpen: boolean
  onToggleTracePanel: () => void
  onOpenSettings: () => void
}) {
  return (
    <header className="flex items-center justify-between gap-3 border-b border-zinc-800/80 bg-zinc-950/40 px-5 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-[13.5px] font-semibold tracking-tight text-zinc-100">
          {title}
        </h1>
        <span className="shrink-0 text-[11px] text-zinc-500">
          {messageCount === 0
            ? 'no messages yet'
            : `${String(messageCount)} message${messageCount === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <button
          type="button"
          onClick={onToggleTracePanel}
          className={
            tracePanelOpen
              ? 'rounded-full border border-violet-500/50 bg-violet-500/15 px-2.5 py-0.5 text-violet-200'
              : 'rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-0.5 text-zinc-300 hover:border-zinc-600'
          }
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          LLM trace
        </button>
        <span
          className={
            isStreaming
              ? 'rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-sky-200'
              : 'rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5'
          }
        >
          {isStreaming ? 'streaming' : 'idle'}
        </span>
        <ModelBadge provider={provider} modelId={modelId} onClick={onOpenSettings} />
      </div>
    </header>
  )
}

function EmptyState({ onSuggest }: { onSuggest: (text: string) => void }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="w-full max-w-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 shadow-lg ring-1 ring-white/10">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-white"
          >
            <path d="M12 2v4M5 5l3 3M19 5l-3 3M2 12h4M18 12h4M5 19l3-3M19 19l-3-3M12 18v4" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </div>
        <h2 className="text-[18px] font-semibold tracking-tight text-zinc-100">
          How can I help you today?
        </h2>
        <p className="mt-1.5 text-[12.5px] text-zinc-500">
          Start a conversation, or pick a starter prompt.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onSuggest(s); }}
              className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2.5 text-left text-[12.5px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-100"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
