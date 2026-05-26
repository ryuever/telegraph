import type { LucideIcon } from 'lucide-react'

export type AgentActivityStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'error'
  | 'blocked'
  | 'cancelled'

export type AgentActivityTone =
  | 'neutral'
  | 'reasoning'
  | 'tool'
  | 'result'
  | 'human'
  | 'workflow'
  | 'model'

export type AgentActivityIcon = LucideIcon

