import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/packages/ui/components/ui/button'
import { cn } from '@/packages/ui/lib/utils'
import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import {
  defaultDesignProfile,
  splitSettingList,
  type DesignRuntimeSettings,
} from './design-runtime-settings'

interface DesignRuntimeSettingsDialogProps {
  open: boolean
  settings: DesignRuntimeSettings
  onClose: () => void
  onSave: (settings: DesignRuntimeSettings) => void
}

export function DesignRuntimeSettingsDialog({
  open,
  settings,
  onClose,
  onSave,
}: DesignRuntimeSettingsDialogProps): JSX.Element | null {
  const [draft, setDraft] = useState<DesignRuntimeSettings>(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  if (!open) return null

  const profile = draft.taskCapabilityProfile ?? { kind: 'default' }

  const setProfile = (taskCapabilityProfile: RuntimeTaskCapabilityProfile): void => {
    setDraft(current => ({ ...current, taskCapabilityProfile }))
  }

  const setProfileKind = (kind: RuntimeTaskCapabilityProfile['kind']): void => {
    setProfile(defaultDesignProfile(kind))
  }

  const setExtensionBlocklist = (raw: string): void => {
    setDraft(current => ({
      ...current,
      extensionBlocklist: splitSettingList(raw),
    }))
  }

  const save = (): void => {
    onSave(draft)
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Design runtime settings"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Design Settings</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">Run capability policy</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <Field label="Task capability profile" hint="Applies to the next design run">
            <select
              value={profile.kind}
              onChange={event => {
                setProfileKind(event.target.value as RuntimeTaskCapabilityProfile['kind'])
              }}
              className={selectClass}
            >
              <option value="default">default</option>
              <option value="readonly-workspace">readonly workspace</option>
              <option value="shell-automation">shell automation</option>
              <option value="coding-edit">workspace edit preview</option>
              <option value="design-build">design build preview</option>
            </select>
          </Field>

          {profile.kind === 'shell-automation' && (
            <Field label="Allowed shell commands" hint="Blank keeps command approval run-scoped">
              <input
                type="text"
                value={profile.commands?.join(', ') ?? ''}
                onChange={event => {
                  setProfile({ ...profile, commands: splitSettingList(event.target.value) })
                }}
                placeholder="git, pnpm, node"
                className={inputClass}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          {hasScopes(profile) && (
            <Field label="Requested scopes" hint="Permission broker still gates risky actions">
              <input
                type="text"
                value={profile.scopes.join(', ')}
                onChange={event => {
                  setProfile({ ...profile, scopes: splitSettingList(event.target.value) })
                }}
                placeholder="artifact:write, repo:read"
                className={inputClass}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}

          {profile.kind === 'coding-edit' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={profile.patchPolicy === 'apply-after-confirm'}
                onChange={event => {
                  setProfile({
                    ...profile,
                    patchPolicy: event.target.checked ? 'apply-after-confirm' : 'preview',
                  })
                }}
                className="h-3.5 w-3.5 rounded border-border bg-background"
              />
              Allow patch apply after confirmation
            </label>
          )}

          {profile.kind === 'design-build' && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={profile.artifactPolicy === 'apply-after-confirm'}
                onChange={event => {
                  const artifactPolicy = event.target.checked ? 'apply-after-confirm' : 'preview'
                  setProfile({
                    ...profile,
                    artifactPolicy,
                    scopes: artifactPolicy === 'apply-after-confirm'
                      ? withScope(profile.scopes, 'repo:write')
                      : profile.scopes,
                  })
                }}
                className="h-3.5 w-3.5 rounded border-border bg-background"
              />
              Allow artifact apply after confirmation
            </label>
          )}

          <Field label="Extension blocklist" hint="Comma-separated capability ids denied for runs">
            <input
              type="text"
              value={draft.extensionBlocklist?.join(', ') ?? ''}
              onChange={event => { setExtensionBlocklist(event.target.value) }}
              placeholder="telegraph-subagents"
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={save} aria-label="Save design settings">
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}

function hasScopes(
  profile: RuntimeTaskCapabilityProfile,
): profile is Extract<RuntimeTaskCapabilityProfile, { scopes: string[] }> {
  return 'scopes' in profile
}

function withScope(scopes: string[], scope: string): string[] {
  return scopes.includes(scope) ? scopes : [...scopes, scope]
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}): JSX.Element {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-3">
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
  'placeholder:text-muted-foreground focus:border-ring',
)

const selectClass = cn(inputClass, 'appearance-none')
