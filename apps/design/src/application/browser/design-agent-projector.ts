import type { AgentEvent } from '@/packages/agent-protocol'
import type { DesignAgentRunEventRecordSnapshot } from '@/apps/design/application/common'
import {
  reduceDesignSubagentItems,
  type DesignSubagentViewItem,
} from './design-subagent-projector'

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

export interface DesignAgentRunProjection {
  status?: DesignAgentRunStatus
  assistantText: string
  artifacts: DesignProjectedArtifact[]
  subagents: DesignSubagentViewItem[]
  traceEvents: AgentEvent[]
  updatedAt?: number
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
      if (!shouldProjectToolResultArtifact(event.toolName)) return
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

function shouldProjectToolResultArtifact(toolName: string): boolean {
  return toolName !== 'create_shadcn_project' &&
    toolName !== 'add_shadcn_component' &&
    toolName !== 'validate_shadcn_component_usage'
}

export function projectDesignAgentRunEventRecords(
  records: DesignAgentRunEventRecordSnapshot[],
): DesignAgentRunProjection {
  return projectDesignAgentEvents(records
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .map(record => record.event))
}

export function projectDesignAgentEvents(events: AgentEvent[]): DesignAgentRunProjection {
  const projection: DesignAgentRunProjection = {
    assistantText: '',
    artifacts: [],
    subagents: [],
    traceEvents: [],
  }

  for (const event of events) {
    projectAgentEventToDesign(event, {
      onStatus: status => {
        projection.status = status
        projection.updatedAt = event.ts
      },
      onAssistantText: text => {
        projection.assistantText = `${projection.assistantText}${text}`
        projection.updatedAt = event.ts
      },
      onArtifact: artifact => {
        projection.artifacts = upsertDesignProjectedArtifact(projection.artifacts, artifact)
        projection.updatedAt = event.ts
      },
      onTraceEvent: traceEvent => {
        projection.traceEvents.push(traceEvent)
        projection.updatedAt = traceEvent.ts
      },
    })

    projection.subagents = reduceDesignSubagentItems(projection.subagents, {
      type: 'agent_event',
      runId: eventRunId(event) ?? '',
      event,
    })
  }

  return projection
}

function emitArtifact(output: unknown, event: AgentEvent, handlers: DesignAgentProjectionHandlers): void {
  const artifact = projectArtifact(output, event)
  if (artifact) handlers.onArtifact?.(artifact, event)
}

export function projectArtifact(output: unknown, event: AgentEvent): DesignProjectedArtifact | null {
  const candidate = artifactCandidate(output)
  if (!candidate) return null

  const id = stringField(candidate, 'id') ?? stringField(candidate, 'artifactId')
  const kind = stringField(candidate, 'kind') ?? stringField(candidate, 'artifactKind') ?? stringField(candidate, 'type')
  if (!id || !kind) return null

  const normalized = normalizeToolArtifact(candidate, event, id)
  const title = normalized.title ?? stringField(candidate, 'title') ?? stringField(candidate, 'name')
  return {
    id: normalized.id,
    kind,
    title,
    output: normalized.output ?? candidate,
    sourceEventType: event.type,
  }
}

export function upsertDesignProjectedArtifact(
  artifacts: DesignProjectedArtifact[],
  artifact: DesignProjectedArtifact,
): DesignProjectedArtifact[] {
  const existing = artifacts.find(item => item.id === artifact.id)
  const nextArtifact = artifact.sourceEventType === 'run_completed'
    ? artifact
    : mergeProjectedArtifact(existing, artifact)
  return [
    ...artifacts.filter(item => item.id !== artifact.id),
    nextArtifact,
  ]
}

export function mergeProjectedArtifact(
  existing: DesignProjectedArtifact | undefined,
  incoming: DesignProjectedArtifact,
): DesignProjectedArtifact {
  if (!existing) return incoming
  const existingOutput = existing.output
  const incomingOutput = incoming.output
  if (!isRecord(existingOutput) || !isRecord(incomingOutput)) return incoming

  const existingOperations = operationArray(existingOutput)
  const incomingOperations = operationArray(incomingOutput)
  if (!existingOperations || !incomingOperations) return incoming

  return {
    ...incoming,
    title: incoming.title ?? existing.title,
    output: {
      ...existingOutput,
      ...incomingOutput,
      metadata: mergeMetadata(recordField(existingOutput, 'metadata'), recordField(incomingOutput, 'metadata')),
      operations: mergeOperationsByPath(existingOperations, incomingOperations),
    },
  }
}

function normalizeToolArtifact(
  candidate: Record<string, unknown>,
  event: AgentEvent,
  id: string,
): { id: string; title?: string; output?: Record<string, unknown> } {
  if (event.type !== 'tool_result' || event.toolName !== 'add_shadcn_component') return { id }
  const baseId = id.includes(':shadcn-') ? id.split(':shadcn-')[0] : id
  const componentName = nestedStringField(event.output, ['component', 'name']) ??
    nestedStringField(event.output, ['installation', 'name'])
  const title = stripComponentSuffix(stringField(candidate, 'title'), componentName)
  return {
    id: baseId,
    title,
    output: {
      ...candidate,
      id: baseId,
      title: title ?? stringField(candidate, 'title'),
    },
  }
}

function stripComponentSuffix(title: string | undefined, componentName: string | undefined): string | undefined {
  if (!title || !componentName) return title
  const suffix = ` + ${componentName}`
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title
}

function operationArray(record: Record<string, unknown>): Record<string, unknown>[] | undefined {
  const operations = record.operations
  if (!Array.isArray(operations) || !operations.every(isRecord)) return undefined
  return operations
}

function mergeOperationsByPath(
  existingOperations: Record<string, unknown>[],
  incomingOperations: Record<string, unknown>[],
): Record<string, unknown>[] {
  const operationsByPath = new Map<string, Record<string, unknown>>()
  for (const operation of existingOperations) {
    const path = stringField(operation, 'path')
    if (path) operationsByPath.set(path, operation)
  }
  for (const operation of incomingOperations) {
    const path = stringField(operation, 'path')
    if (!path) continue
    operationsByPath.set(path, mergeOperation(operationsByPath.get(path), operation))
  }
  return [...operationsByPath.values()]
}

function mergeOperation(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  if (!existing || stringField(incoming, 'kind') === 'delete' || !stringField(incoming, 'path')?.endsWith('/package.json')) {
    return incoming
  }
  const existingContent = stringField(existing, 'content')
  const incomingContent = stringField(incoming, 'content')
  if (!existingContent || !incomingContent) return incoming
  const existingJson = parseRecord(existingContent)
  const incomingJson = parseRecord(incomingContent)
  if (!existingJson || !incomingJson) return incoming
  return {
    ...incoming,
    kind: stringField(existing, 'kind') === 'add' ? 'add' : incoming.kind,
    content: JSON.stringify({
      ...existingJson,
      ...incomingJson,
      dependencies: {
        ...recordField(existingJson, 'dependencies'),
        ...recordField(incomingJson, 'dependencies'),
      },
      devDependencies: {
        ...recordField(existingJson, 'devDependencies'),
        ...recordField(incomingJson, 'devDependencies'),
      },
    }, null, 2),
  }
}

function mergeMetadata(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...existing,
    ...incoming,
    shadcnToolInstallations: [
      ...arrayField(existing, 'shadcnToolInstallations'),
      ...arrayField(incoming, 'shadcnToolInstallations'),
    ],
  }
}

function parseRecord(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function nestedStringField(value: unknown, path: string[]): string | undefined {
  let current = value
  for (const segment of path) {
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return typeof current === 'string' && current.length > 0 ? current : undefined
}

function recordField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  return isRecord(value) ? value : {}
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
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

function eventRunId(event: AgentEvent): string | undefined {
  if ('runId' in event && typeof event.runId === 'string') return event.runId
  if ('parentRunId' in event && typeof event.parentRunId === 'string') return event.parentRunId
  return undefined
}
