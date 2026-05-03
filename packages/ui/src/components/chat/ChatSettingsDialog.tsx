import React, { useEffect, useMemo, useState } from 'react'
import { cn } from '@telegraph/ui/lib/utils'
import {
  MINIMAX_OPENAI_BASE_URL,
  MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
} from '@telegraph/agent'
import { CATALOG, type ChatModelSettings } from './model-settings'

interface Props {
  open: boolean
  settings: ChatModelSettings
  onClose: () => void
  onSave: (next: ChatModelSettings) => void
}

export function ChatSettingsDialog({ open, settings, onClose, onSave }: Props) {
  const [draft, setDraft] = useState<ChatModelSettings>(settings)

  useEffect(() => {
    if (open) setDraft(settings)
  }, [open, settings])

  const provider = draft.provider
  const per = draft.byProvider[provider] ?? { apiKey: '', baseUrl: '' }

  const providerOptions = useMemo(() => {
    const seen = new Set<string>()
    const list: { id: string; label: string }[] = []
    for (const m of CATALOG) {
      if (seen.has(m.provider)) continue
      seen.add(m.provider)
      list.push({ id: m.provider, label: m.provider })
    }
    return list
  }, [])

  const modelOptions = useMemo(
    () => CATALOG.filter(m => m.provider === provider),
    [provider]
  )

  if (!open) return null

  const setProvider = (next: string) => {
    const firstModel = CATALOG.find(m => m.provider === next)
    setDraft(d => ({
      ...d,
      provider: next,
      modelId: firstModel?.id ?? d.modelId,
      byProvider: {
        ...d.byProvider,
        [next]: d.byProvider[next] ?? {
          apiKey: '',
          baseUrl: next === MINIMAX_OPENAI_COMPAT_PROVIDER_ID ? MINIMAX_OPENAI_BASE_URL : undefined,
        },
      },
    }))
  }

  const setModel = (id: string) => setDraft(d => ({ ...d, modelId: id }))

  const setApiKey = (key: string) =>
    setDraft(d => ({
      ...d,
      byProvider: { ...d.byProvider, [provider]: { ...per, apiKey: key } },
    }))

  const setBaseUrl = (url: string) =>
    setDraft(d => ({
      ...d,
      byProvider: { ...d.byProvider, [provider]: { ...per, baseUrl: url || undefined } },
    }))

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
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3.5">
          <h2 className="text-[13.5px] font-semibold tracking-tight text-zinc-100">
            Chat model settings
          </h2>
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

        <div className="space-y-4 px-5 py-4">
          <Field label="Provider">
            <select
              value={provider}
              onChange={e => setProvider(e.target.value)}
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
            <select
              value={draft.modelId}
              onChange={e => setModel(e.target.value)}
              className={selectClass}
            >
              {modelOptions.map(m => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>

          <Field label="API key">
            <input
              type="password"
              value={per.apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="sk-…"
              className={inputClass}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {provider === MINIMAX_OPENAI_COMPAT_PROVIDER_ID && (
            <Field
              label="Base URL"
              hint={`Default: ${MINIMAX_OPENAI_BASE_URL}`}
            >
              <input
                type="text"
                value={per.baseUrl ?? ''}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder={MINIMAX_OPENAI_BASE_URL}
                className={inputClass}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
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
  )
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
