import * as React from 'react'

import { cn } from '@/packages/ui/lib/utils'

export interface AgentPayloadBlockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  label: React.ReactNode
  value: unknown
  language?: string
}

export function AgentPayloadBlock({
  label,
  value,
  language,
  className,
  ...props
}: AgentPayloadBlockProps): React.JSX.Element {
  const formattedValue = React.useMemo(() => formatAgentPayload(value), [value])

  return (
    <div className={cn('min-w-0 overflow-hidden rounded-md border border-border bg-slate-950', className)} {...props}>
      <div className="flex min-h-7 items-center justify-between gap-2 border-b border-white/10 px-2.5 py-1">
        <span className="truncate text-[10px] font-medium uppercase text-slate-400">{label}</span>
        {language && <span className="font-mono text-[10px] text-slate-500">{language}</span>}
      </div>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[11px] leading-relaxed text-slate-100">
        {formattedValue}
      </pre>
    </div>
  )
}

export function formatAgentPayload(value: unknown): string {
  if (value === undefined) return ''
  if (value === null) return 'null'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    if (value instanceof Error) return value.message
    return Object.prototype.toString.call(value)
  }
}
