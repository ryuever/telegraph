import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'

export const ORCHESTRATOR_CHECKPOINT_METADATA_KEY = 'telegraph.orchestratorCheckpoint'

export interface OrchestratorCheckpointResumeMetadata {
  value: unknown
  requestedBy?: string
  reason?: string
  requestedAt?: number
}

export interface OrchestratorCheckpointMetadata {
  threadId?: string
  checkpointNamespace?: string
  checkpointId?: string
  resume?: OrchestratorCheckpointResumeMetadata
}

export interface OrchestratorCheckpointControl {
  threadId?: string
  checkpointNamespace?: string
  checkpointId?: string
  resume?: OrchestratorCheckpointResumeMetadata
}

export interface OrchestratorPauseRequest {
  runId: string
  requestedBy: string
  reason?: string
  requestedAt?: number
}

export interface OrchestratorPauseInterruptPayload {
  type: 'remote_pause'
  runId: string
  nodeId: string
  requestedBy: string
  reason?: string
  requestedAt: number
}

export interface OrchestratorCheckpointController {
  checkpoint(input: RuntimeInput): OrchestratorCheckpointControl | undefined
  consumePause?(input: RuntimeInput, nodeId: string): OrchestratorPauseInterruptPayload | undefined
}

export interface InMemoryOrchestratorCheckpointControllerOptions {
  threadId?: (input: RuntimeInput) => string | undefined
  checkpointNamespace?: string
  now?: () => number
}

export class InMemoryOrchestratorCheckpointController implements OrchestratorCheckpointController {
  private readonly pauseRequests = new Map<string, Required<OrchestratorPauseRequest>>()
  private readonly now: () => number

  constructor(private readonly options: InMemoryOrchestratorCheckpointControllerOptions = {}) {
    this.now = options.now ?? Date.now
  }

  requestPause(request: OrchestratorPauseRequest): void {
    this.pauseRequests.set(request.runId, {
      runId: request.runId,
      requestedBy: request.requestedBy,
      reason: request.reason ?? '',
      requestedAt: request.requestedAt ?? this.now(),
    })
  }

  checkpoint(input: RuntimeInput): OrchestratorCheckpointControl | undefined {
    const metadata = readOrchestratorCheckpointMetadata(input.metadata)
    return pruneUndefined({
      threadId: metadata?.threadId ?? this.options.threadId?.(input) ?? input.runId,
      checkpointNamespace: metadata?.checkpointNamespace ?? this.options.checkpointNamespace,
      checkpointId: metadata?.checkpointId,
      resume: metadata?.resume,
    })
  }

  consumePause(input: RuntimeInput, nodeId: string): OrchestratorPauseInterruptPayload | undefined {
    const request = this.pauseRequests.get(input.runId)
    if (!request) return undefined
    this.pauseRequests.delete(input.runId)
    return pruneUndefined({
      type: 'remote_pause' as const,
      runId: input.runId,
      nodeId,
      requestedBy: request.requestedBy,
      reason: request.reason || undefined,
      requestedAt: request.requestedAt,
    })
  }
}

export function createOrchestratorCheckpointMetadata(
  metadata: OrchestratorCheckpointMetadata,
): Record<typeof ORCHESTRATOR_CHECKPOINT_METADATA_KEY, OrchestratorCheckpointMetadata> {
  return {
    [ORCHESTRATOR_CHECKPOINT_METADATA_KEY]: pruneUndefined({
      threadId: metadata.threadId,
      checkpointNamespace: metadata.checkpointNamespace,
      checkpointId: metadata.checkpointId,
      resume: metadata.resume,
    }),
  }
}

export function readOrchestratorCheckpointMetadata(
  metadata: Record<string, unknown> | undefined,
): OrchestratorCheckpointMetadata | undefined {
  const value = metadata?.[ORCHESTRATOR_CHECKPOINT_METADATA_KEY]
  if (!isRecord(value)) return undefined

  const resume = isRecord(value.resume)
    ? pruneUndefined({
      value: value.resume.value,
      requestedBy: typeof value.resume.requestedBy === 'string' ? value.resume.requestedBy : undefined,
      reason: typeof value.resume.reason === 'string' ? value.resume.reason : undefined,
      requestedAt: typeof value.resume.requestedAt === 'number' ? value.resume.requestedAt : undefined,
    })
    : undefined

  return pruneUndefined({
    threadId: typeof value.threadId === 'string' ? value.threadId : undefined,
    checkpointNamespace: typeof value.checkpointNamespace === 'string' ? value.checkpointNamespace : undefined,
    checkpointId: typeof value.checkpointId === 'string' ? value.checkpointId : undefined,
    resume,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
