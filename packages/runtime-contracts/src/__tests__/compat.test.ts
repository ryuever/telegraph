import { describe, expect, it } from 'vitest'
import {
  RUNTIME_CONTRACT_SCHEMA_VERSION as protocolVersion,
} from '@telegraph/agent-protocol'
import {
  RUNTIME_CONTRACT_SCHEMA_VERSION as compatVersion,
} from '../index'
import { allGoldenEvents as compatGoldenEvents } from '../fixtures/goldenEvents'
import { allGoldenEvents as protocolGoldenEvents } from '@telegraph/agent-protocol/fixtures/goldenEvents'

describe('@telegraph/runtime-contracts compatibility package', () => {
  it('re-exports the agent protocol schema version', () => {
    expect(compatVersion).toBe(protocolVersion)
  })

  it('re-exports golden fixtures from agent-protocol subpaths', () => {
    expect(compatGoldenEvents).toBe(protocolGoldenEvents)
    expect(compatGoldenEvents.length).toBeGreaterThan(0)
  })
})
