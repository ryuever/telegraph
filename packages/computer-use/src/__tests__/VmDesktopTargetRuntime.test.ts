import { describe, expect, it } from 'vitest'
import {
  VmDesktopTargetRuntime,
  assertLaunchableVmDesktopTarget,
  createVmDesktopTargetDefinition,
  validateLaunchableVmDesktopTarget,
  type VmDesktopLauncher,
} from '../vm-desktop-runtime.js'

describe('VmDesktopTargetRuntime', () => {
  it('creates safe VM desktop target definitions by default', () => {
    const definition = createVmDesktopTargetDefinition({
      targetId: 'vm-1',
      domains: ['example.com'],
      vmImageRef: 'vm-image://ubuntu-browser',
      vmTemplateId: 'template-browser',
      computeProfile: 'small',
    })

    expect(definition).toMatchObject({
      target: {
        targetId: 'vm-1',
        kind: 'vm',
        scope: {
          includeDomains: ['example.com'],
        },
      },
      trustLevel: 'managed-vm',
      persistent: false,
      networkPolicy: {
        mode: 'allowlist',
        allowedDomains: ['example.com'],
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
      metadata: {
        runtime: 'vm-desktop',
        vmImageRef: 'vm-image://ubuntu-browser',
        vmTemplateId: 'template-browser',
        computeProfile: 'small',
      },
    })
    expect(validateLaunchableVmDesktopTarget(definition)).toEqual([])
  })

  it('rejects unsafe VM launch definitions', () => {
    expect(() => {
      assertLaunchableVmDesktopTarget({
        target: { targetId: 'desktop-1', kind: 'desktop' },
        trustLevel: 'user-desktop',
        networkPolicy: { mode: 'open' },
        profileSync: { mode: 'none', homeMount: 'selected-paths-readwrite' },
        artifactTransfer: { exportMode: 'workspace-scoped', importMode: 'workspace-scoped' },
      })
    }).toThrow('VM desktop runtime requires target kind "vm"')
  })

  it('launches and selects VM desktop sessions through an injected launcher', async () => {
    const launched: string[] = []
    const stopped: string[] = []
    const launcher: VmDesktopLauncher = {
      launch: definition => {
        launched.push(definition.target.targetId)
        return Promise.resolve({ runtimeHandle: `vm-handle:${definition.target.targetId}` })
      },
      stop: session => {
        stopped.push(session.sessionId)
        return Promise.resolve()
      },
    }
    const runtime = new VmDesktopTargetRuntime({
      launcher,
      idFactory: sequentialIds(['target-a', 'session-a']),
      now: sequentialNow([10, 20]),
    })

    const session = await runtime.launch({
      domains: ['docs.example.com'],
      label: 'Docs VM',
      homeMount: 'selected-paths-readonly',
    })

    expect(session).toMatchObject({
      sessionId: 'vm-desktop-session-session-a',
      status: 'running',
      runtimeHandle: 'vm-handle:vm-desktop-target-a',
      launchedAt: 10,
      definition: {
        target: {
          targetId: 'vm-desktop-target-a',
          kind: 'vm',
          label: 'Docs VM',
        },
        profileSync: {
          homeMount: 'selected-paths-readonly',
        },
      },
    })
    expect(launched).toEqual(['vm-desktop-target-a'])
    expect(runtime.selectTarget({ domains: ['docs.example.com'] })).toMatchObject({
      target: { targetId: 'vm-desktop-target-a' },
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

  it('returns cloned sessions so callers cannot mutate VM runtime state', async () => {
    const runtime = new VmDesktopTargetRuntime({
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
          label: 'VM Desktop',
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
