import { describe, expect, it, vi } from 'vitest'
import {
  CapabilityBroker,
  CapabilityHost,
  chatCapabilities,
  codingCapabilities,
  type CapabilityHookRegistrar,
  type ToolCapability,
} from '@/packages/agent-capabilities'
import type { HookHandler, HookName, RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION as V } from '@/packages/agent-protocol'

const noopHooks: CapabilityHookRegistrar = {
  on: () => () => {},
}

/** Hooks recorder that captures registrations and lets the test fire them. */
function makeRecordingHooks() {
  const handlers = new Map<HookName, Set<HookHandler<HookName>>>()
  const hooks: CapabilityHookRegistrar = {
    on(name, handler) {
      const set = handlers.get(name) ?? new Set()
      set.add(handler as HookHandler<HookName>)
      handlers.set(name, set)
      return () => set.delete(handler as HookHandler<HookName>)
    },
  }
  return {
    hooks,
    fire<N extends HookName>(name: N, payload: Parameters<HookHandler<N>>[0]): void {
      handlers.get(name)?.forEach(h => (h as (p: unknown) => void)(payload))
    },
  }
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

  describe('D-016 P3 extension API surface', () => {
    it('registers a runtime contribution with aliases (dedup in listRuntimes)', () => {
      const host = new CapabilityHost(noopHooks)
      const create = () => ({ id: 'r', label: 'r', run: async function* () {} })
      host.registerRuntime({ id: 'pi-ai', aliases: ['pi'], create })
      expect(host.has('runtime', 'pi-ai')).toBe(true)
      expect(host.has('runtime', 'pi')).toBe(true)
      expect(host.getRuntime('pi')?.id).toBe('pi-ai')
      expect(host.listRuntimes()).toHaveLength(1)
    })

    it('registers a subagent profile', () => {
      const host = new CapabilityHost(noopHooks)
      host.registerSubagentProfile({ name: 'explore', description: 'd', systemPrompt: 's' })
      expect(host.has('subagent', 'explore')).toBe(true)
      expect(host.getSubagentProfile('explore')?.systemPrompt).toBe('s')
      expect(host.listSubagentProfiles()).toHaveLength(1)
    })

    it('rejects empty id/name on each new registrar', () => {
      const host = new CapabilityHost(noopHooks)
      expect(() => host.registerRuntime({ id: '', create: () => null })).toThrow(/id is required/)
      expect(() => host.registerSubagentProfile({ name: '', description: '', systemPrompt: '' })).toThrow(/name is required/)
      expect(() => host.registerContextProvider({ id: 'x', name: '', provide: () => '' })).toThrow(/name is required/)
      expect(() => host.registerMessageRenderer({ id: '', match: 't', componentId: 'c' })).toThrow(/id is required/)
      expect(() => host.registerCommand({ id: '', title: 't', command: 'c' })).toThrow(/id is required/)
      expect(() => host.registerProvider({ id: '', config: {} })).toThrow(/id is required/)
    })

    it('onEvent filters by event.type and defers handler via microtask', async () => {
      const recorder = makeRecordingHooks()
      const host = new CapabilityHost(recorder.hooks)
      const seen: RuntimeEvent['type'][] = []
      host.onEvent('tool_call', evt => {
        seen.push(evt.type)
      })

      // Fire two events; only the matching one should be observed.
      const matching: RuntimeEvent = {
        type: 'tool_call', schemaVersion: V, callId: 'c1', toolName: 'demo', input: {}, ts: 1,
      }
      const nonMatching: RuntimeEvent = {
        type: 'tool_result', schemaVersion: V, callId: 'c1', toolName: 'demo', output: {}, ts: 2,
      }
      recorder.fire('onRuntimeEvent', { event: matching, request: {} as never, runtimeId: 'fake' })
      recorder.fire('onRuntimeEvent', { event: nonMatching, request: {} as never, runtimeId: 'fake' })
      // Drain microtasks.
      await Promise.resolve()
      await Promise.resolve()
      expect(seen).toEqual(['tool_call'])
    })

    it('TelegraphExtension alias is structurally compatible with AgentCapability', () => {
      // Compile-time only — if this file typechecks, the alias holds.
      // Runtime sanity: a TelegraphExtension can be invoked as an AgentCapability.
      const ext: import('@/packages/agent-capabilities').TelegraphExtension = ({ host }) => {
        host.registerCustom('marker', true)
      }
      const host = new CapabilityHost(noopHooks)
      const result = ext({ host, hooks: noopHooks })
      expect(result).toBeUndefined()
      expect(host.getCustom('marker')).toBe(true)
    })

    it('returns and calls cleanup function from factory', async () => {
      const host = new CapabilityHost(noopHooks)
      const cleanup = vi.fn()
      const ext: import('@/packages/agent-capabilities').TelegraphExtension = () => cleanup
      const ret = ext({ host, hooks: noopHooks })
      expect(typeof ret).toBe('function')
      if (typeof ret === 'function') ret()
      expect(cleanup).toHaveBeenCalledOnce()
    })
  })
})
