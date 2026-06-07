import { describe, expect, it } from 'vitest'
import { SubagentRegistry } from '../SubagentRegistry'
import type { SubagentProfile } from '@/packages/agent-protocol'

const sampleProfile: SubagentProfile = {
  name: 'explore',
  description: 'Read-only investigation subagent',
  systemPrompt: 'You explore code and return findings.',
}

describe('SubagentRegistry', () => {
  it('registers and retrieves a profile by name', () => {
    const reg = new SubagentRegistry()
    reg.register(sampleProfile)
    expect(reg.has('explore')).toBe(true)
    expect(reg.get('explore')).toEqual(sampleProfile)
    expect(reg.size()).toBe(1)
  })

  it('rejects a profile without a name', () => {
    const reg = new SubagentRegistry()
    expect(() => reg.register({ ...sampleProfile, name: '' })).toThrow(/name is required/)
  })

  it('rejects duplicate registration', () => {
    const reg = new SubagentRegistry()
    reg.register(sampleProfile)
    expect(() => reg.register(sampleProfile)).toThrow(/already registered/)
  })

  it('upserts overrides a prior registration', () => {
    const reg = new SubagentRegistry()
    reg.register(sampleProfile)
    const updated = { ...sampleProfile, description: 'updated' }
    reg.upsert(updated)
    expect(reg.get('explore')?.description).toBe('updated')
  })

  it('unregister removes the entry', () => {
    const reg = new SubagentRegistry()
    reg.register(sampleProfile)
    expect(reg.unregister('explore')).toBe(true)
    expect(reg.unregister('explore')).toBe(false)
    expect(reg.has('explore')).toBe(false)
  })

  it('list returns all registered profiles', () => {
    const reg = new SubagentRegistry()
    reg.register(sampleProfile)
    reg.register({ ...sampleProfile, name: 'plan', description: 'plan-mode' })
    const names = reg.list().map(p => p.name).sort()
    expect(names).toEqual(['explore', 'plan'])
  })
})
