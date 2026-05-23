import { describe, expect, it } from 'vitest'
import {
  COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  type ComputerAction,
} from '@/packages/computer-use-protocol'
import { MacOsAccessibilityActionProvider } from '../provider.js'

const baseAction: Omit<ComputerAction, 'kind' | 'input'> = {
  actionId: 'action-1',
  runId: 'run-1',
  target: {
    targetId: 'desktop:main',
    kind: 'desktop',
  },
  approvalId: 'approval-1',
  requestedAt: 10,
  schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
}

describe('MacOsAccessibilityActionProvider', () => {
  it('executes click actions through osascript with pixel coordinates', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const provider = new MacOsAccessibilityActionProvider({
      now: () => 20,
      execFile: (file, args) => {
        calls.push({ file, args })
        return Promise.resolve()
      },
    })

    await expect(provider.performAction({
      ...baseAction,
      kind: 'click',
      input: {
        point: { x: 42.4, y: 80.7 },
        viewportWidth: 100,
        viewportHeight: 100,
      },
    })).resolves.toMatchObject({
      ok: true,
      completedAt: 20,
    })
    expect(calls).toEqual([{
      file: 'osascript',
      args: ['-e', 'tell application "System Events" to click at {42, 81}'],
    }])
  })

  it('converts normalized coordinates when viewport bounds are provided', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const provider = new MacOsAccessibilityActionProvider({
      execFile: (file, args) => {
        calls.push({ file, args })
        return Promise.resolve()
      },
    })

    await provider.performAction({
      ...baseAction,
      kind: 'click',
      input: {
        x: 0.5,
        y: 0.25,
        coordinateSpace: 'normalized',
        viewportWidth: 200,
        viewportHeight: 100,
      },
    })

    expect(calls[0]).toEqual({
      file: 'osascript',
      args: ['-e', 'tell application "System Events" to click at {100, 25}'],
    })
  })

  it('executes type, hotkey, and scroll actions through osascript', async () => {
    const scripts: string[] = []
    const provider = new MacOsAccessibilityActionProvider({
      execFile: (_file, args) => {
        scripts.push(args[1] ?? '')
        return Promise.resolve()
      },
    })

    await provider.performAction({
      ...baseAction,
      kind: 'type',
      input: { text: 'hello "Telegraph"' },
    })
    await provider.performAction({
      ...baseAction,
      kind: 'hotkey',
      input: { keys: ['command', 'shift', 'p'] },
    })
    await provider.performAction({
      ...baseAction,
      kind: 'scroll',
      input: { deltaY: -4 },
    })

    expect(scripts).toEqual([
      'tell application "System Events" to keystroke "hello \\"Telegraph\\""',
      'tell application "System Events" to keystroke "p" using {command down, shift down}',
      'tell application "System Events" to scroll up by 4',
    ])
  })

  it('returns attributed failures without throwing', async () => {
    const provider = new MacOsAccessibilityActionProvider({
      now: () => 30,
      execFile: () => Promise.reject(new Error('accessibility denied')),
    })

    await expect(provider.performAction({
      ...baseAction,
      kind: 'click',
      input: {
        x: 10,
        y: 20,
        viewportWidth: 100,
        viewportHeight: 100,
      },
    })).resolves.toMatchObject({
      ok: false,
      completedAt: 30,
      failureReason: 'coordinate_mismatch',
      message: 'accessibility denied',
    })
  })

  it('executes wait actions without osascript', async () => {
    const calls: string[] = []
    const provider = new MacOsAccessibilityActionProvider({
      wait: ms => {
        calls.push(`wait:${String(ms)}`)
        return Promise.resolve()
      },
      execFile: file => {
        calls.push(file)
        return Promise.resolve()
      },
    })

    await provider.performAction({
      ...baseAction,
      kind: 'wait',
      input: { ms: 5 },
    })

    expect(calls).toEqual(['wait:5'])
  })
})
