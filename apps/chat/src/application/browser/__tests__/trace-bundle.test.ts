import { describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import {
  assertChatRunTraceBundle,
  validateChatRunTraceBundle,
} from '@/apps/chat/application/common/trace-bundle'
import type { ChatRunTraceBundle } from '@/apps/chat/application/common'

describe('trace bundle validation', () => {
  it('accepts exported run bundles with matching event records', () => {
    const bundle = bundleFixture()

    expect(validateChatRunTraceBundle(bundle)).toMatchObject({
      ok: true,
    })
    expect(assertChatRunTraceBundle(bundle)).toBe(bundle)
  })

  it('rejects malformed bundles with useful paths', () => {
    const bundle = bundleFixture()
    const result = validateChatRunTraceBundle({
      ...bundle,
      run: {
        ...bundle.run,
        eventCount: 2,
      },
      events: [
        {
          ...bundle.events[0],
          runId: 'other-run',
          event: {
            ...bundle.events[0].event,
            runId: 'other-run',
          },
        },
      ],
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues.map(issue => issue.path)).toEqual(
        expect.arrayContaining([
          '$.events',
          '$.events[0].runId',
          '$.events[0].event.runId',
        ]),
      )
    }
  })
})

function bundleFixture(): ChatRunTraceBundle {
  return {
    schemaVersion: 1,
    exportedAt: 200,
    run: {
      runId: 'run-1',
      sessionId: 'session-1',
      status: 'completed',
      runtimeId: 'pi-ai',
      artifactRefs: [],
      settings: {
        provider: 'minimax',
        modelId: 'MiniMax-M2.7',
        backend: 'pi-ai',
        taskCapabilityProfile: 'default',
      },
      input: { message: 'hello' },
      eventCount: 1,
      createdAt: 100,
      completedAt: 150,
    },
    events: [
      {
        runId: 'run-1',
        sessionId: 'session-1',
        seq: 1,
        ts: 150,
        event: {
          type: 'run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'run-1',
          output: null,
          ts: 150,
        },
      },
    ],
  }
}
