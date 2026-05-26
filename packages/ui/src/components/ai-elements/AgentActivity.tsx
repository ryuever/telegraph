import * as React from 'react'
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Circle,
  CircleSlash2,
  Hand,
  ListChecks,
  Loader2,
  PauseCircle,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react'

import { cn } from '@/packages/ui/lib/utils'
import type { AgentActivityIcon, AgentActivityStatus, AgentActivityTone } from './types'

interface ToneVisual {
  icon: AgentActivityIcon
  iconClassName: string
  cardClassName: string
}

interface StatusVisual {
  label: string
  icon: AgentActivityIcon
  badgeClassName: string
  iconClassName?: string
}

const toneVisuals: Record<AgentActivityTone, ToneVisual> = {
  neutral: {
    icon: Bot,
    iconClassName: 'border-border bg-surface-soft text-muted-foreground',
    cardClassName: 'border-border bg-card/80',
  },
  reasoning: {
    icon: Brain,
    iconClassName: 'border-accent-lilac/25 bg-accent-lilac/10 text-accent-lilac',
    cardClassName: 'border-accent-lilac/20 bg-card/80',
  },
  tool: {
    icon: Wrench,
    iconClassName: 'border-cyan-400/25 bg-cyan-400/10 text-cyan-200',
    cardClassName: 'border-cyan-400/20 bg-card/80',
  },
  result: {
    icon: CheckCircle2,
    iconClassName: 'border-accent-mint/25 bg-accent-mint/10 text-accent-mint',
    cardClassName: 'border-accent-mint/20 bg-card/80',
  },
  human: {
    icon: Hand,
    iconClassName: 'border-primary/30 bg-primary/10 text-primary',
    cardClassName: 'border-primary/25 bg-card/80',
  },
  workflow: {
    icon: ListChecks,
    iconClassName: 'border-sky-400/25 bg-sky-400/10 text-sky-200',
    cardClassName: 'border-sky-400/20 bg-card/80',
  },
  model: {
    icon: Sparkles,
    iconClassName: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    cardClassName: 'border-amber-400/20 bg-card/80',
  },
}

const statusVisuals: Record<AgentActivityStatus, StatusVisual> = {
  pending: {
    label: 'Pending',
    icon: Circle,
    badgeClassName: 'border-border bg-surface-soft text-muted-foreground',
  },
  running: {
    label: 'Running',
    icon: Loader2,
    badgeClassName: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
    iconClassName: 'animate-spin',
  },
  complete: {
    label: 'Complete',
    icon: CheckCircle2,
    badgeClassName: 'border-accent-mint/25 bg-accent-mint/10 text-accent-mint',
  },
  error: {
    label: 'Error',
    icon: XCircle,
    badgeClassName: 'border-destructive/35 bg-destructive/10 text-rose-200',
  },
  blocked: {
    label: 'Needs input',
    icon: PauseCircle,
    badgeClassName: 'border-primary/30 bg-primary/10 text-primary',
  },
  cancelled: {
    label: 'Cancelled',
    icon: CircleSlash2,
    badgeClassName: 'border-border bg-muted text-muted-foreground',
  },
}

export interface AgentActivityMeta {
  label?: string
  value: React.ReactNode
}

export interface AgentActivityProps extends React.HTMLAttributes<HTMLUListElement> {
  density?: 'default' | 'compact'
}

export function AgentActivity({
  className,
  density = 'default',
  ...props
}: AgentActivityProps): React.JSX.Element {
  return (
    <ul
      role="list"
      className={cn(
        'flex min-w-0 flex-col [&>li:last-child_[data-agent-rail-line]]:hidden',
        density === 'default' ? 'gap-2.5' : 'gap-1.5',
        className,
      )}
      {...props}
    />
  )
}

export interface AgentActivityItemProps extends Omit<React.HTMLAttributes<HTMLLIElement>, 'title'> {
  title: React.ReactNode
  subtitle?: React.ReactNode
  tone?: AgentActivityTone
  status?: AgentActivityStatus
  statusLabel?: string
  icon?: AgentActivityIcon
  meta?: AgentActivityMeta[]
  actions?: React.ReactNode
  contentClassName?: string
  collapsible?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
}

export function AgentActivityItem({
  title,
  subtitle,
  tone = 'neutral',
  status = 'pending',
  statusLabel,
  icon,
  meta,
  actions,
  contentClassName,
  collapsible,
  open,
  defaultOpen = false,
  onOpenChange,
  children,
  className,
  ...props
}: AgentActivityItemProps): React.JSX.Element {
  const toneVisual = toneVisuals[tone]
  const ToneIcon = icon ?? toneVisual.icon
  const contentId = React.useId()
  const hasContent = React.Children.count(children) > 0
  const canToggle = hasContent && (collapsible ?? true)
  const [isOpen, setIsOpen] = useControllableOpen({ open, defaultOpen, onOpenChange })

  const headerContent = (
    <>
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-md border',
          toneVisual.iconClassName,
        )}
      >
        <ToneIcon size={13} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium leading-5 text-foreground">{title}</span>
          {subtitle && (
            <span className="min-w-0 truncate text-[11px] leading-5 text-muted-foreground">{subtitle}</span>
          )}
        </span>
        {meta && meta.length > 0 && (
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] leading-4 text-muted-foreground">
            {meta.map((item, index) => (
              <span key={String(index)} className="inline-flex min-w-0 items-center gap-1">
                {item.label && <span className="uppercase text-muted-foreground/75">{item.label}</span>}
                <span className="min-w-0 truncate font-mono">{item.value}</span>
              </span>
            ))}
          </span>
        )}
      </span>
      <AgentActivityStatusBadge status={status} label={statusLabel} />
      {canToggle && (
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={cn(
            'shrink-0 text-muted-foreground transition-transform duration-150',
            !isOpen && '-rotate-90',
          )}
        />
      )}
    </>
  )

  return (
    <li className={cn('grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-2', className)} {...props}>
      <div className="relative flex justify-center pt-3">
        <span
          data-agent-rail-line
          className="absolute bottom-[-0.875rem] top-7 w-px bg-border/80"
        />
        <span
          className={cn(
            'relative z-10 flex size-4 items-center justify-center rounded-full border bg-background',
            status === 'running' && 'border-amber-400/35 text-amber-200',
            status === 'complete' && 'border-accent-mint/35 text-accent-mint',
            status === 'error' && 'border-destructive/45 text-rose-200',
            status === 'blocked' && 'border-primary/40 text-primary',
            (status === 'pending' || status === 'cancelled') && 'border-border text-muted-foreground',
          )}
        >
          <AgentActivityStatusIcon status={status} size={10} />
        </span>
      </div>

      <div className={cn('min-w-0 rounded-md border shadow-sm', toneVisual.cardClassName)}>
        {canToggle ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-controls={contentId}
            onClick={() => { setIsOpen(!isOpen); }}
            className="flex min-h-10 w-full min-w-0 items-center gap-2 rounded-md px-2.5 py-2 text-left outline-none transition-colors hover:bg-surface-soft/60 focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {headerContent}
          </button>
        ) : (
          <div className="flex min-h-10 min-w-0 items-center gap-2 px-2.5 py-2">
            {headerContent}
          </div>
        )}

        {actions && (
          <div className="border-t border-border/80 px-2.5 py-2">
            {actions}
          </div>
        )}

        {hasContent && (!canToggle || isOpen) && (
          <div
            id={contentId}
            className={cn(
              'min-w-0 border-t border-border/80 px-3 py-2.5 text-[12.5px] leading-relaxed text-foreground/90',
              contentClassName,
            )}
          >
            {children}
          </div>
        )}
      </div>
    </li>
  )
}

export interface AgentActivityStatusBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  status: AgentActivityStatus
  label?: string
}

export function AgentActivityStatusBadge({
  status,
  label,
  className,
  ...props
}: AgentActivityStatusBadgeProps): React.JSX.Element {
  const visual = statusVisuals[status]
  const StatusIcon = visual.icon
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 rounded border px-1.5 text-[9.5px] font-medium uppercase leading-none',
        visual.badgeClassName,
        className,
      )}
      {...props}
    >
      <StatusIcon size={11} className={visual.iconClassName} />
      {label ?? visual.label}
    </span>
  )
}

export interface AgentActivityStatusIconProps extends React.SVGAttributes<SVGSVGElement> {
  status: AgentActivityStatus
  size?: number
}

export function AgentActivityStatusIcon({
  status,
  className,
  size = 12,
  ...props
}: AgentActivityStatusIconProps): React.JSX.Element {
  const visual = statusVisuals[status]
  const StatusIcon = visual.icon
  return <StatusIcon size={size} className={cn(visual.iconClassName, className)} {...props} />
}

export function getAgentActivityStatusLabel(status: AgentActivityStatus): string {
  return statusVisuals[status].label
}

interface ControllableOpenOptions {
  open?: boolean
  defaultOpen: boolean
  onOpenChange?: (open: boolean) => void
}

function useControllableOpen({
  open,
  defaultOpen,
  onOpenChange,
}: ControllableOpenOptions): [boolean, (open: boolean) => void] {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen)
  const isControlled = open !== undefined
  const value = isControlled ? open : uncontrolledOpen

  const setValue = React.useCallback((nextOpen: boolean) => {
    if (!isControlled) setUncontrolledOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }, [isControlled, onOpenChange])

  return [value, setValue]
}

