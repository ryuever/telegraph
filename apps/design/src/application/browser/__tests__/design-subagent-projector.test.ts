import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { reduceDesignSubagentItems } from '../design-subagent-projector'
import type { DesignAgentStreamEvent } from '@/apps/design/application/common'

function project(events: DesignAgentStreamEvent[]) {
  return events.reduce(reduceDesignSubagentItems, [])
}

describe('reduceDesignSubagentItems', () => {
  it('projects design-build child run events with profile metadata', () => {
    const items = project([
      {
        type: 'agent_event',
        runId: 'run-1',
        event: {
          type: 'child_run_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'run-1',
          childRunId: 'run-1:design-reviewer',
          label: 'Design Reviewer',
          raw: {
            profileId: 'design-reviewer',
            stage: 'review',
            profile: {
              title: 'Reviewer',
              description: 'Checks generated artifacts.',
            },
          },
          ts: 1,
        },
      },
      {
        type: 'agent_event',
        runId: 'run-1',
        event: {
          type: 'child_run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'run-1',
          childRunId: 'run-1:design-reviewer',
          output: {
            review: {
              verdict: 'pass',
            },
          },
          ts: 2,
        },
      },
    ])

    expect(items).toEqual([
      expect.objectContaining({
        id: 'run-1:design-reviewer',
        label: 'Design Reviewer',
        profileId: 'design-reviewer',
        stage: 'review',
        status: 'completed',
        detail: 'review pass',
        cancellable: false,
      }),
    ])
  })

  it('projects subagent manager snapshots', () => {
    const items = project([
      {
        type: 'subagent_updated',
        runId: 'run-1',
        subagent: {
          id: 'child-1',
          parentRunId: 'run-1',
          agent: 'worker',
          label: 'Worker',
          description: 'Does work',
          task: 'Build the patch',
          status: 'running',
          toolUses: 2,
          startedAt: 10,
        },
      },
    ])

    expect(items).toEqual([
      expect.objectContaining({
        id: 'child-1',
        agent: 'worker',
        status: 'running',
        task: 'Build the patch',
        toolUses: 2,
        cancellable: true,
      }),
    ])
  })
})
