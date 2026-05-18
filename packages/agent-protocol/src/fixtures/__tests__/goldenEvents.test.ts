import { describe, expect, it } from 'vitest'
import type { RuntimeEventType } from '../../events'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '../../version'
import {
  allGoldenEvents,
  goldenDesignArtifactRun,
  goldenMultiAgentChain,
  goldenMultiAgentParallel,
  goldenRunLifecycle,
} from '../goldenEvents'

const KNOWN_EVENT_TYPES: RuntimeEventType[] = [
  'run_started',
  'run_completed',
  'run_failed',
  'run_cancelled',
  'model_request',
  'model_event',
  'assistant_delta',
  'assistant_message',
  'tool_call',
  'tool_result',
  'tool_error',
  'step_started',
  'step_completed',
  'edge_taken',
  'child_run_started',
  'child_run_completed',
  'extension_activated',
  'extension_deactivated',
  'permission_requested',
  'permission_resolved',
  'runtime_log',
]

describe('agent protocol golden events', () => {
  it('keeps all golden events on schema v1 and known event types', () => {
    const knownTypes = new Set<string>(KNOWN_EVENT_TYPES)

    expect(allGoldenEvents.length).toBeGreaterThan(0)
    for (const event of allGoldenEvents) {
      expect(event.schemaVersion).toBe(RUNTIME_CONTRACT_SCHEMA_VERSION)
      expect(knownTypes.has(event.type)).toBe(true)
    }
  })

  it('keeps raw payloads JSON serializable across the RPC boundary', () => {
    for (const event of allGoldenEvents) {
      expect(() => { JSON.stringify(event); }).not.toThrow()
    }
  })

  it('keeps run-oriented fixtures terminal where they model complete runs', () => {
    for (const fixture of [
      goldenRunLifecycle,
      goldenMultiAgentChain,
      goldenMultiAgentParallel,
      goldenDesignArtifactRun,
    ]) {
      expect(['run_completed', 'run_failed', 'run_cancelled']).toContain(fixture.at(-1)?.type)
    }
  })
})
