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
  type LlmTraceRow,
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
import type {
  ChatAgentRunEventRecordSnapshot,
  ChatAgentRunRecordSnapshot,
  ChatPermissionRequestSnapshot,
  ChatRunTraceBundle,
  ChatRuntimeCapabilityDescriptorSnapshot,
} from '@/apps/chat/application/common'
import { listRuntimeCapabilityDescriptors } from '@/packages/agent/runtime/RuntimeCapabilityDescriptor'
import type { AgentRunReplayMode } from '@/packages/agent/persistence/AgentRunRepository'

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
  const [persistedRuns, setPersistedRuns] = useState<ChatAgentRunRecordSnapshot[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedRunRows, setSelectedRunRows] = useState<LlmTraceRow[]>([])
  const [runConsoleLoading, setRunConsoleLoading] = useState(false)
  const [pendingPermissions, setPendingPermissions] = useState<ChatPermissionRequestSnapshot[]>([])
  const [runtimeCapabilities, setRuntimeCapabilities] = useState<ChatRuntimeCapabilityDescriptorSnapshot[]>(
    () => listRuntimeCapabilityDescriptors()
  )

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

  useEffect(() => {
    if (!settingsOpen || !agentService.listRuntimeCapabilities) return
    const controller = new AbortController()
    agentService.listRuntimeCapabilities(controller.signal)
      .then(items => {
        if (!controller.signal.aborted && items.length > 0) {
          setRuntimeCapabilities(items)
        }
      })
      .catch(() => {
        // Keep static descriptors when the pagelet RPC channel is not ready.
      })
    return () => { controller.abort(); }
  }, [agentService, settingsOpen])

  const rememberPermissionRequest = useCallback((request: ChatPermissionRequestSnapshot) => {
    setPendingPermissions(prev => {
      const next = prev.filter(item => item.id !== request.id)
      next.push(request)
      return next
    })
  }, [])

  const resolvePermission = useCallback(async (requestId: string, granted: boolean) => {
    if (!agentService.resolvePermissionRequest) return
    const ok = await agentService.resolvePermissionRequest(requestId, {
      granted,
      reason: granted ? 'Approved in Chat permission UI' : 'Denied in Chat permission UI',
    })
    if (ok) {
      setPendingPermissions(prev => prev.filter(item => item.id !== requestId))
    }
  }, [agentService])

  useEffect(() => {
    if (!agentService.listPendingPermissions) return
    const controller = new AbortController()
    agentService.listPendingPermissions(undefined, controller.signal)
      .then(items => {
        if (!controller.signal.aborted) {
          setPendingPermissions(items)
        }
      })
      .catch(() => {
        // Pending permission recovery is best effort; live stream events remain authoritative.
      })
    return () => { controller.abort(); }
  }, [agentService])

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
  } = useChat({
    agent: agentService,
    onLlmTrace: appendLlmTrace,
    onPermissionRequest: rememberPermissionRequest,
  })

  const displayedTraceRows = useMemo(
    () =>
      traceScopeAllChats ? traceRows : traceRows.filter(r => r.sessionId === activeId),
    [traceScopeAllChats, traceRows, activeId]
  )

  const loadPersistedRuns = useCallback(async () => {
    if (!agentService.listRuns) return
    setRunConsoleLoading(true)
    try {
      const runs = await agentService.listRuns({
        sessionId: traceScopeAllChats ? undefined : activeId,
        limit: 80,
      })
      setPersistedRuns(runs)
      if (selectedRunId && !runs.some(run => run.runId === selectedRunId)) {
        setSelectedRunId(null)
        setSelectedRunRows([])
      }
    } finally {
      setRunConsoleLoading(false)
    }
  }, [activeId, agentService, selectedRunId, traceScopeAllChats])

  useEffect(() => {
    if (!tracePanelOpen) return
    void loadPersistedRuns()
  }, [loadPersistedRuns, tracePanelOpen, traceRows.length])

  const selectPersistedRun = useCallback(async (runId: string | null) => {
    setSelectedRunId(runId)
    if (!runId) {
      setSelectedRunRows([])
      return
    }
    if (!agentService.listRunEvents) return
    setRunConsoleLoading(true)
    try {
      const events = await agentService.listRunEvents(runId)
      setSelectedRunRows(runEventsToTraceRows(events))
    } finally {
      setRunConsoleLoading(false)
    }
  }, [agentService])

  const replayPersistedRun = useCallback(async (
    runId: string,
    mode: AgentRunReplayMode,
    source?: { sourceEventSeq?: number; sourceChildRunId?: string },
  ) => {
    const run = persistedRuns.find(item => item.runId === runId) ?? await agentService.getRun?.(runId)
    if (!run) return
    const message = run.input?.message ?? run.inputPreview
    if (!message) return
    const diff = replaySettingsDiff(run, settings)
    if (diff.length > 0 && !window.confirm([
      'Replay will use the current Chat settings, which differ from the selected run:',
      '',
      ...diff.map(item => `- ${item}`),
      '',
      'Continue?',
    ].join('\n'))) {
      return
    }

    const targetSessionId = mode === 'retry'
      ? run.sessionId
      : useSessionsStore.getState().createSession()

    setActiveId(targetSessionId)
    await sendMessage(message, {
      targetSessionId,
      parentRunId: run.runId,
      replay: {
        mode,
        sourceRunId: run.runId,
        sourceEventSeq: source?.sourceEventSeq,
        sourceChildRunId: source?.sourceChildRunId,
      },
    })
    void loadPersistedRuns()
  }, [agentService, loadPersistedRuns, persistedRuns, sendMessage, setActiveId, settings])

  const forkPersistedNode = useCallback((source: {
    sourceRunId: string
    sourceEventSeq?: number
    sourceChildRunId?: string
  }) => {
    void replayPersistedRun(source.sourceRunId, 'fork', source)
  }, [replayPersistedRun])

  const exportPersistedRun = useCallback(async (runId: string) => {
    if (!agentService.exportRunTraceBundle) return
    const bundle = await agentService.exportRunTraceBundle(runId)
    if (!bundle) return

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    try {
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `telegraph-run-${shortRunId(runId)}.trace.json`
      anchor.click()
    } finally {
      URL.revokeObjectURL(url)
    }
  }, [agentService])

  const importTraceBundle = useCallback(async (bundle: ChatRunTraceBundle) => {
    if (!agentService.importRunTraceBundle) return
    const result = await agentService.importRunTraceBundle(bundle)
    await loadPersistedRuns()
    await selectPersistedRun(result.record.runId)
  }, [agentService, loadPersistedRuns, selectPersistedRun])

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
              runtimeCapability={findEffectiveRuntimeCapability(runtimeCapabilities, settings)}
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
            <PermissionApprovalTray
              requests={pendingPermissions.filter(item => !activeId || item.sessionId === activeId)}
              onApprove={requestId => { void resolvePermission(requestId, true); }}
              onDeny={requestId => { void resolvePermission(requestId, false); }}
            />
          </main>
          <LlmTracePanel
            open={tracePanelOpen}
            rows={displayedTraceRows}
            storedTraceRowCount={traceRows.length}
            persistedRuns={persistedRuns}
            selectedRunId={selectedRunId}
            selectedRunRows={selectedRunRows}
            runConsoleLoading={runConsoleLoading}
            scopeAllChats={traceScopeAllChats}
            onScopeAllChatsChange={setTraceScopeAllChats}
            onSelectPersistedRun={selectPersistedRun}
            onRefreshPersistedRuns={loadPersistedRuns}
            onReplayPersistedRun={replayPersistedRun}
            onForkPersistedNode={forkPersistedNode}
            onExportPersistedRun={exportPersistedRun}
            onImportTraceBundle={importTraceBundle}
            onClear={clearVisibleTraces}
            onClose={() => { setTracePanelOpen(false); }}
          />
        </div>
      </div>

      <ChatSettingsDialog
        open={settingsOpen}
        settings={settings}
        runtimeCapabilities={runtimeCapabilities}
        onClose={() => { setSettingsOpen(false); }}
        onSave={handleSaveSettings}
      />
    </div>
  )
}

function replaySettingsDiff(run: ChatAgentRunRecordSnapshot, settings: ChatModelSettings): string[] {
  const checks: Array<[string, string | undefined | null, string | undefined | null]> = [
    ['provider', run.settings.provider, settings.provider],
    ['model', run.settings.modelId, settings.modelId],
    ['backend', run.settings.backend ?? run.runtimeId, settings.backend ?? 'pi-ai'],
    ['orchestration', run.settings.orchestration, settings.orchestration ?? 'none'],
    ['pattern', run.settings.orchestrationPattern, settings.orchestrationPattern ?? null],
    ['team', run.teamId ?? run.settings.orchestration, settings.orchestration],
    ['permission profile', run.settings.taskCapabilityProfile ?? 'default', settings.taskCapabilityProfile?.kind ?? 'default'],
  ]
  return checks
    .filter(([, before, after]) => (before ?? '-') !== (after ?? '-'))
    .map(([label, before, after]) => `${label}: ${before ?? '-'} -> ${after ?? '-'}`)
}

function runEventsToTraceRows(events: ChatAgentRunEventRecordSnapshot[]): LlmTraceRow[] {
  return events.map(item => ({
    sessionId: item.sessionId ?? item.runId,
    runId: item.runId,
    seq: item.seq,
    ts: item.ts,
    trace: { kind: 'runtime_event', event: item.event },
  }))
}

function findEffectiveRuntimeCapability(
  capabilities: ChatRuntimeCapabilityDescriptorSnapshot[],
  settings: ChatModelSettings,
): ChatRuntimeCapabilityDescriptorSnapshot | undefined {
  const runtimeId = settings.orchestration === 'telegraph-subagents'
    ? 'telegraph-subagents'
    : settings.backend
  return capabilities.find(item => item.id === runtimeId)
}

function PermissionApprovalTray({
  requests,
  onApprove,
  onDeny,
}: {
  requests: ChatPermissionRequestSnapshot[]
  onApprove: (requestId: string) => void
  onDeny: (requestId: string) => void
}) {
  if (requests.length === 0) return null
  return (
    <div className="border-t border-amber-900/40 bg-amber-950/20 px-4 py-2">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {requests.map(request => (
          <div
            key={request.id}
            className="rounded-md border border-amber-800/60 bg-zinc-950/80 px-3 py-2 shadow-lg"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] uppercase text-amber-200">
                permission
              </span>
              <span className="font-mono text-[10.5px] text-zinc-400">{shortRunId(request.runId)}</span>
              <span className="text-[11px] text-zinc-300">{permissionTitle(request)}</span>
            </div>
            <div className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              {request.proposedDecision.reason}
              {request.context.operation ? ` · ${operationSummary(request.context.operation)}` : ''}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { onDeny(request.id); }}
                className="rounded-md border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                Deny
              </button>
              <button
                type="button"
                onClick={() => { onApprove(request.id); }}
                className="rounded-md bg-amber-200 px-2.5 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
              >
                Approve
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function permissionTitle(request: ChatPermissionRequestSnapshot): string {
  const permission = request.permission
  if (permission.type === 'filesystem') return `Filesystem ${permission.access}: ${permission.scope}`
  if (permission.type === 'shell') return `Shell execution: ${permission.risk} risk`
  if (permission.type === 'network') return `Network access: ${permission.hosts?.join(', ') ?? 'unspecified host'}`
  if (permission.type === 'process') return `Process access: ${permission.commands?.join(', ') ?? 'unspecified command'}`
  if (permission.type === 'secrets') return `Secrets access: ${permission.keys?.join(', ') ?? 'unspecified key'}`
  return permission satisfies never
}

function operationSummary(operation: ChatPermissionRequestSnapshot['context']['operation']): string {
  if (!operation) return ''
  switch (operation.kind) {
    case 'filesystem.read':
    case 'filesystem.write':
      return operation.path ?? operation.kind
    case 'shell.exec':
      return [operation.command, operation.cwd].filter(Boolean).join(' @ ')
    case 'network.request':
      return operation.url ?? operation.host ?? operation.kind
    default:
      return operation satisfies never
  }
}

function shortRunId(runId: string): string {
  return runId.length > 12 ? `${runId.slice(0, 12)}...` : runId
}

function Header({
  title,
  messageCount,
  isStreaming,
  provider,
  modelId,
  runtimeCapability,
  tracePanelOpen,
  onToggleTracePanel,
  onOpenSettings,
}: {
  title: string
  messageCount: number
  isStreaming: boolean
  provider: string
  modelId: string
  runtimeCapability?: ChatRuntimeCapabilityDescriptorSnapshot
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
        {runtimeCapability && (
          <button
            type="button"
            onClick={onOpenSettings}
            title={runtimeCapability.summary}
            className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-zinc-300 hover:border-zinc-600"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {runtimeCapability.label}{' '}
            <span className="ml-1 text-zinc-500">{runtimeCapability.maturity}</span>
          </button>
        )}
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
