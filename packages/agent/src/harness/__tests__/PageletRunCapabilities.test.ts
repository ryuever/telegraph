import type { AgentEvent } from '@/packages/agent-protocol'
import { CapabilityHost } from '@/packages/agent/harness/CapabilityHost'
import { HookBus } from '@/packages/agent/harness/HookBus'
import { createPageletRunCapabilities } from '@/packages/agent/harness/node/PageletRunCapabilities'
import { describe, expect, it } from 'vitest'

describe('createPageletRunCapabilities', () => {
  it('keeps the default profile lightweight', async () => {
    const host = await register({
      taskCapabilityProfile: { kind: 'default' },
    })

    expect(host.has('feedback')).toBe(true)
    expect(host.has('process')).toBe(false)
    expect(host.has('filesystem')).toBe(false)
    expect(host.has('patch')).toBe(false)
  })

  it('enables shell automation only for explicit shell profiles', async () => {
    const host = await register({
      taskCapabilityProfile: {
        kind: 'shell-automation',
        commands: ['git'],
        cwdPolicy: 'workspace',
      },
    })

    expect(host.has('process')).toBe(true)
    expect(host.has('filesystem')).toBe(false)
    expect(host.has('patch')).toBe(false)
  })

  it('enables workspace filesystem and patch capabilities for design build profiles', async () => {
    const host = await register({
      taskCapabilityProfile: {
        kind: 'design-build',
        scopes: ['artifact:write', 'repo:read'],
        artifactPolicy: 'preview',
      },
    })

    expect(host.has('process')).toBe(false)
    expect(host.has('filesystem')).toBe(true)
    expect(host.has('patch')).toBe(true)
  })
})

async function register(settings: Parameters<typeof createPageletRunCapabilities>[0]['settings']): Promise<CapabilityHost> {
  const hooks = new HookBus()
  const host = new CapabilityHost(hooks)
  const events: AgentEvent[] = []
  const capabilities = createPageletRunCapabilities({
    runId: 'run-pagelet-capabilities',
    sessionId: 'session-pagelet-capabilities',
    pageletId: 'chat',
    pageletKind: 'chat',
    settings,
    workspaceRoot: process.cwd(),
    feedback: {
      notify: () => {},
    },
    emit: event => { events.push(event) },
  })

  for (const capability of capabilities) {
    await capability({ host, hooks })
  }

  expect(events).toEqual([])
  return host
}
