import type { AgentEvent } from '@/packages/agent-protocol'
import { BaseAgentRuntime, type RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import type { DesignBuildChildRunner } from './DesignBuildChildRunner'
import {
  DesignBuildWorkflow,
  normalizeDesignBuildError,
} from './DesignBuildWorkflow'
import type { DesignBuildSubagentProfileResolver } from './DesignBuildSubagentGateway'
import {
  runCancelled,
  runFailed,
  runStarted,
  TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
} from './DesignBuildRuntimeEvents'

export { TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION }

export class DesignBuildRuntime extends BaseAgentRuntime {
  readonly id = TELEGRAPH_DESIGN_BUILD_RUNTIME_ID
  readonly label = 'Telegraph Design Build'
  private readonly workflow: DesignBuildWorkflow

  constructor(options: {
    childRunner?: DesignBuildChildRunner
    profileResolver?: DesignBuildSubagentProfileResolver
    workflow?: DesignBuildWorkflow
  } = {}) {
    super()
    this.workflow = options.workflow ?? new DesignBuildWorkflow({
      childRunner: options.childRunner,
      profileResolver: options.profileResolver,
    })
  }

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    yield runStarted(input.runId)

    if (input.signal?.aborted) {
      yield runCancelled(input.runId)
      return
    }

    try {
      yield* this.workflow.run(input, {
        assistantRequestId: this.generateRequestId(input.runId),
      })
    } catch (error) {
      const normalized = normalizeDesignBuildError(error)
      yield runFailed(input.runId, normalized.code, normalized.message, normalized.details)
    }
  }
}
