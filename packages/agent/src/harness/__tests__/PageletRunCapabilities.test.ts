import type { AgentEvent } from '@/packages/agent-protocol'
import {
  ComputerUseBroker,
  jsonPayload,
  type ComputerActionProvider,
  type ComputerObservationProvider,
  type ObservationArtifactStore,
  type ObservationCaptureInput,
  type ObservationPayload,
  type WriteObservationArtifactInput,
} from '@/packages/computer-use'
import type { ActionResult, ComputerAction } from '@/packages/computer-use-protocol'
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

  it('enables read-only computer observation only for computer profiles', async () => {
    const host = await register({
      taskCapabilityProfile: {
        kind: 'computer-observe',
        scopes: ['desktop:read'],
      },
    }, {
      computerUseBroker: new ComputerUseBroker(
        new FakeObservationProvider(),
        new MemoryObservationArtifactStore(),
      ),
    })

    expect(host.has('process')).toBe(false)
    expect(host.has('filesystem')).toBe(false)
    expect(host.has('patch')).toBe(false)
    expect(host.has('tool', 'computer.observe')).toBe(true)

    const output = await host.getTool('computer.observe')?.execute({
      target: {
        targetId: 'desktop:main',
        kind: 'desktop',
        label: 'Main desktop',
      },
      kinds: ['window_list'],
    })

    expect(output).toMatchObject({
      observations: [{
        runId: 'run-pagelet-capabilities',
        kind: 'window_list',
        target: {
          targetId: 'desktop:main',
          kind: 'desktop',
        },
        artifactRef: {
          mediaType: 'application/json',
          uri: 'memory://window_list',
        },
      }],
    })

    await expect(host.getTool('computer.observe')?.execute({
      target: {
        targetId: 'app:com.apple.TextEdit',
        kind: 'app',
        appId: 'com.apple.TextEdit',
      },
      kinds: ['window_list'],
    })).rejects.toThrow('outside the allowed observation scopes')
  })

  it('enables controlled computer actions only for computer-act profiles', async () => {
    const actionProvider = new FakeActionProvider()
    const host = await register({
      taskCapabilityProfile: {
        kind: 'computer-act',
        scopes: ['desktop:act', 'desktop:read'],
        actions: ['click'],
      },
    }, {
      computerUseBroker: new ComputerUseBroker(
        new FakeObservationProvider(),
        new MemoryObservationArtifactStore(),
        actionProvider,
        {
          requireApproval: true,
          allowedKinds: ['click', 'type', 'hotkey', 'scroll', 'wait'],
          captureBeforeAfter: false,
        },
      ),
    })

    expect(host.has('tool', 'computer.observe')).toBe(true)
    expect(host.has('tool', 'computer.act')).toBe(true)

    await expect(host.getTool('computer.act')?.execute({
      kind: 'type',
      input: { text: 'hello' },
      approvalId: 'approval-1',
    })).rejects.toThrow('outside the allowed action profile')

    const denied = await host.getTool('computer.act')?.execute({
      kind: 'click',
      input: {
        x: 0.5,
        y: 0.5,
        coordinateSpace: 'normalized',
      },
    })

    expect(denied).toMatchObject({
      ok: false,
      failureReason: 'permission_denied',
      message: 'Computer action requires approval.',
    })

    const result = await host.getTool('computer.act')?.execute({
      kind: 'click',
      input: {
        x: 0.5,
        y: 0.5,
        coordinateSpace: 'normalized',
      },
      approvalId: 'approval-1',
    })

    expect(result).toMatchObject({
      ok: true,
      runId: 'run-pagelet-capabilities',
    })
    expect(actionProvider.actions).toEqual([
      expect.objectContaining({
        runId: 'run-pagelet-capabilities',
        kind: 'click',
        approvalId: 'approval-1',
      }),
    ])
  })
})

async function register(
  settings: Parameters<typeof createPageletRunCapabilities>[0]['settings'],
  overrides: Partial<Parameters<typeof createPageletRunCapabilities>[0]> = {},
): Promise<CapabilityHost> {
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
    ...overrides,
  })

  for (const capability of capabilities) {
    await capability({ host, hooks })
  }

  expect(events).toEqual([])
  return host
}

class FakeObservationProvider implements ComputerObservationProvider {
  captureScreenshot(input: ObservationCaptureInput): Promise<ObservationPayload> {
    return Promise.resolve(jsonPayload({ target: input.target, screenshot: true }, 'Screenshot'))
  }

  listWindows(input: ObservationCaptureInput): Promise<ObservationPayload> {
    return Promise.resolve(jsonPayload({ target: input.target, windows: [] }, 'Window list'))
  }
}

class MemoryObservationArtifactStore implements ObservationArtifactStore {
  writeArtifact(input: WriteObservationArtifactInput) {
    return Promise.resolve({
      artifactId: `artifact-${input.kind}`,
      uri: `memory://${input.kind}`,
      mediaType: input.mediaType,
      title: input.title,
      sizeBytes: input.bytes.byteLength,
      sha256: 'sha256-test',
    })
  }
}

class FakeActionProvider implements ComputerActionProvider {
  readonly actions: ComputerAction[] = []

  performAction(action: ComputerAction): Promise<ActionResult> {
    this.actions.push(action)
    return Promise.resolve({
      actionId: action.actionId,
      runId: action.runId,
      ok: true,
      completedAt: action.requestedAt + 1,
      schemaVersion: 1,
    })
  }
}
