import { describe, expect, it } from 'vitest'
import type { ObservationArtifactRef } from '@/packages/computer-use-protocol'
import {
  COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  type ActionResult,
  type ComputerAction,
  type ComputerTarget,
} from '@/packages/computer-use-protocol'
import { ComputerUseBroker } from '../ComputerUseBroker.js'
import type { ObservationArtifactStore, WriteObservationArtifactInput } from '../artifact-store.js'
import {
  jsonPayload,
  MacOsScreenCaptureObservationProvider,
  type ComputerActionProvider,
  type ComputerObservationProvider,
  type ObservationCaptureInput,
  type ObservationPayload,
} from '../provider.js'

const target: ComputerTarget = {
  targetId: 'desktop:main',
  kind: 'desktop',
  label: 'Main desktop',
}

describe('ComputerUseBroker', () => {
  it('stores screenshot bytes as artifact refs instead of embedding payloads', async () => {
    const store = new MemoryArtifactStore()
    const broker = new ComputerUseBroker(new FakeObservationProvider(), store)

    const [observation] = await broker.observe({
      runId: 'run-1',
      target,
      kinds: ['screenshot'],
      now: 100,
    })

    expect(observation).toMatchObject({
      runId: 'run-1',
      target,
      kind: 'screenshot',
      capturedAt: 100,
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
      artifactRef: {
        mediaType: 'image/png',
        sizeBytes: 7,
      },
    })
    expect('bytes' in observation).toBe(false)
    expect(store.writes[0]?.bytes.byteLength).toBe(7)
  })

  it('can capture multiple read-only observation kinds', async () => {
    const broker = new ComputerUseBroker(new FakeObservationProvider(), new MemoryArtifactStore())

    const observations = await broker.observe({
      runId: 'run-2',
      target,
      kinds: ['window_list', 'accessibility_tree'],
      now: 200,
    })

    expect(observations.map(observation => observation.kind)).toEqual(['window_list', 'accessibility_tree'])
    expect(observations.every(observation => observation.artifactRef.uri.startsWith('memory://'))).toBe(true)
  })

  it('redacts sensitive observation targets before calling the provider', async () => {
    const provider = new FakeObservationProvider()
    const store = new MemoryArtifactStore()
    const broker = new ComputerUseBroker(
      provider,
      store,
      undefined,
      undefined,
      {
        redactedAppIds: ['com.example.SecretApp'],
      },
    )

    const [observation] = await broker.observe({
      runId: 'run-redacted',
      target: {
        targetId: 'app:secret',
        kind: 'app',
        appId: 'com.example.SecretApp',
        label: 'Secret App',
      },
      kinds: ['screenshot'],
      now: 250,
    })

    expect(observation).toMatchObject({
      kind: 'screenshot',
      redactions: ['Observation redacted for target "app:secret".'],
      artifactRef: {
        mediaType: 'application/json',
        title: 'Secret App (redacted)',
      },
    })
    expect(provider.screenshotCaptures).toBe(0)
    expect(new TextDecoder().decode(store.writes[0]?.bytes)).toContain('"redacted": true')
  })

  it('denies sensitive observation targets before capture', async () => {
    const provider = new FakeObservationProvider()
    const broker = new ComputerUseBroker(
      provider,
      new MemoryArtifactStore(),
      undefined,
      undefined,
      {
        deniedTargetIds: ['desktop:main'],
      },
    )

    await expect(broker.observe({
      runId: 'run-denied',
      target,
      kinds: ['screenshot'],
      now: 260,
    })).rejects.toThrow('Observation denied for target "desktop:main".')
    expect(provider.screenshotCaptures).toBe(0)
  })

  it('does not broaden scoped macOS screenshot requests to the full desktop', async () => {
    const provider = new MacOsScreenCaptureObservationProvider()

    await expect(provider.captureScreenshot({
      target: {
        targetId: 'app:com.apple.TextEdit',
        kind: 'app',
        appId: 'com.apple.TextEdit',
      },
    })).rejects.toThrow('Scoped screenshot capture')
  })

  it('captures macOS window screenshots only when a numeric window id is present', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const removedPaths: string[] = []
    const provider = new MacOsScreenCaptureObservationProvider({
      tmpDir: '/tmp',
      idFactory: () => 'fixed',
      execFile: (file, args) => {
        calls.push({ file, args })
        return Promise.resolve()
      },
      readFile: () => Promise.resolve(new TextEncoder().encode('window-png')),
      rm: path => {
        removedPaths.push(path)
        return Promise.resolve()
      },
    })

    const payload = await provider.captureScreenshot({
      target: {
        targetId: 'window:42',
        kind: 'window',
        windowId: '42',
        label: 'Editor',
      },
    })

    expect(payload).toMatchObject({
      mediaType: 'image/png',
      title: 'Editor',
    })
    expect(calls).toEqual([{
      file: 'screencapture',
      args: ['-x', '-t', 'png', '-l', '42', '/tmp/telegraph-screenshot-fixed.png'],
    }])
    expect(removedPaths).toEqual(['/tmp/telegraph-screenshot-fixed.png'])

    await expect(provider.captureScreenshot({
      target: {
        targetId: 'window:not-numeric',
        kind: 'window',
        windowId: 'abc',
      },
    })).rejects.toThrow('requires a numeric windowId')
  })

  it('denies computer actions without approval', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
    )

    const result = await broker.act({
      runId: 'run-1',
      target,
      kind: 'click',
      now: 300,
    })

    expect(result).toMatchObject({
      runId: 'run-1',
      ok: false,
      failureReason: 'permission_denied',
      message: 'Computer action requires approval.',
      completedAt: 300,
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    })
    expect(actionProvider.actions).toEqual([])
  })

  it('can require approval only for selected app targets', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: false,
        allowedKinds: ['click'],
        captureBeforeAfter: false,
        approvalRequiredAppIds: ['com.example.SecretApp'],
      },
    )
    const secretTarget: ComputerTarget = {
      targetId: 'app:secret',
      kind: 'app',
      appId: 'com.example.SecretApp',
      label: 'Secret App',
    }

    const denied = await broker.act({
      runId: 'run-per-app',
      target: secretTarget,
      kind: 'click',
      now: 350,
    })

    expect(denied).toMatchObject({
      ok: false,
      failureReason: 'permission_denied',
      message: 'Computer action requires approval for app "com.example.SecretApp".',
      completedAt: 350,
    })

    await expect(broker.act({
      runId: 'run-per-app',
      target,
      kind: 'click',
      now: 351,
    })).resolves.toMatchObject({ ok: true })

    await expect(broker.act({
      runId: 'run-per-app',
      target: secretTarget,
      kind: 'click',
      approvalId: 'approval-secret',
      now: 352,
    })).resolves.toMatchObject({ ok: true })
    expect(actionProvider.actions).toHaveLength(2)
  })

  it('runs approved computer actions through the action provider', async () => {
    const actionProvider = new FakeActionProvider()
    const store = new MemoryArtifactStore()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      store,
      actionProvider,
    )

    const result = await broker.act({
      runId: 'run-2',
      target,
      kind: 'type',
      input: { text: 'hello' },
      approvalId: 'approval-1',
      now: 400,
    })

    expect(result).toMatchObject({
      runId: 'run-2',
      ok: true,
      afterObservationRef: {
        mediaType: 'image/png',
      },
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    })
    expect(actionProvider.actions).toEqual([expect.objectContaining({
      runId: 'run-2',
      kind: 'type',
      input: { text: 'hello' },
      approvalId: 'approval-1',
      beforeObservationRef: expect.objectContaining({
        mediaType: 'image/png',
      }),
    })])
    expect(store.writes).toHaveLength(2)
    expect(broker.getActionCount('run-2')).toBe(1)
  })

  it('enforces per-run action budgets before invoking the provider', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: true,
        allowedKinds: ['click'],
        maxActionsPerRun: 1,
        captureBeforeAfter: false,
      },
    )

    await expect(broker.act({
      runId: 'run-budget',
      target,
      kind: 'click',
      approvalId: 'approval-1',
      now: 500,
    })).resolves.toMatchObject({ ok: true })

    const second = await broker.act({
      runId: 'run-budget',
      target,
      kind: 'click',
      approvalId: 'approval-2',
      now: 510,
    })

    expect(second).toMatchObject({
      ok: false,
      failureReason: 'budget_exceeded',
      completedAt: 510,
    })
    expect(actionProvider.actions).toHaveLength(1)
  })

  it('rejects normalized coordinates outside the expected range', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: true,
        allowedKinds: ['click'],
        captureBeforeAfter: false,
      },
    )

    const result = await broker.act({
      runId: 'run-coordinate',
      target,
      kind: 'click',
      input: {
        x: 1.2,
        y: 0.5,
        coordinateSpace: 'normalized',
      },
      approvalId: 'approval-1',
      now: 520,
    })

    expect(result).toMatchObject({
      ok: false,
      failureReason: 'coordinate_mismatch',
      message: 'Normalized coordinates must be between 0 and 1.',
      completedAt: 520,
    })
    expect(actionProvider.actions).toHaveLength(0)
  })

  it('rejects pixel coordinates outside the declared viewport', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: true,
        allowedKinds: ['click'],
        captureBeforeAfter: false,
      },
    )

    const result = await broker.act({
      runId: 'run-viewport',
      target,
      kind: 'click',
      input: {
        point: { x: 20, y: 30 },
        viewportWidth: 10,
        viewportHeight: 10,
      },
      approvalId: 'approval-1',
      now: 530,
    })

    expect(result).toMatchObject({
      ok: false,
      failureReason: 'coordinate_mismatch',
      message: 'Pixel coordinates are outside the viewport bounds.',
      completedAt: 530,
    })
    expect(actionProvider.actions).toHaveLength(0)
  })

  it('rejects stale observation references before invoking the provider', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: true,
        allowedKinds: ['click'],
        captureBeforeAfter: false,
        maxObservationAgeMs: 5_000,
      },
    )

    const result = await broker.act({
      runId: 'run-stale',
      target,
      kind: 'click',
      input: {
        x: 0.5,
        y: 0.5,
        coordinateSpace: 'normalized',
        observationCapturedAt: 1_000,
      },
      approvalId: 'approval-1',
      now: 7_000,
    })

    expect(result).toMatchObject({
      ok: false,
      failureReason: 'stale_ref',
      message: 'Computer action observation reference is stale by 6000ms.',
      completedAt: 7_000,
    })
    expect(actionProvider.actions).toHaveLength(0)
  })

  it('accepts fresh normalized coordinates', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
      {
        requireApproval: true,
        allowedKinds: ['click'],
        captureBeforeAfter: false,
        maxObservationAgeMs: 5_000,
      },
    )

    const result = await broker.act({
      runId: 'run-fresh',
      target,
      kind: 'click',
      input: {
        x: 0.5,
        y: 0.5,
        coordinateSpace: 'normalized',
        observationCapturedAt: 1_000,
      },
      approvalId: 'approval-1',
      now: 5_000,
    })

    expect(result).toMatchObject({
      ok: true,
      runId: 'run-fresh',
    })
    expect(actionProvider.actions).toHaveLength(1)
  })

  it('honors global stop until it is cleared', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FakeObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
    )

    broker.stopAll('Emergency stop')
    await expect(broker.act({
      runId: 'run-stop',
      target,
      kind: 'click',
      approvalId: 'approval-1',
      now: 600,
    })).resolves.toMatchObject({
      ok: false,
      failureReason: 'stopped',
      message: 'Emergency stop',
    })

    broker.clearStop()
    await expect(broker.act({
      runId: 'run-stop',
      target,
      kind: 'click',
      approvalId: 'approval-2',
      now: 610,
    })).resolves.toMatchObject({ ok: true })
    expect(actionProvider.actions).toHaveLength(1)
  })

  it('returns an attributed action result when observation fails', async () => {
    const actionProvider = new FakeActionProvider()
    const broker = new ComputerUseBroker(
      new FailingObservationProvider(),
      new MemoryArtifactStore(),
      actionProvider,
    )

    const result = await broker.act({
      runId: 'run-observation-failure',
      target,
      kind: 'click',
      approvalId: 'approval-1',
      now: 700,
    })

    expect(result).toMatchObject({
      runId: 'run-observation-failure',
      ok: false,
      failureReason: 'unknown',
      message: 'capture failed',
    })
    expect(actionProvider.actions).toEqual([])
  })
})

class FakeObservationProvider implements ComputerObservationProvider {
  screenshotCaptures = 0

  captureScreenshot(input: ObservationCaptureInput): Promise<ObservationPayload> {
    this.screenshotCaptures += 1
    return Promise.resolve({
      bytes: new TextEncoder().encode('pngdata'),
      mediaType: 'image/png',
      title: input.target.label,
    })
  }

  listWindows(input: ObservationCaptureInput): Promise<ObservationPayload> {
    return Promise.resolve(jsonPayload({
      target: input.target.targetId,
      windows: [{ id: 'window-1', title: 'Telegraph' }],
    }, 'Window list'))
  }

  snapshotAccessibilityTree(input: ObservationCaptureInput): Promise<ObservationPayload> {
    return Promise.resolve(jsonPayload({
      target: input.target.targetId,
      nodes: [],
    }, 'Accessibility tree'))
  }
}

class MemoryArtifactStore implements ObservationArtifactStore {
  readonly writes: WriteObservationArtifactInput[] = []

  writeArtifact(input: WriteObservationArtifactInput): Promise<ObservationArtifactRef> {
    this.writes.push(input)
    return Promise.resolve({
      artifactId: `artifact-${String(this.writes.length)}`,
      uri: `memory://artifact-${String(this.writes.length)}`,
      mediaType: input.mediaType,
      title: input.title,
      sizeBytes: input.bytes.byteLength,
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
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    })
  }
}

class FailingObservationProvider extends FakeObservationProvider {
  override captureScreenshot(): Promise<ObservationPayload> {
    return Promise.reject(new Error('capture failed'))
  }
}
