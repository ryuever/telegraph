export type RuntimeMessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** Chat / turn messages carried in `RunInput`. */
export interface RuntimeMessage {
  id: string
  role: RuntimeMessageRole
  content: string
  status?: string
  metadata?: Record<string, unknown>
}
