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

    const traceEvents: AgentEvent[] = []
    let result
    try {
      result = await this.childRunner.runChild({
        ...request,
        profile,
        emitEvent: event => {
          if (isForwardedChildTraceEvent(event)) traceEvents.push(event)
        },
      })
    } catch (error) {
      for (const event of traceEvents) {
        yield event
      }
      throw error
    }
    for (const event of traceEvents) {
      yield event
    }
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

function isForwardedChildTraceEvent(event: AgentEvent): boolean {
  return event.type === 'model_request' ||
    event.type === 'model_event' ||
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
