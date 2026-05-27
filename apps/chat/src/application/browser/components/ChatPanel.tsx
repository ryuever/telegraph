import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Sparkles } from 'lucide-react'
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
import { getSessionStore, isSessionDeleted, loadDeletedSessionIds, useSessionsStore } from '@/packages/stores'
import { PageletAgentService } from '../pagelet-agent-service'
import { createChatAgentEventProjectionState, projectAgentEventToChat } from '../agent-event-projector'
import { upsertToolCall } from '../chat-tool-calls'
import { upsertSubagentUpdate } from '../chat-subagents'
import { groupPersistedRuns, sortRunsForSessionTimeline } from '../persisted-run-groups'
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
  ChatStreamEvent,
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
  const [selectedPersistedSessionId, setSelectedPersistedSessionId] = useState<string | null>(null)
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

  useEffect(() => {
    if (!agentService.deleteSessionRuns) return
    const controller = new AbortController()
    for (const sessionId of loadDeletedSessionIds()) {
      void agentService.deleteSessionRuns(sessionId, controller.signal).catch(() => {
        // Cleanup is retried on the next ChatPanel mount.
      })
    }
    return () => { controller.abort(); }
  }, [agentService])

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

  useEffect(() => {
    if (!agentService.subscribeToStreamEvents) return undefined
    const controller = new AbortController()
    let subscription: { unsubscribe(): void } | undefined
    const remoteRuns = new Map<string, {
      sessionId: string
      assistantMessageId: string
      projectionState: ReturnType<typeof createChatAgentEventProjectionState>
    }>()

    const ensureRemoteRun = (event: ChatStreamEvent) => {
      if (!event.sourceIntentId || !event.sessionId || !event.message) return undefined
      if (isSessionDeleted(event.sessionId)) return undefined
      const existing = remoteRuns.get(event.runId)
      if (existing) return existing

      const title = deriveRemoteTitle(event.message)
      useSessionsStore.getState().upsertSession(event.sessionId, title)
      const store = getSessionStore(event.sessionId, title)
      const userMessageId = `remote:${event.runId}:user`
      const assistantMessageId = `remote:${event.runId}:assistant`
      const messages = store.getState().messages

      if (!messages.some(message => message.id === userMessageId)) {
        store.addMessage({
          id: userMessageId,
          role: 'user',
          content: event.message,
          createdAt: Date.now(),
          status: 'done',
        })
      }
      if (!messages.some(message => message.id === assistantMessageId)) {
        store.addMessage({
          id: assistantMessageId,
          role: 'assistant',
          content: '',
          createdAt: Date.now(),
          status: 'streaming',
        })
      }
      store.setStreaming(true)

      const remoteRun = {
        sessionId: event.sessionId,
        assistantMessageId,
        projectionState: createChatAgentEventProjectionState(),
      }
      remoteRuns.set(event.runId, remoteRun)
      return remoteRun
    }

    const updateAssistant = (
      run: { sessionId: string; assistantMessageId: string },
      updater: Parameters<ReturnType<typeof getSessionStore>['updateMessage']>[1],
    ) => {
      getSessionStore(run.sessionId).updateMessage(run.assistantMessageId, updater)
    }

    void agentService.subscribeToStreamEvents(event => {
      if (event.type === 'run_queued') {
        ensureRemoteRun(event)
        return
      }

      const remoteRun = remoteRuns.get(event.runId)
      if (!remoteRun) return
      const store = getSessionStore(remoteRun.sessionId)

      if (event.type === 'permission_pending' && event.permissionRequest) {
        rememberPermissionRequest(event.permissionRequest)
        return
      }

      if (event.type === 'runtime_event' && event.event) {
        projectAgentEventToChat(event.event, {
          sessionId: remoteRun.sessionId,
          runId: event.runId,
          projectionState: remoteRun.projectionState,
          onChunk: delta => {
            updateAssistant(remoteRun, message => ({
              ...message,
              content: message.content + delta,
              status: message.status === 'pending' ? 'streaming' : message.status,
            }))
          },
          onToolCall: call => {
            updateAssistant(remoteRun, message => ({
              ...message,
              toolCalls: upsertToolCall(message.toolCalls ?? [], call),
            }))
          },
          onSubagentUpdate: update => {
            updateAssistant(remoteRun, message => ({
              ...message,
              subagentGroups: upsertSubagentUpdate(message.subagentGroups ?? [], update),
            }))
          },
          onStatus: status => {
            updateAssistant(remoteRun, message => ({
              ...message,
              status: status === 'failed' ? 'error' : status === 'completed' ? 'done' : 'streaming',
            }))
            if (status === 'completed' || status === 'failed') store.setStreaming(false)
          },
          onLlmTrace: appendLlmTrace,
        })
        if (event.event.type === 'run_failed') {
          const errorMessage = event.event.error.message
          updateAssistant(remoteRun, message => ({
            ...message,
            status: 'error',
            errorMessage,
          }))
        }
        return
      }

      if (event.type === 'text_delta' && event.text) {
        const delta = event.text
        updateAssistant(remoteRun, message => ({
          ...message,
          content: `${message.content}${delta}`,
          status: 'streaming',
        }))
      } else if (event.type === 'run_completed' || event.type === 'done') {
        updateAssistant(remoteRun, message => ({ ...message, status: 'done' }))
        store.setStreaming(false)
      } else if (event.type === 'run_failed' || event.type === 'error') {
        updateAssistant(remoteRun, message => ({ ...message, status: 'error', errorMessage: event.error }))
        store.setStreaming(false)
      }
    }, controller.signal)
      .then(nextSubscription => {
        subscription = nextSubscription
      })
      .catch(() => {
        // Remote chat mirroring is best-effort; direct local chat and run ledger remain authoritative.
      })

    return () => {
      controller.abort()
      subscription?.unsubscribe()
    }
  }, [agentService, appendLlmTrace, rememberPermissionRequest])

  useEffect(() => {
    if (!agentService.listRuns || !agentService.listRunEvents) return undefined
    const listRuns = agentService.listRuns.bind(agentService)
    const listRunEvents = agentService.listRunEvents.bind(agentService)
    const controller = new AbortController()

    const hydrateRemoteRuns = async () => {
      const runs = await listRuns({ limit: 80, signal: controller.signal })
      if (controller.signal.aborted) return

      for (const run of runs.filter(isRemoteChatRun)) {
        const message = run.input?.message ?? run.inputPreview
        if (!message) continue
        if (isSessionDeleted(run.sessionId)) continue

        const title = deriveRemoteTitle(message)
        useSessionsStore.getState().upsertSession(run.sessionId, title)
        const store = getSessionStore(run.sessionId, title)
        const userMessageId = `remote:${run.runId}:user`
        const assistantMessageId = `remote:${run.runId}:assistant`
        const currentMessages = store.getState().messages
        const existingAssistant = currentMessages.find(item => item.id === assistantMessageId)

        if (!currentMessages.some(item => item.id === userMessageId)) {
          store.addMessage({
            id: userMessageId,
            role: 'user',
            content: message,
            createdAt: run.createdAt,
            status: 'done',
          })
        }
        if (!existingAssistant) {
          store.addMessage({
            id: assistantMessageId,
            role: 'assistant',
            content: '',
            createdAt: run.startedAt ?? run.createdAt,
            status: run.status === 'failed' ? 'error' : run.status === 'completed' ? 'done' : 'streaming',
            errorMessage: run.failureMessage,
          })
        }

        if (existingAssistant?.content || existingAssistant?.toolCalls?.length || existingAssistant?.subagentGroups?.length) {
          continue
        }

        const events = await listRunEvents(run.runId, controller.signal)
        const projectionState = createChatAgentEventProjectionState()
        const updateAssistant = (
          updater: Parameters<ReturnType<typeof getSessionStore>['updateMessage']>[1],
        ) => {
          getSessionStore(run.sessionId).updateMessage(assistantMessageId, updater)
        }

        for (const record of events) {
          projectAgentEventToChat(record.event, {
            sessionId: run.sessionId,
            runId: run.runId,
            projectionState,
            onChunk: delta => {
              updateAssistant(item => ({ ...item, content: item.content + delta }))
            },
            onToolCall: call => {
              updateAssistant(item => ({ ...item, toolCalls: upsertToolCall(item.toolCalls ?? [], call) }))
            },
            onSubagentUpdate: update => {
              updateAssistant(item => ({
                ...item,
                subagentGroups: upsertSubagentUpdate(item.subagentGroups ?? [], update),
              }))
            },
            onStatus: status => {
              updateAssistant(item => ({
                ...item,
                status: status === 'failed' ? 'error' : status === 'completed' ? 'done' : 'streaming',
              }))
            },
          })
          if (record.event.type === 'run_failed') {
            const errorMessage = record.event.error.message
            updateAssistant(item => ({ ...item, status: 'error', errorMessage }))
          }
        }
      }
    }

    void hydrateRemoteRuns().catch(() => {
      // Backfill is best-effort; live stream mirroring handles new remote runs.
    })

    return () => {
      controller.abort()
    }
  }, [agentService])

  const displayedTraceRows = useMemo(
    () =>
      traceScopeAllChats ? traceRows : traceRows.filter(r => r.sessionId === activeId),
    [traceScopeAllChats, traceRows, activeId]
  )

  const loadPersistedRuns = useCallback(async () => {
    if (!agentService.listRuns) return []
    setRunConsoleLoading(true)
    try {
      const runs = await agentService.listRuns({
        sessionId: traceScopeAllChats ? undefined : activeId,
        limit: 80,
      })
      setPersistedRuns(runs)
      const groups = groupPersistedRuns(runs)
      if (selectedPersistedSessionId && !groups.some(group => group.sessionId === selectedPersistedSessionId)) {
        setSelectedPersistedSessionId(null)
        setSelectedRunRows([])
      }
      return runs
    } finally {
      setRunConsoleLoading(false)
    }
  }, [activeId, agentService, selectedPersistedSessionId, traceScopeAllChats])

  useEffect(() => {
    if (!tracePanelOpen) return
    void loadPersistedRuns()
  }, [loadPersistedRuns, tracePanelOpen, traceRows.length])

  const selectPersistedRunGroup = useCallback(async (
    sessionId: string | null,
    sourceRuns = persistedRuns,
  ) => {
    setSelectedPersistedSessionId(sessionId)
    if (!sessionId) {
      setSelectedRunRows([])
      return
    }
    if (!agentService.listRunEvents) return
    setRunConsoleLoading(true)
    try {
      const sessionRuns = sortRunsForSessionTimeline(
        sourceRuns.filter(run => run.sessionId === sessionId)
      )
      const rows: LlmTraceRow[] = []
      for (const run of sessionRuns) {
        const events = await agentService.listRunEvents(run.runId)
        rows.push(...runEventsToTraceRows(events))
      }
      setSelectedRunRows(rows)
    } finally {
      setRunConsoleLoading(false)
    }
  }, [agentService, persistedRuns])

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

  const importTraceBundle = useCallback(async (bundle: ChatRunTraceBundle) => {
    if (!agentService.importRunTraceBundle) return
    const result = await agentService.importRunTraceBundle(bundle)
    const runs = await loadPersistedRuns()
    const nextRuns = runs.some(run => run.runId === result.record.runId)
      ? runs
      : [result.record, ...runs]
    await selectPersistedRunGroup(result.record.sessionId, nextRuns)
  }, [agentService, loadPersistedRuns, selectPersistedRunGroup])

  const clearVisibleTraces = useCallback(() => {
    clearLlmTraceRowsForSession(activeId)
  }, [activeId])

  const handleDeleteConversation = useCallback((id: string) => {
    deleteConversation(id)
    clearLlmTraceRowsForSession(id)
    setPersistedRuns(prev => prev.filter(run => run.sessionId !== id))
    if (selectedPersistedSessionId === id) {
      setSelectedPersistedSessionId(null)
      setSelectedRunRows([])
    }
  }, [deleteConversation, selectedPersistedSessionId])

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
    <div className="flex h-full w-full flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <ChatSidebar
          conversations={conversations}
          activeId={activeId}
          collapsed={collapsed}
          onSelect={setActiveId}
          onCreate={createConversation}
          onDelete={handleDeleteConversation}
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
            selectedPersistedSessionId={selectedPersistedSessionId}
            selectedRunRows={selectedRunRows}
            runConsoleLoading={runConsoleLoading}
            scopeAllChats={traceScopeAllChats}
            onScopeAllChatsChange={setTraceScopeAllChats}
            onSelectPersistedRunGroup={sessionId => { void selectPersistedRunGroup(sessionId); }}
            onRefreshPersistedRuns={() => { void loadPersistedRuns(); }}
            onForkPersistedNode={source => { forkPersistedNode(source); }}
            onImportTraceBundle={bundle => { void importTraceBundle(bundle); }}
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
    ['backend', run.settings.backend ?? run.runtimeId, settings.backend],
    ['orchestration', run.settings.orchestration, settings.orchestration],
    ['pattern', run.settings.orchestrationPattern, settings.orchestrationPattern],
    ['team', run.teamId ?? run.settings.orchestration, settings.orchestration],
    ['permission profile', run.settings.taskCapabilityProfile ?? 'default', settings.taskCapabilityProfile.kind],
  ]
  return checks
    .filter(([, before, after]) => (before ?? '-') !== (after ?? '-'))
    .map(([label, before, after]) => `${label}: ${before ?? '-'} -> ${after ?? '-'}`)
}

function deriveRemoteTitle(text: string): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return 'Remote chat'
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed
}

function isRemoteChatRun(run: ChatAgentRunRecordSnapshot): boolean {
  return run.runId.startsWith('chat-intent_') || run.sessionId.startsWith('chat-intent_')
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
          <div key={request.id} className="rounded-md border border-amber-300/70 bg-card px-3 py-2 shadow-lg">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9.5px] uppercase text-amber-200">
                permission
              </span>
              <span className="font-mono text-[10.5px] text-muted-foreground">{shortRunId(request.runId)}</span>
              <span className="text-[11px] text-foreground">{permissionTitle(request)}</span>
            </div>
            <div className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
              {request.proposedDecision.reason}
              {request.context.operation ? ` · ${operationSummary(request.context.operation)}` : ''}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { onDeny(request.id); }}
                className="rounded-md border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-surface-soft"
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
  return `Secrets access: ${permission.keys?.join(', ') ?? 'unspecified key'}`
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
    <header className="flex items-center justify-between gap-3 border-b border-border bg-card/55 px-5 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="truncate text-[13.5px] font-semibold text-foreground">
          {title}
        </h1>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {messageCount === 0
            ? 'no messages yet'
            : `${String(messageCount)} message${messageCount === 1 ? '' : 's'}`}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={onToggleTracePanel}
          className={
            tracePanelOpen
              ? 'rounded-md border border-border bg-accent px-2.5 py-0.5 text-accent-foreground'
              : 'rounded-md border border-border bg-background px-2.5 py-0.5 text-muted-foreground hover:bg-surface-soft'
          }
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          LLM trace
        </button>
        <span
          className={
            isStreaming
              ? 'rounded-md border border-border bg-surface-tint px-2 py-0.5 text-foreground'
              : 'rounded-md border border-border bg-background px-2 py-0.5'
          }
        >
          {isStreaming ? 'streaming' : 'idle'}
        </span>
        {runtimeCapability && (
          <button
            type="button"
            onClick={onOpenSettings}
            title={runtimeCapability.summary}
            className="rounded-md border border-border bg-background px-2 py-0.5 text-muted-foreground hover:bg-surface-soft"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            {runtimeCapability.label}{' '}
            <span className="ml-1 text-muted-foreground">{runtimeCapability.maturity}</span>
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
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-primary shadow-[0_0_28px_rgba(255,84,54,0.18)]">
          <Sparkles size={22} />
        </div>
        <h2 className="text-[18px] font-semibold text-foreground">
          How can I help you today?
        </h2>
        <p className="mt-1.5 text-[12.5px] text-muted-foreground">
          Start a conversation, or pick a starter prompt.
        </p>

        <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { onSuggest(s); }}
              className="rounded-md border border-border bg-card px-3 py-2.5 text-left text-[12.5px] text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
