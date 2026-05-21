import { describe, expect, it } from 'vitest'
import {
  capabilitySupport,
  getRuntimeCapabilityDescriptor,
  listRuntimeCapabilityDescriptors,
} from '../RuntimeCapabilityDescriptor'

describe('RuntimeCapabilityDescriptor', () => {
  it('describes the runtime matrix used by Chat', () => {
    const descriptors = listRuntimeCapabilityDescriptors()

    expect(descriptors.map(item => item.id)).toEqual([
      'pi-ai',
      'pi-embedded',
      'telegraph-subagents',
      'telegraph-orchestrator',
    ])
    expect(capabilitySupport(getRuntimeCapabilityDescriptor('pi-ai'), 'rawTrace')).toBe('supported')
    expect(capabilitySupport(getRuntimeCapabilityDescriptor('pi-ai'), 'shell')).toBe('unsupported')
    expect(capabilitySupport(getRuntimeCapabilityDescriptor('telegraph-subagents'), 'childRun')).toBe('supported')
  })

  it('returns cloned descriptors for callers', () => {
    const first = listRuntimeCapabilityDescriptors()
    first[0].capabilities[0].support = 'unsupported'

    const second = listRuntimeCapabilityDescriptors()
    expect(second[0].capabilities[0].support).toBe('supported')
  })
})
