import * as React from 'react'

import { cn } from '@/packages/ui/lib/utils'
import { AgentActivityStatusIcon } from './AgentActivity'
import type { AgentActivityStatus } from './types'

export interface AgentStepListItem {
  id: string
  label: React.ReactNode
  description?: React.ReactNode
  status?: AgentActivityStatus
  meta?: React.ReactNode
}

export interface AgentStepListProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: AgentStepListItem[]
  ordered?: boolean
  compact?: boolean
}

export function AgentStepList({
  steps,
  ordered = false,
  compact = false,
  className,
  ...props
}: AgentStepListProps): React.JSX.Element | null {
  if (steps.length === 0) return null

  return (
    <div className={cn('min-w-0', className)} {...props}>
      <ol className={cn('flex min-w-0 flex-col', compact ? 'gap-1.5' : 'gap-2')}>
        {steps.map((step, index) => {
          const status = step.status ?? 'pending'
          return (
            <li key={step.id} className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-2">
              <span
                className={cn(
                  'mt-0.5 flex size-5 items-center justify-center rounded-md border text-[10px] tabular-nums',
                  status === 'running' && 'border-amber-400/25 bg-amber-400/10 text-amber-200',
                  status === 'complete' && 'border-accent-mint/25 bg-accent-mint/10 text-accent-mint',
                  status === 'error' && 'border-destructive/35 bg-destructive/10 text-rose-200',
                  status === 'blocked' && 'border-primary/30 bg-primary/10 text-primary',
                  (status === 'pending' || status === 'cancelled') && 'border-border bg-surface-soft text-muted-foreground',
                )}
              >
                {ordered && status === 'pending'
                  ? String(index + 1)
                  : <AgentActivityStatusIcon status={status} size={11} />}
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-[12.5px] font-medium text-foreground">{step.label}</span>
                  {step.meta && (
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{step.meta}</span>
                  )}
                </span>
                {step.description && (
                  <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted-foreground">
                    {step.description}
                  </span>
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

