import * as React from 'react'
import { Check, Hand, X } from 'lucide-react'

import { Button } from '@/packages/ui/components/ui/button'
import {
  AgentActivityItem,
  type AgentActivityItemProps,
} from './AgentActivity'
import type { AgentActivityStatus } from './types'

export interface AgentHumanInteractionProps
  extends Omit<AgentActivityItemProps, 'title' | 'tone' | 'status' | 'statusLabel' | 'icon' | 'actions' | 'children'> {
  title?: React.ReactNode
  status?: AgentActivityStatus
  description?: React.ReactNode
  approveLabel?: React.ReactNode
  rejectLabel?: React.ReactNode
  onApprove?: () => void
  onReject?: () => void
  disabled?: boolean
  children?: React.ReactNode
}

export function AgentHumanInteraction({
  title = 'Needs your input',
  status = 'blocked',
  description,
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
  onApprove,
  onReject,
  disabled = false,
  defaultOpen = true,
  children,
  ...props
}: AgentHumanInteractionProps): React.JSX.Element {
  const hasActions = Boolean(onApprove || onReject)
  const hasBody = Boolean(description || children || hasActions)

  return (
    <AgentActivityItem
      title={title}
      tone="human"
      status={status}
      icon={Hand}
      defaultOpen={defaultOpen}
      {...props}
    >
      {hasBody
        ? (
          <div className="flex min-w-0 flex-col gap-3">
            {description && <div className="text-muted-foreground">{description}</div>}
            {children}
            {hasActions && (
              <div className="flex flex-wrap items-center gap-2">
                {onApprove && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={onApprove}
                    disabled={disabled}
                  >
                    <Check size={14} />
                    {approveLabel}
                  </Button>
                )}
                {onReject && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={onReject}
                    disabled={disabled}
                  >
                    <X size={14} />
                    {rejectLabel}
                  </Button>
                )}
              </div>
            )}
          </div>
        )
        : undefined}
    </AgentActivityItem>
  )
}
