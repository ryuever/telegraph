import * as React from 'react'
import { ListChecks } from 'lucide-react'

import {
  AgentActivityItem,
  type AgentActivityItemProps,
} from './AgentActivity'
import { AgentStepList, type AgentStepListItem } from './AgentStepList'
import type { AgentActivityStatus } from './types'

export interface AgentPlanProps
  extends Omit<AgentActivityItemProps, 'title' | 'tone' | 'status' | 'statusLabel' | 'icon' | 'children'> {
  title?: React.ReactNode
  status?: AgentActivityStatus
  steps: AgentStepListItem[]
  ordered?: boolean
  children?: React.ReactNode
}

export function AgentPlan({
  title = 'Plan',
  status = 'running',
  steps,
  ordered = true,
  defaultOpen,
  children,
  ...props
}: AgentPlanProps): React.JSX.Element {
  const hasBody = Boolean(steps.length > 0 || children)

  return (
    <AgentActivityItem
      title={title}
      tone="workflow"
      status={status}
      icon={ListChecks}
      defaultOpen={defaultOpen ?? status !== 'complete'}
      {...props}
    >
      {hasBody
        ? (
          <div className="flex min-w-0 flex-col gap-2">
            <AgentStepList steps={steps} ordered={ordered} />
            {children}
          </div>
        )
        : undefined}
    </AgentActivityItem>
  )
}
