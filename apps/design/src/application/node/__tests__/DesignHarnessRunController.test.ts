import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { DesignHarnessRunController } from '../DesignHarnessRunController'

describe('DesignHarnessRunController', () => {
  it('centralizes run lifecycle control and event fanout', () => {
    const controller = new DesignHarnessRunController()
    const events: string[] = []
    const subscription = controller.subscribe(event => {
      events.push(event.type)
    })

    const run = controller.startRun({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: 'make a page',
    })
    expect(run.signal.aborted).toBe(false)
    expect(controller.cancelRun('run-1')).toBe(true)
    expect(run.signal.aborted).toBe(true)

    controller.emitAgentEvent({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'run_cancelled',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        reason: 'Cancelled',
        ts: 1,
      },
    })
    controller.finishRun('run-1')
    subscription.unsubscribe()

    expect(events).toEqual(['run_queued', 'agent_event'])
    expect(controller.getRun('run-1')).toMatchObject({
      runId: 'run-1',
      status: 'cancelled',
    })
  })

  it('publishes subagent snapshots when subagent state changes', async () => {
    const controller = new DesignHarnessRunController()
    const updates: string[] = []
    controller.subscribe(event => {
      if (event.type === 'subagent_updated') {
        updates.push(`${event.subagent.id}:${event.subagent.status}`)
      }
    })

    const generator = controller.subagents.spawnAndWait({
      parentRunId: 'run-1',
      childRunId: 'child-1',
      label: 'Worker',
      agent: {
        name: 'worker',
        description: 'Does work',
        systemPrompt: 'Work.',
        scope: 'project',
      },
      task: 'do work',
      settings: {
        provider: 'test',
        modelId: 'test-model',
        apiKey: 'test-key',
      },
      signal: AbortSignal.abort(),
    })
    await generator.next()

    expect(controller.cancelSubagent('child-1')).toBe(false)
    expect(controller.listSubagents()).toEqual([
      expect.objectContaining({
        id: 'child-1',
        status: 'stopped',
      }),
    ])
    expect(updates).toContain('child-1:stopped')
  })

  it('indexes runtime child run events as subagent snapshots', () => {
    const controller = new DesignHarnessRunController()
    const updates: string[] = []
    controller.startRun({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: 'make a page',
    })
    controller.subscribe(event => {
      if (event.type === 'subagent_updated') {
        updates.push(`${event.subagent.id}:${event.subagent.status}:${event.subagent.result ?? ''}`)
      }
    })

    controller.emitAgentEvent({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
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
            description: 'Checks artifacts.',
          },
        },
        ts: 1,
      },
    })
    controller.emitAgentEvent({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'tool_call',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1:design-reviewer',
        callId: 'call-1',
        toolName: 'submit_review',
        input: {},
        ts: 2,
      },
    })
    controller.emitAgentEvent({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
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
        ts: 3,
      },
    })

    expect(controller.listSubagents()).toEqual([
      expect.objectContaining({
        id: 'run-1:design-reviewer',
        sessionId: 'session-1',
        agent: 'Reviewer',
        label: 'Design Reviewer',
        status: 'completed',
        result: 'review pass',
        toolUses: 1,
      }),
    ])
    expect(controller.getSubagentResult('run-1:design-reviewer', true)).toMatchObject({
      id: 'run-1:design-reviewer',
      resultConsumed: true,
    })
    expect(updates).toEqual([
      'run-1:design-reviewer:running:',
      'run-1:design-reviewer:running:',
      'run-1:design-reviewer:completed:review pass',
      'run-1:design-reviewer:completed:review pass',
    ])
  })

  it('clears runtime child snapshots when the same run id restarts', () => {
    const controller = new DesignHarnessRunController()
    controller.startRun({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: 'first',
    })
    controller.emitAgentEvent({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'child_run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'run-1',
        childRunId: 'child-old',
        label: 'Old Child',
        ts: 1,
      },
    })
    expect(controller.listSubagents().map(subagent => subagent.id)).toContain('child-old')

    controller.startRun({
      runId: 'run-1',
      sessionId: 'session-2',
      prompt: 'second',
    })

    expect(controller.listSubagents().map(subagent => subagent.id)).not.toContain('child-old')
  })
})
