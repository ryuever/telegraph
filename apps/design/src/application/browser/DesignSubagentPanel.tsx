import type { JSX } from 'react'
import { Network, Square, Wrench } from 'lucide-react'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignSubagentViewItem } from './design-subagent-projector'

export interface DesignSubagentPanelProps {
  items: DesignSubagentViewItem[]
  onCancel: (childRunId: string) => void
}

export function DesignSubagentPanel({
  items,
  onCancel,
}: DesignSubagentPanelProps): JSX.Element {
  if (items.length === 0) return <></>

  const activeCount = items.filter(item => item.status === 'queued' || item.status === 'running').length
  const failedCount = items.filter(item => item.status === 'error').length

  return (
    <div className="shrink-0 border-b border-border bg-background px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-foreground">
          <Network size={13} className="shrink-0 text-muted-foreground" />
          <span className="truncate">Subagents</span>
        </div>
        <div className="shrink-0 text-[10px] text-muted-foreground">
          {String(activeCount)} active / {String(items.length)} total{failedCount > 0 ? ` / ${String(failedCount)} failed` : ''}
        </div>
      </div>
      <div className="max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {items.map(item => (
          <div
            key={item.id}
            className="grid grid-cols-[14px_minmax(0,1fr)_auto] items-start gap-2 rounded-md border border-border bg-card px-2 py-2"
          >
            <span className={subagentStatusDotClassName(item.status)} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <div className="truncate text-xs font-medium text-foreground">{item.label}</div>
                {item.stage && (
                  <span className="shrink-0 rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {item.stage}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                {item.detail ?? item.task ?? item.profileId ?? item.id}
              </div>
              {(item.toolUses ?? 0) > 0 && (
                <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Wrench size={10} />
                  <span>{String(item.toolUses)} tools</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {subagentStatusLabel(item.status)}
              </span>
              {item.cancellable && (
                <button
                  type="button"
                  title="Stop subagent"
                  aria-label={`Stop subagent ${item.label}`}
                  onClick={() => { onCancel(item.id) }}
                  className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground"
                >
                  <Square size={11} />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function subagentStatusDotClassName(status: DesignSubagentViewItem['status']): string {
  return cn(
    'mt-1.5 h-2 w-2 shrink-0 rounded-full',
    status === 'completed' && 'bg-emerald-500',
    status === 'error' && 'bg-destructive',
    status === 'stopped' && 'bg-muted-foreground',
    status === 'queued' && 'bg-sky-500',
    status === 'running' && 'bg-amber-500',
  )
}

function subagentStatusLabel(status: DesignSubagentViewItem['status']): string {
  if (status === 'queued') return '排队'
  if (status === 'running') return '运行中'
  if (status === 'completed') return '完成'
  if (status === 'error') return '失败'
  return '停止'
}
