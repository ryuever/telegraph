import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  DesignRunStore,
  designRunSnapshotFromLedger,
  designRunSnapshotFromRecord,
} from '../DesignRunStore'

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

  it('projects persisted run ledger records into design run snapshots', () => {
    const snapshot = designRunSnapshotFromLedger({
      runId: 'run-ledger',
      sessionId: 'session-ledger',
      status: 'failed',
      runtimeId: 'design-build',
      failureReason: 'runtime_recovery',
      failureMessage: 'Run was still active when the pagelet process started.',
      artifactRefs: ['artifact-ledger'],
      settings: {},
      input: { message: 'make a durable page' },
      eventCount: 1,
      createdAt: 100,
      startedAt: 110,
      completedAt: 200,
      lastEventAt: 200,
    }, [
      {
        runId: 'run-ledger',
        sessionId: 'session-ledger',
        seq: 1,
        ts: 110,
        event: {
          type: 'run_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'run-ledger',
          ts: 110,
        },
      },
    ])

    expect(snapshot).toMatchObject({
      runId: 'run-ledger',
      sessionId: 'session-ledger',
      prompt: 'make a durable page',
      status: 'failed',
      error: 'Run was still active when the pagelet process started.',
      startedAt: 110,
      updatedAt: 200,
      completedAt: 200,
      artifactCount: 1,
      events: [{ type: 'run_started', ts: 110 }],
    })
  })

  it('projects run records without loading event payloads for list summaries', () => {
    const snapshot = designRunSnapshotFromRecord({
      runId: 'run-summary',
      sessionId: 'session-summary',
      status: 'completed',
      runtimeId: 'design-build',
      artifactRefs: ['artifact-heavy'],
      settings: {},
      inputPreview: 'make a summary page',
      eventCount: 42,
      createdAt: 100,
      startedAt: 120,
      completedAt: 300,
      lastEventAt: 280,
    })

    expect(snapshot).toMatchObject({
      runId: 'run-summary',
      sessionId: 'session-summary',
      prompt: 'make a summary page',
      status: 'completed',
      startedAt: 120,
      updatedAt: 280,
      completedAt: 300,
      artifactCount: 1,
      events: [{ type: 'run_queued', ts: 100 }],
    })
  })
})
