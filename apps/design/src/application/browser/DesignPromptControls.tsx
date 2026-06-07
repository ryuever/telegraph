import type { JSX } from 'react'
import { Bot, Settings } from 'lucide-react'
import type { DesignConfiguredModelDescriptorSnapshot } from '@/apps/design/application/common'
import { Button } from '@/packages/ui/components/ui/button'
import { cn } from '@/packages/ui/lib/utils'

interface DesignPromptControlsProps {
  configuredModels: DesignConfiguredModelDescriptorSnapshot[]
  provider?: string
  modelId?: string
  onModelSelect?: (provider: string, modelId: string) => void
  onOpenSettings?: () => void
  compact?: boolean
  loading?: boolean
}

export function DesignPromptControls({
  configuredModels,
  provider,
  modelId,
  onModelSelect,
  onOpenSettings,
  compact = false,
  loading = false,
}: DesignPromptControlsProps): JSX.Element {
  const selectedValue = provider && modelId ? modelOptionValue(provider, modelId) : ''
  const hasSelected = configuredModels.some(model =>
    model.provider === provider && model.id === modelId
  )
  const selectValue = hasSelected ? selectedValue : ''
  const disabled = loading || configuredModels.length === 0

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div
        className={cn(
          'flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground',
          compact ? 'h-8 max-w-[220px]' : 'h-8 max-w-[320px]',
        )}
      >
        <Bot size={13} className="shrink-0" />
        <select
          value={selectValue}
          disabled={disabled}
          aria-label="Design model selection"
          title={modelSelectTitle(configuredModels, provider, modelId, loading)}
          onChange={event => {
            const next = parseModelOptionValue(event.target.value)
            if (!next) return
            onModelSelect?.(next.provider, next.modelId)
          }}
          className="min-w-0 flex-1 appearance-none bg-transparent text-xs text-foreground outline-none disabled:text-muted-foreground"
        >
          {!hasSelected && (
            <option value="">
              {loading ? 'Loading models...' : 'No configured models'}
            </option>
          )}
          {configuredModels.map(model => (
            <option key={modelOptionValue(model.provider, model.id)} value={modelOptionValue(model.provider, model.id)}>
              {model.provider} · {model.label || model.id}
            </option>
          ))}
        </select>
      </div>

      {onOpenSettings && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          title="Design settings"
          aria-label="Design settings"
          className={cn('h-8 w-8 shrink-0 rounded-md', compact && 'h-8 w-8')}
          onClick={onOpenSettings}
        >
          <Settings size={14} />
        </Button>
      )}
    </div>
  )
}

function modelOptionValue(provider: string, modelId: string): string {
  return `${encodeURIComponent(provider)}:${encodeURIComponent(modelId)}`
}

function parseModelOptionValue(value: string): { provider: string; modelId: string } | undefined {
  const separator = value.indexOf(':')
  if (separator < 0) return undefined
  return {
    provider: decodeURIComponent(value.slice(0, separator)),
    modelId: decodeURIComponent(value.slice(separator + 1)),
  }
}

function modelSelectTitle(
  configuredModels: DesignConfiguredModelDescriptorSnapshot[],
  provider?: string,
  modelId?: string,
  loading?: boolean,
): string {
  if (loading) return 'Loading models from Settings / Providers'
  if (configuredModels.length === 0) return 'Configure provider auth in Settings / Providers'
  if (!provider || !modelId) return 'Design model'
  const model = configuredModels.find(item => item.provider === provider && item.id === modelId)
  if (!model) return 'Selected model is not configured in Settings / Providers'
  return model.authLabel ? `${provider} · ${model.label} · ${model.authLabel}` : `${provider} · ${modelId}`
}
