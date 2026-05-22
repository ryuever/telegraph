import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  DESIGN_BUILD_CHILD_PROFILES,
  type DesignBuildChildProfile,
} from '../DesignBuildChildContracts'
import {
  DesignBuildSubagentGateway,
} from '../DesignBuildSubagentGateway'
import type {
  DesignBuildChildRunRequest,
  DesignBuildChildRunResult,
  DesignBuildChildRunner,
} from '../DesignBuildChildRunner'

describe('DesignBuildSubagentGateway', () => {
  it('resolves subagent profiles before running structured child contracts', async () => {
    const profile: DesignBuildChildProfile = {
      id: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      title: 'Design Reviewer',
      systemPrompt: 'Review artifacts for design quality.',
      sourcePath: '/repo/extensions/telegraph-subagents/agents/design-reviewer.md',
      origin: {
        extensionId: '@telegraph/subagents',
        contributionId: 'design-reviewer',
      },
    }
    const childRunner = new CapturingChildRunner()
    const gateway = new DesignBuildSubagentGateway({
      childRunner,
      profileResolver: profileId => profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer ? profile : undefined,
    })

    const output = await collectReturn(gateway.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:design-reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      settings: {},
    }))

    expect(output.returnValue).toEqual({ review: { verdict: 'pass', checks: [] } })
    expect(childRunner.requests[0]?.profile).toEqual(profile)
    expect(output.events[0]).toMatchObject({
      type: 'child_run_started',
      raw: {
        profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        stage: 'review',
        profile: {
          title: 'Design Reviewer',
          sourcePath: '/repo/extensions/telegraph-subagents/agents/design-reviewer.md',
        },
      },
    })
    expect(gateway.listChildRuns()).toEqual([
      {
        childRunId: 'run-1:design-reviewer',
        profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        output: { review: { verdict: 'pass', checks: [] } },
      },
    ])
  })

  it('forwards child model and tool trace without forwarding child assistant text or lifecycle terminals', async () => {
    const childRunner = new CapturingChildRunner({
      emitTrace: true,
    })
    const gateway = new DesignBuildSubagentGateway({ childRunner })

    const output = await collectReturn(gateway.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:design-worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1', kind: 'design-patch', title: 'Artifact' },
      settings: {},
    }))

    expect(output.returnValue).toEqual({ artifactId: 'artifact-1', kind: 'design-patch', title: 'Artifact' })
    expect(output.events.map(event => event.type)).toEqual([
      'child_run_started',
      'model_request',
      'tool_call',
      'child_run_completed',
    ])
  })
})

class CapturingChildRunner implements DesignBuildChildRunner {
  readonly requests: DesignBuildChildRunRequest[] = []

  constructor(private readonly options: { emitTrace?: boolean } = {}) {}

  runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    this.requests.push(request)
    if (this.options.emitTrace) {
      request.emitEvent?.({
        type: 'model_request',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: request.childRunId,
        requestId: 'req-child',
        payload: { prompt: 'child prompt' },
        ts: 1,
      })
      request.emitEvent?.({
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: request.childRunId,
        requestId: 'req-child',
        text: 'child text should stay trace-only',
        ts: 2,
      })
      request.emitEvent?.({
        type: 'tool_call',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: request.childRunId,
        callId: 'call-submit',
        toolName: 'submit_design_child_output',
        input: request.input,
        ts: 3,
      })
      request.emitEvent?.({
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: request.childRunId,
        output: request.input,
        ts: 4,
      })
    }
    return Promise.resolve({
      output: request.input,
      source: 'model-backed',
    })
  }
}

async function collectReturn(
  input: AsyncGenerator<AgentEvent, unknown, void>,
): Promise<{ events: AgentEvent[]; returnValue: unknown }> {
  const events: AgentEvent[] = []
  for (;;) {
    const next = await input.next()
    if (next.done) {
      return { events, returnValue: next.value }
    }
    events.push(next.value)
  }
}
