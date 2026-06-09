import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@/packages/ui/lib/utils'
import {
  type ChatModelSettings,
  getConfiguredProviderOptions,
  getConfiguredModelOptions,
} from '../model-settings'
import {
  capabilitySupport,
  listRuntimeCapabilityDescriptors,
  type RuntimeCapabilityDescriptor,
  type RuntimeCapabilitySupport,
} from '@/packages/agent/runtime/RuntimeCapabilityDescriptor'
import type { ChatRuntimeCapabilityDescriptorSnapshot } from '@/apps/chat/application/common'
import type { ChatConfiguredModelDescriptorSnapshot } from '@/apps/chat/application/common'

interface Props {
  open: boolean
  settings: ChatModelSettings
  runtimeCapabilities?: ChatRuntimeCapabilityDescriptorSnapshot[]
  configuredModels?: ChatConfiguredModelDescriptorSnapshot[]
  onClose: () => void
  onSave: (next: ChatModelSettings) => void
}

type SettingsTab = 'model' | 'orchestration' | 'extensions'

const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'model', label: 'Model' },
  { id: 'orchestration', label: 'Orchestration' },
  { id: 'extensions', label: 'Extensions' },
]

export function ChatSettingsDialog({
  open,
  settings,
  runtimeCapabilities,
  configuredModels = [],
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<ChatModelSettings>(settings)
  const [activeTab, setActiveTab] = useState<SettingsTab>('model')

  useEffect(() => {
    if (open) {
      setDraft(settings)
    }
  }, [open, settings])

  const provider = draft.provider
  const providerOptions = useMemo(
    () => getConfiguredProviderOptions(configuredModels),
    [configuredModels]
  )
  const modelOptions = useMemo(
    () => getConfiguredModelOptions(provider, configuredModels),
    [configuredModels, provider]
  )
  const capabilityDescriptors = useMemo(
    () => runtimeCapabilities && runtimeCapabilities.length > 0
      ? runtimeCapabilities
      : listRuntimeCapabilityDescriptors(),
    [runtimeCapabilities]
  )
  const selectedRuntime = useMemo(
    () => findEffectiveRuntimeDescriptor(capabilityDescriptors, draft),
    [capabilityDescriptors, draft]
  )

  if (!open) return null

  const setProvider = (next: string) => {
    const firstModel = configuredModels.find(m => m.provider === next)
    setDraft(d => ({
      ...d,
      provider: next,
      modelId: firstModel?.id ?? d.modelId,
    }))
  }

  const setModel = (id: string) => { setDraft(d => ({ ...d, modelId: id })); }
  const setBackend = (backend: ChatModelSettings['backend']) =>
    { setDraft(d => ({ ...d, backend })); }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 px-4 backdrop-blur-sm"
      onMouseDown={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-md border border-border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div className="flex items-center gap-3">
            <h2 className="text-[13.5px] font-semibold text-foreground">Settings</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex border-b border-border px-5">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => { setActiveTab(tab.id); }}
              className={cn(
                'relative px-3 py-2 text-[11.5px] font-medium transition-colors',
                activeTab === tab.id
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 -bottom-px h-px bg-primary" />
              )}
            </button>
          ))}
        </div>

        <div className="px-5 py-4">
          {activeTab === 'model' && (
            <ModelTab
              draft={draft}
              providerOptions={providerOptions}
              modelOptions={modelOptions}
              configuredModelCount={configuredModels.length}
              runtimeCapabilities={capabilityDescriptors}
              selectedRuntime={selectedRuntime}
              onSetProvider={setProvider}
              onSetModel={setModel}
              onSetBackend={setBackend}
            />
          )}
          {activeTab === 'orchestration' && (
            <OrchestrationTab
              draft={draft}
              selectedRuntime={selectedRuntime}
              onSetOrchestration={setOrchestration}
              onSetOrchestrationPattern={setOrchestrationPattern}
              onSetWorktreeIsolation={setWorktreeIsolation}
            />
          )}
          {activeTab === 'extensions' && (
            <ExtensionsTab
              draft={draft}
              selectedRuntime={selectedRuntime}
              onSetBlocklist={setExtensionBlocklistText}
              onSetTaskCapabilityProfile={setTaskCapabilityProfile}
            />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {configuredModels.length} configured model(s)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-[12.5px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-primary px-3 py-1.5 text-[12.5px] font-medium text-primary-foreground hover:bg-primary/90"
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
  providerOptions,
  modelOptions,
  configuredModelCount,
  runtimeCapabilities,
  selectedRuntime,
  onSetProvider,
  onSetModel,
  onSetBackend,
}: {
  draft: ChatModelSettings
  providerOptions: { id: string; label: string; authLabel?: string }[]
  modelOptions: ChatConfiguredModelDescriptorSnapshot[]
  configuredModelCount: number
  runtimeCapabilities: RuntimeCapabilityDescriptor[]
  selectedRuntime?: RuntimeCapabilityDescriptor
  onSetProvider: (id: string) => void
  onSetModel: (id: string) => void
  onSetBackend: (backend: ChatModelSettings['backend']) => void
}) {
  return (
    <div className="space-y-4">
      {configuredModelCount === 0 && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          No configured provider models are available yet. Add provider auth in Settings / Providers.
        </div>
      )}

      <Field label="Provider">
        <select
          value={draft.provider}
          onChange={e => { onSetProvider(e.target.value); }}
          className={selectClass}
          disabled={providerOptions.length === 0}
        >
          {providerOptions.map(p => (
            <option key={p.id} value={p.id}>
              {p.authLabel ? `${p.label} (${p.authLabel})` : p.label}
            </option>
          ))}
          {!providerOptions.some(provider => provider.id === draft.provider) && (
            <option value={draft.provider} disabled>
              {draft.provider} (not configured)
            </option>
          )}
        </select>
      </Field>

      <Field label="Model">
        <select
          value={draft.modelId}
          onChange={e => { onSetModel(e.target.value); }}
          className={selectClass}
          disabled={modelOptions.length === 0}
        >
          {modelOptions.map(m => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
          {!modelOptions.some(model => model.id === draft.modelId) && (
            <option value={draft.modelId} disabled>
              {draft.modelId} (not configured)
            </option>
          )}
        </select>
      </Field>

      <Field label="Execution backend">
        <select
          value={draft.backend}
          onChange={e => { onSetBackend(e.target.value); }}
          className={selectClass}
        >
          {runtimeCapabilities.map(runtime => (
            <option key={runtime.id} value={runtime.id} disabled={!runtime.selectable}>
              {runtime.label} ({runtime.maturity})
            </option>
          ))}
          {!runtimeCapabilities.some(runtime => runtime.id === draft.backend) && (
            <option value={draft.backend} disabled>
              {draft.backend} (not available)
            </option>
          )}
          <option value="langgraph" disabled>langgraph (not validated)</option>
          <option value="vercel-ai" disabled>vercel-ai (not validated)</option>
        </select>
      </Field>

      <RuntimeCapabilityMatrix descriptor={selectedRuntime} />
    </div>
  )
}

function OrchestrationTab({
  draft,
  selectedRuntime,
  onSetOrchestration,
  onSetOrchestrationPattern,
  onSetWorktreeIsolation,
}: {
  draft: ChatModelSettings
  selectedRuntime?: RuntimeCapabilityDescriptor
  onSetOrchestration: (v: ChatModelSettings['orchestration']) => void
  onSetOrchestrationPattern: (v: ChatModelSettings['orchestrationPattern']) => void
  onSetWorktreeIsolation: (v: boolean) => void
}) {
  const childRunSupport = capabilitySupport(selectedRuntime, 'childRun')
  const selectedRuntimeBlocksChildRuns = draft.orchestration !== 'telegraph-subagents' && childRunSupport === 'unsupported'

  return (
    <div className="space-y-4">
      <Field label="Orchestration mode">
        <select
          value={draft.orchestration}
          onChange={e =>
            { onSetOrchestration(e.target.value); }
          }
          className={selectClass}
        >
          <option value="none">none</option>
          <option value="telegraph-subagents">Team Router v0</option>
        </select>
      </Field>

      {selectedRuntimeBlocksChildRuns && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Current backend does not emit child runs. Select Team Router v0 to enable routed
          child-agent execution.
        </div>
      )}

      {draft.orchestration === 'telegraph-subagents' && (
        <>
          <Field label="Router preference">
            <select
              value={draft.orchestrationPattern}
              onChange={e =>
                { onSetOrchestrationPattern(
                  e.target.value as ChatModelSettings['orchestrationPattern']
                ); }
              }
              className={selectClass}
            >
              <option value="chain">review handoff</option>
              <option value="parallel">parallel specialists</option>
            </select>
          </Field>

          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={draft.worktreeIsolation}
              onChange={e => { onSetWorktreeIsolation(e.target.checked); }}
              className="h-3.5 w-3.5 rounded border-border bg-background"
            />
            Enable worktree isolation hint (recommended for parallel code edits)
          </label>

          <div className="text-[11px] text-muted-foreground">
            Uses Telegraph native agent profiles from `~/.telegraph/agents` and project
            `.telegraph/agents`. The router chooses direct, clarify, single, parallel, or review.
          </div>
        </>
      )}
    </div>
  )
}

function ExtensionsTab({
  draft,
  selectedRuntime,
  onSetBlocklist,
  onSetTaskCapabilityProfile,
}: {
  draft: ChatModelSettings
  selectedRuntime?: RuntimeCapabilityDescriptor
  onSetBlocklist: (raw: string) => void
  onSetTaskCapabilityProfile: (profile: ChatModelSettings['taskCapabilityProfile']) => void
}) {
  const profile = draft.taskCapabilityProfile
  const supportsReadonly = capabilitySupport(selectedRuntime, 'filesystem') !== 'unsupported'
  const supportsShell = capabilitySupport(selectedRuntime, 'shell') !== 'unsupported'
  const supportsPatch = capabilitySupport(selectedRuntime, 'patch') !== 'unsupported'
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
          <option value="readonly-workspace" disabled={!supportsReadonly}>readonly workspace</option>
          <option value="shell-automation" disabled={!supportsShell}>shell automation</option>
          <option value="coding-edit" disabled={!supportsPatch}>coding edit</option>
          <option value="design-build" disabled={!supportsReadonly}>design build</option>
        </select>
      </Field>

      {profile.kind !== 'default' && (
        <div className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
          Risky capabilities remain gated by the permission broker. Renderer approval is Phase D;
          unsupported profiles are disabled for the selected runtime.
        </div>
      )}

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
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={profile.patchPolicy === 'apply-after-confirm'}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                patchPolicy: e.target.checked ? 'apply-after-confirm' : 'preview',
              })
            }}
            className="h-3.5 w-3.5 rounded border-border bg-background"
          />
          Allow patch apply after confirmation
        </label>
      )}

      {profile.kind === 'design-build' && (
        <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={profile.artifactPolicy === 'apply-after-confirm'}
            onChange={e => {
              onSetTaskCapabilityProfile({
                ...profile,
                artifactPolicy: e.target.checked ? 'apply-after-confirm' : 'preview',
              })
            }}
            className="h-3.5 w-3.5 rounded border-border bg-background"
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

function RuntimeCapabilityMatrix({ descriptor }: { descriptor?: RuntimeCapabilityDescriptor }) {
  if (!descriptor) {
    return (
      <div className="rounded-md border border-border bg-muted px-3 py-2 text-[11px] text-muted-foreground">
        Runtime capability descriptor is not available.
      </div>
    )
  }

  return (
    <section className="rounded-md border border-border bg-background p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-semibold text-foreground">{descriptor.label}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[9.5px] uppercase', maturityClass(descriptor.maturity))}>
              {descriptor.maturity}
            </span>
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{descriptor.summary}</p>
        </div>
        <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[9.5px] uppercase text-muted-foreground">
          {descriptor.productLayer}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {descriptor.capabilities.map(item => (
          <div
            key={item.key}
            title={item.note}
            className={cn(
              'min-w-0 rounded-md border px-2 py-1',
              supportClass(item.support)
            )}
          >
            <div className="truncate text-[10.5px] font-medium">{item.label}</div>
            <div className="text-[9.5px] uppercase opacity-80">{supportLabel(item.support)}</div>
          </div>
        ))}
      </div>
      {descriptor.limitations.length > 0 && (
        <ul className="mt-2 space-y-1 text-[10.5px] leading-relaxed text-muted-foreground">
          {descriptor.limitations.map(item => (
            <li key={item}>- {item}</li>
          ))}
        </ul>
      )}
    </section>
  )
}

function findEffectiveRuntimeDescriptor(
  descriptors: RuntimeCapabilityDescriptor[],
  settings: ChatModelSettings,
): RuntimeCapabilityDescriptor | undefined {
  const runtimeId = settings.orchestration === 'telegraph-subagents'
    ? 'telegraph-subagents'
    : settings.backend
  return descriptors.find(item => item.id === runtimeId)
}

function supportLabel(support: RuntimeCapabilitySupport): string {
  if (support === 'supported') return 'yes'
  if (support === 'partial') return 'partial'
  return 'no'
}

function supportClass(support: RuntimeCapabilitySupport): string {
  if (support === 'supported') return 'border-emerald-200 bg-emerald-50 text-emerald-700'
  if (support === 'partial') return 'border-amber-200 bg-amber-50 text-amber-700'
  return 'border-border bg-muted text-muted-foreground'
}

function maturityClass(maturity: RuntimeCapabilityDescriptor['maturity']): string {
  if (maturity === 'ready') return 'bg-emerald-100 text-emerald-700'
  if (maturity === 'scaffold') return 'bg-amber-100 text-amber-700'
  return 'bg-accent text-primary'
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
        <span className="text-[11px] font-medium uppercase text-muted-foreground">
          {label}
        </span>
        {hint && <span className="text-[10.5px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </label>
  )
}

const inputClass = cn(
  'block w-full rounded-md border border-border bg-background px-2.5 py-1.5',
  'text-[12.5px] text-foreground outline-none transition-colors',
  'placeholder:text-muted-foreground/70 focus:border-primary/45 focus:bg-card'
)

const selectClass = cn(inputClass, 'pr-8')
