import * as React from 'react'
import { Wrench } from 'lucide-react'

import {
  AgentActivityItem,
  type AgentActivityItemProps,
  type AgentActivityMeta,
} from './AgentActivity'
import { AgentPayloadBlock } from './AgentPayloadBlock'
import type { AgentActivityStatus } from './types'

export interface AgentToolCallProps
  extends Omit<AgentActivityItemProps, 'title' | 'tone' | 'status' | 'statusLabel' | 'icon' | 'children'> {
  toolName: string
  title?: React.ReactNode
  status?: AgentActivityStatus
  callId?: React.ReactNode
  durationLabel?: React.ReactNode
  input?: unknown
  output?: unknown
  error?: React.ReactNode
  summary?: React.ReactNode
  children?: React.ReactNode
}

export function AgentToolCall({
  toolName,
  title,
  status = 'running',
  callId,
  durationLabel,
  input,
  output,
  error,
  summary,
  subtitle,
  meta,
  defaultOpen,
  children,
  ...props
}: AgentToolCallProps): React.JSX.Element {
  const mergedMeta: AgentActivityMeta[] = [
    { label: 'tool', value: toolName },
    ...(callId ? [{ label: 'call', value: callId }] : []),
    ...(durationLabel ? [{ label: 'time', value: durationLabel }] : []),
    ...(meta ?? []),
  ]
  const hasBody = Boolean(summary || input !== undefined || output !== undefined || error || children)

  return (
    <AgentActivityItem
      title={title ?? toolTitle(status)}
      subtitle={subtitle}
      tone="tool"
      status={status}
      icon={Wrench}
      meta={mergedMeta}
      defaultOpen={defaultOpen ?? (status === 'running' || status === 'error')}
      {...props}
    >
      {hasBody
        ? (
          <div className="flex min-w-0 flex-col gap-2">
            {summary && <div className="text-muted-foreground">{summary}</div>}
            {input !== undefined && <AgentPayloadBlock label="Input" value={input} language="json" />}
            {output !== undefined && <AgentPayloadBlock label="Output" value={output} language="json" />}
            {error && (
              <div className="rounded-md border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-rose-200">
                {error}
              </div>
            )}
            {children}
          </div>
        )
        : undefined}
    </AgentActivityItem>
  )
}

function toolTitle(status: AgentActivityStatus): string {
  if (status === 'complete') return 'Used tool'
  if (status === 'error') return 'Tool failed'
  if (status === 'cancelled') return 'Tool cancelled'
  return 'Using tool'
}
