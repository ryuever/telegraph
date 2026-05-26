import * as React from 'react'
import { Brain } from 'lucide-react'

import {
  AgentActivityItem,
  type AgentActivityItemProps,
  type AgentActivityMeta,
} from './AgentActivity'
import { AgentStepList, type AgentStepListItem } from './AgentStepList'
import type { AgentActivityStatus } from './types'

export interface AgentReasoningProps
  extends Omit<AgentActivityItemProps, 'title' | 'tone' | 'status' | 'statusLabel' | 'icon' | 'children'> {
  title?: React.ReactNode
  status?: AgentActivityStatus
  elapsedLabel?: React.ReactNode
  summary?: React.ReactNode
  steps?: AgentStepListItem[]
  children?: React.ReactNode
}

export function AgentReasoning({
  title,
  status = 'running',
  elapsedLabel,
  subtitle,
  summary,
  steps = [],
  meta,
  defaultOpen,
  children,
  ...props
}: AgentReasoningProps): React.JSX.Element {
  const mergedMeta: AgentActivityMeta[] = [
    ...(elapsedLabel ? [{ label: 'time', value: elapsedLabel }] : []),
    ...(meta ?? []),
  ]
  const hasBody = Boolean(summary || steps.length > 0 || children)

  return (
    <AgentActivityItem
      title={title ?? (status === 'running' ? 'Thinking' : 'Reasoning')}
      subtitle={subtitle}
      tone="reasoning"
      status={status}
      icon={Brain}
      meta={mergedMeta.length > 0 ? mergedMeta : undefined}
      defaultOpen={defaultOpen ?? status === 'running'}
      {...props}
    >
      {hasBody
        ? (
          <>
            {summary && (
              <div className="mb-2 rounded-md border border-border/80 bg-background/55 px-2.5 py-2 text-muted-foreground">
                {summary}
              </div>
            )}
            {steps.length > 0 && <AgentStepList steps={steps} compact />}
            {children}
          </>
        )
        : undefined}
    </AgentActivityItem>
  )
}
