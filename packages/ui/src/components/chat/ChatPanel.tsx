import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Toolbar } from '@telegraph/ui/components/Toolbar'
import { ChatSidebar } from './ChatSidebar'
import { ChatMessages } from './ChatMessages'
import { ChatComposer } from './ChatComposer'
import { ChatSettingsDialog } from './ChatSettingsDialog'
import { ModelBadge } from './ModelBadge'
import { useChat } from './use-chat'
import { useSessionsStore } from '@telegraph/stores'
import { MockAgentService } from './agent-service'
import { PiAgentService } from './pi-agent-service'
import {
  loadSettings,
  saveSettings,
  toRuntimeSettings,
  loadEnvModels,
  mergeEnvModelsIntoSettings,
  getDefaultModelFromEnv,
  type ChatModelSettings,
} from './model-settings'
import type { AgentService } from './types'

interface Props {
  agent?: AgentService
}

const SUGGESTIONS = [
  'Summarize what Telegraph does',
  'Help me debug an Electron preload bridge',
  'Draft a release note for the latest commits',
  'Explain how my renderer talks to the main process',
]

export function ChatPanel({ agent }: Props) {
  const [settings, setSettings] = useState<ChatModelSettings>(() => loadSettings())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [isLoadingEnv, setIsLoadingEnv] = useState(true)

  // Load and merge .env config on mount
  useEffect(() => {
    let isMounted = true

    async function initEnvConfig() {
      try {
        const envModels = await loadEnvModels()
        if (!isMounted) return

        const currentSettings = loadSettings()
        const mergedSettings = mergeEnvModelsIntoSettings(currentSettings, envModels)

        // If no provider/model is set in localStorage, use the first env model as default
        const defaultFromEnv = getDefaultModelFromEnv(envModels)
        if (defaultFromEnv && !currentSettings.byProvider[currentSettings.provider]?.apiKey) {
          mergedSettings.provider = defaultFromEnv.provider
          mergedSettings.modelId = defaultFromEnv.modelId
        }

        setSettings(mergedSettings)
        // Save the merged settings to localStorage for persistence
        saveSettings(mergedSettings)
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

  // Build a single agent service per settings tuple. PiAgentService has no
  // intrinsic state across `send` calls, so reconstructing it on settings
  // change is cheap. Falls back to the mock when no agent prop is supplied
  // and no API key is configured.
  const agentService = useMemo<AgentService>(() => {
    if (agent) return agent
    const runtime = toRuntimeSettings(settings)
    if (!runtime.apiKey) return new MockAgentService()
    return new PiAgentService(runtime)
  }, [agent, settings])

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
  } = useChat({ agent: agentService })

  /** Subscribe directly so draft always tracks the real active session (avoids stale activeId vs. zustand). */
  const composerSessionId = useSessionsStore(s => s.activeSessionId)
  const composerKey = composerSessionId ?? ''

  /** Restored drafts when switching sidebar sessions (composer keeps live text locally). */
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
    <div className="flex h-screen w-screen flex-col bg-zinc-950 text-zinc-100">
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
          onToggleCollapse={() => setCollapsed(c => !c)}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <Header
            title={active.title}
            messageCount={active.messages.length}
            isStreaming={isStreaming}
            provider={settings.provider}
            modelId={settings.modelId}
            onOpenSettings={() => setSettingsOpen(true)}
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
            key={`${composerKey}|${composerRemountKey}`}
            sessionId={composerKey}
            seedText={seedText}
            onPersistSessionDraft={persistSessionDraft}
            onSendMessage={handleSendMessage}
            onStop={stop}
            isStreaming={isStreaming}
          />
        </main>
      </div>

      <ChatSettingsDialog
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
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
  onOpenSettings,
}: {
  title: string
  messageCount: number
  isStreaming: boolean
  provider: string
  modelId: string
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
            : `${messageCount} message${messageCount === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
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
              onClick={() => onSuggest(s)}
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

