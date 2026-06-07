import type { AgentEvent, RuntimeSettings } from '@/packages/agent-protocol'
import type { PiAiExecutableTool } from '@/packages/agent/runtime/streamPiAiRuntime'
import { discoverAgents } from '@/extensions/telegraph-subagents/src/agentDiscovery'
import type { SubagentDefinition } from '@/extensions/telegraph-subagents/src/types'
import type {
  DesignBuildChildProfile,
  DesignBuildChildProfileId,
  DesignBuildChildStage,
} from './DesignBuildChildContracts'
import { childRunRaw } from './DesignBuildChildContracts'
import {
  ModelBackedDesignBuildChildRunner,
  type DesignBuildChildRunner,
} from './DesignBuildChildRunner'
import {
  childRunCompleted,
  childRunStarted,
} from './DesignBuildRuntimeEvents'

export interface DesignBuildSubagentRunRecord {
  childRunId: string
  profileId: string
  output: unknown
}

export interface DesignBuildSubagentGatewayOptions {
  childRunner?: DesignBuildChildRunner
  profileResolver?: DesignBuildSubagentProfileResolver
}

export type DesignBuildSubagentProfileResolver = (
  profileId: DesignBuildChildProfileId,
) => DesignBuildChildProfile | undefined

export interface DesignBuildSubagentRunRequest {
  parentRunId: string
  childRunId: string
  profileId: DesignBuildChildProfileId
  stage: DesignBuildChildStage
  label: string
  input: unknown
  modelInput?: unknown
  settings?: RuntimeSettings
  metadata?: Record<string, unknown>
  signal?: AbortSignal
  attempt?: number
  tools?: PiAiExecutableTool[]
  requiredTools?: string[]
}

export class DesignBuildSubagentGateway {
  private readonly childRunner: DesignBuildChildRunner
  private readonly profileResolver: DesignBuildSubagentProfileResolver
  private readonly childRuns: DesignBuildSubagentRunRecord[] = []

  constructor(options: DesignBuildSubagentGatewayOptions = {}) {
    this.childRunner = options.childRunner ?? new ModelBackedDesignBuildChildRunner()
    this.profileResolver = options.profileResolver ?? createDefaultProfileResolver()
  }

  listChildRuns(): DesignBuildSubagentRunRecord[] {
    return [...this.childRuns]
  }

  async *runChild(request: DesignBuildSubagentRunRequest): AsyncGenerator<AgentEvent, unknown, void> {
    const profile = this.profileResolver(request.profileId)
    const raw = childRunRaw(request.profileId, request.stage, {
      attempt: request.attempt,
      profile,
    })
    yield childRunStarted(
      request.parentRunId,
      request.childRunId,
      request.label,
      raw,
    )

    const traceQueue = createLiveTraceQueue()
    const child = this.childRunner.runChild({
      ...request,
      profile,
      emitEvent: event => {
        if (isForwardedChildTraceEvent(event)) traceQueue.push(event)
      },
    })
    const result = yield* drainChildWithLiveTrace(child, traceQueue)
    yield childRunCompleted(
      request.parentRunId,
      request.childRunId,
      result.output,
      raw,
    )
    this.childRuns.push({
      childRunId: request.childRunId,
      profileId: request.profileId,
      output: result.output,
    })

    return result.output
  }
}

interface LiveTraceQueue {
  push(event: AgentEvent): void
  hasEvents(): boolean
  drain(): AgentEvent[]
  wait(): Promise<TraceWake>
  wake(): void
}

interface TraceWake {
  kind: 'trace'
}

type ChildResult = { output: unknown }

type ChildCompletion =
  | { kind: 'completed'; result: ChildResult }
  | { kind: 'failed'; error: unknown }

function createLiveTraceQueue(): LiveTraceQueue {
  const events: AgentEvent[] = []
  let wakeWaiter: (() => void) | undefined
  return {
    push(event) {
      events.push(event)
      this.wake()
    },
    hasEvents() {
      return events.length > 0
    },
    drain() {
      return events.splice(0)
    },
    wait() {
      return new Promise<TraceWake>(resolve => {
        wakeWaiter = () => { resolve({ kind: 'trace' }) }
      })
    },
    wake() {
      const wake = wakeWaiter
      wakeWaiter = undefined
      wake?.()
    },
  }
}

async function* drainChildWithLiveTrace(
  child: Promise<ChildResult>,
  traceQueue: LiveTraceQueue,
): AsyncGenerator<AgentEvent, ChildResult, void> {
  const childCompletion: Promise<ChildCompletion> = child.then(
    result => ({ kind: 'completed', result }),
    (error: unknown) => ({ kind: 'failed', error }),
  )
  let completion: ChildCompletion | undefined

  while (!completion) {
    for (const event of traceQueue.drain()) {
      yield event
    }
    if (traceQueue.hasEvents()) continue
    const next = await Promise.race([childCompletion, traceQueue.wait()])
    if (next.kind === 'trace') continue
    completion = next
  }

  for (const event of traceQueue.drain()) {
    yield event
  }

  if (completion.kind === 'failed') throw asError(completion.error)
  return completion.result
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function isForwardedChildTraceEvent(event: AgentEvent): boolean {
  return event.type === 'model_request' ||
    event.type === 'tool_call' ||
    event.type === 'tool_result' ||
    event.type === 'tool_error' ||
    event.type === 'runtime_log'
}

function createDefaultProfileResolver(): DesignBuildSubagentProfileResolver {
  const agents = discoverAgents({ cwd: process.cwd() })
  return profileId => profileFromSubagentDefinition(profileId, agents.get(profileId))
}

function profileFromSubagentDefinition(
  profileId: DesignBuildChildProfileId,
  definition: SubagentDefinition | undefined,
): DesignBuildChildProfile | undefined {
  if (!definition) return undefined
  return {
    id: profileId,
    title: definition.title,
    description: definition.description,
    systemPrompt: definition.systemPrompt,
    tools: definition.tools,
    inheritSkills: definition.inheritSkills,
    skills: definition.skills,
    sourcePath: definition.sourcePath,
    origin: definition.origin,
  }
}
