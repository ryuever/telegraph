import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import { DesignRunStore } from '../DesignRunStore'

describe('DesignRunStore', () => {
  it('persists run lifecycle summaries in memory', () => {
    const store = new DesignRunStore()

    store.start({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: 'make a page',
    })
    store.append({
      type: 'run_queued',
      runId: 'run-1',
      sessionId: 'session-1',
    })
    store.append({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'step_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        stepId: 'run-1:brief',
        label: 'Intent Brief',
        ts: 1,
      },
    })
    store.append({
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        output: {},
        ts: 2,
      },
    })

    expect(store.list()).toHaveLength(1)
    expect(store.get('run-1')).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      prompt: 'make a page',
      status: 'completed',
      events: [
        { type: 'run_queued' },
        { type: 'step_started', label: 'Intent Brief' },
        { type: 'run_completed' },
      ],
    })
  })
})
