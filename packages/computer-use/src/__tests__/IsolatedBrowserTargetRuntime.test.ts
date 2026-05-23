import { describe, expect, it } from 'vitest'
import {
  IsolatedBrowserTargetRuntime,
  assertLaunchableIsolatedBrowserTarget,
  createIsolatedBrowserTargetDefinition,
  validateLaunchableIsolatedBrowserTarget,
  type IsolatedBrowserLauncher,
} from '../isolated-browser-runtime.js'

describe('IsolatedBrowserTargetRuntime', () => {
  it('creates safe isolated browser target definitions by default', () => {
    const definition = createIsolatedBrowserTargetDefinition({
      targetId: 'iso-1',
      domains: ['example.com'],
      blockedDomains: ['tracker.example.com'],
    })

    expect(definition).toMatchObject({
      target: {
        targetId: 'iso-1',
        kind: 'isolated_browser',
        scope: {
          includeDomains: ['example.com'],
          excludeDomains: ['tracker.example.com'],
        },
      },
      trustLevel: 'ephemeral-isolated',
      persistent: false,
      networkPolicy: {
        mode: 'allowlist',
        allowedDomains: ['example.com'],
        blockedDomains: ['tracker.example.com'],
        allowPrivateNetwork: false,
      },
      profileSync: {
        mode: 'none',
        homeMount: 'none',
      },
      artifactTransfer: {
        exportMode: 'explicit-approval',
        importMode: 'explicit-approval',
      },
    })
    expect(validateLaunchableIsolatedBrowserTarget(definition)).toEqual([])
  })

  it('rejects unsafe isolated browser launch definitions', () => {
    expect(() => {
      assertLaunchableIsolatedBrowserTarget({
        target: { targetId: 'desktop-1', kind: 'desktop' },
        trustLevel: 'user-desktop',
        networkPolicy: { mode: 'open' },
        profileSync: { mode: 'managed-profile', homeMount: 'selected-paths-readwrite' },
        artifactTransfer: { exportMode: 'workspace-scoped', importMode: 'workspace-scoped' },
      })
    }).toThrow('isolated browser runtime requires target kind "isolated_browser"')
  })

  it('launches and selects isolated browser sessions through an injected launcher', async () => {
    const launched: string[] = []
    const stopped: string[] = []
    const launcher: IsolatedBrowserLauncher = {
      launch: definition => {
        launched.push(definition.target.targetId)
        return Promise.resolve({ runtimeHandle: `handle:${definition.target.targetId}` })
      },
      stop: session => {
        stopped.push(session.sessionId)
        return Promise.resolve()
      },
    }
    const runtime = new IsolatedBrowserTargetRuntime({
      launcher,
      idFactory: sequentialIds(['target-a', 'session-a']),
      now: sequentialNow([10, 20]),
    })

    const session = await runtime.launch({
      domains: ['docs.example.com'],
      label: 'Docs sandbox',
    })

    expect(session).toMatchObject({
      sessionId: 'isolated-browser-session-session-a',
      status: 'running',
      runtimeHandle: 'handle:isolated-browser-target-a',
      launchedAt: 10,
      definition: {
        target: {
          targetId: 'isolated-browser-target-a',
          kind: 'isolated_browser',
          label: 'Docs sandbox',
        },
      },
    })
    expect(launched).toEqual(['isolated-browser-target-a'])
    expect(runtime.selectTarget({ domains: ['docs.example.com'] })).toMatchObject({
      target: { targetId: 'isolated-browser-target-a' },
    })

    const stoppedSession = await runtime.stop(session.sessionId)

    expect(stoppedSession).toMatchObject({
      sessionId: session.sessionId,
      status: 'stopped',
      stoppedAt: 20,
    })
    expect(stopped).toEqual([session.sessionId])
    expect(runtime.selectTarget({ domains: ['docs.example.com'] })).toBeNull()
  })

  it('returns cloned sessions so callers cannot mutate runtime state', async () => {
    const runtime = new IsolatedBrowserTargetRuntime({
      idFactory: sequentialIds(['target-a', 'session-a']),
      now: sequentialNow([10]),
    })
    const session = await runtime.launch()
    const listed = runtime.listSessions()

    listed[0].status = 'stopped'
    listed[0].definition.target.label = 'mutated'

    expect(runtime.listSessions()).toHaveLength(1)
    const current = runtime.listSessions()[0]
    expect(current).toMatchObject({
      sessionId: session.sessionId,
      status: 'running',
      definition: {
        target: {
          label: 'Isolated Browser',
        },
      },
    })
  })
})

function sequentialIds(values: string[]): () => string {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 'id'
}

function sequentialNow(values: number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? 0
}
