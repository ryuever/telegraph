import { describe, expect, it } from 'vitest'
import {
  CapabilityBroker,
  CapabilityHost,
  chatCapabilities,
  codingCapabilities,
  type CapabilityHookRegistrar,
  type ToolCapability,
} from '@/packages/agent-capabilities'

const noopHooks: CapabilityHookRegistrar = {
  on: () => () => {},
}

describe('CapabilityHost', () => {
  it('registers host capabilities through composable helpers', async () => {
    const host = new CapabilityHost(noopHooks)
    const feedback = { notify: () => undefined }
    const process = { exec: async () => ({ stdout: 'ok', stderr: '', code: 0 }) }

    for (const capability of [
      ...chatCapabilities({ feedback }),
      ...codingCapabilities({ process }),
    ]) {
      await capability({ host, hooks: noopHooks })
    }

    expect(host.feedback).toBe(feedback)
    expect(host.process).toBe(process)
    expect(host.has('feedback')).toBe(true)
    expect(host.has('process')).toBe(true)
  })

  it('brokers tool registration without depending on packages/agent', () => {
    const host = new CapabilityHost(noopHooks)
    const broker = new CapabilityBroker(host)
    const tool: ToolCapability = {
      definition: {
        name: 'demo',
        description: 'Demo tool',
        inputSchema: { type: 'object', properties: {} },
      },
      execute: async input => input,
    }

    broker.registerTool(tool)

    expect(broker.getTool('demo')).toBe(tool)
    expect(host.listTools()).toEqual([tool.definition])
  })
})
