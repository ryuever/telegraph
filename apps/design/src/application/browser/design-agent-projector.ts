import type { AgentEvent } from '@/packages/agent-protocol'

export type DesignAgentRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface DesignProjectedArtifact {
  id: string
  kind: string
  title?: string
  output: unknown
  sourceEventType: AgentEvent['type']
}

export interface DesignAgentProjectionHandlers {
  onStatus?: (status: DesignAgentRunStatus, event: AgentEvent) => void
  onAssistantText?: (text: string, event: AgentEvent) => void
  onArtifact?: (artifact: DesignProjectedArtifact, event: AgentEvent) => void
  onTraceEvent?: (event: AgentEvent) => void
}

export function projectAgentEventToDesign(event: AgentEvent, handlers: DesignAgentProjectionHandlers): void {
  handlers.onTraceEvent?.(event)

  switch (event.type) {
    case 'run_started':
      handlers.onStatus?.('running', event)
      return

    case 'assistant_delta':
      if (event.text) handlers.onAssistantText?.(event.text, event)
      return

    case 'assistant_message':
      if (event.message.role === 'assistant' && event.message.content) {
        handlers.onAssistantText?.(event.message.content, event)
      }
      emitArtifact(event.message.metadata, event, handlers)
      return

    case 'tool_result':
      emitArtifact(event.output, event, handlers)
      return

    case 'run_completed':
      handlers.onStatus?.('completed', event)
      emitArtifact(event.output, event, handlers)
      return

    case 'run_failed':
      handlers.onStatus?.('failed', event)
      return

    case 'run_cancelled':
      handlers.onStatus?.('cancelled', event)
      return

    default:
      return
  }
}

function emitArtifact(output: unknown, event: AgentEvent, handlers: DesignAgentProjectionHandlers): void {
  const artifact = projectArtifact(output, event.type)
  if (artifact) handlers.onArtifact?.(artifact, event)
}

export function projectArtifact(output: unknown, sourceEventType: AgentEvent['type']): DesignProjectedArtifact | null {
  const candidate = artifactCandidate(output)
  if (!candidate) return null

  const id = stringField(candidate, 'id') ?? stringField(candidate, 'artifactId')
  const kind = stringField(candidate, 'kind') ?? stringField(candidate, 'artifactKind') ?? stringField(candidate, 'type')
  if (!id || !kind) return null

  return {
    id,
    kind,
    title: stringField(candidate, 'title') ?? stringField(candidate, 'name'),
    output: candidate,
    sourceEventType,
  }
}

function artifactCandidate(output: unknown): Record<string, unknown> | null {
  if (!isRecord(output)) return null
  const artifact = output.artifact
  if (isRecord(artifact)) return artifact
  return output
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
