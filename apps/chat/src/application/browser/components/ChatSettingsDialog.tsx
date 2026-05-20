import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import {
  CATALOG,
  type ChatModelSettings,
  type EnvModelConfig,
  type ModelConnectionStatus,
  loadEnvModels,
  testModelConnection,
  getProviderOptions,
  getModelOptions,
} from '../model-settings'

interface Props {
  open: boolean
  settings: ChatModelSettings
  onClose: () => void
  onSave: (next: ChatModelSettings) => void
}

type SettingsTab = 'model' | 'orchestration' | 'extensions'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'extensions', label: 'Extensions' },
]

export function ChatSettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ChatModelSettings>(settings)
  const [envModels, setEnvModels] = useState<EnvModelConfig[]>([])
  const [connectionStatus, setConnectionStatus] = useState<Map<string, ModelConnectionStatus>>(
    new Map()
  )
  const [isTesting, setIsTesting] = useState(false)
  const [activeTab, setActiveTab] = useState<SettingsTab>('model')

  useEffect(() => {
    if (open) {
      setDraft(settings)
      const models = loadEnvModels()
      setEnvModels(models)
      testAllConnections(models)
    }
  }, [open, settings])

  const testAllConnections = (models: EnvModelConfig[]) => {
    if (models.length === 0) return
    setIsTesting(true)
    const results = new Map<string, ModelConnectionStatus>()
    for (const model of models) {
      if (model.apiKey) {
        const status = testModelConnection(
          model.provider,
          model.modelId,
          model.apiKey,
          model.baseUrl
        )
        results.set(`${model.provider}:${model.modelId}`, status)
      }
    }
    setConnectionStatus(results)
    setIsTesting(false)
  }

  const provider = draft.provider
  const providerOptions = useMemo(() => getProviderOptions(), [])
  const modelOptions = useMemo(() => getModelOptions(provider), [provider])

  const currentStatus = connectionStatus.get(`${provider}:${draft.modelId}`)

  const availableEnvModels = useMemo(() => {
    return envModels.filter(m => {
      const status = connectionStatus.get(`${m.provider}:${m.modelId}`)
      return status?.connected
    })
  }, [envModels, connectionStatus])

  if (!open) return null

  const setProvider = (next: string) => {
    const firstModel = CATALOG.find(m => m.provider === next)
    setDraft(d => ({
      ...d,
      provider: next,
      modelId: firstModel?.id ?? d.modelId,
    }))
  }

  const setModel = (id: string) => { setDraft(d => ({ ...d, modelId: id })); }
  const setBackend = (backend: ChatModelSettings['backend']) =>
    { setDraft(d => ({ ...d, backend })); }
  const setApiKey = (apiKey: string) =>
    { setDraft(d => ({ ...d, apiKey })); }
  const setBaseUrl = (baseUrl: string) =>
    { setDraft(d => ({ ...d, baseUrl: baseUrl || undefined })); }
  const setOrchestration = (orchestration: ChatModelSettings['orchestration']) =>
    { setDraft(d => ({ ...d, orchestration })); }
  const setOrchestrationPattern = (
    orchestrationPattern: ChatModelSettings['orchestrationPattern']
  ) => { setDraft(d => ({ ...d, orchestrationPattern })); }
  const setWorktreeIsolation = (worktreeIsolation: boolean) =>
    { setDraft(d => ({ ...d, worktreeIsolation })); }
  const setExtensionBlocklistText = (raw: string) =>
    { setDraft(d => ({
      ...d,
      extensionBlocklist: raw
        .split(/[,\n]+/)
        .map(s => s.trim())
        .filter(Boolean),
    })); }
  const setTaskCapabilityProfile = (taskCapabilityProfile: ChatModelSettings['taskCapabilityProfile']) =>
    { setDraft(d => ({ ...d, taskCapabilityProfile })); }

  const save = () => {
    onSave(draft)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[13.5px] font-semibold tracking-tight text-zinc-100">Settings</h2>
            {isTesting && (
              <span className="animate-pulse text-[10px] text-zinc-500">testing...</span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-zinc-800 px-5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveTab(tab.id); }}
              className={cn(
                'relative px-3 py-2 text-[11.5px] font-medium tracking-wide transition-colors',
                activeTab === tab.id
                  ? 'text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-zinc-100" />
              )}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {activeTab === 'model' && (
            <ModelTab
              draft={draft}
              envModels={envModels}
              availableEnvModels={availableEnvModels}
              connectionStatus={connectionStatus}
              currentStatus={currentStatus}
              providerOptions={providerOptions}
              modelOptions={modelOptions}
              onSetProvider={setProvider}
              onSetModel={setModel}
              onSetBackend={setBackend}
              onSetApiKey={setApiKey}
              onSetBaseUrl={setBaseUrl}
            />
          )}
          {activeTab === 'orchestration' && (
            <OrchestrationTab
              draft={draft}
              onSetOrchestration={setOrchestration}
              onSetOrchestrationPattern={setOrchestrationPattern}
              onSetWorktreeIsolation={setWorktreeIsolation}
            />
          )}
          {activeTab === 'extensions' && (
            <ExtensionsTab
              draft={draft}
              onSetBlocklist={setExtensionBlocklistText}
              onSetTaskCapabilityProfile={setTaskCapabilityProfile}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            {envModels.length > 0 ? (
              <span className="text-[11px] text-zinc-500">
                {envModels.length} model(s) from .env
              </span>
            ) : (
              <span className="text-[11px] text-zinc-600">No .env config found</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12.5px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-zinc-100 px-3 py-1.5 text-[12.5px] font-medium text-zinc-900 hover:bg-white"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModelTab({
  draft,
  envModels: _envModels,
  availableEnvModels,
  connectionStatus,
  currentStatus,
  providerOptions,
  modelOptions,
  onSetProvider,
  onSetModel,
  onSetBackend,
  onSetApiKey,
  onSetBaseUrl,
}: {
  draft: ChatModelSettings
  envModels: EnvModelConfig[]
  availableEnvModels: EnvModelConfig[]
  connectionStatus: Map<string, ModelConnectionStatus>
  currentStatus: ModelConnectionStatus | undefined
  providerOptions: { id: string; label: string }[]
  modelOptions: { provider: string; id: string; label: string }[]
  onSetProvider: (id: string) => void
  onSetModel: (id: string) => void
  onSetBackend: (backend: ChatModelSettings['backend']) => void
  onSetApiKey: (apiKey: string) => void
  onSetBaseUrl: (baseUrl: string) => void
}) {
  return (
    <div className="space-y-4">
      {availableEnvModels.length > 0 && (
        <div className="rounded-lg border border-green-900/30 bg-green-950/20 p-3">
          <div className="mb-2 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <span className="text-[11px] font-medium text-green-400">
              Available models (from .env)
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {availableEnvModels.map(model => {
              const status = connectionStatus.get(`${model.provider}:${model.modelId}`)
              const isSelected =
                draft.provider === model.provider && draft.modelId === model.modelId
              return (
                <button
                  key={`${model.provider}:${model.modelId}`}
                  onClick={() => {
                    onSetProvider(model.provider)
                    onSetModel(model.modelId)
                  }}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition-colors',
                    isSelected
                      ? 'bg-green-600 text-white'
                      : 'bg-green-900/30 text-green-300 hover:bg-green-900/50'
                  )}
                >
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      status?.connected ? 'bg-green-400' : 'bg-zinc-500'
                    )}
                  />
                  {model.label || `${model.provider} · ${model.modelId}`}
                  {status?.latency && (
                    <span className="text-[10px] opacity-70">({status.latency}ms)</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <Field label="Provider">
        <select
          value={draft.provider}
          onChange={e => { onSetProvider(e.target.value); }}
          className={selectClass}
        >
          {providerOptions.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Model">
        <div className="flex items-center gap-2">
          <select
            value={draft.modelId}
            onChange={e => { onSetModel(e.target.value); }}
            className={cn(selectClass, 'flex-1')}
          >
            {modelOptions.map(m => {
              const status = connectionStatus.get(`${m.provider}:${m.id}`)
              return (
                <option key={m.id} value={m.id}>
                  {m.label} {status?.connected ? '\u2713' : status?.error ? '\u2717' : ''}
                </option>
              )
            })}
          </select>
          {currentStatus && (
            <div
              className={cn(
                'flex h-9 items-center gap-1.5 rounded-md px-3 text-[11px]',
                currentStatus.connected
                  ? 'bg-green-950/50 text-green-400'
                  : 'bg-red-950/50 text-red-400'
              )}
            >
              <div
                className={cn(
                  'h-2 w-2 rounded-full',
                  currentStatus.connected ? 'bg-green-500' : 'bg-red-500'
                )}
              />
              {currentStatus.connected
                ? `Connected (${String(currentStatus.latency)}ms)`
                : 'Disconnected'}
            </div>
          )}
        </div>
        {currentStatus?.error && (
          <div className="mt-1.5 text-[11px] text-red-400">Error: {currentStatus.error}</div>
        )}
      </Field>

      <Field label="Execution backend">
        <select
          value={draft.backend}
          onChange={e => { onSetBackend(e.target.value as ChatModelSettings['backend']); }}
          className={selectClass}
        >
          <option value="pi-ai">pi-ai (default)</option>
          <option value="pi-embedded">pi-embedded (tool loop)</option>
          <option value="telegraph-orchestrator">telegraph-orchestrator (experimental)</option>
          <option value="langgraph" disabled>langgraph (not validated)</option>
          <option value="vercel-ai" disabled>vercel-ai (not validated)</option>
        </select>
      </Field>

      <Field label="API Key" hint="Stored in localStorage (MVP)">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft.apiKey}
            onChange={e => { onSetApiKey(e.target.value); }}
            placeholder="Enter your API key"
            className={cn(inputClass, 'flex-1')}
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.readText()
                .then(text => { onSetApiKey(text.trim()); })
                .catch(() => { /* clipboard read denied */ });
            }}
            className="shrink-0 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-500 hover:text-zinc-100"
          >
            Paste
          </button>
        </div>
      </Field>

      <Field label="Base URL" hint="Optional — override the default endpoint">
        <input
          type="text"
          value={draft.baseUrl ?? ''}
          onChange={e => { onSetBaseUrl(e.target.value); }}
          placeholder="https://api.example.com/v1"
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </div>
  )
}

function OrchestrationTab({
  draft,
  onSetOrchestration,
  onSetOrchestrationPattern,
  onSetWorktreeIsolation,
}: {
  draft: ChatModelSettings
  onSetOrchestration: (v: ChatModelSettings['orchestration']) => void
  onSetOrchestrationPattern: (v: ChatModelSettings['orchestrationPattern']) => void
  onSetWorktreeIsolation: (v: boolean) => void
}) {
  return (
    <div className="space-y-4">
      <Field label="Orchestration mode">
        <select
          value={draft.orchestration}
          onChange={e =>
            { onSetOrchestration(e.target.value as ChatModelSettings['orchestration']); }
          }
          className={selectClass}
        >
          <option value="none">none</option>
          <option value="telegraph-subagents">Telegraph native subagents</option>
        </select>
      </Field>

      {draft.orchestration === 'telegraph-subagents' && (
        <>
          <Field label="Orchestration pattern">
            <select
              value={draft.orchestrationPattern}
              onChange={e =>
                { onSetOrchestrationPattern(
                  e.target.value as ChatModelSettings['orchestrationPattern']
                ); }
              }
              className={selectClass}
            >
              <option value="chain">chain (scout → planner → worker → reviewer)</option>
              <option value="parallel">parallel (scout/planner/worker/reviewer)</option>
            </select>
          </Field>

          <label className="flex items-center gap-2 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={draft.worktreeIsolation}
              onChange={e => { onSetWorktreeIsolation(e.target.checked); }}
              className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900"
            />
            Enable worktree isolation hint (recommended for parallel code edits)
          </label>

          <div className="text-[11px] text-zinc-500">
            Uses Telegraph native agent profiles from `~/.telegraph/agents` and project
            `.telegraph/agents`. Pi compatibility must be enabled explicitly.
          </div>
        </>
      )}
    </div>
  )
}

function ExtensionsTab({
  draft,
  onSetBlocklist,
  onSetTaskCapabilityProfile,
}: {
  draft: ChatModelSettings
  onSetBlocklist: (raw: string) => void
  onSetTaskCapabilityProfile: (profile: ChatModelSettings['taskCapabilityProfile']) => void
}) {
  const profile = draft.taskCapabilityProfile
  const setProfileKind = (kind: ChatModelSettings['taskCapabilityProfile']['kind']) => {
    if (kind === 'readonly-workspace') {
      onSetTaskCapabilityProfile({ kind, scopes: ['repo:read'] })
      return
    }
    if (kind === 'shell-automation') {
      onSetTaskCapabilityProfile({ kind, commands: [], cwdPolicy: 'workspace' })
      return
    }
    if (kind === 'coding-edit') {
      onSetTaskCapabilityProfile({ kind, scopes: ['repo:read', 'repo:write'], patchPolicy: 'preview' })
      return
    }
    if (kind === 'design-build') {
      onSetTaskCapabilityProfile({ kind, scopes: ['artifact:write', 'repo:read'], artifactPolicy: 'preview' })
      return
    }
    onSetTaskCapabilityProfile({ kind: 'default' })
  }

  return (
    <div className="space-y-4">
      <Field
        label="Task capability profile"
        hint="Per-run request profile; permission broker still gates every risky action"
      >
        <select
          value={profile.kind}
          onChange={e => {
            setProfileKind(e.target.value as ChatModelSettings['taskCapabilityProfile']['kind'])
          }}
          className={selectClass}
        >
          <option value="default">default (chat only)</option>
          <option value="readonly-workspace">readonly workspace</option>
          <option value="shell-automation">shell automation</option>
          <option value="coding-edit">coding edit</option>
          <option value="design-build">design build</option>
        </select>
      </Field>

      {profile.kind === 'shell-automation' && (
        <Field label="Allowed shell commands" hint="Comma or newline separated executable names">
          <textarea
            value={profile.commands?.join(', ') ?? ''}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                commands: splitList(e.target.value),
              })
            }}
            placeholder="git, pnpm, node"
            className={cn(inputClass, 'min-h-20 resize-y')}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}

      {(profile.kind === 'readonly-workspace' ||
        profile.kind === 'coding-edit' ||
        profile.kind === 'design-build') && (
        <Field label="Requested scopes" hint="Saved with the run profile; defaults stay narrow">
          <input
            type="text"
            value={profile.scopes.join(', ')}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                scopes: splitList(e.target.value),
              })
            }}
            placeholder="repo:read"
            className={inputClass}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      )}

      {profile.kind === 'coding-edit' && (
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={profile.patchPolicy === 'apply-after-confirm'}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                patchPolicy: e.target.checked ? 'apply-after-confirm' : 'preview',
              })
            }}
            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900"
          />
          Allow patch apply after confirmation
        </label>
      )}

      {profile.kind === 'design-build' && (
        <label className="flex items-center gap-2 text-[11px] text-zinc-400">
          <input
            type="checkbox"
            checked={profile.artifactPolicy === 'apply-after-confirm'}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                artifactPolicy: e.target.checked ? 'apply-after-confirm' : 'preview',
              })
            }}
            className="h-3.5 w-3.5 rounded border-zinc-700 bg-zinc-900"
          />
          Allow artifact apply after confirmation
        </label>
      )}

      <Field
        label="Extension blocklist"
        hint="Comma-separated capability ids denied for runs (merged with ~/.telegraph/extension-registry.json)"
      >
        <input
          type="text"
          value={draft.extensionBlocklist.join(', ')}
          onChange={e => { onSetBlocklist(e.target.value); }}
          placeholder="telegraph-subagents"
          className={inputClass}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </div>
  )
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
          {label}
        </span>
        {hint && <span className="text-[10.5px] text-zinc-600">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

const inputClass = cn(
  'block w-full rounded-md border border-zinc-800 bg-zinc-900/60 px-2.5 py-1.5',
  'text-[12.5px] text-zinc-100 outline-none transition-colors',
  'placeholder:text-zinc-600 focus:border-zinc-600 focus:bg-zinc-900'
)

const selectClass = cn(inputClass, 'pr-8')
