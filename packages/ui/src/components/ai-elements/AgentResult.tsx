import * as React from 'react'
import { CheckCircle2, FileText } from 'lucide-react'

import { cn } from '@/packages/ui/lib/utils'
import {
  AgentActivityItem,
  type AgentActivityItemProps,
} from './AgentActivity'
import type { AgentActivityStatus } from './types'

export interface AgentResultArtifact {
  id: string
  name: React.ReactNode
  path?: React.ReactNode
  delta?: React.ReactNode
  status?: React.ReactNode
}

export interface AgentResultProps
  extends Omit<AgentActivityItemProps, 'title' | 'tone' | 'status' | 'statusLabel' | 'icon' | 'children'> {
  title?: React.ReactNode
  status?: AgentActivityStatus
  description?: React.ReactNode
  artifacts?: AgentResultArtifact[]
  children?: React.ReactNode
}

export function AgentResult({
  title = 'Result',
  status = 'complete',
  description,
  artifacts = [],
  defaultOpen,
  children,
  ...props
}: AgentResultProps): React.JSX.Element {
  const hasBody = Boolean(description || artifacts.length > 0 || children)

  return (
    <AgentActivityItem
      title={title}
      tone="result"
      status={status}
      icon={CheckCircle2}
      defaultOpen={defaultOpen ?? status !== 'complete'}
      {...props}
    >
      {hasBody
        ? (
          <div className="flex min-w-0 flex-col gap-2">
            {description && <div className="text-muted-foreground">{description}</div>}
            {artifacts.length > 0 && (
              <ul className="divide-y divide-border overflow-hidden rounded-md border border-border bg-background/55">
                {artifacts.map(artifact => (
                  <li key={artifact.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-2 px-2.5 py-2">
                    <FileText size={14} className="mt-0.5 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-medium text-foreground">{artifact.name}</span>
                      {artifact.path && (
                        <span className="block truncate font-mono text-[10.5px] text-muted-foreground">{artifact.path}</span>
                      )}
                    </span>
                    {(artifact.delta || artifact.status) && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {artifact.delta && (
                          <span className="rounded bg-accent-mint/10 px-1.5 py-0.5 font-mono text-[10px] text-accent-mint">
                            {artifact.delta}
                          </span>
                        )}
                        {artifact.status && (
                          <span className={cn('rounded bg-surface-soft px-1.5 py-0.5 text-[10px] text-muted-foreground')}>
                            {artifact.status}
                          </span>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {children}
          </div>
        )
        : undefined}
    </AgentActivityItem>
  )
}
