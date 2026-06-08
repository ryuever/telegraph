import {
  CapabilityHost,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities'
import { describe, expect, it, vi } from 'vitest'
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from '../constants'
import extension, { TELEGRAPH_SUBAGENTS_MANAGER_KEY } from '../extension'
import { SubagentManager } from '../SubagentManager'

function noopHooks(): CapabilityHookRegistrar {
  return { on: () => () => {} }
}

function createHost(): CapabilityHost {
  return new CapabilityHost(noopHooks())
}

/**
 * Narrow the `AgentCapability` return-type union down to the synchronous
 * cleanup function this extension produces. The runtime test against
 * `typeof` keeps the assertion honest if the contract drifts later.
 */
function expectSyncCleanup(value: unknown): () => void {
  expect(typeof value).toBe('function')
  return value as () => void
}

describe('telegraph-subagents extension factory', () => {
  it('registers a SubagentManager under the well-known custom-capability key', () => {
    const host = createHost()

    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const manager = host.getCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY)
    expect(manager).toBeInstanceOf(SubagentManager)
    cleanup()
  })

  it('registers the telegraph-subagents runtime contribution with a working create()', () => {
    const host = createHost()

    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const contribution = host.getRuntime(TELEGRAPH_SUBAGENTS_RUNTIME_ID)
    expect(contribution).toBeDefined()
    expect(contribution?.id).toBe(TELEGRAPH_SUBAGENTS_RUNTIME_ID)
    expect(typeof contribution?.create).toBe('function')

    // Calling create() must not throw — the harness builds lazily against the
    // extension-owned manager and only allocates per-run state.
    const runtime = contribution?.create({ runtimeId: TELEGRAPH_SUBAGENTS_RUNTIME_ID })
    expect(runtime).toBeTruthy()
    cleanup()
  })

  it('discovers and registers SubagentProfiles (catalog is populated eagerly)', () => {
    const host = createHost()

    // Eagerness is documented in extension.ts — discovery happens at activation
    // time so `host.listSubagentProfiles()` is non-empty before any run.
    // We don't assert *which* profiles are present (depends on cwd), just that
    // discovery ran and the method is wired through to the host registry.
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    // The list shape itself is the contract under test; emptiness is allowed
    // in environments without builtin/user/project agents.
    const profiles = host.listSubagentProfiles()
    expect(Array.isArray(profiles)).toBe(true)
    cleanup()
  })

  it('cleanup disposes the SubagentManager without unregistering host entries', () => {
    const host = createHost()
    const cleanup = expectSyncCleanup(extension({ host, hooks: noopHooks() }))

    const manager = host.getCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY) as SubagentManager
    const disposeSpy = vi.spyOn(manager, 'disposeAll')

    cleanup()

    expect(disposeSpy).toHaveBeenCalledTimes(1)
    // Host registrations are intentionally left in place — the pagelet owns
    // the host's lifetime; the extension only manages its own resources.
    expect(host.getRuntime(TELEGRAPH_SUBAGENTS_RUNTIME_ID)).toBeDefined()
    expect(host.getCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY)).toBe(manager)
  })
})
